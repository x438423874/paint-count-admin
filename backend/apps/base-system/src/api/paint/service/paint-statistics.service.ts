import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import {
  MonthlyStat,
  CategoryBreakdown,
  AdjustmentSummary,
  DailyStat,
  MonthlyOrderRow,
  ShopMeta,
  getCurrentSettlementMonth,
  isAuditedStatus,
  isCountedInPaintTotal,
  isVoidOrder,
  normalizePlateNumber,
  resolveShopScope,
  roundHalfUp,
  toDateKey,
  toOrderShopWhere,
  toPaintCents,
  toShopWhere,
  centsToPaintCount,
  aggregateShopMonthly,
  type ShopScope,
} from './paint-calculation';
import { PaintStatsCache, hashScope, statsTtlForMonth } from './paint-stats-cache';

export type { MonthlyStat, CategoryBreakdown, AdjustmentSummary, DailyStat } from './paint-calculation';

export interface YearOverviewItem {
  month: number;
  settlementMonth: string;
  totalOrders: number;
  totalPaintCount: number;
  shopCount: number;
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

export interface ShopComparisonItem {
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

export interface StatisticsDashboard {
  monthly: MonthlyStat[];
  overview: StatisticsOverview;
  comparison: ShopComparisonItem[];
  category: CategoryBreakdown[];
  yearOverview: YearOverviewItem[];
}

/** 导出用的工单明细项 */
export interface ExportOrderItem {
  部位: string;
  数量: number;
  幅数: number;
  是否新件: string;
  特殊车漆: string;
  车漆倍数: number | string;
}

/** 导出用的工单行 */
export interface ExportOrderRow {
  工单号: string;
  门店: string;
  门店编码: string;
  工单日期: string;
  结算月份: string;
  车牌号: string;
  车型: string;
  客户名称: string;
  /** 工单自身的幅数（含返工单） */
  总幅数: number;
  /** 计入月度统计口径的幅数：返工单为 0，正常单与幅数调整单为自身幅数 */
  计入统计幅数: number;
  是否返工: string;
  是否调整单: string;
  是否审核: string;
  审核时间: string;
  审核人: string;
  状态: string;
  项目明细: ExportOrderItem[];
  备注: string;
}

/** 年度概览 SQL 聚合行 */
interface YearAggregateRow {
  settlementMonth: string;
  shopCount: number | string;
  reworkOrders: number | string;
  reworkPaintCount: number | string | null;
  reworkVehicles: number | string;
  totalOrders: number | string;
  totalPaintCount: number | string | null;
  pendingOrders: number | string;
  pendingPaintCount: number | string | null;
  pendingVehicles: number | string;
  auditedOrders: number | string;
  auditedPaintCount: number | string | null;
  auditedVehicles: number | string;
}

@Injectable()
export class PaintStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== 公共能力 ====================

  /**
   * 解析数据权限范围
   *
   * 注意：accessibleShopIds 为空数组表示「普通用户未绑定任何门店」，
   * 必须返回空结果，历史实现在此处退化成了「不限制」从而越权暴露全部门店数据。
   */
  private scopeOf(shopId: string | undefined, accessibleShopIds: string[] | null | undefined): ShopScope {
    return resolveShopScope(shopId, accessibleShopIds);
  }

  private scopeHashOf(scope: ShopScope): string {
    return scope.kind === 'list' ? hashScope('list', scope.shopIds) : hashScope(scope.kind);
  }

  private targetMonth(settlementMonth?: string): string {
    return settlementMonth || getCurrentSettlementMonth();
  }

  /** 门店对比（纯内存派生，复用已缓存的月度统计，不再重复查库） */
  private buildComparison(monthly: MonthlyStat[]): ShopComparisonItem[] {
    return monthly
      .map(s => ({
        shopId: s.shopId,
        shopName: s.shopName,
        shopCode: s.shopCode,
        totalOrders: s.totalOrders,
        totalPaintCount: s.totalPaintCount,
        totalVehicles: s.totalVehicles,
        avgPaintPerVehicle: s.avgPaintPerVehicle,
        avgPaintPerOrder: s.avgPaintPerOrder,
        pendingOrders: s.pendingOrders,
        pendingPaintCount: s.pendingPaintCount,
        pendingVehicles: s.pendingVehicles,
        auditedOrders: s.auditedOrders,
        auditedPaintCount: s.auditedPaintCount,
        auditedVehicles: s.auditedVehicles,
      }))
      .sort((a, b) => b.totalPaintCount - a.totalPaintCount);
  }

