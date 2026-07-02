import { Injectable, Logger } from '@nestjs/common';

/** PaddleOCR 识别的单个文本块（含坐标） */
export interface OcrTextBlock {
  text: string;
  confidence: number;
  box: number[][]; // 4个角点 [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
}

/** 关键字提取的字段标签配置 */
export interface FieldLabelConfig {
  /** 字段名 */
  field: string;
  /** 可能的标签文字（如车牌号、车牌等） */
  labels: string[];
  /** 标签与值的位置关系：right=右侧同行, below=下方, rightOrBelow=右侧或下方 */
  position: 'right' | 'below' | 'rightOrBelow';
}

/** 关键字提取结果 */
export interface KeywordExtractResult {
  field: string;
  value: string;
  confidence: number;
  method: string; // 'keyword' | 'regex'
  labelUsed?: string; // 匹配到的标签文字
  /** 全图识别的所有文本块（供调用方复用，避免重复识别） */
  blocks?: OcrTextBlock[];
}

/**
 * PaddleOCR 微服务调用层
 * 通过 HTTP 调用 Python FastAPI 服务（端口 8500）
 */
@Injectable()
export class PaddleOcrService {
  private readonly logger = new Logger(PaddleOcrService.name);
  private readonly serviceUrl = 'http://127.0.0.1:8500';

