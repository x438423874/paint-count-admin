import { Injectable } from '@nestjs/common';
import Tesseract from 'tesseract.js';

// 中国车牌正则
const PLATE_REGEX = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]/;

// 工单号正则
const ORDER_NO_REGEX = /(?:工单[号编码]?[:\s]*)?([A-Za-z]{0,3}[-]?\d{6,})/;

export interface OcrResult {
  plateNumber: string;
  orderNo: string;
  rawText: string;
}

@Injectable()
export class OcrService {
  private worker: Tesseract.Worker | null = null;
  private workerInitializing: Promise<Tesseract.Worker> | null = null;

  private async getWorker(): Promise<Tesseract.Worker> {
    if (this.worker) return this.worker;

    if (this.workerInitializing) return this.workerInitializing;

    this.workerInitializing = Tesseract.createWorker('chi_sim+eng', undefined, {
      logger: () => {},
    }).then(w => {
      this.worker = w;
      this.workerInitializing = null;
      return w;
    });

    return this.workerInitializing;
  }

  async recognize(buffer: Buffer): Promise<OcrResult> {
    const worker = await this.getWorker();

    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    });

    const { data } = await worker.recognize(buffer, {}, { text: true });
    const rawText = data.text || '';

    const plateMatch = rawText.match(PLATE_REGEX);
    const plateNumber = plateMatch ? plateMatch[0] : '';

    const orderMatch = rawText.match(ORDER_NO_REGEX);
    const orderNo = orderMatch ? orderMatch[1] || orderMatch[0] : '';

    return { plateNumber, orderNo, rawText };
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}
