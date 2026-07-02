import { request } from '../request';

// ==================== 类型定义 ====================

/** 通用分页结果 */
export interface PageResult<T> {
  records: T[];
  total: number;
  current: number;
  size: number;
}

/** 门店状态 */
export type ShopStatus = 'ENABLED' | 'DISABLED';

/** 标准模板摘要 */
export interface PaintStandardTemplateBrief {
  id: string;
  name: string;
}

/** 门店 */
export interface PaintShop {
  id: string;
  name: string;
  code: string;
  brand: string;
  address?: string | null;
  phone?: string | null;
  status: ShopStatus;
  standardTemplateId?: string | null;
  standardTemplate?: PaintStandardTemplateBrief | null;
  excelTemplateConfig?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

/** 门店列表项（精简） */
export interface PaintShopListItem {
  id: string;
  name: string;
  code: string;
  brand: string;
}

/** 工单状态 */
export type PaintOrderStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

/** 图片类型 */
export type PaintImageType = 'BEFORE' | 'DURING' | 'AFTER';

/** 喷漆项目类别 */
export interface PaintItemCategory {
  id: string;
  name: string;
  code: string;
  sortOrder: number;
  isSpecial: boolean;
  shopId?: string | null;
}

/** 特殊车漆 */
export interface PaintSpecialPaint {
  id: string;
  name: string;
  multiplier: number;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

/** 工单项目 */
export interface PaintWorkOrderItem {
  id: string;
  orderId: string;
  categoryId: string;
  quantity: number;
  paintCount: number;
  newPartQuantity: number;
  specialPaintId?: string | null;
  specialPaintMultiplier?: number | null;
  remarks?: string | null;
  category?: PaintItemCategory;
  specialPaint?: PaintSpecialPaint | null;
}

/** 工单图片 */
export interface PaintWorkOrderImage {
  id: string;
  orderId: string;
  url: string;
  thumbnailUrl?: string | null;
  imageType: PaintImageType;
  description?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  createdAt: string;
}

/** 结算记录 */
export interface PaintSettlementRecord {
  id: string;
  orderId: string;
  settlementMonth: string;
  paintCount: number;
  itemCount: number;
  remark?: string | null;
  createdAt: string;
}

/** 工单 */
export interface PaintWorkOrder {
  id: string;
  orderNo: string;
  shopId: string;
  orderDate: string;
  settlementMonth?: string | null;
  carModel?: string | null;
  plateNumber?: string | null;
  vin?: string | null;
  customerName?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  description?: string | null;
  totalPaintCount: number;
  status: PaintOrderStatus;
  isAudited: boolean;
  auditedAt?: string | null;
  auditedBy?: string | null;
  remark?: string | null;
  mergeGroupId?: string | null;
  shopName?: string | null;
  isAbnormal?: boolean | null;
  createdAt: string;
  updatedAt?: string | null;
  shop?: PaintShopListItem;
  items?: PaintWorkOrderItem[];
  images?: PaintWorkOrderImage[];
  settlements?: PaintSettlementRecord[];
}

/** 工单创建数据 */
export interface CreateWorkOrderData {
  orderNo?: string;
  shopId: string;
  orderDate: string;
  settlementMonth?: string;
  carModel?: string;
  plateNumber?: string;
  vin?: string;
  customerName?: string;
  phone?: string;
  contactPerson?: string;
  description?: string;
  items?: WorkOrderItemInput[];
  remark?: string;
}

/** 工单更新数据 */
export interface UpdateWorkOrderData {
  id: string;
  orderNo?: string;
  carModel?: string;
  plateNumber?: string;
  customerName?: string;
  phone?: string;
  status?: PaintOrderStatus;
  settlementMonth?: string;
  items?: WorkOrderItemInput[];
  remark?: string;
}

/** 工单项目输入 */
export interface WorkOrderItemInput {
  categoryId: string;
  quantity?: number;
  newPartQuantity?: number;
  specialPaintId?: string;
}

/** 幅数标准 */
export interface PaintStandard {
  id: string;
  shopId: string;
  categoryId: string;
  coefficient: number;
  newPartAddition: number;
  alias?: string | null;
  unit: string;
  category?: PaintItemCategory;
}

/** 标准模板 */
export interface PaintStandardTemplate {
  id: string;
  name: string;
  description?: string | null;
  version?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string | null;
  items?: PaintStandardTemplateItem[];
}

/** 标准模板项目 */
export interface PaintStandardTemplateItem {
  id: string;
  templateId: string;
  categoryId: string;
  coefficient: number;
  newPartAddition: number;
  alias?: string | null;
  unit: string;
  specialPaintId?: string | null;
  category?: PaintItemCategory;
  specialPaint?: PaintSpecialPaint | null;
}

/** 月度统计 */
export interface MonthlyStat {
  settlementMonth: string;
  shopId: string;
  shopName: string;
  shopCode: string;
  totalOrders: number;
  totalPaintCount: number;
  totalVehicles: number;
  avgPaintPerVehicle: number;
  avgPaintPerOrder: number;
  dailyStats: { date: string; orderCount: number; paintCount: number }[];
  pendingOrders: number;
  pendingPaintCount: number;
  pendingVehicles: number;
  auditedOrders: number;
  auditedPaintCount: number;
  auditedVehicles: number;
}

/** 类别统计 */
export interface CategoryBreakdown {
  categoryName: string;
  categoryCode: string;
  totalCount: number;
  totalPaintCount: number;
}

/** 门店对比 */
export interface ShopComparison {
  shopId: string;
  shopName: string;
  shopCode: string;
  totalOrders: number;
  totalPaintCount: number;
  totalVehicles: number;
  avgPaintPerVehicle: number;
  avgPaintPerOrder: number;
  pendingOrders: number;
  pendingPaintCount: number;
  pendingVehicles: number;
  auditedOrders: number;
  auditedPaintCount: number;
  auditedVehicles: number;
}

/** 年度概览 */
export interface YearOverview {
  month: string;
  totalOrders: number;
  totalPaintCount: number;
  averagePaintCount: number;
  pendingOrders: number;
  pendingPaintCount: number;
  pendingVehicles: number;
  auditedOrders: number;
  auditedPaintCount: number;
  auditedVehicles: number;
}

/** Excel 模板配置 */
export interface ExcelTemplateConfig {
  dataStartRow?: number;
  headerRow?: number;
  coefficientRow?: number;
  fields: {
    date: string;
    carModel: string;
    plateNumber: string;
    orderNo: string;
    paintCount: string;
    remark: string;
  };
  items: { col: string; categoryName: string }[];
}

/** 定时任务 */
export interface ScheduledTask {
  name: string;
  cron: string;
  description: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
}

/** 导入结果 */
export interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

// ==================== 门店 API ====================

export function fetchPaintShopList() {
  return request<PaintShopListItem[]>({
    url: '/paint/shop/list',
    method: 'get'
  });
}

export function fetchPaintShopPage(params?: { current?: number; size?: number; name?: string; brand?: string }) {
  return request<PageResult<PaintShop>>({
    url: '/paint/shop/page',
    method: 'get',
    params
  });
}

export function fetchPaintShopById(id: string) {
  return request<PaintShop>({
    url: `/paint/shop/${id}`,
    method: 'get'
  });
}

export function createPaintShop(data: { name: string; code: string; brand: string; address?: string; phone?: string; standardTemplateId?: string }) {
  return request({
    url: '/paint/shop',
    method: 'post',
    data
  });
}

export function updatePaintShop(data: { id: string; name: string; brand: string; address?: string; phone?: string; standardTemplateId?: string }) {
  return request({
    url: '/paint/shop',
    method: 'put',
    data
  });
}

export function deletePaintShop(id: string) {
  return request({
    url: `/paint/shop/${id}`,
    method: 'delete'
  });
}

// ==================== 工单 API ====================

export function fetchWorkOrderPage(params?: {
  current?: number;
  size?: number;
  shopId?: string;
  plateNumber?: string;
  customerName?: string;
  settlementMonth?: string;
  status?: string;
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

export function quickCreateWorkOrder(shopId: string, formData: FormData) {
  return request<PaintWorkOrder>({
    url: '/paint/work-order/quick-create',
    method: 'post',
    data: formData,
    timeout: 120_000
  });
}

export function ocrRecognizeImage(formData: FormData) {
  return request<{ plateNumber: string; orderNo: string; customerName: string; phone: string; carModel: string; date: string; rawText: string }>({
    url: '/paint/work-order/ocr',
    method: 'post',
    data: formData,
    timeout: 120_000
  });
}

/** 智能标注：自动识别字段区域坐标 */
export function ocrSmartAnnotate(formData: FormData) {
  return request<Record<string, { x: number; y: number; width: number; height: number } | null>>({
    url: '/paint/work-order/ocr-smart-annotate',
    method: 'post',
    data: formData,
    timeout: 120_000
  });
}

export function getOcrTemplate(shopId: string) {
  return request<any>({
    url: '/paint/work-order/ocr-template',
    method: 'get',
    params: { shopId }
  });
}

export function saveOcrTemplate(shopId: string, config: any) {
  return request({
    url: '/paint/work-order/ocr-template',
    method: 'post',
    data: { shopId, config }
  });
}

export function deleteOcrTemplate(shopId: string) {
  return request({
    url: '/paint/work-order/ocr-template',
    method: 'delete',
    params: { shopId }
  });
}

// 获取默认字段别名配置
export function getDefaultFieldLabels() {
  return request<Record<string, string[]>>({
    url: '/paint/work-order/ocr-field-labels/default',
    method: 'get'
  });
}

// 获取门店字段别名配置
export function getShopFieldLabels(shopId: string) {
  return request<Record<string, string[]>>({
    url: '/paint/work-order/ocr-field-labels',
    method: 'get',
    params: { shopId }
  });
}

// 保存门店字段别名配置
export function saveShopFieldLabels(shopId: string, config: Record<string, string[]>) {
  return request({
    url: '/paint/work-order/ocr-field-labels',
    method: 'post',
    data: { shopId, config }
  });
}

// OCR诊断：返回详细的识别过程信息
export function ocrDiagnose(file: File, shopId?: string) {
  const formData = new FormData();
  formData.append('file', file);
  if (shopId) formData.append('shopId', shopId);
  return request({
    url: '/paint/work-order/ocr-diagnose',
    method: 'post',
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000
  });
}

// 修复脏数据：没有有效区域标注但标记为已验证的记录重置为待验证
export function fixOcrVerifiedStatus(shopId?: string) {
  return request<{ fixed: number }>({
    url: '/paint/work-order/ocr-fix-verified-status',
    method: 'post',
    data: shopId ? { shopId } : {}
  });
}

export function batchValidateOcr(shopId: string, limit: number = 20) {
  return request<{
    total: number;
    fields: Record<string, { total: number; matched: number; accuracy: number }>;
    details: Array<{
      orderId: string;
      orderNo: string;
      expected: Record<string, string>;
      actual: Record<string, string>;
      matched: Record<string, boolean>;
    }>;
  }>({
    url: '/paint/work-order/ocr-batch-validate',
    method: 'post',
    data: { shopId, limit }
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

export function addWorkOrderItems(orderId: string, items: WorkOrderItemInput[]) {
  return request({
    url: `/paint/work-order/${orderId}/items`,
    method: 'post',
    data: items
  });
}

export function removeWorkOrderItem(orderId: string, itemId: string) {
  return request({
    url: `/paint/work-order/${orderId}/items/${itemId}`,
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

// ==================== 统计 API ====================

export function fetchMonthlyStatistics(params?: { settlementMonth?: string; shopId?: string }) {
  return request<MonthlyStat[]>({
    url: '/paint/statistics/monthly',
    method: 'get',
    params
  });
}

export function fetchCategoryBreakdown(params?: { settlementMonth?: string; shopId?: string }) {
  return request<CategoryBreakdown[]>({
    url: '/paint/statistics/category',
    method: 'get',
    params
  });
}

export function fetchShopComparison(params?: { settlementMonth?: string }) {
  return request<ShopComparison[]>({
    url: '/paint/statistics/comparison',
    method: 'get',
    params
  });
}

export function fetchYearOverview(params?: { year?: number; shopId?: string }) {
  return request<YearOverview[]>({
    url: '/paint/statistics/year-overview',
    method: 'get',
    params
  });
}

// ==================== 幅数标准 API ====================

export function fetchPaintCategoryList() {
  return request<PaintItemCategory[]>({
    url: '/paint/standard-template/categories',
    method: 'get'
  });
}

export function fetchShopStandards(shopId: string) {
  return request<PaintStandard[]>({
    url: `/paint/standard/shop/${shopId}`,
    method: 'get'
  });
}

export function fetchShopCategoriesWithStandard(shopId: string) {
  return request<(PaintItemCategory & { standard?: PaintStandard })[]>({
    url: `/paint/standard/shop/${shopId}/categories`,
    method: 'get'
  });
}

export function setShopStandards(shopId: string, standards: { categoryId: string; coefficient: number; newPartAddition?: number; alias?: string }[]) {
  return request({
    url: `/paint/standard/shop/${shopId}`,
    method: 'post',
    data: { standards }
  });
}

export function updatePaintStandard(id: string, coefficient: number) {
  return request({
    url: `/paint/standard/${id}`,
    method: 'put',
    data: { coefficient }
  });
}

export function deletePaintStandard(id: string) {
  return request({
    url: `/paint/standard/${id}`,
    method: 'delete'
  });
}

// ==================== 部位管理 ====================

export function createPaintCategory(data: { name: string; code: string; sortOrder?: number; isSpecial?: boolean }) {
  return request<PaintItemCategory>({
    url: '/paint/standard-template/categories',
    method: 'post',
    data
  });
}

export function updatePaintCategory(id: string, data: { name?: string; code?: string; sortOrder?: number; isSpecial?: boolean }) {
  return request<PaintItemCategory>({
    url: `/paint/standard-template/categories/${id}`,
    method: 'put',
    data
  });
}

export function deletePaintCategory(id: string) {
  return request({
    url: `/paint/standard-template/categories/${id}`,
    method: 'delete'
  });
}

// ==================== 标准模板 ====================

export function fetchStandardTemplateList() {
  return request<PaintStandardTemplate[]>({
    url: '/paint/standard-template/list',
    method: 'get'
  });
}

export function fetchStandardTemplateById(id: string) {
  return request<PaintStandardTemplate>({
    url: `/paint/standard-template/${id}`,
    method: 'get'
  });
}

export function createStandardTemplate(data: { name: string; description?: string; version?: string; items?: { categoryId: string; coefficient: number; newPartAddition?: number; alias?: string; specialPaintId?: string }[] }) {
  return request<PaintStandardTemplate>({
    url: '/paint/standard-template',
    method: 'post',
    data
  });
}

export function updateStandardTemplate(data: { id: string; name?: string; description?: string; version?: string; isActive?: boolean; items?: { categoryId: string; coefficient: number; newPartAddition?: number; alias?: string; specialPaintId?: string }[] }) {
  return request<PaintStandardTemplate>({
    url: '/paint/standard-template',
    method: 'put',
    data
  });
}

export function deleteStandardTemplate(id: string) {
  return request({
    url: `/paint/standard-template/${id}`,
    method: 'delete'
  });
}

export function applyTemplateToShop(templateId: string, shopId: string) {
  return request({
    url: '/paint/standard-template/apply',
    method: 'post',
    data: { templateId, shopId }
  });
}

// ==================== 特殊车漆（通过标准模板管理） ====================

export function fetchSpecialPaintList(templateId?: string, activeOnly?: boolean) {
  const params: any = {};
  if (templateId) params.templateId = templateId;
  if (activeOnly) params.activeOnly = 'true';
  return request<PaintSpecialPaint[]>({
    url: '/paint/standard-template/special-paints',
    method: 'get',
    params
  });
}

export function createSpecialPaint(data: { templateId: string; name: string; multiplier: number; description?: string; isActive?: boolean }) {
  return request<PaintSpecialPaint>({
    url: '/paint/standard-template/special-paint',
    method: 'post',
    data
  });
}

export function updateSpecialPaint(data: { id: string; name?: string; multiplier?: number; description?: string; isActive?: boolean }) {
  return request<PaintSpecialPaint>({
    url: '/paint/standard-template/special-paint',
    method: 'put',
    data
  });
}

export function deleteSpecialPaint(id: string) {
  return request({
    url: `/paint/standard-template/special-paint/${id}`,
    method: 'delete'
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

export function findDuplicateOrders(orderNo: string, excludeId?: string) {
  return request<PaintWorkOrder[]>({
    url: `/paint/work-order/duplicates/${orderNo}`,
    method: 'get',
    params: excludeId ? { excludeId } : undefined
  });
}

export function mergeWorkOrders(targetId: string, sourceIds: string[]) {
  return request<PaintWorkOrder>({
    url: '/paint/work-order/merge',
    method: 'post',
    data: { targetId, sourceIds }
  });
}

// ==================== 工单结算记录 ====================

export function addSettlementRecord(orderId: string, settlementMonth: string, remark?: string) {
  return request<PaintSettlementRecord>({
    url: `/paint/work-order/${orderId}/settlement`,
    method: 'post',
    data: { settlementMonth, remark }
  });
}

export function removeSettlementRecord(orderId: string, recordId: string) {
  return request({
    url: `/paint/work-order/${orderId}/settlement/${recordId}`,
    method: 'delete'
  });
}

export function setAbnormal(orderId: string, isAbnormal: boolean, abnormalRemark?: string) {
  return request({
    url: `/paint/work-order/${orderId}/abnormal`,
    method: 'post',
    data: { isAbnormal, abnormalRemark }
  });
}

export function getSettlementHistory(orderId: string) {
  return request<PaintSettlementRecord[]>({
    url: `/paint/work-order/${orderId}/settlements`,
    method: 'get'
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

export function exportWorkOrderExcel(shopId: string, settlementMonth?: string) {
  return request({
    url: '/paint/work-order/export',
    method: 'get',
    params: { shopId, ...(settlementMonth && { settlementMonth }) },
    responseType: 'blob'
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

export function saveExcelTemplate(shopId: string, config: ExcelTemplateConfig) {
  return request<PaintShop>({
    url: '/paint/work-order/save-template',
    method: 'post',
    data: { shopId, config }
  });
}

export function getExcelTemplateConfig(shopId: string) {
  return request<ExcelTemplateConfig | null>({
    url: '/paint/work-order/template-config',
    method: 'get',
    params: { shopId }
  });
}

// ==================== 导出 ====================

export function exportStatisticsCsv(settlementMonth: string, shopId?: string) {
  return request({
    url: '/paint/statistics/export/csv',
    method: 'get',
    params: { settlementMonth, ...(shopId && { shopId }) },
    responseType: 'blob'
  });
}

export function exportStatisticsExcel(settlementMonth: string, shopId?: string) {
  return request({
    url: '/paint/statistics/export/excel',
    method: 'get',
    params: { settlementMonth, ...(shopId && { shopId }) },
    responseType: 'blob'
  });
}

export function exportStatisticsPdf(settlementMonth: string, shopId?: string) {
  return request({
    url: '/paint/statistics/export/pdf',
    method: 'get',
    params: { settlementMonth, ...(shopId && { shopId }) },
    responseType: 'blob'
  });
}

// ==================== OCR 标注学习 API ====================

/** OCR 标注数据 */
export interface OcrAnnotation {
  id: string;
  shopId: string;
  orderId?: string | null;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  regions: Record<string, { x: number; y: number; width: number; height: number } | null>;
  groundTruth?: Record<string, string> | null;
  isVerified: boolean;
  annotatedBy?: string | null;
  createdAt: string;
}

/** 聚合模板 */
export interface AggregatedTemplate {
  name: string;
  imageWidth: number;
  imageHeight: number;
  regions: Record<string, { x: number; y: number; width: number; height: number }>;
  annotationCount: number;
  fieldCoverage: Record<string, number>;
}

/** 标注统计 */
export interface AnnotationStats {
  total: number;
  verified: number;
  unverified: number;
  coverage: Record<string, number>;
}

/** 保存 OCR 标注 */
export function saveOcrAnnotation(data: {
  shopId: string;
  orderId?: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  regions: Record<string, any>;
  groundTruth?: Record<string, string>;
  isVerified?: boolean;
}) {
  return request<OcrAnnotation>({
    url: '/paint/work-order/ocr-annotation',
    method: 'post',
    data
  });
}

/** 查询门店标注列表 */
export function getOcrAnnotations(shopId: string, page?: number, pageSize?: number) {
  return request<{ list: OcrAnnotation[]; total: number }>({
    url: '/paint/work-order/ocr-annotations',
    method: 'get',
    params: { shopId, page, pageSize }
  });
}

/** 删除标注 */
export function deleteOcrAnnotation(id: string, shopId: string) {
  return request({
    url: `/paint/work-order/ocr-annotation/${id}`,
    method: 'delete',
    params: { shopId }
  });
}

/** 验证标注 */
export function verifyOcrAnnotation(id: string, isCorrect: boolean) {
  return request({
    url: `/paint/work-order/ocr-annotation/${id}/verify`,
    method: 'post',
    data: { isCorrect }
  });
}

/** 获取聚合模板 */
export function getAggregatedOcrTemplate(shopId: string) {
  return request<AggregatedTemplate | null>({
    url: '/paint/work-order/ocr-aggregated-template',
    method: 'get',
    params: { shopId }
  });
}

/** 获取标注统计 */
export function getOcrAnnotationStats(shopId: string) {
  return request<AnnotationStats>({
    url: '/paint/work-order/ocr-annotation-stats',
    method: 'get',
    params: { shopId }
  });
}

/** 获取已标注的工单ID列表（用于区分已标注/未标注） */
export function getAnnotatedOrderIds(shopId: string) {
  return request<string[]>({
    url: '/paint/work-order/ocr-annotated-order-ids',
    method: 'get',
    params: { shopId }
  });
}

// ==================== 定时任务管理 ====================

export function fetchScheduledTasks() {
  return request<ScheduledTask[]>({
    url: '/scheduled-tasks',
    method: 'get'
  });
}

export function fetchScheduledTaskByName(name: string) {
  return request<ScheduledTask>({
    url: `/scheduled-tasks/${name}`,
    method: 'get'
  });
}

export function startScheduledTask(name: string) {
  return request({
    url: `/scheduled-tasks/${name}/start`,
    method: 'post'
  });
}

export function stopScheduledTask(name: string) {
  return request({
    url: `/scheduled-tasks/${name}/stop`,
    method: 'post'
  });
}

export function toggleScheduledTask(name: string, action: 'start' | 'stop') {
  return request({
    url: `/scheduled-tasks/${name}/${action}`,
    method: 'post'
  });
}

// ==================== 用户-门店绑定 API（数据权限） ====================

/** 用户绑定的门店信息 */
export interface UserBoundShop {
  id: string;
  name: string;
  code: string;
  brand: string;
  status: string;
}

/** 获取指定用户绑定的门店列表（仅超管可用） */
export function fetchUserBoundShops(userId: string) {
  return request<UserBoundShop[]>({
    url: `/paint/user-shop/user/${userId}`,
    method: 'get'
  });
}

/** 设置指定用户绑定的门店（仅超管可用，全量覆盖） */
export function bindUserShops(userId: string, shopIds: string[]) {
  return request({
    url: `/paint/user-shop/user/${userId}`,
    method: 'put',
    data: { shopIds }
  });
}
