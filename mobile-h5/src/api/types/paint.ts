// ===== 工单相关类型 =====

export enum PaintOrderStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  AUDITED = 'AUDITED',
  SETTLED = 'SETTLED',
  ABNORMAL = 'ABNORMAL',
  VOID = 'VOID',
}

/** 与后端 Prisma 枚举 PaintImageType 对齐（OTHER 为历史笔误，库中不存在） */
export enum PaintImageType {
  BEFORE = 'BEFORE',
  DURING = 'DURING',
  AFTER = 'AFTER',
}

export interface WorkOrderItem {
  id: string
  orderId?: string
  categoryId: string
  categoryName?: string
  quantity: number
  paintCount: number | string
  newPartQuantity: number
  specialPaintId?: string | null
  specialPaintMultiplier?: number | string | null
  specialPaintName?: string
  remarks?: string | null
  category?: {
    id: string
    name: string
    code: string
    sortOrder: number
    isSpecial: boolean
  }
  specialPaint?: {
    id: string
    name: string
    multiplier: number | string
  } | null
}

export interface WorkOrderImage {
  id: string
  url: string
  thumbnailUrl?: string
  imageType: PaintImageType
  description?: string
}

// ===== 车辆主数据 =====
export interface PaintVehicle {
  id: string
  plateNumber: string
  vin?: string | null
  carModel?: string | null
  brand?: string | null
  customerName?: string | null
  phone?: string | null
  contactPerson?: string | null
  remark?: string | null
  lastOrderAt?: string | null
  lastShopId?: string | null
  lastShopName?: string | null
  totalOrderCount: number
  totalPaintCount: number | string
  createdAt: string
  updatedAt?: string | null
}

export interface VehicleHistorySummary {
  totalOrders: number
  totalPaintCount: number
  firstOrderAt?: string | null
  lastOrderAt?: string | null
  shopCount: number
  reworkCount: number
  abnormalCount: number
}

export interface PaintWorkOrder {
  id: string
  orderNo?: string
  shopId: string
  shopName?: string
  orderDate?: string
  settlementMonth?: string
  carModel?: string
  plateNumber?: string
  vin?: string
  brand?: string
  customerName?: string
  phone?: string
  contactPerson?: string
  description?: string
  status: PaintOrderStatus
  auditedBy?: string
  auditedAt?: string
  abnormalRemark?: string
  isRework: boolean
  reworkRemark?: string
  /** 幅数调整单（负幅数对冲，统计只计幅数不计工单数） */
  isAdjustment?: boolean
  totalPaintCount: number
  remark?: string
  mergeGroupId?: string
  items?: WorkOrderItem[]
  images?: WorkOrderImage[]
  _count?: { images: number }
  shop?: { id: string; name: string }
  createdAt: string
  updatedAt: string
  _isDuplicate?: boolean
  _duplicateCount?: number
  /** 运行时标记：同车牌在其它结算月份也有结算工单（列表「跨月结算」标签） */
  _hasOtherMonthSettlement?: boolean
}

export interface PaintOrderImage {
  id: string
  orderId: string
  url: string
  type: PaintImageType
  uploaderId?: string
  uploaderName?: string
  createdAt: string
}

export interface CreateWorkOrderDto {
  orderNo?: string
  shopId: string
  orderDate?: string
  settlementMonth?: string
  carModel?: string
  plateNumber?: string
  vin?: string
  brand?: string
  customerName?: string
  phone?: string
  contactPerson?: string
  description?: string
  items?: CreateWorkOrderItemDto[]
  remark?: string
  isAdjustment?: boolean
}

export interface CreateWorkOrderItemDto {
  categoryId: string
  quantity?: number
  newPartQuantity?: number
  specialPaintId?: string
  overridePaintCount?: number
}

export interface UpdateWorkOrderDto {
  id: string
  orderNo?: string
  orderDate?: string
  carModel?: string
  plateNumber?: string
  vin?: string
  brand?: string
  customerName?: string
  phone?: string
  contactPerson?: string
  description?: string
  status?: PaintOrderStatus
  settlementMonth?: string
  items?: CreateWorkOrderItemDto[]
  remark?: string
  isRework?: boolean
  reworkRemark?: string
  isAdjustment?: boolean
}

export interface PageWorkOrderDto {
  current?: number
  size?: number
  shopId?: string
  plateNumber?: string
  orderNo?: string
  customerName?: string
  settlementMonth?: string
  status?: PaintOrderStatus
  isRework?: boolean
}

export interface PageResult<T> {
  records: T[]
  total: number
  current: number
  size: number
  totalPaintCount?: number
}

// ===== 门店相关类型 =====

export interface PaintShop {
  id: string
  name: string
  code?: string
  brand?: string
  address?: string
  contactPerson?: string
  phone?: string
  status?: string
  standardTemplateId?: string
  excelTemplateConfig?: string
  createdAt: string
  updatedAt: string
}

// ===== 统计相关类型 =====

