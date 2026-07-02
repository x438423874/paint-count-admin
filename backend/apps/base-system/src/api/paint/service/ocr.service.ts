import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { MetricsService } from '@lib/shared/metrics/metrics.service';
import { PaddleOcrService } from './paddle-ocr.service';
import { OcrAnnotationService, AggregatedTemplate } from './ocr-annotation.service';

// 中国车牌正则（含新能源车牌：如粤EZ9A33、粤AD12345）
const PLATE_REGEX = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-HJ-NP-Z0-9]{4,6}[A-HJ-NP-Z0-9挂学警港澳]?/;

// 工单号正则
const ORDER_NO_REGEX = /(?:工单[号编码]?[:\s]*)?([A-Za-z]{0,3}[-]?\d{6,})/;

// 客户名称正则：2-4个中文字符，通常在"客户名称"/"客户"/"姓名"/"车主"标签后
// 注意：长标签（客户名称、客户姓名）必须放在短标签（客户）前面，否则"客户"会先匹配，
// 把"名称"当作值返回（如"客户名称：翟鹏国"会错误匹配出"名称"）
const CUSTOMER_NAME_REGEX = /(?:客户名称[:\s]*|客户姓名[:\s]*|客户[:\s]*|姓名[:\s]*|车主[:\s]*|送修人[:\s]*)([\u4e00-\u9fa5]{2,4})/;

// 电话正则：手机号或座机（严格匹配，避免日期被误识别）
const PHONE_REGEX = /(?:电话[:\s]*|手机[:\s]*|联系方式[:\s]*|联系电话[:\s]*)?(1[3-9]\d{9}|0\d{2,3}-?\d{7,8})/;

// 车型正则：中文+字母数字组合，在"车型"标签后
const CAR_MODEL_REGEX = /(?:车型[:\s]*|车辆型号[:\s]*|车辆类型[:\s]*)([\u4e00-\u9fa5A-Za-z0-9\-]+)/;

// 日期正则：匹配 YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYY年MM月DD日 / YYYYMMDD
const DATE_REGEX = /(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})日?/;

/** 字段别名配置：每个字段对应的标签词列表 */
export type FieldLabelsConfig = Record<string, string[]>;

/** 默认字段别名配置（所有门店的回退值） */
export const DEFAULT_FIELD_LABELS: FieldLabelsConfig = {
  orderNo: ['工单号', '作业单号', '单号', '工单编号', '编号', '订单号', '维修单号', '派工单'],
  plateNumber: ['车牌号', '车牌', '号牌', '车牌号码'],
  customerName: ['客户名称', '客户姓名', '车主姓名', '客户', '姓名', '车主', '送修人'],
  phone: ['手机号', '送修人手机', '联系电话', '电话', '手机', '联系方式', '联系手机', '联系人'],
  carModel: ['车型', '车名车型', '车辆型号', '车型型号', '车辆类型', '厂牌车名', '车系'],
  // 日期标签按优先级排序：接车 > 开单 > 进厂 > 打印
  date: ['接车日期', '接车时间', '开单日期', '开单时间', '进厂日期', '进厂时间', '打印日期', '打印时间'],
};

/** 日期标签优先级分组（用于按优先级提取日期） */
export const DATE_LABEL_PRIORITY = [
  { labels: ['接车日期', '接车时间'], name: '接车日期' },
  { labels: ['开单日期', '开单时间'], name: '开单日期' },
  { labels: ['进厂日期', '进厂时间'], name: '进厂日期' },
  { labels: ['打印日期', '打印时间'], name: '打印日期' },
];

/** 工单类型 */
type WorkOrderType = 'repair' | 'entrust' | 'unknown';

/** 根据图片标题/关键字检测工单类型 */
function detectWorkOrderType(texts: string[]): WorkOrderType {
  const fullText = texts.join('');
  if (/客户委托修理单|委托修理|修理单/.test(fullText)) return 'entrust';
  if (/维修工单|接车单|施工单/.test(fullText)) return 'repair';
  return 'unknown';
}

export interface OcrResult {
  plateNumber: string;
  orderNo: string;
  customerName: string;
  phone: string;
  carModel: string;
  date: string;
  rawText: string;
}

/** OCR模板中单个字段的区域配置 */
export interface OcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** OCR模板配置 */
export interface OcrTemplateConfig {
  /** 模板名称 */
  name: string;
  /** 原图宽度（用于坐标归一化） */
  imageWidth: number;
  /** 原图高度（用于坐标归一化） */
  imageHeight: number;
  /** 各字段区域映射 */
  regions: {
    orderNo?: OcrRegion;
    plateNumber?: OcrRegion;
    customerName?: OcrRegion;
    phone?: OcrRegion;
    carModel?: OcrRegion;
    date?: OcrRegion;
  };
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paddleOcr: PaddleOcrService,
    private readonly annotationService: OcrAnnotationService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * 智能标注：使用 PaddleOCR 全图识别文本块，根据关键字自动定位字段区域
   * 返回每个字段的建议区域坐标（绝对像素坐标）
   * @param fieldLabelsConfig 门店字段别名配置，未传则使用默认配置
   */
  async smartAnnotate(buffer: Buffer, fieldLabelsConfig?: FieldLabelsConfig): Promise<Record<string, OcrRegion | null>> {
    const paddleAvailable = await this.paddleOcr.isAvailable().catch(() => false);
    if (!paddleAvailable) {
      throw new Error('PaddleOCR 服务不可用，无法进行智能标注');
    }

    // 全图识别获取文本块
    const blocks = await this.paddleOcr.recognizeFullImage(buffer);
    if (!blocks || blocks.length === 0) {
      return { orderNo: null, plateNumber: null, customerName: null, phone: null, carModel: null, date: null };
    }

    // 解析文本块坐标
    const parsedBlocks = blocks.map(block => {
      const box = block.box;
      let x: number, y: number, width: number, height: number;

      if (Array.isArray(box) && box.length === 4 && Array.isArray(box[0])) {
        const xs = box.map((p: number[]) => p[0]);
        const ys = box.map((p: number[]) => p[1]);
        x = Math.min(...xs);
        y = Math.min(...ys);
        width = Math.max(...xs) - x;
        height = Math.max(...ys) - y;
      } else {
        x = 0; y = 0; width = 0; height = 0;
      }

      return {
        text: block.text,
        confidence: block.confidence,
        x, y, width, height,
        cx: x + width / 2,
        cy: y + height / 2,
      };
    });

    this.logger.debug(`智能标注: 识别到 ${parsedBlocks.length} 个文本块`);

    // 字段标签配置：优先使用传入的门店配置，否则使用默认配置
    const config = fieldLabelsConfig || DEFAULT_FIELD_LABELS;

    const fieldLabels = [
      { field: 'orderNo', labels: config.orderNo || DEFAULT_FIELD_LABELS.orderNo },
      { field: 'plateNumber', labels: config.plateNumber || DEFAULT_FIELD_LABELS.plateNumber },
      { field: 'customerName', labels: config.customerName || DEFAULT_FIELD_LABELS.customerName },
      { field: 'phone', labels: config.phone || DEFAULT_FIELD_LABELS.phone },
      { field: 'carModel', labels: config.carModel || DEFAULT_FIELD_LABELS.carModel },
      { field: 'date', labels: config.date || DEFAULT_FIELD_LABELS.date },
    ];

    // 所有标签集合（用于排除标签块，不作为值）= 配置的所有标签 + 常见干扰词
    const allLabels = new Set<string>([
      ...config.orderNo || [], ...config.plateNumber || [],
      ...config.customerName || [], ...config.phone || [],
      ...config.carModel || [], ...config.date || [],
      // 常见干扰词（非字段值）
      '车架号', '发动机号', 'VIN', '名称',
      '里程', '接车人', '预交车日',
      '作业项目名称', '工时', '工时费', '维修班组', '维修人',
    ]);

    const result: Record<string, OcrRegion | null> = {};

    for (const fieldLabel of fieldLabels) {
      // 1. 找标签块（最长匹配优先）
      let labelBlock: typeof parsedBlocks[0] | null = null;
      let matchedLabelLength = 0;

      for (const block of parsedBlocks) {
        const cleanText = block.text.replace(/[：:]/g, '').trim();
        for (const label of fieldLabel.labels) {
          if (cleanText.includes(label) && label.length > matchedLabelLength) {
            labelBlock = block;
            matchedLabelLength = label.length;
          }
        }
      }

      if (!labelBlock) {
        this.logger.debug(`智能标注: ${fieldLabel.field} 未找到标签`);
        result[fieldLabel.field] = null;
        continue;
      }

      this.logger.debug(`智能标注: ${fieldLabel.field} 找到标签块 "${labelBlock.text}" at (${labelBlock.x}, ${labelBlock.y})`);

      // 2. 尝试从标签文本块自身提取内联值（如"车牌号：粤E2T9B0"）
      const labelRegex = new RegExp(`(?:${fieldLabel.labels.join('|')})[：:\\s]*([\\S]+)`, 'i');
      const inlineMatch = labelBlock.text.match(labelRegex);
      if (inlineMatch && inlineMatch[1]) {
        // 有内联值，标签和值在同一文本块中
        // 估算值区域的坐标：标签宽度之后的部分
        const labelText = labelBlock.text;
        const valueStartIdx = labelText.indexOf(inlineMatch[1]);
        if (valueStartIdx > 0) {
          const ratio = valueStartIdx / labelText.length;
          const valueX = labelBlock.x + labelBlock.width * ratio;
          const valueWidth = labelBlock.width * (1 - ratio);
          result[fieldLabel.field] = {
            x: Math.round(valueX),
            y: Math.round(labelBlock.y),
            width: Math.round(valueWidth),
            height: Math.round(labelBlock.height),
          };
          this.logger.debug(`智能标注: ${fieldLabel.field} 内联值 "${inlineMatch[1]}" region=(${valueX}, ${labelBlock.y})`);
          continue;
        }
      }

      // 3. 没有内联值时，找标签右侧或下方最近的文本块作为值区域
      let bestValueBlock: typeof parsedBlocks[0] | null = null;
      let bestDistance = Infinity;
      let bestIsRight = false; // 优先右侧

      for (const block of parsedBlocks) {
        if (block === labelBlock) continue;

        // 排除其他标签块
        const cleanText = block.text.replace(/[：:]/g, '').trim();
        let isLabel = false;
        for (const l of allLabels) {
          if (cleanText === l || cleanText.startsWith(l)) {
            isLabel = true;
            break;
          }
        }
        if (isLabel) continue;

        // 判断位置关系
        const isRight = block.cx > labelBlock.cx + labelBlock.width * 0.3 &&
          Math.abs(block.cy - labelBlock.cy) < labelBlock.height * 1.5;
        const isBelow = block.cy > labelBlock.cy + labelBlock.height * 0.5 &&
          Math.abs(block.cx - labelBlock.cx) < labelBlock.width * 3;

        if (!isRight && !isBelow) continue;

        const dx = block.cx - labelBlock.cx;
        const dy = block.cy - labelBlock.cy;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 右侧优先（距离权重更小）
        const weightedDistance = isRight ? distance : distance * 1.5;

        if (weightedDistance < bestDistance) {
          bestDistance = weightedDistance;
          bestValueBlock = block;
          bestIsRight = isRight;
        }
      }

      if (bestValueBlock) {
        // 扩展值区域：向右扩展一些，确保完整覆盖值文本
        const expand = Math.round(bestValueBlock.width * 0.1);
        result[fieldLabel.field] = {
          x: Math.max(0, Math.round(bestValueBlock.x - expand * 0.5)),
          y: Math.round(bestValueBlock.y),
          width: Math.round(bestValueBlock.width + expand),
          height: Math.round(bestValueBlock.height),
        };
        this.logger.debug(`智能标注: ${fieldLabel.field} 值块 "${bestValueBlock.text}" ${bestIsRight ? '右侧' : '下方'} region=(${bestValueBlock.x}, ${bestValueBlock.y})`);
      } else {
        // 没找到值块，使用标签右侧区域作为建议
        result[fieldLabel.field] = {
          x: Math.round(labelBlock.x + labelBlock.width + 5),
          y: Math.round(labelBlock.y),
          width: Math.round(labelBlock.width * 1.5),
          height: Math.round(labelBlock.height),
        };
        this.logger.debug(`智能标注: ${fieldLabel.field} 未找到值块，使用标签右侧建议区域`);
      }
    }

    return result;
  }

