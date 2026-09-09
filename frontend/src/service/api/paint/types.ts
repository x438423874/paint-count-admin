// ==================== 喷漆业务类型定义 ====================

/** 通用分页结果（与 Api.Common.PaginatingQueryRecord 同构） */
export type PageResult<T> = Api.Common.PaginatingQueryRecord<T>;

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
  status?: string;
  standardTemplateId?: string;
  standardTemplate?: { id: string; name: string };
}

/** 工单状态 */
export type PaintOrderStatus = 'DRAFT' | 'PENDING' | 'AUDITED' | 'SETTLED' | 'ABNORMAL' | 'VOID';

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
  isAdjustment?: boolean | null;
  createdAt: string;
  updatedAt?: string | null;
  shop?: PaintShopListItem;
  items?: PaintWorkOrderItem[];
  images?: PaintWorkOrderImage[];
  _count?: { images: number };
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
  isAdjustment?: boolean;
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
  isAdjustment?: boolean;
}

/** 工单项目输入 */
export interface WorkOrderItemInput {
  categoryId: string;
  quantity?: number;
  newPartQuantity?: number;
  specialPaintId?: string;
  /** 直接指定幅数（可传负值，用于调整单抵消）；传入后忽略按系数计算 */
  overridePaintCount?: number;
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
  totalNewPartQuantity?: number;
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
  /** 自动识别时建议的部位别名映射 */
  suggestedAliasMap?: Record<string, string[]>;
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
  /** 数值语义：quantity=数量模式，paintCount=部位幅数模式 */
  mode?: 'quantity' | 'paintCount';
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
  reworkOrders: number;
  reworkPaintCount: number;
  reworkVehicles: number;
}

/**
 * 统计看板聚合数据
 *
 * 一次请求拿齐「月度统计 + KPI 概览 + 门店对比 + 类别分布 + 年度趋势」， 替代原先 5 个并发请求（其中 comparison / overview 在后端还会各自再跑一次完整月度聚合）。
 */
export interface StatisticsDashboard {
  monthly: MonthlyStat[];
  overview: StatisticsOverview;
  comparison: ShopComparison[];
  category: CategoryBreakdown[];
  yearOverview: YearOverview[];
}

export interface OrderNoRule {
  pattern: string;
  length: number;
  description?: string;
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
  reworkExcludedCount: number;
  reworkExcludedPaintCount: number;
  voidedCount: number;
}

export type ReconcileItemType = 'matched' | 'diff' | 'missing_in_system' | 'extra_in_system' | 'duplicate' | 'voided';

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
  isRework?: boolean | null;
  reworkRemark?: string | null;
  voidReason?: string | null;
}

export interface ReconcileResult {
  summary: ReconcileSummary;
  items: ReconcileItem[];
}

/** 用户绑定的门店信息（含在岗期） */
export interface UserBoundShop {
  id: string;
  name: string;
  code: string;
  brand: string;
  status: string;
  /** 在岗开始时间 */
  startAt: string;
  /** 离岗时间；为 null 表示在岗中 */
  endAt: string | null;
}

export interface SettlementMonthRecord {
  id: string | null;
  shopId: string;
  month: string;
  isSealed: boolean;
  sealedAt: string | null;
  sealedBy: string | null;
  shop?: { id: string; name: string };
  stats?: {
    orderCount: number;
    totalPaintCount: number;
    reworkCount: number;
  };
}

export interface SealOverviewItem {
  shopId: string;
  shopName: string;
  month: string;
  orderCount: number;
  totalPaintCount: number;
  reworkCount: number;
  /** 待审核工单数 */
  pendingCount: number;
  /** 待审核幅数合计 */
  pendingPaintCount: number;
  /** 当月是否有工单数据（false = 漏导入风险提示） */
  hasData: boolean;
  isSealed: boolean;
  sealedAt: string | null;
  sealedBy: string | null;
}

export interface SealOverviewSummary {
  shopsWithData: number;
  shopsWithoutData: number;
  pendingOrderTotal: number;
  pendingPaintTotal: number;
  sealedCount: number;
}

export interface SealOverviewResult {
  list: SealOverviewItem[];
  total: number;
  summary?: SealOverviewSummary;
}

export interface PaintVehicle {
  id: string;
  plateNumber: string;
  vin?: string | null;
  carModel?: string | null;
  brand?: string | null;
  customerName?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  remark?: string | null;
  lastOrderAt?: string | null;
  lastShopId?: string | null;
  lastShopName?: string | null;
  totalOrderCount: number;
  totalPaintCount: number | string;
  createdAt: string;
  updatedAt?: string | null;
}

export interface VehicleHistorySummary {
  totalOrders: number;
  totalPaintCount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  shopCount: number;
  reworkCount: number;
  abnormalCount: number;
}

/** 图片池状态：待匹配/已归类/待确认/人工/失败 */
export type PendingImageStatus = 'PENDING' | 'MATCHED' | 'NEEDS_REVIEW' | 'MANUAL' | 'FAILED';

/** OCR 生命周期状态（与匹配 status 解耦，支持上传后异步识别） */
export type PendingOcrStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

/** 图片池记录 */
export interface PaintPendingImage {
  id: string;
  shopId: string;
  settlementMonth?: string | null;
  url: string;
  thumbnailUrl?: string | null;
  fileSize?: number | null;
  fileHash?: string | null;
  ocrOrderNo?: string | null;
  ocrPlateNumber?: string | null;
  ocrVin?: string | null;
  ocrCarModel?: string | null;
  ocrBrand?: string | null;
  ocrCustomerName?: string | null;
  ocrPhone?: string | null;
  ocrDate?: string | null;
  /** OCR 识别生命周期：上传后异步识别，用户可离开页面 */
  ocrStatus?: PendingOcrStatus;
  status: PendingImageStatus;
  matchedOrderId?: string | null;
  matchRemark?: string | null;
  uploadedBy?: string | null;
  createdAt: string;
  matchedAt?: string | null;
  /** 图片来源：POOL=图片池直接上传(匹配) / CREATE=新建工单时上传 */
  source?: 'POOL' | 'CREATE';
  shop?: { id: string; name: string; code: string };
  order?: {
    id: string;
    orderNo: string | null;
    plateNumber: string | null;
    settlementMonth: string | null;
    status: string;
  } | null;
}

/** 图片池状态计数 */
export interface PendingImageStatusCounts {
  PENDING: number;
  MATCHED: number;
  NEEDS_REVIEW: number;
  MANUAL: number;
  FAILED: number;
  total: number;
}