export interface MonthlyStatistics {
  settlementMonth: string
  shopId: string
  shopName: string
  shopCode?: string
  totalOrders: number
  totalPaintCount: number
  totalVehicles: number
  avgPaintPerVehicle: number
  avgPaintPerOrder: number
  dailyStats: DailyStat[]
  pendingOrders: number
  pendingPaintCount: number
  pendingVehicles: number
  auditedOrders: number
  auditedPaintCount: number
  auditedVehicles: number
  abnormalOrders?: number
  abnormalPaintCount?: number
  settledOrders?: number
  settledPaintCount?: number
  reworkOrders?: number
  reworkPaintCount?: number
  reworkVehicles?: number
}

export interface DailyStat {
  date: string
  orderCount: number
  paintCount: number
}

export interface CategoryBreakdown {
  categoryId?: string
  categoryName: string
  categoryCode?: string
  paintCount: number
  totalPaintCount?: number
  orderCount: number
  totalCount?: number
  totalNewPartQuantity?: number
}

export interface ShopComparison {
  shopId: string
  shopName: string
  shopCode?: string
  totalOrders: number
  totalPaintCount: number
  totalVehicles: number
  avgPaintPerVehicle: number
  avgPaintPerOrder: number
  pendingOrders: number
  pendingPaintCount: number
  pendingVehicles: number
  auditedOrders: number
  auditedPaintCount: number
  auditedVehicles: number
  reworkOrders?: number
  reworkPaintCount?: number
  reworkVehicles?: number
}

export interface YearOverview {
  settlementMonth: string
  paintCount: number
  orderCount: number
  reworkOrders?: number
  reworkPaintCount?: number
  reworkVehicles?: number
}

export interface StatisticsOverview {
  totalOrders: number
  totalPaintCount: number
  auditedOrders: number
  auditedPaintCount: number
  auditRate: number
  pendingOrders: number
  pendingPaintCount: number
  abnormalOrders: number
  abnormalPaintCount: number
  settledOrders: number
  settledPaintCount: number
  settlementRate: number
  avgPaintPerOrder: number
  reworkOrders?: number
  reworkPaintCount?: number
  reworkVehicles?: number
}

// ===== 幅数标准相关类型 =====

export interface PaintCategory {
  id: string
  name: string
  code?: string
}

export interface PaintStandard {
  categoryId: string
  category?: {
    id: string
    name: string
    code: string
    sortOrder: number
    isSpecial: boolean
  }
  categoryName?: string
  coefficient: number | string
  newPartAddition: number | string
  alias?: string
  specialPaintId?: string | null
  standardId?: string
}

// ===== 特殊车漆 =====

export interface PaintSpecialPaint {
  id: string
  name: string
  multiplier: number | string
  description?: string
  isActive?: boolean
  templateId?: string
}

// ===== 车辆 DTO =====

export interface CreateVehicleDto {
  plateNumber: string
  vin?: string
  carModel?: string
  brand?: string
  customerName?: string
  phone?: string
  contactPerson?: string
  remark?: string
}

export interface UpdateVehicleDto {
  id: string
  plateNumber?: string
  vin?: string
  carModel?: string
  brand?: string
  customerName?: string
  phone?: string
  contactPerson?: string
  remark?: string
}

export interface PageVehicleDto {
  current?: number
  size?: number
  plateNumber?: string
  customerName?: string
  phone?: string
  vin?: string
  shopId?: string
}

// ===== 结算记录 =====

export interface SettlementRecord {
  id: string
  orderId: string
  settlementMonth: string
  paintCount: number | string
  itemCount: number
  remark?: string
  createdAt: string
}

// ===== 图片池 =====

export type PendingImageStatus = 'PENDING' | 'MATCHED' | 'NEEDS_REVIEW' | 'MANUAL' | 'FAILED'

/** OCR 生命周期状态（与匹配 status 解耦，支持上传后异步识别） */
export type OcrStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'

export interface PaintPendingImage {
  id: string
  shopId: string
  settlementMonth?: string | null
  url: string
  thumbnailUrl?: string | null
  fileSize?: number | null
  ocrOrderNo?: string | null
  ocrPlateNumber?: string | null
  ocrVin?: string | null
  ocrCarModel?: string | null
  ocrBrand?: string | null
  ocrCustomerName?: string | null
  ocrPhone?: string | null
  ocrDate?: string | null
  ocrRawJson?: string | null
  /** OCR 识别生命周期：上传后异步识别，用户可离开页面 */
  ocrStatus?: OcrStatus
  /** 图片来源：POOL=图片池直接上传（用于匹配已有工单）；CREATE=新建工单时带图上传 */
  source?: 'POOL' | 'CREATE'
  status: PendingImageStatus
  matchedOrderId?: string | null
  matchRemark?: string | null
  uploadedBy?: string | null
  createdAt: string
  matchedAt?: string | null
  shop?: { id: string; name: string; code: string }
  order?: { id: string; orderNo: string | null; plateNumber: string | null; settlementMonth: string | null; status: string } | null
}

export interface PendingImageStatusCounts {
  PENDING: number
  MATCHED: number
  NEEDS_REVIEW: number
  MANUAL: number
  FAILED: number
  total: number
}

export interface PagePendingImageDto {
  current?: number
  size?: number
  shopId?: string
  settlementMonth?: string
  status?: PendingImageStatus
  keyword?: string
}