  /**
   * 模板区域识别：根据门店OCR模板配置，裁剪各字段区域分别识别
   * 优先使用 PaddleOCR 关键字定位提取（不依赖固定坐标）
   */
  async recognizeWithTemplate(buffer: Buffer, shopId?: string): Promise<OcrResult> {
    // 检查 PaddleOCR 服务是否可用
    const paddleAvailable = await this.paddleOcr.isAvailable().catch(() => false);
    if (!paddleAvailable) {
      throw new Error('PaddleOCR 服务未启动，无法进行 OCR 识别。请启动 PaddleOCR 服务（端口 8500）后重试。');
    }

    // 加载门店字段别名配置（未配置则使用默认）
    const fieldLabelsConfig = shopId
      ? await this.getShopFieldLabels(shopId).catch(() => DEFAULT_FIELD_LABELS)
      : DEFAULT_FIELD_LABELS;

    // 预加载门店模板（用于判断是否有已验证的区域标注）
    let template: OcrTemplateConfig | null = null;
    if (shopId) {
      template = await this.getShopOcrTemplate(shopId).catch(() => null);
    }
    const hasVerifiedRegions = !!(template && this.hasValidRegions(template));

    try {
      // 策略1：PaddleOCR 全图识别 + 关键字定位提取（最稳定，不依赖坐标）
      this.logger.log('使用 PaddleOCR 关键字定位提取...');
      const keywordResult = await this.recognizeByPaddleOcrKeyword(buffer, fieldLabelsConfig);
      const keywordScore = this.scoreResult(keywordResult);
      this.logger.log(`关键字定位提取: 识别到 ${keywordScore} 个字段`);

      // 策略2：如果有已验证的区域标注，优先使用区域识别并融合
      // 这是自主学习的关键：用户标注的区域应发挥主导作用，而非仅作为补充
      if (hasVerifiedRegions && template) {
        this.logger.log('检测到已验证区域标注，使用 PaddleOCR 区域识别...');
        const regionResult = await this.recognizeByPaddleOcr(buffer, template);
        const regionScore = this.scoreResult(regionResult);
        this.logger.log(`区域识别: 识别到 ${regionScore} 个字段`);

        // 智能融合：区域标注的字段优先（用户标注的位置更精准），
        // 关键字定位补充区域未覆盖的字段
        const merged = this.smartMergeResults(regionResult, keywordResult);
        const mergedScore = this.scoreResult(merged);
        this.logger.log(`融合结果: ${mergedScore} 个字段 (区域=${regionScore}, 关键字=${keywordScore})`);

        if (mergedScore > 0) {
          let result = merged;
          if (shopId) {
            result = await this.correctWithAnnotations(shopId, result);
          }
          return this.sanitizeResult(result);
        }
      }

      // 无区域标注或区域识别无结果时，使用关键字定位结果
      if (keywordScore >= 3) {
        this.logger.log('PaddleOCR 关键字定位提取成功');
        let result = keywordResult;
        if (shopId) {
          result = await this.correctWithAnnotations(shopId, result);
        }
        return this.sanitizeResult(result);
      }

      // 关键字识别字段较少时，尝试区域识别补充（即使模板未达到"已验证"标准）
      if (hasVerifiedRegions && template && keywordScore < 3) {
        this.logger.log('使用 PaddleOCR 区域识别补充...');
        const regionResult = await this.recognizeByPaddleOcr(buffer, template);
        // 合并：关键字结果为主，区域识别补充空字段
        const merged = this.mergeResults(keywordResult, regionResult);
        const mergedScore = this.scoreResult(merged);
        if (mergedScore > keywordScore) {
          this.logger.log(`区域识别补充了 ${mergedScore - keywordScore} 个字段`);
          let result = merged;
          if (shopId) {
            result = await this.correctWithAnnotations(shopId, result);
          }
          return this.sanitizeResult(result);
        }
      }

      if (keywordScore > 0) {
        // 使用标注数据纠错
        if (shopId) {
          return this.sanitizeResult(await this.correctWithAnnotations(shopId, keywordResult));
        }
        return this.sanitizeResult(keywordResult);
      }

      // 策略3：PaddleOCR 全图识别 + 正则提取
      this.logger.log('使用 PaddleOCR 全图正则提取...');
      const fullResult = await this.recognizeByPaddleOcrFullImage(buffer);
      if (this.scoreResult(fullResult) > 0) {
        this.logger.log('PaddleOCR 全图正则提取成功');
        // 使用标注数据纠错
        if (shopId) {
          return this.sanitizeResult(await this.correctWithAnnotations(shopId, fullResult));
        }
        return this.sanitizeResult(fullResult);
      }

      this.logger.warn('PaddleOCR 所有策略均未识别到有效字段');
      this.metricsService.recordOcrRecognition(shopId || 'unknown', true);
      return this.sanitizeResult(keywordResult);
    } catch (e) {
      this.logger.error(`PaddleOCR 识别失败: ${e instanceof Error ? e.message : e}`);
      this.metricsService.recordOcrRecognition(shopId || 'unknown', false);
      throw e;
    }
  }

