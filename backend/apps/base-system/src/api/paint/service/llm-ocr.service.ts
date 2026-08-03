import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

export interface LlmOcrItem {
  matchedName: string;   // 匹配到的系统部位名（匹配不到时为空字符串）
  rawText: string;        // 图片上的原始文字
  quantity: number;       // 数量
  newPartQuantity: number; // 新件数量
}

export interface LlmOcrResult {
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
  items: LlmOcrItem[];
}

export interface CategoryContext {
  name: string;
  alias?: string | null;
  code: string;
}

export type OcrMode = 'basic' | 'items' | 'all';

@Injectable()
export class LlmOcrService {
  private readonly logger = new Logger(LlmOcrService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly downgradeOnFail: boolean;
  /** 内容寻址缓存：key=sha256(buffer)+mode，value=识别结果与过期时间。
   *  说明：LLM 原始输出(含 matchedName)仅依赖图片内容与 mode；门店类别匹配在 OcrService 按当前 shop 重新进行，
   *  故以 buffer+mode 作为缓存键是语义安全的——重复上传/重试可零成本复用结果。单实例有效，多实例建议换 Redis。 */
  private readonly cache = new Map<string, { value: LlmOcrResult; expires: number }>();

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('LLM_OCR_API_URL') || 'https://api.minimaxi.com/v1/chat/completions';
    // 安全红线：API Key 仅允许从环境变量注入，禁止在源码中硬编码回退值。
    // 缺失时快速失败，避免静默使用泄露的密钥或让 OCR 在不可预期状态下运行。
    const apiKey = this.configService.get<string>('LLM_OCR_API_KEY');
    if (!apiKey) {
      throw new Error(
        '[LlmOcrService] 未配置 LLM_OCR_API_KEY 环境变量，OCR 功能不可用。请将密钥放入 .env（该文件不得提交进版本库）。',
      );
    }
    this.apiKey = apiKey;
    this.model = this.configService.get<string>('LLM_OCR_MODEL') || 'MiniMax-M3';
    this.timeoutMs = Number(this.configService.get<string>('LLM_OCR_TIMEOUT_MS')) || 60000;
    this.cacheTtlMs = Number(this.configService.get<string>('LLM_OCR_CACHE_TTL_MS')) || 24 * 60 * 60 * 1000;
    this.downgradeOnFail = this.configService.get<string>('LLM_OCR_DOWNGRADE_ON_FAIL') === 'true';
    this.logger.log(`OCR配置: apiUrl=${this.apiUrl}, model=${this.model}, timeout=${this.timeoutMs}ms, cacheTtl=${this.cacheTtlMs}ms, downgradeOnFail=${this.downgradeOnFail}`);
  }

  async recognize(imageBuffer: Buffer, categories?: CategoryContext[], mode: OcrMode = 'all'): Promise<LlmOcrResult> {
    const cacheKey = this.buildCacheKey(imageBuffer, mode);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.log(`OCR命中内容缓存(免外部调用): mode=${mode}`);
      return cached;
    }

