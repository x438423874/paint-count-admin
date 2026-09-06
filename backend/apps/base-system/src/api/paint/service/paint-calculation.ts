/**
 * 喷漆幅数计算 - 纯函数模块
 * 将领域规则从 service 中抽出，便于单元测试与复用
 */

/** 单个工单项目的幅数计算输入 */
export interface PaintCountInput {
  /** 部位系数 */
  coefficient: number;
  /** 新件加幅 */
  newPartAddition: number;
  /** 数量 */
  quantity: number;
  /** 新件数量 */
  newPartQuantity: number;
  /** 特殊车漆倍数（null 表示无特殊车漆） */
  specialPaintMultiplier: number | null;
}

/** 幅数计算结果 */
export interface PaintCountResult {
  quantity: number;
  newPartQuantity: number;
  paintCount: number;
  specialPaintMultiplier: number | null;
}

/**
 * 计算单个项目的幅数
 *
 * 公式：
 *   非新件幅数 = 系数 × 旧件数量
 *   新件幅数   = (系数 + 新件加幅) × 新件数量
 *   总幅数     = (非新件幅数 + 新件幅数) × 特殊车漆倍数
 *
 * @param input 计算输入参数
 * @returns 幅数计算结果
 */
export function calculatePaintCount(input: PaintCountInput): PaintCountResult {
  const { coefficient, newPartAddition, specialPaintMultiplier } = input;
  const quantity = input.quantity || 1;
  const newPartQty = input.newPartQuantity || 0;
  const oldPartQty = quantity - newPartQty;

  let paintCount = coefficient * oldPartQty + (coefficient + newPartAddition) * newPartQty;
  if (specialPaintMultiplier) {
    paintCount *= specialPaintMultiplier;
  }

  return {
    quantity,
    newPartQuantity: newPartQty,
    paintCount,
    specialPaintMultiplier,
  };
}

/**
 * 从一组类别 ID 中找出重复的类别
 * @param categoryIds 类别 ID 数组
 * @returns 重复的类别 ID 数组（去重后）
 */
export function findDuplicateCategoryIds(categoryIds: string[]): string[] {
  const duplicates = categoryIds.filter((id, idx) => categoryIds.indexOf(id) !== idx);
  return [...new Set(duplicates)];
}

/**
 * 判断类别 ID 数组中是否存在重复
 */
export function hasDuplicateCategoryIds(categoryIds: string[]): boolean {
  return findDuplicateCategoryIds(categoryIds).length > 0;
}

/**
 * 格式化工单号
 *
 * 格式：{门店编码}{yyyyMMdd}{4位序号}
 * 例：P202606170001
 *
 * @param shopCode 门店编码
 * @param date 工单日期
 * @param seq 当日序号（从 1 开始）
 */
export function formatOrderNo(shopCode: string, date: Date, seq: number): string {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const prefix = shopCode || 'P';
  return `${prefix}${dateStr}${String(seq).padStart(4, '0')}`;
}

/**
 * 从工单号中解析出序号（末尾 4 位）
 */
export function parseOrderNoSeq(orderNo: string): number {
  return parseInt(orderNo.slice(-4), 10);
}

/**
 * 获取当前结算月份字符串（yyyy-MM）
 */
export function getCurrentSettlementMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 判断结算月份是否需要迁移（新旧月份不同且新月份有值）
 */
export function shouldMigrateSettlementMonth(oldMonth: string | null, newMonth: string | null): boolean {
  return oldMonth !== newMonth && !!newMonth;
}

/**
 * 生成合并组 ID
 *
 * 若目标工单已有合并组 ID 则复用，否则生成新的 ID
 *
 * @param existingMergeGroupId 目标工单已有的合并组 ID（可为 null）
 * @param now 当前时间（用于生成唯一 ID）
 */
export function generateMergeGroupId(existingMergeGroupId: string | null, now: Date = new Date()): string {
  return existingMergeGroupId || `merge_${now.getTime()}`;
}

/**
 * 判断两个工单号是否构成重复（去除前后空格后比较，大小写不敏感）
 */
export function isDuplicateOrderNo(orderNoA: string, orderNoB: string): boolean {
  return orderNoA.trim().toLowerCase() === orderNoB.trim().toLowerCase();
}

// ==================== 数据权限 ====================

/**
 * 门店访问范围
 * - all：不限制（超管/财务）
 * - list：仅允许列表内的门店
 * - none：无任何可访问门店（普通用户未绑定门店，或指定门店越权）
 */