  /** 月度概览 KPI（纯内存派生，复用已缓存的月度统计） */
  private buildOverview(monthly: MonthlyStat[]): StatisticsOverview {
    const sum = (pick: (d: MonthlyStat) => number) => monthly.reduce((s, d) => s + pick(d), 0);
    const totalOrders = sum(d => d.totalOrders);
    const totalPaintCount = roundHalfUp(sum(d => d.totalPaintCount));
    const auditedOrders = sum(d => d.auditedOrders);
    const settledOrders = sum(d => d.settledOrders);

    return {
      totalOrders,
      totalPaintCount,
      auditedOrders,
      auditedPaintCount: roundHalfUp(sum(d => d.auditedPaintCount)),
      auditRate: totalOrders > 0 ? roundHalfUp((auditedOrders / totalOrders) * 100, 2) : 0,
      pendingOrders: sum(d => d.pendingOrders),
      pendingPaintCount: roundHalfUp(sum(d => d.pendingPaintCount)),
      abnormalOrders: sum(d => d.abnormalOrders),
      abnormalPaintCount: roundHalfUp(sum(d => d.abnormalPaintCount)),
      settledOrders,
      settledPaintCount: roundHalfUp(sum(d => d.settledPaintCount)),
      settlementRate: totalOrders > 0 ? roundHalfUp((settledOrders / totalOrders) * 100, 2) : 0,
      avgPaintPerOrder: totalOrders > 0 ? roundHalfUp(totalPaintCount / totalOrders, 2) : 0,
      reworkOrders: sum(d => d.reworkOrders),
      reworkPaintCount: roundHalfUp(sum(d => d.reworkPaintCount)),
      reworkVehicles: sum(d => d.reworkVehicles),
    };
  }

  // ==================== 月度统计 ====================

  /**
   * 结算月幅数统计（按店分组、按天汇总）
   *
   * 口径：
   * - 总幅数   = 正常单幅数 + 幅数调整单幅数（返工、作废不计）
   * - 工单/车辆 = 仅正常单（返工、作废、调整单不计）
   * - 待审/已审 = 仅正常单，按状态拆分
   */
  async getMonthlyStatistics(
    settlementMonth?: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ): Promise<MonthlyStat[]> {
    const targetMonth = this.targetMonth(settlementMonth);
    const scope = this.scopeOf(shopId, accessibleShopIds);
    if (scope.kind === 'none') return [];

    const cacheKey = await PaintStatsCache.buildKey('monthly', targetMonth, this.scopeHashOf(scope));
    const cached = await PaintStatsCache.get<MonthlyStat[]>(cacheKey);
    if (cached) return cached;

    const shops = await this.prisma.paintShop.findMany({
      where: toShopWhere(scope),
      select: { id: true, name: true, code: true },
    });
    if (shops.length === 0) {
      await PaintStatsCache.set(cacheKey, [], statsTtlForMonth(targetMonth), targetMonth);
      return [];
    }

    // 仅查询聚合必需的字段：
    // 注意不要带 items —— 月度统计不使用明细，带上会让 Prisma 额外查一遍全月工单项
    const orders = (await this.prisma.paintWorkOrder.findMany({
      where: {
        settlementMonth: targetMonth,
        ...toOrderShopWhere(scope),
      },
      select: {
        id: true,
        orderDate: true,
        totalPaintCount: true,
        shopId: true,
        status: true,
        isRework: true,
        isAdjustment: true,
        settlementMonth: true,
        createdAt: true,
        remark: true,
        plateNumber: true,
      },
    })) as unknown as MonthlyOrderRow[];

    const ordersByShop = new Map<string, MonthlyOrderRow[]>();
    for (const order of orders) {
      const list = ordersByShop.get(order.shopId);
      if (list) list.push(order);
      else ordersByShop.set(order.shopId, [order]);
    }

    const results = shops.map((shop: ShopMeta) =>
      aggregateShopMonthly(shop, ordersByShop.get(shop.id) || [], targetMonth),
    );

    await PaintStatsCache.set(cacheKey, results, statsTtlForMonth(targetMonth), targetMonth);
    return results;
  }

  // ==================== 类别分布 ====================

