import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('LLM_OCR_API_URL') || 'https://api.minimaxi.com/v1/chat/completions';
    this.apiKey = this.configService.get<string>('LLM_OCR_API_KEY') || 'sk-api-zdYDi2QgMq83L_AzuJyvFC70SYxk1mvBovOfw7W4OwBC-4ZZrg_64nMO73VUATMA-4EBViPEMrTnpeL9ZzXz_QJprqv0lR5SH5SNYhgXPqQRyDZB3dwYsWM';
    this.model = this.configService.get<string>('LLM_OCR_MODEL') || 'MiniMax-M3';
    this.logger.log(`OCR配置: apiUrl=${this.apiUrl}, model=${this.model}, apiKey=${this.apiKey.substring(0, 10)}...`);
  }

  async recognize(imageBuffer: Buffer, categories?: CategoryContext[], mode: OcrMode = 'all'): Promise<LlmOcrResult> {
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
        const list = categories.map(c => c.alias ? `${c.name}（别名：${c.alias}）` : c.name).join('、');
        categorySection = `\n6. 系统中的喷漆部位列表为：${list}。请将图片中识别到的部位匹配到上述列表中的名称，匹配不到的 matchedName 返回空字符串""`;
      }
      prompt = `你是一个工单信息提取助手。请仔细识别这张汽车维修/喷漆工单图片，提取以下字段并以JSON格式返回：
{
  "plateNumber": "车牌号（如粤E12345）",
  "orderNo": "工单号/作业单号/单号",
  "customerName": "客户名称/车主姓名",
  "phone": "联系电话/手机号",
  "carModel": "车型",
  "vin": "车架号/VIN码（17位）",
  "brand": "品牌",
  "date": "日期（格式YYYY-MM-DD，取接车日期或开单日期）",
  "items": [{"matchedName": "匹配的系统部位名", "rawText": "图片上的原始文字", "quantity": 1, "newPartQuantity": 0}]
}
要求：
1. 只返回JSON，不要任何其他内容
2. 识别不到的字段返回空字符串""，items 识别不到返回空数组[]
3. 日期统一为YYYY-MM-DD格式
4. 车牌号要包含省份简称
5. 不要编造信息，只提取图片中实际存在的内容${categorySection}
7. items 中 quantity 为喷漆幅数/数量，newPartQuantity 为新件数量（通常为0）`;
      maxTokens = 2000;
    } else if (wantBasic) {
      // 仅基础资料
      prompt = `你是一个工单信息提取助手。请仔细识别这张汽车维修/喷漆工单图片，提取以下字段并以JSON格式返回：
{
  "plateNumber": "车牌号（如粤E12345）",
  "orderNo": "工单号/作业单号/单号",
  "customerName": "客户名称/车主姓名",
  "phone": "联系电话/手机号",
  "carModel": "车型",
  "vin": "车架号/VIN码（17位）",
  "brand": "品牌",
  "date": "日期（格式YYYY-MM-DD，取接车日期或开单日期）"
}
要求：
1. 只返回JSON，不要任何其他内容
2. 识别不到的字段返回空字符串""
3. 日期统一为YYYY-MM-DD格式
4. 车牌号要包含省份简称
5. 不要编造信息，只提取图片中实际存在的内容`;
      maxTokens = 1000;
    } else {
      // 仅部位
      let categorySection = '';
      if (categories && categories.length > 0) {
        const list = categories.map(c => c.alias ? `${c.name}（别名：${c.alias}）` : c.name).join('、');
        categorySection = `\n1. 系统中的喷漆部位列表为：${list}。请将图片中识别到的部位匹配到上述列表中的名称，匹配不到的 matchedName 返回空字符串""`;
      }
      prompt = `你是一个工单信息提取助手。请仔细识别这张汽车维修/喷漆工单图片中的喷漆部位信息，以JSON格式返回：
{
  "items": [{"matchedName": "匹配的系统部位名", "rawText": "图片上的原始文字", "quantity": 1, "newPartQuantity": 0}]
}
要求：
1. 只返回JSON，不要任何其他内容
2. items 识别不到返回空数组[]
3. 不要编造信息，只提取图片中实际存在的内容${categorySection}
4. items 中 quantity 为喷漆幅数/数量，newPartQuantity 为新件数量（通常为0）`;
      maxTokens = 1500;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

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
        vin: wantBasic ? (parsed.vin || '') : '',
        brand: wantBasic ? (parsed.brand || '') : '',
        date: wantBasic ? (parsed.date || '') : '',
        rawText: content,
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
}