  /**
   * 带超时的 fetch 请求
   * 默认超时 60 秒（OCR 识别可能较慢）
   */
  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 60000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 检查 PaddleOCR 服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.serviceUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * 批量区域识别
   */
  async recognizeRegions(
    imageBuffer: Buffer,
    regions: Array<{ field: string; x: number; y: number; width: number; height: number }>,
  ): Promise<Record<string, { text: string; confidence: number }>> {
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('file', blob, 'image.png');
    formData.append('regions', JSON.stringify(regions));

    const res = await this.fetchWithTimeout(`${this.serviceUrl}/ocr/regions`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PaddleOCR 服务错误: ${err}`);
    }

    const data: any = await res.json();
    if (!data.success) {
      throw new Error('PaddleOCR 识别失败');
    }

    const results: Record<string, { text: string; confidence: number }> = {};
    for (const [field, info] of Object.entries(data.results)) {
      results[field] = {
        text: (info as any).text || '',
        confidence: (info as any).confidence || 0,
      };
    }

    return results;
  }

  /**
   * 全图识别（返回带坐标的文本块）
   */
  async recognizeFullImage(imageBuffer: Buffer): Promise<OcrTextBlock[]> {
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('file', blob, 'image.png');

    const res = await this.fetchWithTimeout(`${this.serviceUrl}/ocr`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`PaddleOCR 服务错误: ${err}`);
    }

    const data: any = await res.json();
    if (!data.success) {
      throw new Error('PaddleOCR 识别失败');
    }

    return (data.texts || []) as OcrTextBlock[];
  }

  /**
   * 关键字定位提取：全图识别后，根据标签关键字定位字段值
   * 原理：找到"车牌号"标签 → 取其右侧或下方的文本块作为值
   */
  async extractByKeywords(
    imageBuffer: Buffer,
    fieldLabels: FieldLabelConfig[],
  ): Promise<KeywordExtractResult[]> {
    // 1. 全图识别
    const blocks = await this.recognizeFullImage(imageBuffer);

    if (blocks.length === 0) {
      return [];
    }

    // 2. 解析每个文本块的边界框
    const parsedBlocks = blocks.map(block => {
      const bbox = this.parseBox(block.box);
      return {
        text: block.text,
        confidence: block.confidence,
        ...bbox,
      };
    });

    this.logger.debug(`PaddleOCR 识别到 ${parsedBlocks.length} 个文本块`);
    for (const b of parsedBlocks) {
      this.logger.debug(`  文本块: "${b.text}" (${b.cx.toFixed(0)}, ${b.cy.toFixed(0)}) conf=${b.confidence.toFixed(1)}%`);
    }

    // 3. 对每个字段，用关键字定位
    const results: KeywordExtractResult[] = [];

    for (const fieldLabel of fieldLabels) {
      const result = this.findFieldValue(parsedBlocks, fieldLabel);
      if (result) {
        results.push(result);
        this.logger.log(
          `关键字提取 ${fieldLabel.field}: label="${result.labelUsed}", value="${result.value}", confidence=${result.confidence.toFixed(1)}%`,
        );
      } else {
        results.push({
          field: fieldLabel.field,
          value: '',
          confidence: 0,
          method: 'keyword',
        });
        this.logger.log(`关键字提取 ${fieldLabel.field}: 未找到标签`);
      }
    }

    // 把全图识别的文本块附在第一个结果上，供调用方复用（避免重复调用 recognizeFullImage）
    if (results.length > 0) {
      results[0].blocks = blocks;
    }

    return results;
  }

  /**
   * 解析 PaddleOCR 返回的 box 坐标为边界框
   * box 格式: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] 或 flat [x1,y1,x2,y2,x3,y3,x4,y4]
   */
  private parseBox(box: number[][] | number[]): { x: number; y: number; width: number; height: number; cx: number; cy: number } {
    let points: Array<[number, number]>;

    if (Array.isArray(box) && box.length === 4 && Array.isArray(box[0])) {
      // [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
      points = box as Array<[number, number]>;
    } else if (Array.isArray(box) && box.length === 8 && typeof box[0] === 'number') {
      // [x1,y1,x2,y2,x3,y3,x4,y4]
      const flatBox = box as number[];
      points = [
        [flatBox[0], flatBox[1]],
        [flatBox[2], flatBox[3]],
        [flatBox[4], flatBox[5]],
        [flatBox[6], flatBox[7]],
      ];
    } else {
      // 无法解析，返回默认值
      return { x: 0, y: 0, width: 0, height: 0, cx: 0, cy: 0 };
    }

    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;

    return {
      x,
      y,
      width,
      height,
      cx: x + width / 2,
      cy: y + height / 2,
    };
  }

  /**
   * 在文本块中查找字段值
   * 策略：找到标签文本块 → 根据位置关系找值文本块
   * 增强：支持模糊标签匹配、同行提取、值清洗
   */
  private findFieldValue(
    blocks: Array<{
      text: string;
      confidence: number;
      x: number;
      y: number;
      width: number;
      height: number;
      cx: number;
      cy: number;
    }>,
    fieldLabel: FieldLabelConfig,
  ): KeywordExtractResult | null {
    // 1. 找到标签文本块（支持模糊匹配）
    // 优先匹配最长标签，避免"名称"优先于"客户名称"等短标签误匹配
    let labelBlock: typeof blocks[0] | null = null;
    let matchedLabel = '';
    let matchedLabelLength = 0;

    for (const block of blocks) {
      const cleanText = block.text.replace(/[：:]/g, '').trim();
      for (const label of fieldLabel.labels) {
        let isMatch = false;

        // 精确匹配
        if (cleanText === label) {
          isMatch = true;
        }
        // 包含匹配（标签是文本块的一部分）
        if (!isMatch && cleanText.includes(label)) {
          isMatch = true;
        }
        // 模糊匹配：编辑距离 <= 1（OCR可能把"车牌号"识别成"车牌号"）
        if (!isMatch && cleanText.length >= 2 && cleanText.length <= label.length + 2) {
          const distance = this.simpleEditDistance(cleanText, label);
          if (distance <= 1) {
            isMatch = true;
          }
        }

        // 优先选择更长的标签匹配，避免短标签（如"名称"）优先于长标签（如"客户名称"）
        if (isMatch && label.length > matchedLabelLength) {
          labelBlock = block;
          matchedLabel = label;
          matchedLabelLength = label.length;
        }
      }
    }

    if (!labelBlock) {
      return null;
    }

    // 2. 尝试从标签文本块自身提取值（如"车牌号：粤E2T9B0"或"客户名称周宇新"在同一文本块中）
    // 优先使用内联值，因为标签和值在同一文本块中时最可靠
    let inlineValue = '';
    const labelRegex = new RegExp(`(?:${fieldLabel.labels.join('|')})[：:\\s]*([\\S]+)`, 'i');
    const inlineMatch = labelBlock.text.match(labelRegex);
    if (inlineMatch && inlineMatch[1]) {
      inlineValue = inlineMatch[1].replace(/^[：:\s]+/, '').trim();
    }

    // 如果内联值存在且有效，直接返回（标签和值在同一文本块中是最可靠的情况）
    if (inlineValue) {
      return {
        field: fieldLabel.field,
        value: inlineValue,
        confidence: labelBlock.confidence,
        method: 'keyword',
        labelUsed: matchedLabel,
      };
    }

    // 3. 没有内联值时，根据位置关系找值文本块
    const candidates: Array<{
      block: typeof blocks[0];
      distance: number;
      value: string;
    }> = [];

    // 所有标签集合（用于排除其他标签块）- 包含工单图片中常见的所有标签
    const allLabels = [
      '工单号', '单号', '工单编号', '编号', '订单号', '维修单号', '派工单',
      '车牌号', '车牌', '号牌', '车牌号码',
      '客户名称', '客户', '姓名', '车主', '送修人', '客户姓名', '客户地址',
      '联系电话', '电话', '手机', '联系方式', '联系手机', '联系人',
      '车型', '车辆型号', '车型型号', '车辆类型', '厂牌车名',
      '车架号', '发动机号', 'VIN',
      '里程', '接车人', '进厂日期', '预交车日', '打印日期',
      '作业项目名称', '工时', '工时费', '维修班组', '维修人', '开始时间', '完工时间', '审查',
      '试车完毕', '试车员签字', '总检验员签字', '负责人', '制单',
      '名称', // "名称"单独出现时通常是"客户名称"的一部分，不是值
    ];

    for (const block of blocks) {
      // 跳过标签自身
      if (block === labelBlock) continue;

      // 跳过也是标签的文本块（不限长度，检查是否以标签开头或等于标签）
      const cleanText = block.text.replace(/[：:]/g, '').trim();
      if (allLabels.some(l => cleanText === l || cleanText.startsWith(l))) {
        continue;
      }

      const isRight = this.isRightOf(block, labelBlock);
      const isBelow = this.isBelowOf(block, labelBlock);

      let isValid = false;
      if (fieldLabel.position === 'right') {
        isValid = isRight;
      } else if (fieldLabel.position === 'below') {
        isValid = isBelow;
      } else {
        // rightOrBelow
        isValid = isRight || isBelow;
      }

      if (isValid) {
        // 计算距离（用于排序）
        const dx = block.cx - labelBlock.cx;
        const dy = block.cy - labelBlock.cy;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 提取值：去掉标签前缀
        let value = block.text.trim();
        for (const label of fieldLabel.labels) {
          const prefixPattern = new RegExp(`^${label}[：:\\s]*`, 'i');
          value = value.replace(prefixPattern, '');
        }
        value = value.replace(/^[：:\s]+/, '').trim();

        if (value) {
          // 根据字段类型校验候选值格式，排除明显不匹配的值
          if (!this.isCandidateValidForField(fieldLabel.field, value)) {
            continue;
          }
          candidates.push({ block, distance, value });
        }
      }
    }

    // 4. 没有内联值时，使用候选值
    if (candidates.length === 0) {
      return null;
    }

    // 按距离排序，取最近的
    candidates.sort((a, b) => a.distance - b.distance);

    return {
      field: fieldLabel.field,
      value: candidates[0].value,
      confidence: candidates[0].block.confidence,
      method: 'keyword',
      labelUsed: matchedLabel,
    };
  }

  /**
   * 简单编辑距离计算（用于模糊标签匹配）
   */
  private simpleEditDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    if (Math.abs(m - n) > 2) return Math.max(m, n);

    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }

    return dp[m][n];
  }

  /**
   * 判断 block 是否在 labelBlock 的右侧
   * 条件：x 坐标在标签右侧，且 y 坐标大致同行（垂直重叠 > 50%）
   */
  private isRightOf(
    block: { x: number; y: number; width: number; height: number; cx: number; cy: number },
    label: { x: number; y: number; width: number; height: number; cx: number; cy: number },
  ): boolean {
    // block 中心在标签右侧
    const isRight = block.cx > label.x + label.width * 0.5;

    // 垂直重叠：两个块的 y 范围有交集
    const blockTop = block.y;
    const blockBottom = block.y + block.height;
    const labelTop = label.y;
    const labelBottom = label.y + label.height;

    const overlapTop = Math.max(blockTop, labelTop);
    const overlapBottom = Math.min(blockBottom, labelBottom);
    const overlapHeight = Math.max(0, overlapBottom - overlapTop);

    const minHeight = Math.min(block.height, label.height);
    const verticalOverlap = minHeight > 0 ? overlapHeight / minHeight : 0;

    return isRight && verticalOverlap > 0.3;
  }

  /**
   * 判断 block 是否在 labelBlock 的下方
   * 条件：y 坐标在标签下方，且 x 坐标大致对齐（水平重叠 > 30%）
   */
  private isBelowOf(
    block: { x: number; y: number; width: number; height: number; cx: number; cy: number },
    label: { x: number; y: number; width: number; height: number; cx: number; cy: number },
  ): boolean {
    // block 顶部在标签底部附近
    const isBelow = block.y > label.y + label.height * 0.3;

    // 水平重叠
    const blockLeft = block.x;
    const blockRight = block.x + block.width;
    const labelLeft = label.x;
    const labelRight = label.x + label.width;

    const overlapLeft = Math.max(blockLeft, labelLeft);
    const overlapRight = Math.min(blockRight, labelRight);
    const overlapWidth = Math.max(0, overlapRight - overlapLeft);

    const minWidth = Math.min(block.width, label.width);
    const horizontalOverlap = minWidth > 0 ? overlapWidth / minWidth : 0;

    // 下方且距离不太远（不超过标签高度的3倍）
    const distance = block.y - (label.y + label.height);

    return isBelow && horizontalOverlap > 0.2 && distance < label.height * 4;
  }

  /**
   * 校验候选值是否符合字段类型的格式要求
   * 排除明显不匹配的值，如电话字段中的日期、客户名称中的纯标签文字
   */
  private isCandidateValidForField(field: string, value: string): boolean {
    switch (field) {
      case 'phone': {
        // 排除日期时间格式（如 "2026.05.04 09:33"、"2026-05-04"、"2026/05/04"）
        if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(value)) return false;
        if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}\s+\d{1,2}[:.]\d{2}/.test(value)) return false;
        // 排除纯日期（8位数字 YYYYMMDD）
        if (/^\d{8}$/.test(value)) {
          const year = parseInt(value.slice(0, 4), 10);
          const month = parseInt(value.slice(4, 6), 10);
          if (year >= 2000 && year <= 2099 && month >= 1 && month <= 12) return false;
        }
        // 排除包含中文的值（电话号码不应包含中文，如".00钣金组"）
        if (/[\u4e00-\u9fa5]/.test(value)) return false;
        break;
      }
      case 'customerName': {
        // 排除纯标签文字（如"名称"、"客户"等被误识别为值）
        const labelWords = ['名称', '客户', '姓名', '车主', '送修人', '联系'];
        if (labelWords.includes(value)) return false;
        // 客户名称应该是2-4个中文字符，排除纯数字、日期等
        if (/^\d+$/.test(value)) return false;
        if (/^\d{4}[-./]/.test(value)) return false;
        break;
      }
      case 'plateNumber': {
        // 车牌必须包含省份简称或字母
        const hasProvince = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁]/.test(value);
        const hasAlpha = /[A-Z]/.test(value);
        if (!hasProvince && !hasAlpha) return false;
        break;
      }
      case 'orderNo': {
        // 工单号应包含字母或数字，排除纯中文
        if (/^[\u4e00-\u9fa5]+$/.test(value)) return false;
        break;
      }
      case 'carModel': {
        // 排除纯日期
        if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(value)) return false;
        break;
      }
    }
    return true;
  }
}