  /**
   * 项目类别幅数分布
   *
   * 口径与月度统计总幅数对齐：排除返工单与作废单，包含幅数调整单。
   * 聚合下推到 SQL（groupBy），不再把全月明细拉到内存。
   */
  async getCategoryBreakdown(
    settlementMonth?: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ): Promise<CategoryBreakdown[]> {
    const targetMonth = this.targetMonth(settlementMonth);
    const scope = this.scopeOf(shopId, accessibleShopIds);
    if (scope.kind === 'none') return [];

    const cacheKey = await PaintStatsCache.buildKey('category', targetMonth, this.scopeHashOf(scope));
    const cached = await PaintStatsCache.get<CategoryBreakdown[]>(cacheKey);
    if (cached) return cached;

    const grouped = await this.prisma.paintWorkOrderItem.groupBy({
      by: ['categoryId'],
      where: {
        order: {
          settlementMonth: targetMonth,
          status: { not: 'VOID' },
          isRework: false,
          ...toOrderShopWhere(scope),
        },
      },
      _sum: { quantity: true, paintCount: true, newPartQuantity: true },
    });

    if (grouped.length === 0) {
      await PaintStatsCache.set(cacheKey, [], statsTtlForMonth(targetMonth), targetMonth);
      return [];
    }

    // 一次性取类别名称，避免 N+1
    const categories = await this.prisma.paintItemCategory.findMany({
      where: { id: { in: grouped.map(g => g.categoryId) } },
      select: { id: true, name: true, code: true },
    });
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    const results: CategoryBreakdown[] = grouped
      .map(g => ({
        categoryName: categoryMap.get(g.categoryId)?.name || '未知部位',
        categoryCode: categoryMap.get(g.categoryId)?.code || 'unknown',
        totalCount: g._sum.quantity || 0,
        totalPaintCount: roundHalfUp(centsToPaintCount(toPaintCents(g._sum.paintCount))),
        totalNewPartQuantity: g._sum.newPartQuantity || 0,
      }))
      .sort((a, b) => b.totalPaintCount - a.totalPaintCount);

    await PaintStatsCache.set(cacheKey, results, statsTtlForMonth(targetMonth), targetMonth);
    return results;
  }

  // ==================== 门店对比 / 概览 ====================

  /**
   * 门店对比统计
   * 复用月度统计结果，不再重复查库（历史实现会再跑一次完整月度聚合）
   */
  async getShopComparison(
    settlementMonth?: string,
    accessibleShopIds?: string[] | null,
  ): Promise<ShopComparisonItem[]> {
    const monthly = await this.getMonthlyStatistics(settlementMonth, undefined, accessibleShopIds);
    return this.buildComparison(monthly);
  }

  /** 月度概览 KPI */
  async getOverview(
    settlementMonth?: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ): Promise<StatisticsOverview> {
    const monthly = await this.getMonthlyStatistics(settlementMonth, shopId, accessibleShopIds);
    return this.buildOverview(monthly);
  }

  // ==================== 年度概览 ====================