    try {
      const result = await this.callWithRetry(() => this.callLlm(imageBuffer, categories, mode));
      this.setCache(cacheKey, result);
      return result;
    } catch (e) {
      // 降级：all 模式整体失败时，退化为仅基础资料，至少保留车牌/工单号等关键字段，避免整单创建失败
      if (this.downgradeOnFail && mode === 'all') {
        this.logger.warn(`OCR(all)失败，降级为 basic 模式: ${e instanceof Error ? e.message : e}`);
        const basic = await this.callWithRetry(() => this.callLlm(imageBuffer, categories, 'basic'));
        const basicKey = this.buildCacheKey(imageBuffer, 'basic');
        this.setCache(basicKey, basic);
        return basic;
      }
      throw e;
    }
  }

  /** 单次调用大模型（无缓存、无重试），仅在 callWithRetry 内被调用 */
  private async callLlm(imageBuffer: Buffer, categories?: CategoryContext[], mode: OcrMode = 'all'): Promise<LlmOcrResult> {
    const base64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    // 根据模式构建 prompt
    const wantBasic = mode === 'basic' || mode === 'all';
    const wantItems = mode === 'items' || mode === 'all';

    let prompt: string;
    let maxTokens: number;

    if (wantBasic && wantItems) {
      // 全部识别
      let categorySection = '';
      if (categories && categories.length > 0) {
        const list = categories.map(c => c.alias ? `${c.name}(${c.alias})` : c.name).join(',');
        categorySection = `\n匹配部位到列表[${list}],未匹配则matchedName为空`;
      }
      prompt = `识别工单图片,返回JSON:\n{"plateNumber":"","orderNo":"","customerName":"","phone":"","carModel":"","carSeries":"","vin":"","brand":"","date":"","items":[{"matchedName":"","quantity":1,"newPartQuantity":0}]}\n规则:只返回JSON|未识别字段返空串items返[]|日期YYYY-MM-DD|车牌含省份简称(旧车牌可能仅6位字母数字)勿编造=quantity为幅数newPartQuantity为新件数默认0|carModel为车型(如宋PLUS DM-i/凯美瑞),carSeries为车系或具体型号(如宋/2024款荣耀版)${categorySection}`;
      maxTokens = 800;
    } else if (wantBasic) {
      // 仅基础资料
      prompt = `识别工单图片,返回JSON:\n{"plateNumber":"","orderNo":"","customerName":"","phone":"","carModel":"","carSeries":"","vin":"","brand":"","date":""}\n规则:只返回JSON|未识别字段返空串|日期YYYY-MM-DD|车牌含省份简称(旧车牌可能仅6位字母数字)|勿编造|carModel为车型(如宋PLUS DM-i/凯美瑞),carSeries为车系或具体型号(如宋/2024款荣耀版)`;
      maxTokens = 500;
    } else {
      // 仅部位
      let categorySection = '';
      if (categories && categories.length > 0) {
        const list = categories.map(c => c.alias ? `${c.name}(${c.alias})` : c.name).join(',');
        categorySection = `\n匹配部位到列表[${list}],未匹配则matchedName为空`;
      }
      prompt = `识别工单图片喷漆部位,返回JSON:\n{"items":[{"matchedName":"","quantity":1,"newPartQuantity":0}]}\n规则:只返回JSON|未识别返[]|勿编造|quantity为幅数newPartQuantity为新件数默认0${categorySection}`;
      maxTokens = 600;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: base64 } },
              { type: 'text', text: prompt },
            ],
          }],
          temperature: 0.1,
          max_completion_tokens: maxTokens,
          thinking: { type: 'disabled' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`大模型API错误: ${response.status} ${errText}`);
      }

      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      // 去除思考过程标签（MiniMax M3 等推理模型可能输出思考内容）
      const cleanedContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      // 解析JSON（处理可能被markdown包裹的情况）
      const jsonStr = cleanedContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      return {
        plateNumber: wantBasic ? (parsed.plateNumber || '') : '',
        orderNo: wantBasic ? (parsed.orderNo || '') : '',
        customerName: wantBasic ? (parsed.customerName || '') : '',
        phone: wantBasic ? (parsed.phone || '') : '',
        carModel: wantBasic ? (parsed.carModel || '') : '',
        carSeries: wantBasic ? (parsed.carSeries || '') : '',
        vin: wantBasic ? (parsed.vin || '') : '',
        brand: wantBasic ? (parsed.brand || '') : '',
        date: wantBasic ? (parsed.date || '') : '',
        rawText: '',  // 不再保存模型原始输出，节省输出 token
        items: wantItems ? (Array.isArray(parsed.items) ? parsed.items.map((item: any) => ({
          matchedName: item.matchedName || '',
          rawText: item.rawText || '',
          quantity: Number(item.quantity) || 1,
          newPartQuantity: Number(item.newPartQuantity) || 0,
        })) : []) : [],
      };
    } catch (e) {
      clearTimeout(timeout);
      this.logger.error(`大模型OCR失败: ${e instanceof Error ? e.message : e}`);
      throw new Error(`大模型OCR识别失败: ${e instanceof Error ? e.message : e}`);
    }
  }

  private buildCacheKey(buffer: Buffer, mode: OcrMode): string {
    return `${createHash('sha256').update(buffer).digest('hex')}:${mode}`;
  }

  private getFromCache(key: string): LlmOcrResult | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      this.cache.delete(key);
      return null;
    }
    return hit.value;
  }

  private setCache(key: string, value: LlmOcrResult): void {
    this.cache.set(key, { value, expires: Date.now() + this.cacheTtlMs });
    // 防止单实例内存无限增长
    if (this.cache.size > 2000) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }

  /** 指数退避重试：网络错误/5xx 可重试；4xx（含鉴权失败）直接抛出避免无意义重试 */
  private async callWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (!this.isRetryable(e) || attempt === attempts - 1) {
          throw e;
        }
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        this.logger.warn(`OCR第${attempt + 1}次失败，${delay}ms后重试(${attempts - attempt - 1}次剩余): ${e instanceof Error ? e.message : e}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  private isRetryable(e: unknown): boolean {
    if (!(e instanceof Error)) return true;
    // 4xx 客户端错误（含 401/403 鉴权、400 请求格式）不可重试
    if (/大模型API错误:\s*4\d\d/.test(e.message)) return false;
    return true;
  }
}
