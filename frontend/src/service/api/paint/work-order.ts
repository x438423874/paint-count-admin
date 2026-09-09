import { request } from '../../request';
import type {
  BatchCreateItem,
  BatchOcrPreviewItem,
  CreateWorkOrderData,
  ExcelTemplateConfig,
  ImportResult,
  OcrRecognizedItem,
  OrderNoRule,
  PageResult,
  PaintShop,
  PaintWorkOrder,
  PaintWorkOrderImage,
  ReconcileResult,
  UpdateWorkOrderData
} from './types';

// ==================== 工单 API ====================

export function fetchWorkOrderPage(params: {
  current?: number;
  size?: number;
  shopId?: string;
  plateNumber?: string;
  orderNo?: string;
  customerName?: string;
  settlementMonth?: string;
  status?: string;
  isRework?: boolean;
  isAdjustment?: boolean;
  categoryId?: string;
}) {
  return request<PageResult<PaintWorkOrder>>({
    url: '/paint/work-order/page',
    method: 'get',
    params
  });
}

export function fetchWorkOrderById(id: string) {
  return request<PaintWorkOrder>({
    url: `/paint/work-order/${id}`,
    method: 'get'
  });
}

export function createWorkOrder(data: CreateWorkOrderData) {
  return request<PaintWorkOrder>({
    url: '/paint/work-order',
    method: 'post',
    data
  });
}

/** shopId 已由调用方写入 formData，此参数仅为兼容旧签名保留 */
export function quickCreateWorkOrder(_shopId: string, formData: FormData) {
  return request<PaintWorkOrder>({
    url: '/paint/work-order/quick-create',
    method: 'post',
    data: formData,
    timeout: 120_000
  });
}

export function ocrRecognizeImage(formData: FormData) {
  return request<{
    plateNumber: string;
    orderNo: string;
    customerName: string;
    phone: string;
    carModel: string;
    vin: string;
    brand: string;
    date: string;
    rawText: string;
    orderNoValid?: boolean;
    orderNoCandidates?: string[];
    vinCorrected?: boolean;
    vinOriginal?: string;
    items?: OcrRecognizedItem[];
  }>({
    url: '/paint/work-order/ocr',
    method: 'post',
    data: formData,
    timeout: 120_000
  });
}

export function batchOcrPreview(formData: FormData) {
  return request<{ items: BatchOcrPreviewItem[] }>({
    url: '/paint/work-order/batch-ocr-preview',
    method: 'post',
    data: formData,
    timeout: 300_000
  });
}

export function batchCreateWorkOrder(shopId: string, items: BatchCreateItem[], files: Map<string, File>) {
  const formData = new FormData();
  formData.append('shopId', shopId);
  formData.append('items', JSON.stringify(items));
  files.forEach((file, id) => {
    formData.append(id, file);
  });
  return request<{ created: any[]; errors: { id: string; message: string }[]; total: number }>({
    url: '/paint/work-order/batch-create',
    method: 'post',
    data: formData,
    timeout: 300_000
  });
}

export function updateWorkOrder(data: UpdateWorkOrderData) {
  return request<PaintWorkOrder>({
    url: '/paint/work-order',
    method: 'put',
    data
  });
}

export function deleteWorkOrder(id: string) {
  return request({
    url: `/paint/work-order/${id}`,
    method: 'delete'
  });
}

export function uploadWorkOrderImage(orderId: string, formData: FormData) {
  return request<PaintWorkOrderImage>({
    url: `/paint/work-order/${orderId}/images`,
    method: 'post',
    data: formData
  });
}

export function removeWorkOrderImage(imageId: string) {
  return request({
    url: `/paint/work-order/images/${imageId}`,
    method: 'delete'
  });
}

/** 批量审核工单（逐单校验，失败不影响其余） */
export function batchAuditWorkOrders(ids: string[]) {
  return request<{ success: number; failed: number; errors: { id: string; message: string }[] }>({
    url: '/paint/work-order/batch-audit',
    method: 'post',
    data: { ids }
  });
}

// ==================== 工单审核 ====================

export function auditWorkOrder(id: string, auditedBy?: string) {
  return request<PaintWorkOrder>({
    url: '/paint/work-order/audit',
    method: 'post',
    data: { id, auditedBy }
  });
}

export function unauditWorkOrder(id: string) {
  return request<PaintWorkOrder>({
    url: `/paint/work-order/unaudit/${id}`,
    method: 'post'
  });
}

// ==================== 工单合并 ====================

export function findDuplicateOrders(orderNo: string, excludeId?: string, settlementMonth?: string) {
  return request<PaintWorkOrder[]>({
    url: `/paint/work-order/duplicates/${orderNo}`,
    method: 'get',
    params: { ...(excludeId ? { excludeId } : {}), ...(settlementMonth ? { settlementMonth } : {}) }
  });
}