  /**
   * 智能融合区域识别和关键字识别结果
   * 策略：区域标注的字段优先（用户标注的位置更精准），关键字补充未识别字段
   * 当区域识别结果为空但关键字有值时，回退使用关键字结果
   */
  private smartMergeResults(regionResult: OcrResult, keywordResult: OcrResult): OcrResult {
    const fields: Array<keyof OcrResult> = ['plateNumber', 'orderNo', 'customerName', 'phone', 'carModel', 'date'];

    const merged: OcrResult = {
      plateNumber: '',
      orderNo: '',
      customerName: '',
      phone: '',
      carModel: '',
      date: '',
      rawText: regionResult.rawText || keywordResult.rawText,
    };

    for (const field of fields) {
      const regionValue = (regionResult as any)[field] as string;
      const keywordValue = (keywordResult as any)[field] as string;

      if (regionValue && keywordValue) {
        // 两者都有值：优先使用区域识别结果（用户标注的位置更精准）
        // 但如果区域结果明显是错误格式（如车牌缺少省份），使用关键字结果
        if (field === 'plateNumber' && !PLATE_REGEX.test(regionValue) && PLATE_REGEX.test(keywordValue)) {
          (merged as any)[field] = keywordValue;
        } else {
          (merged as any)[field] = regionValue;
        }
      } else if (regionValue) {
        (merged as any)[field] = regionValue;
      } else if (keywordValue) {
        (merged as any)[field] = keywordValue;
      }
    }

    return merged;
  }

  /**
   * 使用标注数据（ground truth）纠错OCR结果
   * 原理：从同门店的标注数据中获取已知正确值，
   * 通过编辑距离模糊匹配来纠正OCR识别的常见错误
   *
   * 注意：客户名称、电话等每单不同的字段不参与纠错，
   * 因为不同工单的值本来就不一样，用其他工单的值纠错会导致错误替换。
   * 只有格式固定的字段（如车牌号、工单号）适合纠错。
   */
  private async correctWithAnnotations(shopId: string, result: OcrResult): Promise<OcrResult> {
    try {
      const annotations = await this.annotationService.getAnnotations(shopId, 1, 200);
      if (!annotations || annotations.list.length === 0) {
        return result;
      }

      const corrected = { ...result };

      // 收集 ground truth 值，按字段分组
      const truthByField: Record<string, string[]> = {
        plateNumber: [],
        orderNo: [],
        carModel: [],
      };

      for (const ann of annotations.list) {
        if (ann.groundTruth) {
          for (const field of Object.keys(truthByField)) {
            const value = (ann.groundTruth as any)[field];
            if (value && typeof value === 'string' && value.trim()) {
              truthByField[field].push(value.trim());
            }
          }
        }
      }

      // 1. 车牌号：规则纠错 + 格式校验
      if (corrected.plateNumber) {
        corrected.plateNumber = this.correctPlateNumber(
          corrected.plateNumber,
          truthByField.plateNumber,
        );
      }

      // 2. 工单号：格式校验 + 前缀/长度学习
      if (corrected.orderNo) {
        corrected.orderNo = this.correctOrderNo(
          corrected.orderNo,
          truthByField.orderNo,
        );
      }

      // 3. 车型：基于常见车型库做模糊匹配
      if (corrected.carModel) {
        corrected.carModel = this.correctCarModel(
          corrected.carModel,
          truthByField.carModel,
        );
      }

      // 4. 日期格式标准化
      if (corrected.date) {
        corrected.date = this.normalizeDateFormat(corrected.date);
      }

      return corrected;
    } catch (e) {
      this.logger.warn(`标注数据纠错失败: ${e instanceof Error ? e.message : e}`);
      return result;
    }
  }

  /**
   * 车牌号纠错
   * 1. 省份简称常见 OCR 错误替换（如"奥"->"粤"）
   * 2. 字符规范化：大写、去除空格/分隔符
   * 3. 格式校验：汉字 + 大写字母 + 数字/字母
   * 4. 基于历史标注的车牌前缀学习
   */
  private correctPlateNumber(ocrValue: string, truthValues: string[]): string {
    if (!ocrValue) return '';

    // 省份简称常见 OCR 误识别映射
    const provinceMap: Record<string, string> = {
      '奥': '粤', '每': '粤', '鱼': '鲁', '曾': '京', '输': '渝',
      '渐': '浙', '护': '沪', '津': '津', '冀': '冀', '晋': '晋',
      '辽': '辽', '吉': '吉', '黑': '黑', '苏': '苏', '皖': '皖',
      '闽': '闽', '赣': '赣', '豫': '豫', '鄂': '鄂', '湘': '湘',
      '桂': '桂', '琼': '琼', '川': '川', '贵': '贵', '云': '云',
      '陕': '陕', '甘': '甘', '青': '青', '宁': '宁', '藏': '藏',
    };

    let plate = ocrValue.trim().toUpperCase().replace(/[\s\-_·]/g, '');

    // 替换省份误识别字
    if (plate.length >= 1) {
      const firstChar = plate[0];
      if (provinceMap[firstChar]) {
        plate = provinceMap[firstChar] + plate.slice(1);
      }
    }

    // 如果省份位不是有效汉字，尝试从历史车牌中学习省份前缀
    if (!/[\u4e00-\u9fa5]/.test(plate[0]) && truthValues.length > 0) {
      const commonPrefix = this.extractCommonPrefix(truthValues);
      if (commonPrefix) {
        plate = commonPrefix + plate.replace(/^[A-Z0-9]+/, '');
      }
    }

    // 字符规范化：O->0（第二位及以后的车牌号部分），I->1
    // 中国车牌规则：第2位是省份代码字母，第3位起是数字/字母
    if (plate.length >= 2) {
      // 保留第2位字母不变，其余 O->0, I->1（常见混淆）
      const prefix = plate.slice(0, 2);
      const rest = plate.slice(2).replace(/O/g, '0').replace(/I/g, '1');
      plate = prefix + rest;
    }

    // 格式校验：汉字 + 字母 + 5-6 位字母数字
    if (!/^[\u4e00-\u9fa5][A-Z][A-HJ-NP-Z0-9]{4,6}$/.test(plate)) {
      // 格式不符，但已经做了字符纠错，仍返回
      this.logger.debug(`车牌号格式校验不通过: "${plate}"，保留纠错结果`);
    }

    return plate;
  }

  /**
   * 工单号纠错
   * 1. 去除非法字符
   * 2. 基于历史工单号学习长度和前缀
   * 3. 常见 OCR 错误替换：O->0, I->1, S->5, B->8, Z->2
   */
  private correctOrderNo(ocrValue: string, truthValues: string[]): string {
    if (!ocrValue) return '';

    let orderNo = ocrValue.trim().toUpperCase().replace(/\s/g, '');

    // 常见字母/数字混淆替换
    orderNo = orderNo
      .replace(/O/g, '0')
      .replace(/I/g, '1')
      .replace(/S/g, '5')
      .replace(/B/g, '8')
      .replace(/Z/g, '2')
      .replace(/G/g, '6');

    // 从历史工单号中学习长度
    if (truthValues.length > 0) {
      const lengths = truthValues.map(v => v.length);
      const commonLength = this.mode(lengths);
      if (commonLength && orderNo.length !== commonLength && Math.abs(orderNo.length - commonLength) <= 2) {
        // 长度接近但不一致，尝试用相似度匹配找最接近的历史值
        const bestMatch = this.findClosestMatch(orderNo, truthValues);
        if (bestMatch) {
          const distance = this.levenshteinDistance(orderNo, bestMatch);
          if (distance <= Math.max(2, Math.floor(commonLength * 0.15))) {
            this.logger.log(`工单号纠错: OCR="${ocrValue}" → "${bestMatch}" (编辑距离=${distance})`);
            return bestMatch;
          }
        }
      }
    }

    return orderNo;
  }

  /**
   * 车型纠错
   * 基于历史标注中的常见车型库做模糊匹配
   */
  private correctCarModel(ocrValue: string, truthValues: string[]): string {
    if (!ocrValue) return '';

    const model = ocrValue.trim();
    if (truthValues.length === 0) return model;

    // 去重得到车型库
    const library = [...new Set(truthValues)];
    const bestMatch = this.findClosestMatch(model, library);
    if (!bestMatch) return model;

    const distance = this.levenshteinDistance(
      model.toLowerCase().replace(/[\s\-_]/g, ''),
      bestMatch.toLowerCase().replace(/[\s\-_]/g, ''),
    );

    // 车型名称通常较长，允许 20% 的容错
    const threshold = Math.max(2, Math.floor(bestMatch.length * 0.2));
    if (distance <= threshold && distance > 0) {
      this.logger.log(`车型纠错: OCR="${model}" → "${bestMatch}" (编辑距离=${distance})`);
      return bestMatch;
    }

    return model;
  }

  /**
   * 提取字符串列表的众数长度
   */
  private mode(values: number[]): number | null {
    if (values.length === 0) return null;
    const counts = new Map<number, number>();
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let maxCount = 0;
    let result: number | null = null;
    for (const [value, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        result = value;
      }
    }
    return result;
  }

