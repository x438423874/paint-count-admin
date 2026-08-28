import request from '@/utils/request'
import type {
  CategoryBreakdown,
  CreateVehicleDto,
  CreateWorkOrderDto,
  MonthlyStatistics,
  PageResult,
  PageVehicleDto,
  PageWorkOrderDto,
  PaintCategory,
  PaintShop,
  PaintSpecialPaint,
  PaintStandard,
  PaintVehicle,
  PaintWorkOrder,
  ShopComparison,
  UpdateVehicleDto,
  UpdateWorkOrderDto,
  VehicleHistorySummary,
  YearOverview,
  StatisticsOverview,
  PaintPendingImage,
  PendingImageStatus,
  PendingImageStatusCounts,
  PagePendingImageDto,
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

export function findDuplicateWorkOrders(orderNo: string, excludeId?: string, settlementMonth?: string) {
  return request.get<PaintWorkOrder[]>('/paint/work-order/duplicates/' + orderNo, { params: { ...(excludeId ? { excludeId } : {}), ...(settlementMonth ? { settlementMonth } : {}) } })
}

export function mergeWorkOrders(targetId: string, sourceIds: string[]) {
  return request.post<PaintWorkOrder>('/paint/work-order/merge', { targetId, sourceIds })
}

export function auditWorkOrder(id: string, auditedBy?: string) {
  return request.post<PaintWorkOrder>('/paint/work-order/audit', { id, auditedBy })
}

export function unauditWorkOrder(id: string) {
  return request.post<PaintWorkOrder>(`/paint/work-order/unaudit/${id}`)
}

/** OCR 识别模式：basic 仅基础资料 / items 仅部位 / all 全部 */
export type OcrMode = 'basic' | 'items' | 'all'

export function quickCreateWorkOrder(file: File, shopId: string, settlementMonth?: string, enableOcr = true, ocrMode: OcrMode = 'all') {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('shopId', shopId)
  formData.append('enableOcr', enableOcr ? 'true' : 'false')
  formData.append('ocrMode', ocrMode)
  if (settlementMonth)
    formData.append('settlementMonth', settlementMonth)

  return request.post<PaintWorkOrder>('/paint/work-order/quick-create', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: enableOcr ? 120000 : 60000,
  })
}