export function mergeWorkOrders(targetId: string, sourceIds: string[]) {
  return request<PaintWorkOrder>({
    url: '/paint/work-order/merge',
    method: 'post',
    data: { targetId, sourceIds }
  });
}

// ==================== 工单结算（状态变更） ====================

export function settleWorkOrder(orderId: string, settlementMonth?: string) {
  return request({
    url: `/paint/work-order/${orderId}/settlement`,
    method: 'post',
    data: { settlementMonth }
  });
}

export function unsettleWorkOrder(orderId: string) {
  return request({
    url: `/paint/work-order/${orderId}/unsettle`,
    method: 'post'
  });
}

export function batchSettleWorkOrders(ids: string[]) {
  return request<{ success: number; failed: number; errors: { id: string; message: string }[] }>({
    url: '/paint/work-order/batch-settle',
    method: 'post',
    data: { ids }
  });
}

export function batchUnsettleWorkOrders(ids: string[]) {
  return request<{ success: number; failed: number; errors: { id: string; message: string }[] }>({
    url: '/paint/work-order/batch-unsettle',
    method: 'post',
    data: { ids }
  });
}

export function setAbnormal(orderId: string, isAbnormal: boolean, abnormalRemark?: string) {
  return request({
    url: `/paint/work-order/${orderId}/abnormal`,
    method: 'post',
    data: { isAbnormal, abnormalRemark }
  });
}

export function voidWorkOrder(orderId: string, voidReason?: string) {
  return request({
    url: `/paint/work-order/${orderId}/void`,
    method: 'post',
    data: { voidReason }
  });
}

export function unvoidWorkOrder(orderId: string) {
  return request({
    url: `/paint/work-order/${orderId}/unvoid`,
    method: 'post'
  });
}

// ==================== 工单导入导出 ====================

export function importWorkOrderExcel(file: File, shopId: string, settlementMonth?: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('shopId', shopId);
  if (settlementMonth) formData.append('settlementMonth', settlementMonth);
  return request<ImportResult>({
    url: '/paint/work-order/import',
    method: 'post',
    data: formData,
    headers: { 'Content-Type': null as unknown as string }
  });
}

export function exportWorkOrderExcel(shopId: string, settlementMonth?: string, mode: 'detail' | 'summary' = 'detail') {
  return request({
    url: '/paint/work-order/export',
    method: 'get',
    params: { shopId, mode, ...(settlementMonth && { settlementMonth }) },
    responseType: 'blob'
  });
}

export function reconcileWorkOrderExcel(file: File, shopId: string, settlementMonth: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('shopId', shopId);
  formData.append('settlementMonth', settlementMonth);
  return request<ReconcileResult>({
    url: '/paint/work-order/reconcile',
    method: 'post',
    data: formData,
    headers: { 'Content-Type': null as unknown as string },
    timeout: 120000
  });
}

export function fetchOrderNoRules(shopId: string) {
  return request<OrderNoRule[]>({
    url: '/paint/work-order/order-no-rules',
    method: 'get',
    params: { shopId }
  });
}

export function saveOrderNoRules(shopId: string, rules: OrderNoRule[]) {
  return request({
    url: '/paint/work-order/order-no-rules',
    method: 'post',
    data: { shopId, rules }
  });
}

export function analyzeOrderNoRules(shopId: string) {
  return request<OrderNoRule[]>({
    url: '/paint/work-order/analyze-order-no-rules',
    method: 'post',
    data: { shopId }
  });
}

export function downloadWorkOrderTemplate(shopId: string) {
  return request({
    url: '/paint/work-order/template',
    method: 'get',
    params: { shopId },
    responseType: 'blob'
  });
}

// ==================== Excel模板配置 ====================

export function detectExcelTemplate(file: File, shopId: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('shopId', shopId);
  return request<ExcelTemplateConfig>({
    url: '/paint/work-order/detect-template',
    method: 'post',
    data: formData,
    headers: { 'Content-Type': null as unknown as string }
  });
}

export function saveExcelTemplateAndAliasMap(
  shopId: string,
  config: ExcelTemplateConfig,
  aliasMap: Record<string, string[]>
) {
  return request<PaintShop>({
    url: '/paint/work-order/save-template-and-alias-map',
    method: 'post',
    data: { shopId, config, aliasMap }
  });
}

export function getExcelTemplateConfig(shopId: string) {
  return request<ExcelTemplateConfig | null>({
    url: '/paint/work-order/template-config',
    method: 'get',
    params: { shopId }
  });
}