export type ShopScope =
  | { kind: 'all' }
  | { kind: 'list'; shopIds: string[] }
  | { kind: 'none' };

/**
 * 解析数据权限范围
 *
 * 语义（与工单列表 `WorkOrderService.page`、车辆列表 `PaintVehicleService.list` 保持一致）：
 * - accessibleShopIds 为 null/undefined：不限制
 * - accessibleShopIds 为空数组：普通用户但未绑定任何门店 → **无权访问任何数据**
 * - accessibleShopIds 非空：仅允许这些门店
 *
 * 注意：历史实现把空数组当成"不限制"，会越权暴露全部门店数据，此处已修正。
 */
export function resolveShopScope(shopId?: string | null, accessibleShopIds?: string[] | null): ShopScope {
  if (shopId) {
    if (accessibleShopIds && !accessibleShopIds.includes(shopId)) return { kind: 'none' };
    return { kind: 'list', shopIds: [shopId] };
  }
  if (accessibleShopIds == null) return { kind: 'all' };
  if (accessibleShopIds.length === 0) return { kind: 'none' };
  return { kind: 'list', shopIds: accessibleShopIds };
}

/** 转成门店表的 where 条件 */
export function toShopWhere(scope: ShopScope): { id: { in: string[] } } | undefined {
  return scope.kind === 'list' ? { id: { in: scope.shopIds } } : undefined;
}

/** 转成工单表的 where 条件 */
export function toOrderShopWhere(scope: ShopScope): { shopId: { in: string[] } } | undefined {
  return scope.kind === 'list' ? { shopId: { in: scope.shopIds } } : undefined;
}

// ==================== 工单数据访问范围（含在岗期） ====================

/** 一段门店在岗期（endAt 为空表示在岗中） */
export interface OrderTenure {
  shopId: string;
  startAt: Date;
  endAt: Date | null;
}

/**
 * 工单数据访问范围
 * - all：不限制（超管/财务）
 * - tenure：按门店在岗期过滤（门店负责人/员工，只能看自己在岗时的数据）
 * - none：无任何可访问数据（普通用户未绑定门店）
 */
export type OrderAccessScope =
  | { kind: 'all' }
  | { kind: 'tenure'; tenures: OrderTenure[] }
  | { kind: 'none' };

/** 日期 → 'yyyy-MM' 月份字符串（与 settlementMonth 格式一致，字典序即时间序） */
export function toMonthString(d: Date | string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 工单归属月份（yyyy-MM）：优先结算月份 settlementMonth（工单日期可能录错，结算月份为财务归属口径），
 * 未结算时用录入时间 createdAt 的年月兜底
 */
export function orderBelongMonth(order: {
  settlementMonth?: string | null;
  createdAt?: Date | string | null;
}): string | null {
  const sm = order.settlementMonth;
  if (sm && /^\d{4}-\d{2}$/.test(sm)) return sm;
  if (!order.createdAt) return null;
  const month = toMonthString(order.createdAt);
  return month || null;
}

/** 任期月份区间（'yyyy-MM' 字符串比较；endAt 为空表示在岗中，不设上界） */
function tenureMonthRange(startAt: Date, endAt: Date | null): { gte: string; lte?: string } {
  const range: { gte: string; lte?: string } = { gte: toMonthString(startAt) };
  if (endAt) range.lte = toMonthString(endAt);
  return range;
}

/**
 * 把工单数据访问范围转成 paint_work_order 的 where 条件
 *
 * 在岗期口径（按结算月份归属）：
 * - 已结算工单：settlementMonth（yyyy-MM）落在 [startAt 月, endAt 月] 内
 * - 未结算工单：settlementMonth 为空，按录入时间所在月（[startAt 月初, endAt 月末]）兜底
 * 多段任期/多门店之间取 OR
 */
export function toOrderAccessWhere(scope: OrderAccessScope): Record<string, any> | undefined {
  if (scope.kind === 'all') return undefined;
  if (scope.kind === 'none') return { shopId: { in: [] } };
  return {
    OR: scope.tenures.map(t => {
      const monthRange = tenureMonthRange(t.startAt, t.endAt);
      // 未结算工单的 createdAt 兜底区间：startAt 所在月初 ~ endAt 所在月末
      const s = new Date(t.startAt);
      const createdRange: { gte: Date; lt?: Date } = {
        gte: new Date(s.getFullYear(), s.getMonth(), 1),
      };
      if (t.endAt) {
        const e = new Date(t.endAt);
        createdRange.lt = new Date(e.getFullYear(), e.getMonth() + 1, 1); // 下月 1 号（开区间）
      }
      return {
        shopId: t.shopId,
        OR: [
          { settlementMonth: monthRange },
          { settlementMonth: null, createdAt: createdRange },
        ],
      };
    }),
  };
}

/** 判断在岗期与结算月（yyyy-MM）是否存在交集 */
export function tenureCoversMonth(tenure: OrderTenure, month: string): boolean {
  const parts = month.split('-').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const monthStart = new Date(parts[0], parts[1] - 1, 1);
  const monthEnd = new Date(parts[0], parts[1], 1); // 下月 1 号（开区间）
  const end = tenure.endAt ? new Date(tenure.endAt) : null;
  return new Date(tenure.startAt) < monthEnd && (!end || end >= monthStart);
}

/** 工单归属月份（结算月份口径，未结算按录入时间年月）是否落在任期内 */
export function tenureCoversOrder(
  tenure: OrderTenure,
  order: { settlementMonth?: string | null; createdAt?: Date | string | null },
): boolean {
  const month = orderBelongMonth(order);
  if (!month) return false;
  const startMonth = toMonthString(tenure.startAt);
  if (month < startMonth) return false;
  if (tenure.endAt && month > toMonthString(tenure.endAt)) return false;
  return true;
}

// ==================== 数值精度 ====================

/** 数据库 Decimal / number / string 的统一数值类型 */
export type NumericLike = number | string | { toNumber(): number } | null | undefined;

/**
 * 把任意数值转成"厘幅"整数（幅数 × 100）
 *
 * 数据库幅数为 Decimal(8,2)，转成整数累加可彻底避免浮点误差累积，
 * 输出前再一次性换算回浮点数。
 */
export function toPaintCents(value: NumericLike): number {
  const raw =
    value !== null && typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function'
      ? (value as { toNumber(): number }).toNumber()
      : Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.round(raw * 100);
}

/** 厘幅 → 幅 */
export function centsToPaintCount(cents: number): number {
  return cents / 100;
}

/**
 * 四舍五入（.5 一律远离零）
 *
 * JS 内置 Math.round(-2.5) === -2（向 +∞），对幅数调整单这类负数会导致
 * 正负数舍入方向不一致，这里统一为"四舍五入、绝对值进位"。
 */
export function roundHalfUp(value: number, decimals = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled);
  return rounded / factor;
}

