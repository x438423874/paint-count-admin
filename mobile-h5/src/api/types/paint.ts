// ===== 工单相关类型 =====

export enum PaintOrderStatus {
  PENDING = 'PENDING',
  AUDITED = 'AUDITED',
  SETTLED = 'SETTLED',
}

export enum PaintImageType {
  BEFORE = 'BEFORE',
  AFTER = 'AFTER',
  OTHER = 'OTHER',
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

export interface PaintWorkOrder {
  id: string
  orderNo: string
  shopId: string
  shopName?: string
  orderDate: string
  settlementMonth?: string
  carModel?: string
  plateNumber?: string
  vin?: string
  customerName?: string
  phone?: string
  contactPerson?: string
  description?: string
  status: PaintOrderStatus
  isAudited: boolean
  auditedBy?: string
  auditedAt?: string
  isAbnormal: boolean
  abnormalRemark?: string
  totalPaintCount: number
  remark?: string
  mergeGroupId?: string
  items?: WorkOrderItem[]
  images?: WorkOrderImage[]
  settlements?: SettlementRecord[]
  createdAt: string
  updatedAt: string
}

export interface CreateWorkOrderDto {
  orderNo?: string
  shopId: string
  orderDate: string
  settlementMonth?: string
  carModel?: string
  plateNumber?: string
  vin?: string
  customerName?: string
  phone?: string
  contactPerson?: string
  description?: string
  items?: CreateWorkOrderItemDto[]
  remark?: string
}

export interface CreateWorkOrderItemDto {
  categoryId: string
  quantity?: number
  newPartQuantity?: number
  specialPaintId?: string
}

export interface UpdateWorkOrderDto {
  id: string
  orderNo?: string
  carModel?: string
  plateNumber?: string
  customerName?: string
  phone?: string
  status?: PaintOrderStatus
  settlementMonth?: string
  items?: CreateWorkOrderItemDto[]
  remark?: string
}

export interface PageWorkOrderDto {
  current?: number
  size?: number
  shopId?: string
  plateNumber?: string
  customerName?: string
  settlementMonth?: string
  status?: PaintOrderStatus
  isAudited?: boolean
}

export interface PageResult<T> {
  records: T[]
  total: number
  current: number
  size: number
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
}

export interface YearOverview {
  settlementMonth: string
  paintCount: number
  orderCount: number
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
