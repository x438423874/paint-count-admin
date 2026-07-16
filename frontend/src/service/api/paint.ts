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
export type PaintOrderStatus = 'DRAFT' | 'PENDING' | 'AUDITED' | 'SETTLED' | 'ABNORMAL';

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

/** 工单 */
export interface PaintWorkOrder {
  id: string;
  orderNo?: string | null;
  shopId: string;
  orderDate: string;
  settlementMonth?: string | null;
  carModel?: string | null;
  plateNumber?: string | null;
  vin?: string | null;
  brand?: string | null;
  customerName?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  description?: string | null;
  totalPaintCount: number;
  status: PaintOrderStatus;
  auditedAt?: string | null;
  auditedBy?: string | null;
  remark?: string | null;
  mergeGroupId?: string | null;
  shopName?: string | null;
  isAbnormal?: boolean | null;
  isRework?: boolean | null;
  reworkRemark?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  shop?: PaintShopListItem;
  items?: PaintWorkOrderItem[];
  images?: PaintWorkOrderImage[];
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
  brand?: string;
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
  shopId?: string;
  orderNo?: string;
  orderDate?: string;
  carModel?: string;
  plateNumber?: string;
  vin?: string;
  brand?: string;
  customerName?: string;
  phone?: string;
  contactPerson?: string;
  description?: string;
  status?: PaintOrderStatus;
  settlementMonth?: string;
  items?: WorkOrderItemInput[];
  remark?: string;
  isRework?: boolean;
  reworkRemark?: string;
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
  reworkOrders: number;
  reworkPaintCount: number;
  reworkVehicles: number;
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
  reworkOrders: number;
  reworkPaintCount: number;
  reworkVehicles: number;
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

export function fetchCategoryAliasMap(shopId: string) {
  return request<Record<string, string>>({
    url: `/paint/shop/${shopId}/category-alias-map`,
    method: 'get'
  });
}

// ==================== 工单 API ====================

export function fetchWorkOrderPage(params: {
  current?: number;
  size?: number;
  shopId?: string;
  plateNumber?: string;
  customerName?: string;
  settlementMonth?: string;
  status?: string;
  isRework?: boolean;
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

export function quickCreateWorkOrder(shopId: string, formData: FormData) {
  return request<PaintWorkOrder>({
    url: '/paint/work-order/quick-create',
    method: 'post',
    data: formData,
    timeout: 120_000
  });
}

/** OCR 识别的部位项 */
export interface OcrRecognizedItem {
  categoryId?: string;
  matchedName: string;
  rawText: string;
  quantity: number;
  newPartQuantity: number;
  matched: boolean;
}

/** OCR 识别模式：basic 仅基础资料 / items 仅部位 / all 全部 */
export type OcrMode = 'basic' | 'items' | 'all';

export function ocrRecognizeImage(formData: FormData) {
  return request<{ plateNumber: string; orderNo: string; customerName: string; phone: string; carModel: string; vin: string; brand: string; date: string; rawText: string; items?: OcrRecognizedItem[] }>({
    url: '/paint/work-order/ocr',
    method: 'post',
    data: formData,
    timeout: 120_000
  });
}

export interface BatchOcrPreviewItem {
  id: string;
  fileName: string;
  thumbnail: string;
  result: {
    plateNumber: string;
    orderNo: string;
    customerName: string;
    phone: string;
    carModel: string;
    vin: string;
    brand: string;
    date: string;
    rawText: string;
    items?: OcrRecognizedItem[];
  };
  warnings: string[];
  valid: boolean;
}

export function batchOcrPreview(formData: FormData) {
  return request<{ items: BatchOcrPreviewItem[] }>({
    url: '/paint/work-order/batch-ocr-preview',
    method: 'post',
    data: formData,
    timeout: 300_000
  });
}

export interface BatchCreateItem {
  id: string;
  plateNumber?: string;
  orderNo?: string;
  customerName?: string;
  phone?: string;
  carModel?: string;
  vin?: string;
  brand?: string;
  orderDate?: string;
  settlementMonth?: string;
  items?: { categoryId: string; quantity: number; newPartQuantity: number }[];
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

// ==================== 统计 API ====================

export function fetchLatestSettlementMonth() {
  return request<string | null>({
    url: '/paint/statistics/latest-month',
    method: 'get'
  });
}

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

export interface StatisticsOverview {
  totalOrders: number;
  totalPaintCount: number;
  auditedOrders: number;
  auditedPaintCount: number;
  auditRate: number;
  pendingOrders: number;
  pendingPaintCount: number;
  abnormalOrders: number;
  abnormalPaintCount: number;
  settledOrders: number;
  settledPaintCount: number;
  settlementRate: number;
  avgPaintPerOrder: number;
}

export function fetchStatisticsOverview(params?: { settlementMonth?: string; shopId?: string }) {
  return request<StatisticsOverview>({
    url: '/paint/statistics/overview',
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

export function fetchShopCategoriesWithStandard(shopId: string) {
  return request<(PaintItemCategory & { standard?: PaintStandard })[]>({
    url: `/paint/standard/shop/${shopId}/categories`,
    method: 'get'
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

export function setAbnormal(orderId: string, isAbnormal: boolean, abnormalRemark?: string) {
  return request({
    url: `/paint/work-order/${orderId}/abnormal`,
    method: 'post',
    data: { isAbnormal, abnormalRemark }
  });
}

export interface OrderNoRule {
  pattern: string;
  length: number;
  description?: string;
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

export interface ReconcileSummary {
  excelTotal: number;
  systemTotal: number;
  diff: number;
  excelCount: number;
  systemCount: number;
  matchedCount: number;
  diffCount: number;
  missingInSystemCount: number;
  extraInSystemCount: number;
  duplicateCount: number;
}

export type ReconcileItemType = 'matched' | 'diff' | 'missing_in_system' | 'extra_in_system' | 'duplicate';

export interface ReconcileItem {
  id?: string;
  type: ReconcileItemType;
  orderNo: string;
  plateNumber: string;
  excelPaintCount?: number;
  systemPaintCount?: number;
  diff?: number;
  status?: string;
  systemRemark?: string | null;
  remark?: string;
  source?: 'excel' | 'system';
  count?: number;
}

export interface ReconcileResult {
  summary: ReconcileSummary;
  items: ReconcileItem[];
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

// ==================== 定时任务管理 ====================

export function fetchScheduledTasks() {
  return request<ScheduledTask[]>({
    url: '/scheduled-tasks',
    method: 'get'
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

// ==================== 封单管理 API ====================

export interface SettlementMonthRecord {
  id: string;
  shopId: string;
  month: string;
  isSealed: boolean;
  sealedAt: string | null;
  sealedBy: string | null;
  shop?: { id: string; name: string };
}

export function sealSettlementMonth(shopId: string, month: string) {
  return request<SettlementMonthRecord>({
    url: '/paint/settlement-month/seal',
    method: 'post',
    data: { shopId, month }
  });
}

export function unsealSettlementMonth(shopId: string, month: string) {
  return request<SettlementMonthRecord>({
    url: '/paint/settlement-month/unseal',
    method: 'post',
    data: { shopId, month }
  });
}

export function getSealStatus(shopId: string, month: string) {
  return request<SettlementMonthRecord | null>({
    url: '/paint/settlement-month/status',
    method: 'get',
    params: { shopId, month }
  });
}