// ==================== 车牌归一化 ====================

/**
 * 标准化车牌号：去前后空格 + 转大写
 * 与车辆主数据 `PaintVehicleService.normalizePlate` 保持完全一致，
 * 保证"按车牌去重统计车辆数"时同一台车只算一台。
 */
export function normalizePlateNumber(plate?: string | null): string {
  return (plate || '').trim().toUpperCase();
}

// ==================== 统计口径 ====================

/** 工单状态（字符串形式，避免纯函数模块依赖 Prisma 生成的枚举） */
export type PaintOrderStatusValue = 'DRAFT' | 'PENDING' | 'AUDITED' | 'SETTLED' | 'ABNORMAL' | 'VOID';

/** 视为"已审核"的状态集合（已审核 / 已结算 / 异常） */
export const AUDITED_STATUSES: PaintOrderStatusValue[] = ['AUDITED', 'SETTLED', 'ABNORMAL'];

/** 参与统计判定的最小工单字段集合 */
export interface CountableOrder {
  status: string;
  isRework: boolean;
  isAdjustment: boolean;
}

/**
 * 是否已审核（含已结算、异常）
 *
 * 全系统唯一判定入口：月度统计、年度概览、门店对比、导出必须共用，
 * 否则各入口的"已审核/待审核"口径会互相打架。
 */
export function isAuditedStatus(status: string): boolean {
  return (AUDITED_STATUSES as string[]).includes(status);
}

/** 作废工单：不计入任何幅数统计 */
export function isVoidOrder(order: Pick<CountableOrder, 'status'>): boolean {
  return order.status === 'VOID';
}

/**
 * 计入「幅数总额」的工单：正常单 + 幅数调整单（排除返工、作废）
 *
 * 这是月度总幅数、年度总幅数、类别分布共用的口径，保证三处数字能对上。
 */
export function isCountedInPaintTotal(order: CountableOrder): boolean {
  return !order.isRework && order.status !== 'VOID';
}

/**
 * 计入「工单数 / 车辆数 / 日报」的工单：仅正常单
 *
 * 幅数调整单不是真实工单，只贡献幅数，不贡献工单数和车辆数。
 */
export function isCountedAsNormalOrder(order: CountableOrder): boolean {
  return !order.isRework && order.status !== 'VOID' && !order.isAdjustment;
}

