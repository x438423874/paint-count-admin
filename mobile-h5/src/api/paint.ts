import request from '@/utils/request'
import type {
  CategoryBreakdown,
  CreateWorkOrderDto,
  MonthlyStatistics,
  PageResult,
  PageWorkOrderDto,
  PaintCategory,
  PaintShop,
  PaintSpecialPaint,
  PaintStandard,
  PaintWorkOrder,
  ShopComparison,
  UpdateWorkOrderDto,
  YearOverview,
  SettlementRecord,
} from './types/paint'

// ===== 门店 API =====

export function getShopList() {
  return request.get<PaintShop[]>('/paint/shop/list')
}

export function getShopDetail(id: string) {
  return request.get<PaintShop>(`/paint/shop/${id}`)
}

// ===== 工单 API =====

export function getWorkOrderPage(params: PageWorkOrderDto) {
  return request.get<PageResult<PaintWorkOrder>>('/paint/work-order/page', { params })
}

export function getWorkOrderStatusCounts(shopId?: string, settlementMonth?: string) {
  return request.get<{ total: number; pending: number; audited: number; settled: number }>('/paint/work-order/status-counts', { params: { shopId, settlementMonth } })
}

export function getWorkOrderDetail(id: string) {
  return request.get<PaintWorkOrder>(`/paint/work-order/${id}`)
}

export function createWorkOrder(data: CreateWorkOrderDto) {
  return request.post<PaintWorkOrder>('/paint/work-order', data)
}

export function updateWorkOrder(data: UpdateWorkOrderDto) {
  return request.put<PaintWorkOrder>('/paint/work-order', data)
}

export function deleteWorkOrder(id: string) {
  return request.delete(`/paint/work-order/${id}`)
}

export function auditWorkOrder(id: string, auditedBy?: string) {
  return request.post<PaintWorkOrder>('/paint/work-order/audit', { id, auditedBy })
}

export function unauditWorkOrder(id: string) {
  return request.post<PaintWorkOrder>(`/paint/work-order/unaudit/${id}`)
}

export function quickCreateWorkOrder(file: File, shopId: string, settlementMonth?: string, enableOcr = true) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('shopId', shopId)
  formData.append('enableOcr', enableOcr ? 'true' : 'false')
  if (settlementMonth)
    formData.append('settlementMonth', settlementMonth)

  return request.post<PaintWorkOrder>('/paint/work-order/quick-create', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: enableOcr ? 120000 : 60000,
  })
}

// OCR 识别（不创建工单，仅返回识别结果）
export function ocrRecognizeImage(file: File, shopId?: string) {
  const formData = new FormData()
  formData.append('file', file)
  if (shopId)
    formData.append('shopId', shopId)

  return request.post<{ plateNumber: string; orderNo: string; customerName: string; phone: string; carModel: string; date: string; rawText: string }>('/paint/work-order/ocr', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
}

export function uploadWorkOrderImage(orderId: string, file: File, imageType: string = 'BEFORE') {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('imageType', imageType)
  return request.post(`/paint/work-order/${orderId}/images`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export function deleteWorkOrderImage(imageId: string) {
  return request.delete(`/paint/work-order/images/${imageId}`)
}

// ===== 幅数标准 API =====

export function getCategories() {
  return request.get<PaintCategory[]>('/paint/standard-template/categories')
}

export function getShopCategoriesWithStandard(shopId: string) {
  return request.get<PaintStandard[]>(`/paint/standard/shop/${shopId}/categories`)
}

// ===== 特殊车漆 API =====

export function getSpecialPaintList(activeOnly = true) {
  return request.get<PaintSpecialPaint[]>('/paint/standard-template/special-paints', {
    params: activeOnly ? { activeOnly: 'true' } : {},
  })
}

// ===== 统计 API =====

export function getMonthlyStatistics(settlementMonth?: string, shopId?: string) {
  return request.get<MonthlyStatistics[]>('/paint/statistics/monthly', { params: { settlementMonth, shopId } })
}

export function getCategoryBreakdown(settlementMonth?: string, shopId?: string) {
  return request.get<CategoryBreakdown[]>('/paint/statistics/category', { params: { settlementMonth, shopId } })
}

export function getShopComparison(settlementMonth?: string) {
  return request.get<ShopComparison[]>('/paint/statistics/comparison', { params: { settlementMonth } })
}

export function getYearOverview(year?: number, shopId?: string) {
  return request.get<YearOverview[]>('/paint/statistics/year-overview', { params: { year, shopId } })
}

// ===== 结算 API =====

export function addSettlementRecord(orderId: string, settlementMonth: string, remark?: string) {
  return request.post<SettlementRecord>(`/paint/work-order/${orderId}/settlement`, { settlementMonth, remark })
}

export function removeSettlementRecord(orderId: string, recordId: string) {
  return request.delete(`/paint/work-order/${orderId}/settlement/${recordId}`)
}

export function setAbnormal(orderId: string, isAbnormal: boolean, abnormalRemark?: string) {
  return request.post(`/paint/work-order/${orderId}/abnormal`, { isAbnormal, abnormalRemark })
}

export function getSettlementHistory(orderId: string) {
  return request.get<SettlementRecord[]>(`/paint/work-order/${orderId}/settlements`)
}
