import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { MetricsService } from '@lib/shared/metrics/metrics.service';
import { LlmOcrService, CategoryContext, OcrMode } from './llm-ocr.service';
import { WorkOrderNoRuleService } from './work-order-no-rule.service';

export interface OcrItem {
  categoryId?: string;      // 匹配到的系统部位ID
  matchedName: string;      // 匹配到的系统部位名
  rawText: string;          // 图片上的原始文字
  quantity: number;
  newPartQuantity: number;
  matched: boolean;         // 是否成功匹配到系统部位
}

export interface OcrResult {
  plateNumber: string;
  orderNo: string;
  customerName: string;
  phone: string;
  carModel: string;
  carSeries: string;
  vin: string;
  brand: string;
  date: string;
  rawText: string;
  orderNoValid?: boolean;
  orderNoCandidates?: string[];
  vinCorrected?: boolean;      // VIN 是否被自动修正（O→0、I→1、Q→0 等）
  vinOriginal?: string;        // VIN 修正前的原始值
  items?: OcrItem[];
}

/** 门店OCR品牌/车型映射配置 */
export interface OcrShopConfig {
  /** 车型来源：carModel=用车型字段(默认); carSeries=用车系当车型; carModelThenSeries=车型优先,空则用系列 */
  carModelSource?: 'carModel' | 'carSeries' | 'carModelThenSeries';
  /** 品牌来源：auto=用OCR品牌(默认); fixed=固定品牌; fromCarModel=按车型名反推; none=不填 */
  brandSource?: 'auto' | 'fixed' | 'fromCarModel' | 'none';
  /** brandSource=fixed 时的固定品牌，如宏现图片无品牌→"比亚迪" */
  fixedBrand?: string;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmOcr: LlmOcrService,
    private readonly metricsService: MetricsService,
    private readonly noRuleService: WorkOrderNoRuleService,
  ) {}

  async recognizeWithTemplate(buffer: Buffer, shopId?: string, mode: OcrMode = 'all'): Promise<OcrResult> {
    try {
      this.logger.log(`使用大模型识别工单图片（mode=${mode}）...`);

      const wantBasic = mode === 'basic' || mode === 'all';
      const wantItems = mode === 'items' || mode === 'all';

      // 仅在需要识别部位时查询门店部位列表 + 别名，减少数据库查询
      let categories: CategoryContext[] = [];
      if (shopId && wantItems) {
        categories = await this.getShopCategories(shopId);
      }

      const llmResult = await this.llmOcr.recognize(buffer, categories, mode);

      let result: OcrResult = {
        plateNumber: llmResult.plateNumber,
        orderNo: llmResult.orderNo,
        customerName: llmResult.customerName,
        phone: llmResult.phone,
        carModel: llmResult.carModel,
        carSeries: llmResult.carSeries,
        vin: llmResult.vin,
        brand: llmResult.brand,
        date: llmResult.date,
        rawText: llmResult.rawText,
        items: [],
      };

      // 保留日期格式标准化
      if (result.date) {
        result.date = this.normalizeDateFormat(result.date);
      }

      // 保留占位符清洗
      result = this.sanitizeResult(result);

      // VIN 车架号自动修正：VIN 规范不含 I/O/Q，OCR 常混淆 O↔0、I↔1、Q↔0
      if (result.vin && wantBasic) {
        result = this.applyVinCorrection(result);
      }

      // 保留工单号规则校验
      if (shopId && wantBasic) {
        result = await this.applyOrderNoCorrection(shopId, result);
      }

      // 按门店OCR配置映射品牌/车型（解决不同门店图片"车系/车型/品牌"语义不一致）
      if (shopId && wantBasic) {
        result = await this.applyOcrShopMapping(shopId, result);
      }

      // 将大模型返回的 items 匹配到系统 categoryId（仅 items 模式或 all 模式）
      if (wantItems && llmResult.items && llmResult.items.length > 0 && shopId) {
        result.items = await this.matchItemsToCategories(shopId, llmResult.items);
      } else if (wantItems && llmResult.items && llmResult.items.length > 0) {
        // 没有 shopId 时无法匹配 categoryId
        result.items = llmResult.items.map(item => ({
          matchedName: item.matchedName,
          rawText: item.rawText,
          quantity: item.quantity,
          newPartQuantity: item.newPartQuantity,
          matched: false,
        }));
      }

      this.metricsService.recordOcrRecognition(shopId || 'unknown', true);
      this.logger.log(`大模型OCR完成: orderNo="${result.orderNo}", plateNumber="${result.plateNumber}", items=${result.items?.length || 0}个`);

      return result;
    } catch (e) {
      this.logger.error(`大模型OCR失败: ${e instanceof Error ? e.message : e}`);
      this.metricsService.recordOcrRecognition(shopId || 'unknown', false);
      throw e;
    }
  }

  // 兼容方法
  async recognize(buffer: Buffer, shopId?: string, mode?: OcrMode): Promise<OcrResult> {
    return this.recognizeWithTemplate(buffer, shopId, mode);
  }

  /** 查询门店部位列表 + 模板项目别名 */
  private async getShopCategories(shopId: string): Promise<CategoryContext[]> {
    // 查询全局类别 + 门店自定义类别
    const categories = await this.prisma.paintItemCategory.findMany({
      where: {
        OR: [
          { shopId: null },
          { shopId },
        ],
      },
      orderBy: { sortOrder: 'asc' },
    });

    // 查询门店标准模板项目中的别名
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      select: { standardTemplateId: true },
    });

    let aliasMap: Record<string, string> = {};
    if (shop?.standardTemplateId) {
      const templateItems = await this.prisma.paintStandardTemplateItem.findMany({
        where: { templateId: shop.standardTemplateId },
        select: { categoryId: true, alias: true },
      });
      for (const item of templateItems) {
        if (item.alias) {
          aliasMap[item.categoryId] = item.alias;
        }
      }
    }

    return categories.map(c => ({
      name: c.name,
      code: c.code,
      alias: aliasMap[c.id] || null,
    }));
  }

  /** 将大模型返回的 items 匹配到系统 categoryId */
  private async matchItemsToCategories(shopId: string, llmItems: any[]): Promise<OcrItem[]> {
    const categories = await this.prisma.paintItemCategory.findMany({
      where: {
        OR: [
          { shopId: null },
          { shopId },
        ],
      },
    });

    // 构建 name -> categoryId 映射
    const nameToId: Record<string, string> = {};
    for (const cat of categories) {
      nameToId[cat.name] = cat.id;
      // 也用 code 映射
      nameToId[cat.code] = cat.id;
    }

    // 查询别名映射
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      select: { standardTemplateId: true },
    });

    if (shop?.standardTemplateId) {
      const templateItems = await this.prisma.paintStandardTemplateItem.findMany({
        where: { templateId: shop.standardTemplateId },
        select: { categoryId: true, alias: true },
      });
      for (const item of templateItems) {
        if (item.alias) {
          nameToId[item.alias] = item.categoryId;
        }
      }
    }

    return llmItems.map(item => {
      const matchedName = item.matchedName || '';
      const categoryId = nameToId[matchedName] || '';
      return {
        categoryId: categoryId || undefined,
        matchedName,
        rawText: item.rawText || '',
        quantity: Number(item.quantity) || 1,
        newPartQuantity: Number(item.newPartQuantity) || 0,
        matched: !!categoryId,
      };
    });
  }

  private async applyOrderNoCorrection(shopId: string, result: OcrResult): Promise<OcrResult> {
    if (!shopId || !result.orderNo) return result;
    const rules = await this.noRuleService.getRules(shopId);
    if (rules.length === 0) return result;
    const corrected = this.noRuleService.correct(result.orderNo, rules);
    result.orderNoValid = corrected.valid;
    result.orderNoCandidates = corrected.candidates;
    if (!corrected.valid && corrected.candidates.length > 0) {
      result.orderNo = corrected.candidates[0];
    }
    return result;
  }

  /** VIN 车架号自动修正：VIN 规范不含 I/O/Q，OCR 常混淆 O→0、I→1、Q→0 */
  private applyVinCorrection(result: OcrResult): OcrResult {
    if (!result.vin) return result;
    const original = result.vin.trim().toUpperCase();
    // VIN 标准字符集：A-Z（不含 I/O/Q）+ 0-9
    const vinCharRegex = /^[A-HJ-NPR-Z0-9]{17}$/;
    if (vinCharRegex.test(original)) {
      // 已经符合 VIN 规范，无需修正
      result.vinCorrected = false;
      return result;
    }
    // 执行常见 OCR 混淆替换：O→0、I→1、Q→0
    let corrected = original;
    corrected = corrected.replace(/O/g, '0');
    corrected = corrected.replace(/I/g, '1');
    corrected = corrected.replace(/Q/g, '0');
    if (vinCharRegex.test(corrected)) {
      result.vinOriginal = original;
      result.vin = corrected;
      result.vinCorrected = true;
      this.logger.log(`VIN自动修正: "${original}" → "${corrected}"`);
    } else {
      // 修正后仍不符合，标记但不修改
      result.vinCorrected = false;
    }
    return result;
  }

  /**
   * 按门店 OCR 配置映射品牌/车型来源。
   * 不同门店工单图片上"车系/车型/品牌"字段语义不一致：
   *  - 宏现：无品牌栏、车系是具体型号（无用）
   *  - 有些门店：车系栏才是系统"车型"（如"宋PLUS DM-i"写在车系栏）
   * 通过 PaintShop.ocrConfig 指定来源，无配置时使用智能默认。
   */
  private async applyOcrShopMapping(shopId: string, result: OcrResult): Promise<OcrResult> {
    let config: OcrShopConfig = {};
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      select: { ocrConfig: true },
    });
    if (shop?.ocrConfig) {
      try {
        config = JSON.parse(shop.ocrConfig) as OcrShopConfig;
      } catch {
        config = {};
      }
    }

    const carModelSource = config.carModelSource || 'carModelThenSeries'; // 默认：车型优先，空则用车系兜底
    const brandSource = config.brandSource || 'auto';

    // 1) 车型映射
    const llmCarModel = (result.carModel || '').trim();
    const llmCarSeries = (result.carSeries || '').trim();
    if (carModelSource === 'carSeries') {
      result.carModel = llmCarSeries;
    } else if (carModelSource === 'carModel') {
      result.carModel = llmCarModel;
    } else {
      // carModelThenSeries（默认）：车型为空时用系列兜底
      result.carModel = llmCarModel || llmCarSeries;
    }

    // 2) 品牌映射
    const llmBrand = (result.brand || '').trim();
    if (brandSource === 'none') {
      result.brand = '';
    } else if (brandSource === 'fixed') {
      result.brand = (config.fixedBrand || '').trim();
    } else if (brandSource === 'fromCarModel') {
      result.brand = llmBrand || this.inferBrand(result.carModel);
    } else {
      // auto（默认）：优先OCR品牌，缺失则按车型反推
      result.brand = llmBrand || this.inferBrand(result.carModel);
    }

    return result;
  }

  /** 按车型名反推品牌（覆盖常见国产品牌，用于图片无品牌栏的场景） */
  private inferBrand(carModel: string): string {
    const m = (carModel || '').trim();
    if (!m) return '';
    const map: Array<[string[], string]> = [
      [['宋', '汉', '唐', '元', '秦', '海豹', '海豚', '驱逐舰', '护卫舰', '腾势', '仰望', '方程豹', 'f0', 'f3', 'e6', '王朝', '比亚迪'], '比亚迪'],
      [['凯美瑞', '汉兰达', '卡罗拉', '亚洲龙', '荣放', 'rav4', '威兰达', '雷凌', '丰田'], '丰田'],
      [['雅阁', 'crv', '飞度', '思域', '冠道', '本田', '皓影'], '本田'],
      [['轩逸', '天籁', '奇骏', '逍客', '日产', '骐达'], '日产'],
      [['朗逸', '帕萨特', '迈腾', '速腾', '宝来', '大众', '途观', '探岳'], '大众'],
      [['哈弗', 'h6', '魏', '坦克', '欧拉', '长城'], '长城'],
      [['博越', '星越', '缤越', '帝豪', '吉利', '领克', '银河'], '吉利'],
      [['cs', 'univ', '逸动', '长安', '深蓝', '启源'], '长安'],
      [['宏光', '五菱'], '五菱'],
      [['埃安', 'aion', '传祺', 'gs', '广汽'], '广汽'],
      [['理想'], '理想'],
      [['蔚来'], '蔚来'],
      [['小鹏'], '小鹏'],
      [['问界', '赛力斯'], '问界'],
      [['极氪'], '极氪'],
      [['宝马'], '宝马'],
      [['奔驰', '梅赛德斯'], '奔驰'],
      [['奥迪'], '奥迪'],
      [['现代'], '现代'],
      [['起亚'], '起亚'],
      [['马自达'], '马自达'],
      [['别克'], '别克'],
      [['雪佛兰'], '雪佛兰'],
      [['福特'], '福特'],
    ];
    const lower = m.toLowerCase();
    for (const [keys, brand] of map) {
      if (keys.some(k => lower.includes(k))) return brand;
    }
    return '';
  }

  private normalizeDateFormat(dateStr: string): string {
    const trimmed = dateStr.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/(\d{4})[.\/年-](\d{1,2})[.\/月-](\d{1,2})/);
    if (match) {
      const [, y, m, d] = match;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    if (/^\d{8}$/.test(trimmed)) {
      return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    }
    return trimmed;
  }

  private sanitizeResult(result: OcrResult): OcrResult {
    const fields: Array<keyof Pick<OcrResult, 'plateNumber' | 'orderNo' | 'customerName' | 'phone' | 'carModel' | 'vin' | 'date'>> = [
      'plateNumber', 'orderNo', 'customerName', 'phone', 'carModel', 'vin', 'date'
    ];
    for (const field of fields) {
      const value = result[field];
      if (value && this.isPlaceholderValue(value)) {
        (result as any)[field] = '';
      }
    }
    return result;
  }

  private isPlaceholderValue(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return true;
    if (/^[?？\-_—–·*×÷/\\|·…，。、；：！""''【】《》（）(){}\[\]<>@#￥%&^~`+=]+$/u.test(trimmed)) return true;
    if (['无', '无/', '/', '—', '——', '……', '···', '。。。'].includes(trimmed)) return true;
    return false;
  }
}