// ==================== 月度聚合（纯函数，可单测） ====================

export interface DailyStat {
  date: string;
  orderCount: number;
  paintCount: number;
}

export interface AdjustmentSummary {
  id: string;
  targetMonth: string;
  applyMonth: string;
  categoryId: string | null;
  categoryName: string | null;
  paintCount: number;
  newPartQuantity: number;
  reason: string | null;
  operatorName: string | null;
  createdAt: string;
}

/** 项目类别幅数分布 */
export interface CategoryBreakdown {
  categoryName: string;
  categoryCode: string;
  /** 该部位被施工的数量之和 */
  totalCount: number;
  totalPaintCount: number;
  totalNewPartQuantity: number;
}

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
  dailyStats: DailyStat[];
  pendingOrders: number;
  pendingPaintCount: number;
  pendingVehicles: number;
  auditedOrders: number;
  auditedPaintCount: number;
  auditedVehicles: number;
  abnormalOrders: number;
  abnormalPaintCount: number;
  settledOrders: number;
  settledPaintCount: number;
  reworkOrders: number;
  reworkPaintCount: number;
  reworkVehicles: number;
  adjustmentPaintCount: number;
  adjustmentNewPartQuantity: number;
  adjustments: AdjustmentSummary[];
}

/** 月度聚合所需的工单行（字段与 service 的 select 保持一致） */
export interface MonthlyOrderRow extends CountableOrder {
  id: string;
  shopId: string;
  orderDate: Date | string | null;
  totalPaintCount: NumericLike;
  settlementMonth: string | null;
  createdAt: Date | string | null;
  remark: string | null;
  plateNumber: string | null;
}

interface DailyAccumulator {
  date: string;
  orderCount: number;
  paintCents: number;
}

export interface MonthlyAccumulator {
  totalOrders: number;
  totalPaintCents: number;
  abnormalOrders: number;
  abnormalPaintCents: number;
  settledOrders: number;
  settledPaintCents: number;
  pendingOrders: number;
  pendingPaintCents: number;
  auditedOrders: number;
  auditedPaintCents: number;
  reworkOrders: number;
  reworkPaintCents: number;
  adjustmentPaintCents: number;
  adjustments: AdjustmentSummary[];
  dailyMap: Map<string, DailyAccumulator>;
  plateNumbers: Set<string>;
  pendingPlateNumbers: Set<string>;
  auditedPlateNumbers: Set<string>;
  reworkPlateNumbers: Set<string>;
}

/**
 * 取 UTC 日期键（yyyy-MM-dd）
 *
 * Prisma 对 MySQL DATETIME 统一按 UTC 存取，因此这里必须用 UTC 取值，
 * 否则服务端处于东八区时 `new Date('2026-05-02')` 会被算成 05-01 或 05-02+1。
 */
export function toDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createMonthlyAccumulator(): MonthlyAccumulator {
  return {
    totalOrders: 0,
    totalPaintCents: 0,
    abnormalOrders: 0,
    abnormalPaintCents: 0,
    settledOrders: 0,
    settledPaintCents: 0,
    pendingOrders: 0,
    pendingPaintCents: 0,
    auditedOrders: 0,
    auditedPaintCents: 0,
    reworkOrders: 0,
    reworkPaintCents: 0,
    adjustmentPaintCents: 0,
    adjustments: [],
    dailyMap: new Map(),
    plateNumbers: new Set(),
    pendingPlateNumbers: new Set(),
    auditedPlateNumbers: new Set(),
    reworkPlateNumbers: new Set(),
  };
}

/**
 * 累加单张工单到月度累加器（单次遍历，避免对同一数组重复 filter）
 *
 * 口径：
 * 1. 返工单 → 只进返工口径，不计入总幅数/日报/待审/已审
 * 2. 作废单 → 完全不计
 * 3. 幅数调整单 → 只贡献总幅数与调整明细，不计工单数/车辆数/日报
 * 4. 正常单 → 计入总幅数、工单数、日报、车辆数，并按状态拆分待审/已审
 */