  /**
   * 提取字符串列表的最长公共前缀（至少2个字符）
   */
  private extractCommonPrefix(values: string[]): string {
    if (values.length === 0) return '';
    let prefix = '';
    const first = values[0];
    for (let i = 0; i < first.length; i++) {
      const char = first[i];
      if (values.every(v => v[i] === char)) {
        prefix += char;
      } else {
        break;
      }
    }
    return prefix.length >= 2 ? prefix : '';
  }

  /**
   * 日期格式标准化：将各种日期格式统一为 YYYY-MM-DD
   * 处理 OCR 常见的日期格式错误：2026.05.04、2026/05/04、20260504、2026年05月04日 等
   */
  private normalizeDateFormat(dateStr: string): string {
    const trimmed = dateStr.trim();
    if (!trimmed) return '';

    // 已经是标准格式
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    // 各种分隔符格式：2026.05.04、2026/05/04、2026年05月04日
    const match = trimmed.match(/(\d{4})[.\/年-](\d{1,2})[.\/月-](\d{1,2})/);
    if (match) {
      const [, y, m, d] = match;
      const month = m.padStart(2, '0');
      const day = d.padStart(2, '0');
      return `${y}-${month}-${day}`;
    }

    // 纯数字格式：20260504
    if (/^\d{8}$/.test(trimmed)) {
      return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    }

    return trimmed;
  }

