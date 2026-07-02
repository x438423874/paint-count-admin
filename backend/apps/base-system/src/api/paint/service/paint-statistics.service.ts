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
        isAudited: true,
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
      let pendingOrders = 0;
      let pendingPaintCount = 0;
      let auditedOrders = 0;
      let auditedPaintCount = 0;

      for (const order of shopOrders) {
        const dateKey = new Date(order.orderDate).toISOString().split('T')[0];
        const existing = dailyMap.get(dateKey) || { date: dateKey, orderCount: 0, paintCount: 0 };
        existing.orderCount += 1;
        existing.paintCount += Number(order.totalPaintCount);
        dailyMap.set(dateKey, existing);
        if (order.plateNumber)
          plateNumbers.add(order.plateNumber);

        if (order.isAudited) {
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

      const totalPaintCount = shopOrders.reduce((sum, o) => sum + Number(o.totalPaintCount), 0);
      const totalOrders = shopOrders.length;
      const totalVehicles = plateNumbers.size;

      results.push({
        settlementMonth: targetMonth,
        shopId: shop.id,
        shopName: shop.name,
        shopCode: shop.code,
        totalOrders,
        totalPaintCount,
        totalVehicles,
        avgPaintPerVehicle: totalVehicles > 0 ? +(totalPaintCount / totalVehicles).toFixed(2) : 0,
        avgPaintPerOrder: totalOrders > 0 ? +(totalPaintCount / totalOrders).toFixed(2) : 0,
        dailyStats: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
        pendingOrders,
        pendingPaintCount,
        pendingVehicles: pendingPlateNumbers.size,
        auditedOrders,
        auditedPaintCount,
        auditedVehicles: auditedPlateNumbers.size,
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

    return Array.from(categoryMap.values()).sort((a, b) => b.totalPaintCount - a.totalPaintCount);
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
        isAudited: true,
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
      });
    }

    for (const order of orders) {
      const month = order.settlementMonth;
      if (!month || !monthMap.has(month)) continue;
      const stat = monthMap.get(month)!;
      stat.totalOrders += 1;
      stat.totalPaintCount += Number(order.totalPaintCount);
      stat.shopCount.add(order.shopId);

      if (order.isAudited) {
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
        totalPaintCount: stat.totalPaintCount,
        shopCount: stat.shopCount.size,
        pendingOrders: stat.pendingOrders,
        pendingPaintCount: stat.pendingPaintCount,
        pendingVehicles: stat.pendingPlateNumbers.size,
        auditedOrders: stat.auditedOrders,
        auditedPaintCount: stat.auditedPaintCount,
        auditedVehicles: stat.auditedPlateNumbers.size,
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
      工单日期: new Date(order.orderDate).toISOString().split('T')[0],
      结算月份: order.settlementMonth || '',
      车牌号: order.plateNumber || '',
      车型: order.carModel || '',
      客户名称: order.customerName || '',
      总幅数: Number(order.totalPaintCount),
      是否审核: order.isAudited ? '是' : '否',
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
}