export function accumulateMonthlyOrder(
  acc: MonthlyAccumulator,
  order: MonthlyOrderRow,
  targetMonth: string,
): void {
  const cents = toPaintCents(order.totalPaintCount);
  const plate = normalizePlateNumber(order.plateNumber);

  if (order.isRework) {
    acc.reworkOrders += 1;
    acc.reworkPaintCents += cents;
    if (plate) acc.reworkPlateNumbers.add(plate);
    return;
  }

  if (isVoidOrder(order)) return;

  if (order.isAdjustment) {
    acc.adjustmentPaintCents += cents;
    acc.adjustments.push({
      id: order.id,
      targetMonth,
      applyMonth: order.settlementMonth || targetMonth,
      categoryId: null,
      categoryName: null,
      paintCount: centsToPaintCount(cents),
      newPartQuantity: 0,
      reason: order.remark ?? null,
      operatorName: null,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString(),
    });
    return;
  }

  // ===== 正常工单 =====
  acc.totalOrders += 1;
  acc.totalPaintCents += cents;

  const dateKey = toDateKey(order.orderDate);
  if (dateKey) {
    const daily = acc.dailyMap.get(dateKey) || { date: dateKey, orderCount: 0, paintCents: 0 };
    daily.orderCount += 1;
    daily.paintCents += cents;
    acc.dailyMap.set(dateKey, daily);
  }

  if (plate) acc.plateNumbers.add(plate);

  if (isAuditedStatus(order.status)) {
    acc.auditedOrders += 1;
    acc.auditedPaintCents += cents;
    if (plate) acc.auditedPlateNumbers.add(plate);
  } else {
    acc.pendingOrders += 1;
    acc.pendingPaintCents += cents;
    if (plate) acc.pendingPlateNumbers.add(plate);
  }

  if (order.status === 'ABNORMAL') {
    acc.abnormalOrders += 1;
    acc.abnormalPaintCents += cents;
  }
  if (order.status === 'SETTLED') {
    acc.settledOrders += 1;
    acc.settledPaintCents += cents;
  }
}

export interface ShopMeta {
  id: string;
  name: string;
  code: string;
}

/**
 * 把累加器转成最终月度统计结果
 *
 * 幅数总额 = 正常单幅数 + 调整单幅数（与类别分布、年度概览口径一致）
 */
export function finalizeMonthlyStat(shop: ShopMeta, targetMonth: string, acc: MonthlyAccumulator): MonthlyStat {
  const totalPaintCents = acc.totalPaintCents + acc.adjustmentPaintCents;
  const totalPaintCount = roundHalfUp(centsToPaintCount(totalPaintCents));
  const totalVehicles = acc.plateNumbers.size;

  const dailyStats: DailyStat[] = Array.from(acc.dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, orderCount: d.orderCount, paintCount: roundHalfUp(centsToPaintCount(d.paintCents)) }));

  return {
    settlementMonth: targetMonth,
    shopId: shop.id,
    shopName: shop.name,
    shopCode: shop.code,
    totalOrders: acc.totalOrders,
    totalPaintCount,
    totalVehicles,
    avgPaintPerVehicle: totalVehicles > 0 ? roundHalfUp(centsToPaintCount(totalPaintCents) / totalVehicles, 2) : 0,
    avgPaintPerOrder: acc.totalOrders > 0 ? roundHalfUp(centsToPaintCount(totalPaintCents) / acc.totalOrders, 2) : 0,
    dailyStats,
    pendingOrders: acc.pendingOrders,
    pendingPaintCount: roundHalfUp(centsToPaintCount(acc.pendingPaintCents)),
    pendingVehicles: acc.pendingPlateNumbers.size,
    auditedOrders: acc.auditedOrders,
    auditedPaintCount: roundHalfUp(centsToPaintCount(acc.auditedPaintCents)),
    auditedVehicles: acc.auditedPlateNumbers.size,
    abnormalOrders: acc.abnormalOrders,
    abnormalPaintCount: roundHalfUp(centsToPaintCount(acc.abnormalPaintCents)),
    settledOrders: acc.settledOrders,
    settledPaintCount: roundHalfUp(centsToPaintCount(acc.settledPaintCents)),
    reworkOrders: acc.reworkOrders,
    reworkPaintCount: roundHalfUp(centsToPaintCount(acc.reworkPaintCents)),
    reworkVehicles: acc.reworkPlateNumbers.size,
    adjustmentPaintCount: roundHalfUp(centsToPaintCount(acc.adjustmentPaintCents)),
    adjustmentNewPartQuantity: 0,
    adjustments: acc.adjustments,
  };
}

/** 聚合单个门店一个结算月的全部统计（单次遍历） */
export function aggregateShopMonthly(shop: ShopMeta, orders: MonthlyOrderRow[], targetMonth: string): MonthlyStat {
  const acc = createMonthlyAccumulator();
  for (const order of orders) {
    accumulateMonthlyOrder(acc, order, targetMonth);
  }
  return finalizeMonthlyStat(shop, targetMonth, acc);
}