  /**
   * 在候选值列表中找到与输入值最相似的
   */
  private findClosestMatch(input: string, candidates: string[]): string | null {
    if (candidates.length === 0) return null;

    let bestMatch = null;
    let minDistance = Infinity;

    for (const candidate of candidates) {
      const distance = this.levenshteinDistance(
        input.toLowerCase().replace(/[\s\-_：:]/g, ''),
        candidate.toLowerCase().replace(/[\s\-_：:]/g, ''),
      );

      if (distance < minDistance) {
        minDistance = distance;
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  /**
   * 计算编辑距离（Levenshtein Distance）
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // 删除
          dp[i][j - 1] + 1, // 插入
          dp[i - 1][j - 1] + cost, // 替换
        );
      }
    }

    return dp[m][n];
  }

  /**
   * 清洗OCR结果：将纯符号占位符（如"?"、"-"、"_"、"*"等）清空
   * 工单中未填写的字段常用符号或空白代替，OCR识别出这些应显示为空
   */
  private sanitizeResult(result: OcrResult): OcrResult {
    const fields: Array<keyof OcrResult> = ['plateNumber', 'orderNo', 'customerName', 'phone', 'carModel', 'date'];
    for (const field of fields) {
      const value = result[field];
      if (value && this.isPlaceholderValue(value)) {
        this.logger.log(`清洗占位符 ${field}: "${value}" → ""`);
        (result as any)[field] = '';
      }
    }
    return result;
  }

  /**
   * 判断值是否为占位符（纯符号，无实际含义）
   * 如 "?"、"-"、"_"、"*"、"——"、"……"、"·"、"无"、"/" 等
   */
  private isPlaceholderValue(value: string): boolean {
    const trimmed = value.trim();

    // 空值
    if (!trimmed) return true;

    // 纯符号（1-3个字符的纯标点/符号）
    if (/^[?？\-_—–·*×÷/\\|·…，。、；：！""''【】《》（）(){}\[\]<>@#￥%&^~`+=]+$/u.test(trimmed)) {
      return true;
    }

    // 常见占位文字
    if (['无', '无/', '/', '—', '——', '……', '···', '。。。'].includes(trimmed)) {
      return true;
    }

    return false;
  }

  /**
   * 将指定元素移到数组最前面（用于调整字段别名优先级）
   */
  private moveToFront<T>(arr: T[], value: T): T[] {
    const idx = arr.indexOf(value);
    if (idx <= 0) return [...arr];
    const copy = [...arr];
    copy.splice(idx, 1);
    copy.unshift(value);
    return copy;
  }

  /**
   * 评估识别结果得分（有几个字段非空）
   */
  private scoreResult(result: OcrResult): number {
    let score = 0;
    if (result.orderNo) score++;
    if (result.plateNumber) score++;
    if (result.customerName) score++;
    if (result.phone) score++;
    if (result.carModel) score++;
    if (result.date) score++;
    return score;
  }

  /**
   * 合并两个识别结果（primary 为主，secondary 补充空字段）
   */
  private mergeResults(primary: OcrResult, secondary: OcrResult): OcrResult {
    return {
      orderNo: primary.orderNo || secondary.orderNo,
      plateNumber: primary.plateNumber || secondary.plateNumber,
      customerName: primary.customerName || secondary.customerName,
      phone: primary.phone || secondary.phone,
      carModel: primary.carModel || secondary.carModel,
      date: primary.date || secondary.date,
      rawText: primary.rawText || secondary.rawText,
    };
  }

  /**
   * 检查模板是否有有效的区域配置
   */
  private hasValidRegions(template: OcrTemplateConfig): boolean {
    const regions = template.regions;
    return !!(regions.orderNo || regions.plateNumber || regions.customerName || regions.phone || regions.carModel || (regions as any).date);
  }

  /**
   * 使用 PaddleOCR 关键字定位提取
   * 原理：全图识别后，找到"车牌号"等标签文本块，取其右侧/下方的文本块作为值
   * 优势：不依赖固定坐标，不同尺寸/角度的图片都能识别
   */
  private async recognizeByPaddleOcrKeyword(buffer: Buffer, fieldLabelsConfig?: FieldLabelsConfig): Promise<OcrResult> {
    const result: OcrResult = {
      plateNumber: '',
      orderNo: '',
      customerName: '',
      phone: '',
      carModel: '',
      date: '',
      rawText: '',
    };

    // 字段标签配置：优先使用传入的门店配置，否则使用默认配置
    const config = fieldLabelsConfig || DEFAULT_FIELD_LABELS;

    // 先全图识别检测工单类型，并获取所有文本块（后续复用，避免重复调用）
    const fullImageBlocks = await this.paddleOcr.recognizeFullImage(buffer);
    const fullImageTexts = fullImageBlocks.map(t => t.text);
    const orderType = detectWorkOrderType(fullImageTexts);
    result.rawText = fullImageTexts.join('\n');

    this.logger.log(`检测到工单类型: ${orderType}`);

    // 根据工单类型调整字段别名优先级
    const priorityConfig: FieldLabelsConfig = {
      orderNo: [...(config.orderNo || DEFAULT_FIELD_LABELS.orderNo)],
      plateNumber: [...(config.plateNumber || DEFAULT_FIELD_LABELS.plateNumber)],
      customerName: [...(config.customerName || DEFAULT_FIELD_LABELS.customerName)],
      phone: [...(config.phone || DEFAULT_FIELD_LABELS.phone)],
      carModel: [...(config.carModel || DEFAULT_FIELD_LABELS.carModel)],
      date: [...(config.date || DEFAULT_FIELD_LABELS.date)],
    };

    if (orderType === 'entrust') {
      // 客户委托修理单：优先"作业单号"、"车名车型"、"客户名称"、"接车时间"
      priorityConfig.orderNo = this.moveToFront(priorityConfig.orderNo, '作业单号');
      priorityConfig.carModel = this.moveToFront(priorityConfig.carModel, '车名车型');
      priorityConfig.customerName = this.moveToFront(priorityConfig.customerName, '客户名称');
      priorityConfig.date = this.moveToFront(priorityConfig.date, '接车时间');
    } else if (orderType === 'repair') {
      // 维修工单：优先"工单号"、"车型"、"车主姓名"、"手机号"、"开单日期"
      priorityConfig.orderNo = this.moveToFront(priorityConfig.orderNo, '工单号');
      priorityConfig.carModel = this.moveToFront(priorityConfig.carModel, '车型');
      priorityConfig.customerName = this.moveToFront(priorityConfig.customerName, '车主姓名');
      priorityConfig.phone = this.moveToFront(priorityConfig.phone, '手机号');
      priorityConfig.date = this.moveToFront(priorityConfig.date, '开单日期');
    }

    // 定义各字段的标签和位置关系
    const fieldLabels: Array<import('./paddle-ocr.service').FieldLabelConfig> = [
      {
        field: 'orderNo',
        labels: priorityConfig.orderNo,
        position: 'rightOrBelow',
      },
      {
        field: 'plateNumber',
        labels: priorityConfig.plateNumber,
        position: 'rightOrBelow',
      },
      {
        field: 'customerName',
        labels: priorityConfig.customerName,
        position: 'rightOrBelow',
      },
      {
        field: 'phone',
        labels: priorityConfig.phone,
        position: 'rightOrBelow',
      },
      {
        field: 'carModel',
        labels: priorityConfig.carModel,
        position: 'rightOrBelow',
      },
    ];

    // 调用 PaddleOCR 关键字提取
    const keywordResults = await this.paddleOcr.extractByKeywords(buffer, fieldLabels);

    // rawText 已在前面的全图识别中填充，此处不再覆盖

    // 将关键字提取结果映射到 OcrResult
    for (const kr of keywordResults) {
      if (kr.value) {
        // 对关键字提取的结果再做一次字段类型提取（纠正OCR错误、格式化）
        // 注意：extractFieldByType 返回空字符串表示值被过滤掉（如标签词、日期格式等），
        // 不应回退到原始值，否则会把"名称"等标签词当作客户名称返回
        const corrected = this.extractFieldByType(kr.field, kr.value, true);
        (result as any)[kr.field] = corrected;
      }
    }

    // 针对"车名车型"列做增强：合并同一行右侧的多个值块（如"秦L" + "110"）
    if (orderType === 'entrust' && (!result.carModel || result.carModel.length <= 4)) {
      const carModelBlocks = this.findCarModelBlocks(fullImageBlocks, priorityConfig.carModel);
      if (carModelBlocks) {
        const mergedModel = this.extractFieldByType('carModel', carModelBlocks, true);
        if (mergedModel && mergedModel.length > (result.carModel || '').length) {
          result.carModel = mergedModel;
        }
      }
    }

    // date 字段按优先级查找：接车日期 > 开单日期 > 进厂日期 > 打印日期
    // 复用已识别的文本块，避免重复调用 recognizeFullImage
    if (keywordResults.length > 0 && keywordResults[0].blocks) {
      // 合并门店配置和默认配置的日期标签（去重），避免门店配置覆盖默认配置导致标签丢失
      // 门店配置的标签优先级更高（放在前面），但默认标签仍作为兜底
      const shopDateLabels = config.date || [];
      const defaultDateLabels = DEFAULT_FIELD_LABELS.date;
      const mergedDateLabels = [...new Set([...shopDateLabels, ...defaultDateLabels])];
      // 按优先级分组：每个标签独立一组，按合并后的顺序作为优先级
      const dateLabels = mergedDateLabels.map(label => ({ labels: [label], name: label }));
      result.date = this.extractDateByPriority(keywordResults[0].blocks, dateLabels);
    }

    this.logger.log(
      `PaddleOCR 关键字提取: orderNo="${result.orderNo}", plateNumber="${result.plateNumber}", customerName="${result.customerName}", phone="${result.phone}", carModel="${result.carModel}", date="${result.date}"`,
    );

    return result;
  }

  /**
   * 从全图文本块中查找车型字段，并合并同一行右侧的多个值块
   * 主要用于"客户委托修理单"中的"车名车型"列（如"秦L" + "110"）
   */
  private findCarModelBlocks(
    blocks: Array<{ text: string; confidence: number; box: number[][] }>,
    carModelLabels: string[],
  ): string {
    if (!blocks || blocks.length === 0) return '';

    const parsedBlocks = blocks.map(block => {
      const box = block.box;
      let x = 0, y = 0, width = 0, height = 0;
      if (Array.isArray(box) && box.length === 4 && Array.isArray(box[0])) {
        const xs = box.map((p: number[]) => p[0]);
        const ys = box.map((p: number[]) => p[1]);
        x = Math.min(...xs);
        y = Math.min(...ys);
        width = Math.max(...xs) - x;
        height = Math.max(...ys) - y;
      }
      return { text: block.text, confidence: block.confidence, x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
    });

    // 找到"车名车型"或"车型"标签块
    let labelBlock: typeof parsedBlocks[0] | null = null;
    for (const block of parsedBlocks) {
      const cleanText = block.text.replace(/[：:]/g, '').trim();
      for (const label of carModelLabels) {
        if (cleanText.includes(label)) {
          labelBlock = block;
          break;
        }
      }
      if (labelBlock) break;
    }

    if (!labelBlock) return '';

    // 收集标签右侧同一行的所有文本块
    const candidates = parsedBlocks.filter(block => {
      if (block === labelBlock) return false;
      const isRight = block.cx > labelBlock.cx + labelBlock.width * 0.2;
      const sameRow = Math.abs(block.cy - labelBlock.cy) < Math.max(block.height, labelBlock.height) * 1.2;
      return isRight && sameRow;
    });

    // 按 x 坐标排序
    candidates.sort((a, b) => a.x - b.x);

    // 过滤掉明显不是车型的值（如纯数字、标签词）
    const validTexts = candidates
      .map(b => b.text.trim())
      .filter(text => {
        if (!text) return false;
        if (/^[\d,\.]+$/.test(text)) return false; // 纯数字（如"110"、"9,488"）
        if (['车名车型', '车型', '车辆型号', '车辆类型'].includes(text.replace(/[：:]/g, '').trim())) return false;
        return true;
      });

    if (validTexts.length === 0) return '';

    // 合并文本，保留空格分隔
    return validTexts.join(' ');
  }

  /**
   * 使用 PaddleOCR 全图识别（无模板时使用）
   */
  private async recognizeByPaddleOcrFullImage(buffer: Buffer): Promise<OcrResult> {
    const result: OcrResult = {
      plateNumber: '',
      orderNo: '',
      customerName: '',
      phone: '',
      carModel: '',
      date: '',
      rawText: '',
    };

    // 全图识别
    const texts = await this.paddleOcr.recognizeFullImage(buffer);

    // 合并所有文本
    const fullText = texts.map(t => t.text).join('\n');
    result.rawText = fullText;

    // 用正则从全图文本中提取字段
    result.plateNumber = this.extractFieldByType('plateNumber', fullText, false);
    result.orderNo = this.extractFieldByType('orderNo', fullText, false);
    result.customerName = this.extractFieldByType('customerName', fullText, false);
    result.phone = this.extractFieldByType('phone', fullText, false);
    result.carModel = this.extractFieldByType('carModel', fullText, false);

    this.logger.log(
      `PaddleOCR 全图识别: orderNo="${result.orderNo}", plateNumber="${result.plateNumber}", customerName="${result.customerName}", phone="${result.phone}", carModel="${result.carModel}"`,
    );

    return result;
  }

  /**
   * 使用 PaddleOCR 进行区域识别
   * 支持相对坐标（0-1范围）和绝对坐标
   */
  private async recognizeByPaddleOcr(buffer: Buffer, template: OcrTemplateConfig): Promise<OcrResult> {
    const result: OcrResult = {
      plateNumber: '',
      orderNo: '',
      customerName: '',
      phone: '',
      carModel: '',
      date: '',
      rawText: '',
    };

    // 获取图片实际尺寸
    let imgWidth = template.imageWidth || 1;
    let imgHeight = template.imageHeight || 1;
    try {
      const jimpModule = await import('jimp');
      const image = await jimpModule.Jimp.read(buffer);
      imgWidth = image.width;
      imgHeight = image.height;
    } catch {
      // 获取失败则使用模板尺寸
    }

    // 构建区域请求，自动处理相对/绝对坐标
    // 增加 padding（向外扩展 8%），避免文字边缘被截断导致识别失败
    const PADDING_RATIO = 0.08;
    const regions: Array<{ field: string; x: number; y: number; width: number; height: number }> = [];
    for (const [field, region] of Object.entries(template.regions) as [string, OcrRegion][]) {
      if (!region) continue;

      // 检测是否为相对坐标（0-1范围）
      const isRelative = region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1;

      if (isRelative) {
        // 相对坐标：按图片实际尺寸还原，并增加 padding
        const absX = region.x * imgWidth;
        const absY = region.y * imgHeight;
        const absW = region.width * imgWidth;
        const absH = region.height * imgHeight;
        const padW = absW * PADDING_RATIO;
        const padH = absH * PADDING_RATIO;
        regions.push({
          field,
          x: Math.max(0, Math.round(absX - padW)),
          y: Math.max(0, Math.round(absY - padH)),
          width: Math.round(absW + padW * 2),
          height: Math.round(absH + padH * 2),
        });
      } else {
        // 绝对坐标：直接使用，并增加 padding
        const padW = region.width * PADDING_RATIO;
        const padH = region.height * PADDING_RATIO;
        regions.push({
          field,
          x: Math.max(0, Math.round(region.x - padW)),
          y: Math.max(0, Math.round(region.y - padH)),
          width: Math.round(region.width + padW * 2),
          height: Math.round(region.height + padH * 2),
        });
      }
    }

    if (regions.length === 0) {
      return result;
    }

    // 调用 PaddleOCR 服务
    const paddleResults = await this.paddleOcr.recognizeRegions(buffer, regions);

    // 提取字段
    for (const [field, info] of Object.entries(paddleResults)) {
      const text = info.text;
      const value = this.extractFieldByType(field, text, true);
      if (value) {
        (result as any)[field] = value;
      }
      // 注意：不使用原始文本回退，因为 extractFieldByType 返回空通常是有原因的
      // （如区域扩展后包含了标签词、相邻字段文本等），回退会引入错误值
      this.logger.log(`PaddleOCR 字段 ${field}: rawText="${text.substring(0, 50)}", confidence=${info.confidence.toFixed(1)}%, 提取="${value}"`);
    }

    // 全图识别获取 rawText
    try {
      const fullTexts = await this.paddleOcr.recognizeFullImage(buffer);
      result.rawText = fullTexts.map(t => t.text).join('\n');
    } catch {
      // 全图识别失败不影响区域识别
    }

    return result;
  }

  /**
   * 从原始文本中提取所有字段
   */
  private extractFields(rawText: string): OcrResult {
    const plateMatch = rawText.match(PLATE_REGEX);
    const plateNumber = plateMatch ? plateMatch[0] : '';

    const orderMatch = rawText.match(ORDER_NO_REGEX);
    const orderNo = orderMatch ? orderMatch[1] || orderMatch[0] : '';

    const customerMatch = rawText.match(CUSTOMER_NAME_REGEX);
    const customerName = customerMatch ? customerMatch[1] : '';

    const phoneMatch = rawText.match(PHONE_REGEX);
    const phone = phoneMatch ? phoneMatch[1] : '';

    const carModelMatch = rawText.match(CAR_MODEL_REGEX);
    const carModel = carModelMatch ? carModelMatch[1] : '';

    const dateMatch = rawText.match(DATE_REGEX);
    const date = dateMatch ? this.formatDate(dateMatch[1], dateMatch[2], dateMatch[3]) : '';

    return { plateNumber, orderNo, customerName, phone, carModel, date, rawText };
  }

  /**
   * 根据字段类型从文本中提取值
   * @param field 字段类型
   * @param text OCR识别的文本
   * @param isRegionMode 是否为区域裁剪模式
   */
  private extractFieldByType(field: string, text: string, isRegionMode: boolean = false): string {
    const cleanText = text
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    switch (field) {
      case 'plateNumber': {
        const match = cleanText.match(PLATE_REGEX);
        if (match) return match[0];

        if (isRegionMode) {
          const loose = cleanText.match(/[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-Z0-9]{4,6}/);
          if (loose) return loose[0];

          const cleaned = cleanText.replace(/[^A-Z0-9京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁]/g, '').trim();
          if (cleaned.length >= 6) return cleaned;
        }

        return cleanText.replace(/[^A-Z0-9京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁]/g, '').trim();
      }

      case 'orderNo': {
        const match = cleanText.match(ORDER_NO_REGEX);
        if (match) return match[1] || match[0];

        if (isRegionMode) {
          const loose = cleanText.match(/[A-Za-z]{0,4}[-]?\d{4,}/);
          if (loose) return loose[0];

          const cleaned = cleanText.replace(/[^\w\-]/g, '').trim();
          if (cleaned.length >= 4) return cleaned;
        }

        return cleanText.replace(/[^\w\-]/g, '').trim();
      }

      case 'customerName': {
        // 排除纯标签文字（如"名称"、"客户"等被误识别为值）
        const labelWords = ['名称', '客户', '姓名', '车主', '送修人', '联系'];
        if (labelWords.includes(cleanText)) return '';

        const match = cleanText.match(CUSTOMER_NAME_REGEX);
        if (match) return match[1];

        if (isRegionMode) {
          // 去除常见标签词和冒号，避免匹配到标签而非实际值
          let textWithoutLabel = cleanText;
          for (const label of labelWords) {
            textWithoutLabel = textWithoutLabel.replace(label, '');
          }
          textWithoutLabel = textWithoutLabel.replace(/[：:]/g, '').trim();

          const chinese = textWithoutLabel.match(/[\u4e00-\u9fa5]{2,4}/);
          if (chinese) return chinese[0];

          const afterColon = textWithoutLabel.match(/[：:]\s*([\u4e00-\u9fa5]{2,4})/);
          if (afterColon) return afterColon[1];

          const allChinese = textWithoutLabel.replace(/[^\u4e00-\u9fa5]/g, '').trim();
          if (allChinese.length >= 2 && allChinese.length <= 6) return allChinese;
        }

        return '';
      }

      case 'phone': {
        // 先排除日期时间格式（如 "2026.05.04 09:33"、"2026-05-04"、"2026/05/04 09:33"）
        if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(cleanText)) return '';
        // 排除包含中文的值（电话号码不应包含中文，如".00钣金组"）
        if (/[\u4e00-\u9fa5]/.test(cleanText)) return '';

        const match = cleanText.match(PHONE_REGEX);
        if (match) return match[1];

        if (isRegionMode) {
          // 严格手机号：1开头+10位数字
          const mobile = cleanText.match(/1[3-9]\d{9}/);
          if (mobile) return mobile[0];

          // 严格座机：0开头+区号+号码
          const tel = cleanText.match(/0\d{2,3}-?\d{7,8}/);
          if (tel) return tel[0];

          // 带分隔符的电话（如 0755-12345678 或 138-1234-5678）
          const separated = cleanText.match(/\d{3,4}-\d{3,4}-\d{3,4}/);
          if (separated) return separated[0].replace(/-/g, '');

          // 7-8 位纯数字（座机号码长度，排除日期）
          // 排除：8位日期(YYYYMMDD)、12位时间戳(YYYYMMDDHHMM)、14位时间戳(YYYYMMDDHHMMSS)
          const digits = cleanText.match(/\d{7,8}/);
          if (digits && !this.looksLikeDate(digits[0])) {
            return digits[0];
          }

          // 最后兜底：从文本中提取所有数字，过滤掉日期格式
          const allDigits = cleanText.replace(/[^\d\-]/g, '').trim();
          if (allDigits.length >= 7 && !this.looksLikeDate(allDigits)) {
            return allDigits;
          }
        }

        return '';
      }

      case 'carModel': {
        const match = cleanText.match(CAR_MODEL_REGEX);
        if (match) return match[1];

        if (isRegionMode) {
          let cleaned = cleanText
            .replace(/^(车型|车辆型号|车辆类型|型号)[：:\s]*/i, '')
            .replace(/^[：:]\s*/, '')
            .trim();

          const modelMatch = cleaned.match(/[\u4e00-\u9fa5A-Za-z0-9\-·]+/);
          if (modelMatch) return modelMatch[0];

          if (cleaned.length >= 2) return cleaned;
        }

        return cleanText.replace(/^[：:]\s*/, '').trim();
      }

      case 'date': {
        // 日期提取：匹配各种日期格式，只返回年月日
        const match = cleanText.match(DATE_REGEX);
        if (match) {
          return this.formatDate(match[1], match[2], match[3]);
        }

        // 区域模式：尝试匹配 YYYYMMDD 纯数字格式
        if (isRegionMode) {
          const digitsMatch = cleanText.match(/(\d{4})(\d{2})(\d{2})/);
          if (digitsMatch) {
            return this.formatDate(digitsMatch[1], digitsMatch[2], digitsMatch[3]);
          }
        }

        return '';
      }

      default:
        return cleanText.trim();
    }
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   * 验证月份和日期的合法性，非法则返回空字符串
   */
  private formatDate(yearStr: string, monthStr: string, dayStr: string): string {
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);

    // 基本合法性校验
    if (year < 2000 || year > 2099) return '';
    if (month < 1 || month > 12) return '';
    if (day < 1 || day > 31) return '';

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * 按优先级提取日期：接车日期 > 开单日期 > 进厂日期 > 打印日期
   * 从已识别的文本块中查找，找到第一个有效日期即返回
   * @param dateLabels 日期标签优先级分组，未传则使用默认配置
   */
  private extractDateByPriority(blocks: Array<{ text: string; confidence: number; box: number[][] }>, dateLabels?: Array<{ labels: string[]; name: string }>): string {
    // 日期标签按优先级排序（高 → 低），优先使用传入的门店配置
    const dateLabelGroups = dateLabels || DATE_LABEL_PRIORITY;

    // 解析文本块坐标
    const parsedBlocks = blocks.map(block => {
      const box = block.box;
      let x = 0, y = 0, width = 0, height = 0;
      if (Array.isArray(box) && box.length === 4 && Array.isArray(box[0])) {
        const xs = box.map((p: number[]) => p[0]);
        const ys = box.map((p: number[]) => p[1]);
        x = Math.min(...xs);
        y = Math.min(...ys);
        width = Math.max(...xs) - x;
        height = Math.max(...ys) - y;
      }
      return { text: block.text, confidence: block.confidence, x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
    });

    for (const group of dateLabelGroups) {
      // 找标签块
      let labelBlock: typeof parsedBlocks[0] | null = null;
      for (const block of parsedBlocks) {
        const cleanText = block.text.replace(/[：:]/g, '').trim();
        for (const label of group.labels) {
          if (cleanText.includes(label)) {
            labelBlock = block;
            break;
          }
        }
        if (labelBlock) break;
      }

      if (!labelBlock) continue;

      // 尝试从标签文本中提取内联日期（如"接车日期：2026-05-04"）
      const inlineMatch = labelBlock.text.match(DATE_REGEX);
      if (inlineMatch) {
        const date = this.formatDate(inlineMatch[1], inlineMatch[2], inlineMatch[3]);
        if (date) {
          this.logger.debug(`日期提取: ${group.name} 内联值 "${date}"`);
          return date;
        }
      }

      // 找标签右侧或下方最近的文本块作为值
      let bestBlock: typeof parsedBlocks[0] | null = null;
      let bestDistance = Infinity;

      for (const block of parsedBlocks) {
        if (block === labelBlock) continue;

        const isRight = block.cx > labelBlock.cx + labelBlock.width * 0.3 &&
          Math.abs(block.cy - labelBlock.cy) < labelBlock.height * 1.5;
        const isBelow = block.cy > labelBlock.cy + labelBlock.height * 0.5 &&
          Math.abs(block.cx - labelBlock.cx) < labelBlock.width * 3;

        if (!isRight && !isBelow) continue;

        const dx = block.cx - labelBlock.cx;
        const dy = block.cy - labelBlock.cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const weighted = isRight ? distance : distance * 1.5;

        if (weighted < bestDistance) {
          bestDistance = weighted;
          bestBlock = block;
        }
      }

      if (bestBlock) {
        const date = this.extractFieldByType('date', bestBlock.text, true);
        if (date) {
          this.logger.debug(`日期提取: ${group.name} 值块 "${bestBlock.text}" → "${date}"`);
          return date;
        }
      }
    }

    return '';
  }

  /**
   * 判断字符串是否像日期（避免日期被误识别为电话号码）
   * 识别以下格式：
   *   - YYYYMMDD（8位）
   *   - YYYYMMDDHHMM（12位）
   *   - YYYYMMDDHHMMSS（14位）
   *   - YYYY-MM-DD 等带分隔符格式
   */
  private looksLikeDate(s: string): boolean {
    const digits = s.replace(/\D/g, '');
    const len = digits.length;

    // 8位日期：YYYYMMDD
    if (len === 8) {
      const year = parseInt(digits.slice(0, 4), 10);
      const month = parseInt(digits.slice(4, 6), 10);
      const day = parseInt(digits.slice(6, 8), 10);
      return year >= 2000 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
    }

    // 12位时间戳：YYYYMMDDHHMM
    if (len === 12) {
      const year = parseInt(digits.slice(0, 4), 10);
      const month = parseInt(digits.slice(4, 6), 10);
      const day = parseInt(digits.slice(6, 8), 10);
      return year >= 2000 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
    }

    // 14位时间戳：YYYYMMDDHHMMSS
    if (len === 14) {
      const year = parseInt(digits.slice(0, 4), 10);
      const month = parseInt(digits.slice(4, 6), 10);
      const day = parseInt(digits.slice(6, 8), 10);
      return year >= 2000 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
    }

    // 带分隔符的日期格式：YYYY-MM-DD、YYYY/MM/DD
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) {
      return true;
    }

    return false;
  }

  /**
   * 获取门店OCR模板配置
   */
  /**
   * 获取门店OCR模板（优先使用聚合模板）
   * 聚合模板从多张标注数据中自动生成，标注越多越准确
   */
  async getShopOcrTemplate(shopId: string): Promise<OcrTemplateConfig | null> {
    // 策略1：尝试获取聚合模板（基于标注学习数据）
    try {
      const aggregatedTemplate = await this.annotationService.aggregateTemplate(shopId);
      if (aggregatedTemplate && aggregatedTemplate.annotationCount >= 1 && this.hasValidRegionsFromAggregated(aggregatedTemplate)) {
        this.logger.log(`使用聚合模板: ${aggregatedTemplate.name}, 基于 ${aggregatedTemplate.annotationCount} 条标注`);
        return {
          name: aggregatedTemplate.name,
          imageWidth: aggregatedTemplate.imageWidth,
          imageHeight: aggregatedTemplate.imageHeight,
          regions: aggregatedTemplate.regions as OcrTemplateConfig['regions'],
        };
      }
    } catch (e) {
      this.logger.warn(`获取聚合模板失败: ${e instanceof Error ? e.message : e}`);
    }

    // 策略2：回退到手动配置的模板
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      select: { ocrTemplateConfig: true },
    });

    if (!shop?.ocrTemplateConfig) return null;

    try {
      const manualTemplate = JSON.parse(shop.ocrTemplateConfig) as OcrTemplateConfig;
      if (this.hasValidRegions(manualTemplate)) {
        this.logger.log(`使用手动配置模板: ${manualTemplate.name}`);
        return manualTemplate;
      }
    } catch {
      // 解析失败
    }

    return null;
  }

  /**
   * 检查聚合模板是否有有效区域
   */
  private hasValidRegionsFromAggregated(template: AggregatedTemplate): boolean {
    if (!template.regions) return false;
    const regions = template.regions;
    let validCount = 0;
    for (const key of Object.keys(regions)) {
      if (regions[key] && regions[key].x !== undefined) {
        validCount++;
      }
    }
    return validCount >= 2; // 至少2个字段有标注
  }

  /**
   * 保存门店OCR模板配置
   */
  async saveShopOcrTemplate(shopId: string, config: OcrTemplateConfig): Promise<void> {
    await this.prisma.paintShop.update({
      where: { id: shopId },
      data: { ocrTemplateConfig: JSON.stringify(config) },
    });
  }

  /**
   * 删除门店OCR模板配置
   */
  async deleteShopOcrTemplate(shopId: string): Promise<void> {
    await this.prisma.paintShop.update({
      where: { id: shopId },
      data: { ocrTemplateConfig: null },
    });
  }

  /**
   * 获取门店字段别名配置
   * 如果门店未配置，返回默认配置
   */
  async getShopFieldLabels(shopId: string): Promise<FieldLabelsConfig> {
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      select: { ocrFieldLabels: true },
    });

    if (shop?.ocrFieldLabels) {
      try {
        const custom = JSON.parse(shop.ocrFieldLabels) as FieldLabelsConfig;
        // 合并：以默认配置为基础，门店配置覆盖
        // 对于空数组或未设置的字段，回退到默认配置（避免门店清空别名后无法识别）
        const merged: FieldLabelsConfig = { ...DEFAULT_FIELD_LABELS, ...custom };
        for (const key of Object.keys(DEFAULT_FIELD_LABELS)) {
          const customLabels = custom[key];
          if (!Array.isArray(customLabels) || customLabels.length === 0) {
            merged[key] = DEFAULT_FIELD_LABELS[key];
          }
        }
        return merged;
      } catch {
        // 解析失败，返回默认
      }
    }
    return { ...DEFAULT_FIELD_LABELS };
  }

  /**
   * 保存门店字段别名配置
   */
  async saveShopFieldLabels(shopId: string, config: FieldLabelsConfig): Promise<void> {
    await this.prisma.paintShop.update({
      where: { id: shopId },
      data: { ocrFieldLabels: JSON.stringify(config) },
    });
  }

  /**
   * 获取默认字段别名配置
   */
  getDefaultFieldLabels(): FieldLabelsConfig {
    return { ...DEFAULT_FIELD_LABELS };
  }

  /**
   * OCR 诊断：返回详细的识别过程信息
   * 用于排查"标注了正确位置但识别不出来"的问题
   */
  async diagnoseRecognize(buffer: Buffer, shopId?: string): Promise<{
    fieldLabelsConfig: FieldLabelsConfig;
    keywordResult: OcrResult;
    keywordDetails: Array<{ field: string; label: string; rawText: string; extracted: string; confidence: number }>;
    regionResult: OcrResult | null;
    regionDetails: Array<{ field: string; rawText: string; extracted: string; confidence: number; usedFallback: boolean }> | null;
    finalResult: OcrResult;
    paddleAvailable: boolean;
  }> {
    // 加载门店字段别名配置
    const fieldLabelsConfig = shopId
      ? await this.getShopFieldLabels(shopId).catch(() => DEFAULT_FIELD_LABELS)
      : DEFAULT_FIELD_LABELS;

    const paddleAvailable = await this.paddleOcr.isAvailable().catch(() => false);

    const keywordDetails: Array<{ field: string; label: string; rawText: string; extracted: string; confidence: number }> = [];
    const regionDetails: Array<{ field: string; rawText: string; extracted: string; confidence: number; usedFallback: boolean }> = [];

    let keywordResult: OcrResult = {
      plateNumber: '', orderNo: '', customerName: '', phone: '', carModel: '', date: '', rawText: ''
    };
    let regionResult: OcrResult | null = null;

    // 1. 关键字定位提取
    if (paddleAvailable) {
      try {
        const keywordResults = await this.paddleOcr.extractByKeywords(buffer, [
          { field: 'orderNo', labels: fieldLabelsConfig.orderNo || DEFAULT_FIELD_LABELS.orderNo, position: 'rightOrBelow' },
          { field: 'plateNumber', labels: fieldLabelsConfig.plateNumber || DEFAULT_FIELD_LABELS.plateNumber, position: 'rightOrBelow' },
          { field: 'customerName', labels: fieldLabelsConfig.customerName || DEFAULT_FIELD_LABELS.customerName, position: 'rightOrBelow' },
          { field: 'phone', labels: fieldLabelsConfig.phone || DEFAULT_FIELD_LABELS.phone, position: 'rightOrBelow' },
          { field: 'carModel', labels: fieldLabelsConfig.carModel || DEFAULT_FIELD_LABELS.carModel, position: 'rightOrBelow' },
        ]);

        for (const kr of keywordResults) {
          const extracted = this.extractFieldByType(kr.field, kr.value, false);
          if (extracted) (keywordResult as any)[kr.field] = extracted;
          keywordDetails.push({
            field: kr.field,
            label: kr.labelUsed || '',
            rawText: kr.value,
            extracted,
            confidence: kr.confidence,
          });
        }

        // 日期按优先级提取（合并门店配置和默认配置，避免标签丢失）
        if (keywordResults.length > 0 && keywordResults[0].blocks) {
          const shopDateLabels = fieldLabelsConfig.date || [];
          const defaultDateLabels = DEFAULT_FIELD_LABELS.date;
          const mergedDateLabels = [...new Set([...shopDateLabels, ...defaultDateLabels])];
          const dateLabels = mergedDateLabels.map(label => ({ labels: [label], name: label }));
          keywordResult.date = this.extractDateByPriority(keywordResults[0].blocks, dateLabels);
        }

        keywordResult.rawText = keywordResults.map(kr => kr.value).join('\n');
      } catch (e) {
        this.logger.error('诊断-关键字识别失败', e);
      }
    }

    // 2. 区域识别（如果有模板配置）
    if (shopId) {
      const template = await this.getShopOcrTemplate(shopId).catch(() => null);
      if (template && this.hasValidRegions(template)) {
        try {
          regionResult = await this.recognizeByPaddleOcr(buffer, template);

          // 获取区域识别的详细信息
          const paddedRegions = await this.buildRegionsWithPadding(template, buffer);
          const paddleResults = await this.paddleOcr.recognizeRegions(buffer, paddedRegions);
          for (const [field, info] of Object.entries(paddleResults)) {
            const extracted = this.extractFieldByType(field, info.text, true);
            const hasFallback: boolean = !extracted && !!info.text && info.text.trim().length >= 2;
            regionDetails.push({
              field,
              rawText: info.text,
              extracted: extracted || (regionResult as any)[field] || '',
              confidence: info.confidence,
              usedFallback: hasFallback,
            });
          }
        } catch (e) {
          this.logger.error('诊断-区域识别失败', e);
        }
      }
    }

    // 3. 合并结果
    const finalResult = regionResult
      ? this.mergeResults(keywordResult, regionResult)
      : keywordResult;

    return {
      fieldLabelsConfig,
      keywordResult,
      keywordDetails,
      regionResult,
      regionDetails: regionDetails.length > 0 ? regionDetails : null,
      finalResult,
      paddleAvailable,
    };
  }

  /**
   * 构建带 padding 的区域列表（供诊断接口复用）
   */
  private async buildRegionsWithPadding(template: OcrTemplateConfig, buffer: Buffer): Promise<Array<{ field: string; x: number; y: number; width: number; height: number }>> {
    let imgWidth = template.imageWidth || 1;
    let imgHeight = template.imageHeight || 1;
    try {
      const jimpModule = await import('jimp');
      const image = await jimpModule.Jimp.read(buffer);
      imgWidth = image.width;
      imgHeight = image.height;
    } catch {
      // 获取失败则使用模板尺寸
    }

    const PADDING_RATIO = 0.08;
    const regions: Array<{ field: string; x: number; y: number; width: number; height: number }> = [];
    for (const [field, region] of Object.entries(template.regions) as [string, OcrRegion][]) {
      if (!region) continue;
      const isRelative = region.x <= 1 && region.y <= 1 && region.width <= 1 && region.height <= 1;
      if (isRelative) {
        const absX = region.x * imgWidth;
        const absY = region.y * imgHeight;
        const absW = region.width * imgWidth;
        const absH = region.height * imgHeight;
        const padW = absW * PADDING_RATIO;
        const padH = absH * PADDING_RATIO;
        regions.push({
          field,
          x: Math.max(0, Math.round(absX - padW)),
          y: Math.max(0, Math.round(absY - padH)),
          width: Math.round(absW + padW * 2),
          height: Math.round(absH + padH * 2),
        });
      } else {
        const padW = region.width * PADDING_RATIO;
        const padH = region.height * PADDING_RATIO;
        regions.push({
          field,
          x: Math.max(0, Math.round(region.x - padW)),
          y: Math.max(0, Math.round(region.y - padH)),
          width: Math.round(region.width + padW * 2),
          height: Math.round(region.height + padH * 2),
        });
      }
    }
    return regions;
  }

  /**
   * 批量验证 OCR 准确率
   * 查找指定门店有图片和已录入数据的工单，对图片重新跑 OCR，对比结果统计准确率
   */
  async batchValidate(shopId: string, limit: number = 20): Promise<{
    total: number;
    fields: Record<string, { total: number; matched: number; accuracy: number }>;
    details: Array<{
      orderId: string;
      orderNo: string;
      expected: Record<string, string>;
      actual: Record<string, string>;
      matched: Record<string, boolean>;
    }>;
  }> {
    // 查找该门店有图片且有录入数据的工单
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: {
        shopId,
        images: { some: {} },
        OR: [
          { plateNumber: { not: '' } },
          { orderNo: { not: '' } },
          { customerName: { not: '' } },
          { phone: { not: '' } },
          { carModel: { not: '' } },
        ],
      },
      include: {
        images: {
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const fieldKeys = ['plateNumber', 'orderNo', 'customerName', 'phone', 'carModel', 'date'] as const;
    const fieldStats: Record<string, { total: number; matched: number; accuracy: number }> = {};
    for (const key of fieldKeys) {
      fieldStats[key] = { total: 0, matched: 0, accuracy: 0 };
    }

    const details: Array<{
      orderId: string;
      orderNo: string;
      expected: Record<string, string>;
      actual: Record<string, string>;
      matched: Record<string, boolean>;
    }> = [];

    for (const order of orders) {
      if (!order.images?.[0]) continue;

      const image = order.images[0];
      let buffer: Buffer;

      // 从图片 URL 下载图片
      try {
        const imageUrl = image.url;
        if (imageUrl.startsWith('http')) {
          const response = await fetch(imageUrl);
          if (!response.ok) continue;
          buffer = Buffer.from(await response.arrayBuffer());
        } else {
          // 本地路径
          continue;
        }
      } catch {
        continue;
      }

      // OCR 识别
      let ocrResult: OcrResult;
      try {
        ocrResult = await this.recognizeWithTemplate(buffer, shopId);
      } catch {
        continue;
      }

      const expected: Record<string, string> = {};
      const actual: Record<string, string> = {};
      const matched: Record<string, boolean> = {};

      for (const key of fieldKeys) {
        // date 字段从 orderDate（DateTime）提取年月日作为期望值
        let expectedVal: string;
        if (key === 'date') {
          const orderDate = (order as any).orderDate;
          expectedVal = orderDate
            ? `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}-${String(orderDate.getDate()).padStart(2, '0')}`
            : '';
        } else {
          expectedVal = (order as any)[key] || '';
        }
        const actualVal = (ocrResult as any)[key] || '';

        expected[key] = expectedVal;
        actual[key] = actualVal;

        if (expectedVal) {
          fieldStats[key].total++;
          // 模糊匹配：忽略大小写、空格、常见分隔符
          const normalize = (s: string) => s.replace(/[\s\-_：:]/g, '').toLowerCase();
          if (normalize(actualVal).includes(normalize(expectedVal)) || normalize(expectedVal).includes(normalize(actualVal))) {
            fieldStats[key].matched++;
            matched[key] = true;
          } else {
            matched[key] = false;
          }
        }
      }

      details.push({
        orderId: order.id,
        orderNo: order.orderNo || '',
        expected,
        actual,
        matched,
      });
    }

    // 计算准确率
    for (const key of fieldKeys) {
      const stat = fieldStats[key];
      stat.accuracy = stat.total > 0 ? Math.round((stat.matched / stat.total) * 10000) / 100 : 0;
    }

    return {
      total: orders.length,
      fields: fieldStats,
      details,
    };
  }
}