// OCR 识别（不创建工单，仅返回识别结果）
export function ocrRecognizeImage(file: File, shopId?: string, ocrMode: OcrMode = 'all') {
  const formData = new FormData()
  formData.append('file', file)
  if (shopId)
    formData.append('shopId', shopId)
  formData.append('ocrMode', ocrMode)

  return request.post<{
    plateNumber: string
    orderNo: string
    customerName: string
    phone: string
    carModel: string
    vin: string
    brand: string
    date: string
    rawText: string
    orderNoValid?: boolean
    orderNoCandidates?: string[]
    vinCorrected?: boolean
    vinOriginal?: string
    items?: {
      categoryId?: string
      matchedName: string
      rawText: string
      quantity: number
      newPartQuantity: number
      matched: boolean
    }[]
  }>('/paint/work-order/ocr', formData, {
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

export function getStatisticsOverview(settlementMonth?: string, shopId?: string) {
  return request.get<StatisticsOverview>('/paint/statistics/overview', { params: { settlementMonth, shopId } })
}

export function getLatestSettlementMonth() {
  return request.get<string | null>('/paint/statistics/latest-month')
}

// ===== 结算 API =====

export function settleWorkOrder(orderId: string, settlementMonth?: string) {
  return request.post<PaintWorkOrder>(`/paint/work-order/${orderId}/settlement`, { settlementMonth })
}

export function unsettleWorkOrder(orderId: string) {
  return request.post<PaintWorkOrder>(`/paint/work-order/${orderId}/unsettle`)
}

export function batchSettleWorkOrders(ids: string[]) {
  return request.post<{ success: number; failed: number; errors: { id: string; message: string }[] }>('/paint/work-order/batch-settle', { ids })
}

export function batchUnsettleWorkOrders(ids: string[]) {
  return request.post<{ success: number; failed: number; errors: { id: string; message: string }[] }>('/paint/work-order/batch-unsettle', { ids })
}

export function setAbnormal(orderId: string, isAbnormal: boolean, abnormalRemark?: string) {
  return request.post(`/paint/work-order/${orderId}/abnormal`, { isAbnormal, abnormalRemark })
}

// ===== 工单号规则 API =====

export interface OrderNoRule {
  pattern: string;
  length: number;
  description?: string;
}

export function fetchOrderNoRules(shopId: string) {
  return request.get<OrderNoRule[]>('/paint/work-order/order-no-rules', { params: { shopId } })
}

// ===== 车辆主数据 API =====

/** 按车牌号查询车辆（工单表单自动填充用） */
export function fetchVehicleByPlate(plateNumber: string) {
  return request.get<PaintVehicle | null>(`/paint/vehicle/by-plate/${encodeURIComponent(plateNumber)}`)
}

/** 查询车辆历史工单 + 统计摘要 */
export function fetchVehicleHistory(
  vehicleId: string,
  params?: { current?: number; size?: number; scope?: 'current_shop' | 'all_shops'; shopId?: string },
) {
  return request.get<{ records: PaintWorkOrder[]; total: number; summary: VehicleHistorySummary }>(
    `/paint/vehicle/${vehicleId}/history-orders`,
    { params },
  )
}

/** 分页查询车辆（按数据权限过滤） */
export function fetchPaintVehiclePage(params: PageVehicleDto) {
  return request.get<PageResult<PaintVehicle>>('/paint/vehicle/page', { params })
}

/** 新增车辆 */
export function createPaintVehicle(data: CreateVehicleDto) {
  return request.post<PaintVehicle>('/paint/vehicle', data)
}

/** 编辑车辆 */
export function updatePaintVehicle(data: UpdateVehicleDto) {
  return request.put<PaintVehicle>('/paint/vehicle', data)
}

/** 删除车辆（仅解除关联，不删工单） */
export function deletePaintVehicle(id: string) {
  return request.delete(`/paint/vehicle/${id}`)
}

/** 查询车辆详情 */
export function fetchVehicleById(id: string) {
  return request.get<PaintVehicle>(`/paint/vehicle/${id}`)
}

// ===== 图片池 API =====

export function getPendingImagePage(params: PagePendingImageDto) {
  return request.get<PageResult<PaintPendingImage>>('/paint/pending-image/page', { params })
}

export function getPendingImageStatusCounts(shopId?: string, settlementMonth?: string) {
  return request.get<PendingImageStatusCounts>('/paint/pending-image/status-counts', { params: { shopId, settlementMonth } })
}

export function getPendingImageDetail(id: string) {
  return request.get<PaintPendingImage>(`/paint/pending-image/${id}`)
}

export function getPendingImageCandidates(id: string) {
  return request.get<any[]>(`/paint/pending-image/${id}/candidates`)
}

/** 上传单张图片到图片池（同步 OCR + 自动匹配）
 * @param source 图片来源：POOL=图片池直接上传（用于匹配已有工单）；CREATE=新建工单时带图上传
 */
export function uploadPendingImage(file: File, shopId: string, settlementMonth?: string, source: 'POOL' | 'CREATE' = 'POOL') {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('shopId', shopId)
  if (settlementMonth) formData.append('settlementMonth', settlementMonth)
  formData.append('source', source)
  return request.post<PaintPendingImage>('/paint/pending-image/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
}

export function autoMatchPendingImage(id: string) {
  return request.post<{ status: PendingImageStatus; matchedOrderId?: string; remark?: string }>(`/paint/pending-image/${id}/auto-match`)
}

/** 上传图片直接关联到指定工单（作为 BEFORE 图，不进图片池）。用于创建工单页“直接创建工单”模式。 */
export function uploadPendingImageToOrder(file: File, shopId: string, orderId: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('shopId', shopId)
  formData.append('orderId', orderId)
  return request.post<PaintOrderImage>('/paint/pending-image/attach-to-order', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
}

export function manualMatchPendingImage(id: string, orderId: string) {
  return request.post<PaintPendingImage>(`/paint/pending-image/${id}/match`, { orderId })
}

export function createOrderFromPending(id: string, settlementMonth?: string) {
  return request.post<PaintPendingImage>(`/paint/pending-image/${id}/create-order`, { settlementMonth })
}

export function retryOcrPendingImage(id: string) {
  return request.post<PaintPendingImage>(`/paint/pending-image/${id}/retry-ocr`, {}, { timeout: 120000 })
}

export function deletePendingImage(id: string) {
  return request.delete(`/paint/pending-image/${id}`)
}

// ===== 幅数调整单 API =====
export function getAdjustmentList(params?: { shopId?: string; applyMonth?: string; targetMonth?: string }) {
  return request.get<PaintAdjustment[]>('/paint/adjustment', { params })
}

export function createAdjustment(data: CreateAdjustmentParams) {
  return request.post<PaintAdjustment>('/paint/adjustment', data)
}

export function deleteAdjustment(id: string) {
  return request.delete(`/paint/adjustment/${id}`)
}