  /**
   * 年度概览（按结算月）
   *
   * 聚合全部下推到 SQL：历史实现会把全年工单整表拉到内存再逐条分组，
   * 这里改为一条 GROUP BY，返回固定 12 行。
   *
   * 口径与月度统计一致：
   * - 总幅数 = 正常单 + 幅数调整单
   * - 工单数 = 仅正常单（调整单不计工单数，与月度统计保持一致）
   */
  async getYearOverview(
    year?: number,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ): Promise<YearOverviewItem[]> {
    const targetYear = year ?? new Date().getFullYear();
    const scope = this.scopeOf(shopId, accessibleShopIds);
    if (scope.kind === 'none') return [];

    const cacheKey = await PaintStatsCache.buildKey('year', `y${targetYear}`, this.scopeHashOf(scope));
    const cached = await PaintStatsCache.get<YearOverviewItem[]>(cacheKey);
    if (cached) return cached;

    const shopFilter =
      scope.kind === 'list'
        ? Prisma.sql` AND shop_id IN (${Prisma.join(scope.shopIds)})`
        : Prisma.empty;

    // plate_number 存在空字符串与大小写混杂的历史数据，
    // 统一 TRIM + UPPER 后再去重，并把空串归一为 NULL 排除掉
    const rows = await this.prisma.$queryRaw<YearAggregateRow[]>`
      SELECT
        settlement_month AS settlementMonth,
        COUNT(DISTINCT shop_id) AS shopCount,
        SUM(CASE WHEN is_rework = 1 THEN 1 ELSE 0 END) AS reworkOrders,
        SUM(CASE WHEN is_rework = 1 THEN total_paint_count ELSE 0 END) AS reworkPaintCount,
        COUNT(DISTINCT CASE WHEN is_rework = 1 THEN NULLIF(UPPER(TRIM(plate_number)), '') END) AS reworkVehicles,
        SUM(CASE WHEN is_rework = 0 AND status <> 'VOID' THEN total_paint_count ELSE 0 END) AS totalPaintCount,
        SUM(CASE WHEN is_rework = 0 AND status <> 'VOID' AND is_adjustment = 0 THEN 1 ELSE 0 END) AS totalOrders,
        SUM(CASE
              WHEN is_rework = 0 AND status <> 'VOID' AND is_adjustment = 0
                   AND status IN ('AUDITED', 'SETTLED', 'ABNORMAL')
              THEN 1 ELSE 0 END) AS auditedOrders,
        SUM(CASE
              WHEN is_rework = 0 AND status <> 'VOID' AND is_adjustment = 0
                   AND status IN ('AUDITED', 'SETTLED', 'ABNORMAL')
              THEN total_paint_count ELSE 0 END) AS auditedPaintCount,
        COUNT(DISTINCT CASE
              WHEN is_rework = 0 AND status <> 'VOID' AND is_adjustment = 0
                   AND status IN ('AUDITED', 'SETTLED', 'ABNORMAL')
              THEN NULLIF(UPPER(TRIM(plate_number)), '') END) AS auditedVehicles,
        SUM(CASE
              WHEN is_rework = 0 AND status <> 'VOID' AND is_adjustment = 0
                   AND status NOT IN ('AUDITED', 'SETTLED', 'ABNORMAL')
              THEN 1 ELSE 0 END) AS pendingOrders,
        SUM(CASE
              WHEN is_rework = 0 AND status <> 'VOID' AND is_adjustment = 0
                   AND status NOT IN ('AUDITED', 'SETTLED', 'ABNORMAL')
              THEN total_paint_count ELSE 0 END) AS pendingPaintCount,
        COUNT(DISTINCT CASE
              WHEN is_rework = 0 AND status <> 'VOID' AND is_adjustment = 0
                   AND status NOT IN ('AUDITED', 'SETTLED', 'ABNORMAL')
              THEN NULLIF(UPPER(TRIM(plate_number)), '') END) AS pendingVehicles
      FROM paint_work_order
      WHERE settlement_month LIKE ${`${targetYear}-%`}
      ${shopFilter}
      GROUP BY settlement_month
    `;

    const rowMap = new Map<string, YearAggregateRow>();
    for (const row of rows) {
      if (row.settlementMonth) rowMap.set(row.settlementMonth, row);
    }

    const num = (v: number | string | null | undefined): number => toPaintCents(v) / 100;

    const results: YearOverviewItem[] = [];
    for (let m = 1; m <= 12; m += 1) {
      const monthStr = `${targetYear}-${String(m).padStart(2, '0')}`;
      const row = rowMap.get(monthStr);
      results.push({
        month: m,
        settlementMonth: monthStr,
        totalOrders: Number(row?.totalOrders ?? 0),
        totalPaintCount: roundHalfUp(num(row?.totalPaintCount)),
        shopCount: Number(row?.shopCount ?? 0),
        pendingOrders: Number(row?.pendingOrders ?? 0),
        pendingPaintCount: roundHalfUp(num(row?.pendingPaintCount)),
        pendingVehicles: Number(row?.pendingVehicles ?? 0),
        auditedOrders: Number(row?.auditedOrders ?? 0),
        auditedPaintCount: roundHalfUp(num(row?.auditedPaintCount)),
        auditedVehicles: Number(row?.auditedVehicles ?? 0),
        reworkOrders: Number(row?.reworkOrders ?? 0),
        reworkPaintCount: roundHalfUp(num(row?.reworkPaintCount)),
        reworkVehicles: Number(row?.reworkVehicles ?? 0),
      });
    }

    await PaintStatsCache.set(cacheKey, results, statsTtlForMonth(`y${targetYear}`), `y${targetYear}`);
    return results;
  }

  // ==================== 一次性聚合接口 ====================

  /**
   * 统计看板聚合接口
   *
   * 历史实现里前端一次加载会并发 monthly / comparison / overview 三个请求，
   * 而 comparison 与 overview 内部各会再跑一遍完整月度聚合，等于同一份数据查 3 次。
   * 这里合并为一次调用：只查一次月度统计，对比与 KPI 在内存派生。
   */
  async getDashboard(
    settlementMonth?: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
    year?: number,
  ): Promise<StatisticsDashboard> {
    const targetMonth = this.targetMonth(settlementMonth);
    const targetYear = year ?? (parseInt(targetMonth.slice(0, 4), 10) || new Date().getFullYear());

    const [monthly, category, yearOverview] = await Promise.all([
      this.getMonthlyStatistics(targetMonth, shopId, accessibleShopIds),
      this.getCategoryBreakdown(targetMonth, shopId, accessibleShopIds),
      this.getYearOverview(targetYear, shopId, accessibleShopIds),
    ]);

    return {
      monthly,
      overview: this.buildOverview(monthly),
      comparison: this.buildComparison(monthly),
      category,
      yearOverview,
    };
  }

