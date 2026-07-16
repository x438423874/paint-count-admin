import { OcrResult } from '../../service/ocr.service';

export interface BatchOcrPreviewItem {
  /** 客户端生成的唯一标识 */
  id: string;
  /** 原始文件名 */
  fileName: string;
  /** 缩略图 base64 */
  thumbnail: string;
  /** OCR 识别结果 */
  result: OcrResult;
  /** 校验警告 */
  warnings: string[];
  /** 是否通过校验 */
  valid: boolean;
}

export interface BatchOcrPreviewResponse {
  items: BatchOcrPreviewItem[];
}

export interface BatchCreateItem {
  /** 与 preview 返回的 id 一致 */
  id: string;
  /** 车牌号 */
  plateNumber?: string;
  /** 工单号 */
  orderNo?: string;
  /** 客户名称 */
  customerName?: string;
  /** 电话 */
  phone?: string;
  /** 车型 */
  carModel?: string;
  /** 车架号 */
  vin?: string;
  /** 品牌 */
  brand?: string;
  /** 日期 */
  orderDate?: string;
  /** 结算月份 */
  settlementMonth?: string;
  /** OCR识别的部位列表 */
  items?: { categoryId: string; quantity: number; newPartQuantity: number }[];
}
