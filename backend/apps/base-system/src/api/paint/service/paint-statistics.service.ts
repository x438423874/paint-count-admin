import { Injectable } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

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
}

export interface DailyStat {
  date: string;
  orderCount: number;
  paintCount: number;
}

export interface CategoryBreakdown {
  categoryName: string;
  categoryCode: string;
  totalCount: number;
  totalPaintCount: number;
}

@Injectable()
export class PaintStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  private round(value: number, decimals = 1): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  async getMonthlyStatistics(
    settlementMonth?: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ) {
    const now = new Date();
    const targetMonth = settlementMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 数据权限：accessibleShopIds 为 null 表示不限制，数组表示限制到这些门店
    // 若用户传入 shopId 且不在允许范围内，返回空结果
    if (shopId && accessibleShopIds && !accessibleShopIds.includes(shopId)) {
      return [];
    }
    // 计算最终门店过滤条件
    const allowedShopIds = accessibleShopIds && accessibleShopIds.length > 0 ? accessibleShopIds : null;
    const shopWhere = shopId
      ? { id: shopId }
      : (allowedShopIds ? { id: { in: allowedShopIds } } : {});

    // 一次查出所有门店
    const shops = await this.prisma.paintShop.findMany({
      where: shopWhere,
      select: { id: true, name: true, code: true },
    });

    const shopIds = shops.map((s: any) => s.id);

    // 一次查出所有门店的工单，避免 N+1 查询
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: {
        settlementMonth: targetMonth,
        shopId: { in: shopIds },
      },
      select: {
        id: true,
        orderDate: true,
        totalPaintCount: true,
        shopId: true,
        status: true,
        isRework: true,
        plateNumber: true,
        items: { select: { categoryId: true, quantity: true, paintCount: true, specialPaintId: true, specialPaintMultiplier: true } },
      },
    });

    // 按门店分组
    const ordersByShop = new Map<string, typeof orders>();
    for (const order of orders) {
      const list = ordersByShop.get(order.shopId) || [];
      list.push(order);
      ordersByShop.set(order.shopId, list);
    }

    const results: MonthlyStat[] = [];

    for (const shop of shops) {
      const shopOrders = ordersByShop.get(shop.id) || [];

      const dailyMap = new Map<string, DailyStat>();
      const plateNumbers = new Set<string>();
      const pendingPlateNumbers = new Set<string>();
      const auditedPlateNumbers = new Set<string>();
      const reworkPlateNumbers = new Set<string>();
      let pendingOrders = 0;
      let pendingPaintCount = 0;
      let auditedOrders = 0;
      let auditedPaintCount = 0;
      let reworkOrders = 0;
      let reworkPaintCount = 0;

      for (const order of shopOrders) {
        if (!order.orderDate) continue;
        const dateKey = new Date(order.orderDate).toISOString().split('T')[0];

        if (order.isRework) {
          reworkOrders += 1;
          reworkPaintCount += Number(order.totalPaintCount);
          if (order.plateNumber)
            reworkPlateNumbers.add(order.plateNumber);
          // 返工单不计入总幅数、日报、待审/已审统计
          continue;
        }

        const existing = dailyMap.get(dateKey) || { date: dateKey, orderCount: 0, paintCount: 0 };
        existing.orderCount += 1;
        existing.paintCount += Number(order.totalPaintCount);
        dailyMap.set(dateKey, existing);
        if (order.plateNumber)
          plateNumbers.add(order.plateNumber);

        if (order.status === 'AUDITED' || order.status === 'SETTLED' || order.status === 'ABNORMAL') {
          auditedOrders += 1;
          auditedPaintCount += Number(order.totalPaintCount);
          if (order.plateNumber)
            auditedPlateNumbers.add(order.plateNumber);
        } else {
          pendingOrders += 1;
          pendingPaintCount += Number(order.totalPaintCount);
          if (order.plateNumber)
            pendingPlateNumbers.add(order.plateNumber);
        }
      }

      const totalPaintCount = this.round(shopOrders.filter(o => !o.isRework).reduce((sum, o) => sum + Number(o.totalPaintCount), 0));
      const totalOrders = shopOrders.filter(o => !o.isRework).length;
      const totalVehicles = plateNumbers.size;

      const dailyStats = Array.from(dailyMap.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(d => ({ ...d, paintCount: this.round(d.paintCount) }));

      const abnormalOrders = shopOrders.filter(o => !o.isRework && o.status === 'ABNORMAL').length;
      const abnormalPaintCount = this.round(shopOrders.filter(o => !o.isRework && o.status === 'ABNORMAL').reduce((sum, o) => sum + Number(o.totalPaintCount), 0));
      const settledOrders = shopOrders.filter(o => !o.isRework && o.status === 'SETTLED').length;
      const settledPaintCount = this.round(shopOrders.filter(o => !o.isRework && o.status === 'SETTLED').reduce((sum, o) => sum + Number(o.totalPaintCount), 0));

      results.push({
        settlementMonth: targetMonth,
        shopId: shop.id,
        shopName: shop.name,
        shopCode: shop.code,
        totalOrders,
        totalVehicles,
        totalPaintCount,
        avgPaintPerVehicle: totalVehicles > 0 ? this.round(totalPaintCount / totalVehicles, 2) : 0,
        avgPaintPerOrder: totalOrders > 0 ? this.round(totalPaintCount / totalOrders, 2) : 0,
        dailyStats,
        pendingOrders,
        pendingPaintCount: this.round(pendingPaintCount),
        pendingVehicles: pendingPlateNumbers.size,
        auditedOrders,
        auditedPaintCount: this.round(auditedPaintCount),
        auditedVehicles: auditedPlateNumbers.size,
        abnormalOrders,
        abnormalPaintCount,
        settledOrders,
        settledPaintCount,
        reworkOrders,
        reworkPaintCount: this.round(reworkPaintCount),
        reworkVehicles: reworkPlateNumbers.size,
      });
    }

    return results;
  }

  async getCategoryBreakdown(
    settlementMonth?: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ) {
    const now = new Date();
    const targetMonth = settlementMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 数据权限：accessibleShopIds 为 null 表示不限制，数组表示限制到这些门店
    if (shopId && accessibleShopIds && !accessibleShopIds.includes(shopId)) {
      return [];
    }
    const allowedShopIds = accessibleShopIds && accessibleShopIds.length > 0 ? accessibleShopIds : null;
    const shopIdWhere = shopId
      ? shopId
      : (allowedShopIds ? { in: allowedShopIds } : undefined);

    const items = await this.prisma.paintWorkOrderItem.findMany({
      where: {
        order: {
          settlementMonth: targetMonth,
          ...(shopIdWhere && { shopId: shopIdWhere }),
        },
      },
      include: { category: true, specialPaint: true },
    });

    const categoryMap = new Map<string, CategoryBreakdown>();
    for (const item of items) {
      const key = item.categoryId;
      const existing = categoryMap.get(key) || {
        categoryName: item.category?.name || '未知部位',
        categoryCode: item.category?.code || 'unknown',
        totalCount: 0,
        totalPaintCount: 0,
      };
      existing.totalCount += item.quantity;
      existing.totalPaintCount += Number(item.paintCount);
      categoryMap.set(key, existing);
    }

    return Array.from(categoryMap.values())
      .map(item => ({ ...item, totalPaintCount: this.round(item.totalPaintCount) }))
      .sort((a, b) => b.totalPaintCount - a.totalPaintCount);
  }

  async getShopComparison(settlementMonth?: string, accessibleShopIds?: string[] | null) {
    // 数据权限：getMonthlyStatistics 已在 SQL 层按 accessibleShopIds 过滤，无需再次内存过滤
    const stats = await this.getMonthlyStatistics(settlementMonth, undefined, accessibleShopIds);
    return stats.map(s => ({
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
    })).sort((a, b) => b.totalPaintCount - a.totalPaintCount);
  }

  async getYearOverview(
    year?: number,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ) {
    const now = new Date();
    const targetYear = year ?? now.getFullYear();

    // 数据权限：accessibleShopIds 为 null 表示不限制，数组表示限制到这些门店
    if (shopId && accessibleShopIds && !accessibleShopIds.includes(shopId)) {
      return [];
    }
    const allowedShopIds = accessibleShopIds && accessibleShopIds.length > 0 ? accessibleShopIds : null;
    const shopIdWhere = shopId
      ? shopId
      : (allowedShopIds ? { in: allowedShopIds } : undefined);

    // 一次查出全年数据，避免循环12次查库
    const yearPrefix = `${targetYear}-`;
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: {
        settlementMonth: { startsWith: yearPrefix },
        ...(shopIdWhere && { shopId: shopIdWhere }),
      },
      select: {
        settlementMonth: true,
        totalPaintCount: true,
        shopId: true,
        status: true,
        isRework: true,
        plateNumber: true,
      },
    });

    // 按月分组
    const monthMap = new Map<string, {
      totalOrders: number;
      totalPaintCount: number;
      shopCount: Set<string>;
      pendingOrders: number;
      pendingPaintCount: number;
      pendingPlateNumbers: Set<string>;
      auditedOrders: number;
      auditedPaintCount: number;
      auditedPlateNumbers: Set<string>;
      reworkOrders: number;
      reworkPaintCount: number;
      reworkPlateNumbers: Set<string>;
    }>();
    for (let m = 1; m <= 12; m++) {
      const monthStr = `${targetYear}-${String(m).padStart(2, '0')}`;
      monthMap.set(monthStr, {
        totalOrders: 0,
        totalPaintCount: 0,
        shopCount: new Set(),
        pendingOrders: 0,
        pendingPaintCount: 0,
        pendingPlateNumbers: new Set(),
        auditedOrders: 0,
        auditedPaintCount: 0,
        auditedPlateNumbers: new Set(),
        reworkOrders: 0,
        reworkPaintCount: 0,
        reworkPlateNumbers: new Set(),
      });
    }

    for (const order of orders) {
      const month = order.settlementMonth;
      if (!month || !monthMap.has(month)) continue;
      const stat = monthMap.get(month)!;

      if (order.isRework) {
        stat.reworkOrders += 1;
        stat.reworkPaintCount += Number(order.totalPaintCount);
        if (order.plateNumber)
          stat.reworkPlateNumbers.add(order.plateNumber);
        continue;
      }

      stat.totalOrders += 1;
      stat.totalPaintCount += Number(order.totalPaintCount);
      stat.shopCount.add(order.shopId);

      if (order.status === 'AUDITED' || order.status === 'SETTLED' || order.status === 'ABNORMAL') {
        stat.auditedOrders += 1;
        stat.auditedPaintCount += Number(order.totalPaintCount);
        if (order.plateNumber)
          stat.auditedPlateNumbers.add(order.plateNumber);
      } else {
        stat.pendingOrders += 1;
        stat.pendingPaintCount += Number(order.totalPaintCount);
        if (order.plateNumber)
          stat.pendingPlateNumbers.add(order.plateNumber);
      }
    }

    return Array.from(monthMap.entries()).map(([settlementMonth, stat]) => {
      const month = parseInt(settlementMonth.split('-')[1], 10);
      return {
        month,
        settlementMonth,
        totalOrders: stat.totalOrders,
        totalPaintCount: this.round(stat.totalPaintCount),
        shopCount: stat.shopCount.size,
        pendingOrders: stat.pendingOrders,
        pendingPaintCount: this.round(stat.pendingPaintCount),
        pendingVehicles: stat.pendingPlateNumbers.size,
        auditedOrders: stat.auditedOrders,
        auditedPaintCount: this.round(stat.auditedPaintCount),
        auditedVehicles: stat.auditedPlateNumbers.size,
        reworkOrders: stat.reworkOrders,
        reworkPaintCount: this.round(stat.reworkPaintCount),
        reworkVehicles: stat.reworkPlateNumbers.size,
      };
    });
  }

  /** 获取导出数据（月度工单明细） */
  async getExportData(
    settlementMonth: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ) {
    // 数据权限：accessibleShopIds 为 null 表示不限制，数组表示限制到这些门店
    if (shopId && accessibleShopIds && !accessibleShopIds.includes(shopId)) {
      return [];
    }
    const allowedShopIds = accessibleShopIds && accessibleShopIds.length > 0 ? accessibleShopIds : null;
    const shopIdWhere = shopId
      ? shopId
      : (allowedShopIds ? { in: allowedShopIds } : undefined);

    const orders = await this.prisma.paintWorkOrder.findMany({
      where: {
        settlementMonth,
        ...(shopIdWhere && { shopId: shopIdWhere }),
      },
      include: {
        shop: { select: { name: true, code: true } },
        items: { include: { category: true, specialPaint: true } },
      },
      orderBy: { orderDate: 'asc' },
    });

    return orders.map(order => ({
      工单号: order.orderNo,
      门店: (order.shop as any)?.name || '',
      门店编码: (order.shop as any)?.code || '',
      工单日期: order.orderDate ? new Date(order.orderDate).toISOString().split('T')[0] : '',
      结算月份: order.settlementMonth || '',
      车牌号: order.plateNumber || '',
      车型: order.carModel || '',
      客户名称: order.customerName || '',
      总幅数: Number(order.totalPaintCount),
      是否审核: order.status !== 'DRAFT' && order.status !== 'PENDING' ? '是' : '否',
      审核时间: order.auditedAt ? new Date(order.auditedAt).toISOString().split('T')[0] : '',
      审核人: order.auditedBy || '',
      状态: order.status,
      项目明细: (order.items as any[]).map(item => ({
        部位: item.category?.name || '',
        数量: item.quantity,
        幅数: Number(item.paintCount),
        是否新件: item.isNewPart ? '是' : '否',
        特殊车漆: item.specialPaint?.name || '',
        车漆倍数: item.specialPaintMultiplier ? Number(item.specialPaintMultiplier) : '',
      })),
      备注: order.remark || '',
    }));
  }

  /**
   * 获取月度概览 KPI
   */
  async getOverview(
    settlementMonth?: string,
    shopId?: string,
    accessibleShopIds?: string[] | null,
  ) {
    const monthly = await this.getMonthlyStatistics(settlementMonth, shopId, accessibleShopIds);
    const totalOrders = monthly.reduce((s, d) => s + d.totalOrders, 0);
    const totalPaintCount = monthly.reduce((s, d) => s + d.totalPaintCount, 0);
    const auditedOrders = monthly.reduce((s, d) => s + d.auditedOrders, 0);
    const auditedPaintCount = monthly.reduce((s, d) => s + d.auditedPaintCount, 0);
    const pendingOrders = monthly.reduce((s, d) => s + d.pendingOrders, 0);
    const pendingPaintCount = monthly.reduce((s, d) => s + d.pendingPaintCount, 0);
    const abnormalOrders = monthly.reduce((s, d) => s + d.abnormalOrders, 0);
    const abnormalPaintCount = monthly.reduce((s, d) => s + d.abnormalPaintCount, 0);
    const settledOrders = monthly.reduce((s, d) => s + d.settledOrders, 0);
    const settledPaintCount = monthly.reduce((s, d) => s + d.settledPaintCount, 0);
    const reworkOrders = monthly.reduce((s, d) => s + d.reworkOrders, 0);
    const reworkPaintCount = monthly.reduce((s, d) => s + d.reworkPaintCount, 0);
    const reworkVehicles = monthly.reduce((s, d) => s + d.reworkVehicles, 0);

    return {
      totalOrders,
      totalPaintCount,
      auditedOrders,
      auditedPaintCount,
      auditRate: totalOrders > 0 ? this.round((auditedOrders / totalOrders) * 100, 2) : 0,
      pendingOrders,
      pendingPaintCount,
      abnormalOrders,
      abnormalPaintCount,
      settledOrders,
      settledPaintCount,
      settlementRate: totalOrders > 0 ? this.round((settledOrders / totalOrders) * 100, 2) : 0,
      avgPaintPerOrder: totalOrders > 0 ? this.round(totalPaintCount / totalOrders, 2) : 0,
      reworkOrders,
      reworkPaintCount,
      reworkVehicles,
    };
  }

  /**
   * 获取有数据的最新结算月份
   */
  async getLatestSettlementMonth(accessibleShopIds?: string[] | null): Promise<string | null> {
    const allowedShopIds = accessibleShopIds && accessibleShopIds.length > 0 ? accessibleShopIds : null;
    const result = await this.prisma.paintWorkOrder.findFirst({
      where: {
        settlementMonth: { not: null },
        ...(allowedShopIds && { shopId: { in: allowedShopIds } }),
      },
      orderBy: { settlementMonth: 'desc' },
      select: { settlementMonth: true },
    });
    return result?.settlementMonth || null;
  }
}