  // ==================== 导出 ====================

  /**
   * 获取导出数据（月度工单明细）
   *
   * 口径说明：
   * - 作废单不属于任何统计，直接剔除
   * - 返工单、幅数调整单保留（便于核对），但用 `是否返工` / `是否调整单` 标注
   * - `计入统计幅数` 为最终纳入月度总幅数的数值，导出合计以此为准，
   *   保证导出的合计数与看板 KPI 完全一致
   */
  private exportWhere(settlementMonth: string, scope: ShopScope) {
    return {
      settlementMonth,
      status: { not: 'VOID' as const },
      ...toOrderShopWhere(scope),
    };
  }

  private exportInclude() {
    return {
      shop: { select: { name: true, code: true } },
      items: { include: { category: true, specialPaint: true } },
    };
  }

  private toExportRow(order: any): ExportOrderRow {
    const total = centsToPaintCount(toPaintCents(order.totalPaintCount));
    const counted = isCountedInPaintTotal(order) ? total : 0;
    return {
      工单号: order.orderNo || '',
      门店: order.shop?.name || '',
      门店编码: order.shop?.code || '',
      工单日期: toDateKey(order.orderDate) || '',
      结算月份: order.settlementMonth || '',
      车牌号: normalizePlateNumber(order.plateNumber),
      车型: order.carModel || '',
      客户名称: order.customerName || '',
      总幅数: total,
      计入统计幅数: counted,
      是否返工: order.isRework ? '是' : '否',
      是否调整单: order.isAdjustment ? '是' : '否',
      是否审核: isAuditedStatus(order.status) ? '是' : '否',
      审核时间: toDateKey(order.auditedAt) || '',
      审核人: order.auditedBy || '',
      状态: order.status,
      项目明细: (order.items as any[]).map(item => ({
        部位: item.category?.name || '',
        数量: item.quantity,
        幅数: centsToPaintCount(toPaintCents(item.paintCount)),
        是否新件: item.isNewPart ? '是' : '否',
        特殊车漆: item.specialPaint?.name || '',
        车漆倍数: item.specialPaintMultiplier ? Number(item.specialPaintMultiplier) : '',
      })),
      备注: order.remark || '',
    };
  }

  async getExportData(
    settlementMonth: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ): Promise<ExportOrderRow[]> {
    const scope = this.scopeOf(shopId, accessibleShopIds);
    if (scope.kind === 'none') return [];

    const orders = await this.prisma.paintWorkOrder.findMany({
      where: this.exportWhere(settlementMonth, scope),
      include: this.exportInclude(),
      orderBy: { orderDate: 'asc' },
    });

    return orders.map(order => this.toExportRow(order));
  }

  /**
   * 分批产出导出数据（供流式导出使用）
   *
   * 一次性 findMany 会把整月工单 + 全部明细载入内存，再叠加 ExcelJS 的
   * writeBuffer 缓冲，大月份容易打满内存。这里按批读取、边写边释放。
   */
  async *iterateExportData(
    settlementMonth: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
    batchSize = 500,
  ): AsyncGenerator<ExportOrderRow[]> {
    const scope = this.scopeOf(shopId, accessibleShopIds);
    if (scope.kind === 'none') return;

    let skip = 0;
    for (;;) {
      const batch = await this.prisma.paintWorkOrder.findMany({
        where: this.exportWhere(settlementMonth, scope),
        include: this.exportInclude(),
        orderBy: [{ orderDate: 'asc' }, { id: 'asc' }],
        skip,
        take: batchSize,
      });
      if (batch.length === 0) return;

      yield batch.map(order => this.toExportRow(order));
      if (batch.length < batchSize) return;
      skip += batch.length;
    }
  }

  // ==================== 其他 ====================

  /**
   * 获取有数据的最新结算月份
   * 用 aggregate 取最大值，避免 findFirst + orderBy 的全索引排序
   */
  async getLatestSettlementMonth(accessibleShopIds?: string[] | null): Promise<string | null> {
    const scope = this.scopeOf(undefined, accessibleShopIds);
    if (scope.kind === 'none') return null;

    const result = await this.prisma.paintWorkOrder.aggregate({
      where: {
        settlementMonth: { not: null },
        ...toOrderShopWhere(scope),
      },
      _max: { settlementMonth: true },
    });
    return result._max.settlementMonth || null;
  }
}
