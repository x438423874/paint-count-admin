/**
 * OCR 识别结果 → 表单字段填充（仅填空字段，不覆盖已有值）
 *
 * 原先 work-order-operate-drawer 内联一份 fieldMap 与填充循环（与移动端 H5 的 create/detail 同构），改字段容易漏改。工单号/VIN 自动修正、填充
 * 反馈等页面侧差异由调用方根据返回值自行处理。
 */

export const OCR_FIELD_MAP = [
  { key: 'plateNumber', label: '车牌号', ocrKey: 'plateNumber' },
  { key: 'orderNo', label: '工单号', ocrKey: 'orderNo' },
  { key: 'customerName', label: '客户名称', ocrKey: 'customerName' },
  { key: 'phone', label: '联系电话', ocrKey: 'phone' },
  { key: 'carModel', label: '车型', ocrKey: 'carModel' },
  { key: 'vin', label: '车架号', ocrKey: 'vin' },
  { key: 'brand', label: '品牌', ocrKey: 'brand' },
  { key: 'orderDate', label: '日期', ocrKey: 'date' }
] as const;

export interface OcrApplyResult {
  /** 本次填充的字段描述（「车牌号：xxx」），空数组表示无字段被填充 */
  filledMessages: string[];
  /** 工单号不符合规则被后端自动修正时的修正值 */
  orderNoCorrected: string | null;
  /** VIN 含易混淆字符（O↔0、I↔1、Q↔0）被后端自动修正时的原始值/修正值 */
  vinCorrected: { original: string; corrected: string } | null;
}

/** 将 OCR 结果填充到表单对象（仅填充空白字段） */
export function applyOcrFields(form: Record<string, any>, result: Record<string, any>): OcrApplyResult {
  const filledMessages: string[] = [];

  for (const { key, label, ocrKey } of OCR_FIELD_MAP) {
    const ocrValue = (result[ocrKey] || '').trim();
    const currentValue = (form[key] || '').trim();
    if (ocrValue && !currentValue) {
      form[key] = ocrValue;
      filledMessages.push(`${label}：${ocrValue}`);
    }
  }

  // 工单号修正：OCR 识别的工单号不符合规则，后端已自动修正
  const candidates = result.orderNoCandidates || [];
  const orderNoValid = result.orderNoValid;
  const orderNoCorrected = candidates.length > 0 && orderNoValid === false ? result.orderNo || '' : null;

  // VIN 修正：OCR 识别的 VIN 含易混淆字符，后端已自动修正
  const vinCorrected =
    result.vinCorrected && result.vinOriginal
      ? { original: result.vinOriginal as string, corrected: result.vin as string }
      : null;

  return { filledMessages, orderNoCorrected, vinCorrected };
}
