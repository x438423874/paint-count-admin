import { Injectable } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

interface MonthlyStat {
  settlementMonth: string;
  shopId: string;
  shopName: string;
  shopCode: string;
  totalOrders: number;
  totalPaintCount: number;
  dailyStats: DailyStat[];
}

interface DailyStat {
  date: string;
  orderCount: number;
  paintCount: number;
}

interface CategoryBreakdown {
  categoryName: string;
  categoryCode: string;
  totalCount: number;
  totalPaintCount: number;
}

@Injectable()
export class PaintStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMonthlyStatistics(settlementMonth?: string, shopId?: string) {
    const now = new Date();
    const targetMonth = settlementMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 一次查出所有门店
    const shops = await this.prisma.paintShop.findMany({
      where: shopId ? { id: shopId } : {},
      select: { id: true, name: true, code: true },
    });

    const shopIds = shops.map(s => s.id);

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
      for (const order of shopOrders) {
        const dateKey = new Date(order.orderDate).toISOString().split('T')[0];
        const existing = dailyMap.get(dateKey) || { date: dateKey, orderCount: 0, paintCount: 0 };
        existing.orderCount += 1;
        existing.paintCount += Number(order.totalPaintCount);
        dailyMap.set(dateKey, existing);
      }

      results.push({
        settlementMonth: targetMonth,
        shopId: shop.id,
        shopName: shop.name,
        shopCode: shop.code,
        totalOrders: shopOrders.length,
        totalPaintCount: shopOrders.reduce((sum, o) => sum + Number(o.totalPaintCount), 0),
        dailyStats: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      });
    }

    return results;
  }

  async getCategoryBreakdown(settlementMonth?: string, shopId?: string) {
    const now = new Date();
    const targetMonth = settlementMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const items = await this.prisma.paintWorkOrderItem.findMany({
      where: {
        order: {
          settlementMonth: targetMonth,
          ...(shopId && { shopId }),
        },
      },
      include: { category: true, specialPaint: true },
    });

    const categoryMap = new Map<string, CategoryBreakdown>();
    for (const item of items) {
      const key = item.categoryId;
      const existing = categoryMap.get(key) || {
        categoryName: item.category.name,
        categoryCode: item.category.code,
        totalCount: 0,
        totalPaintCount: 0,
      };
      existing.totalCount += item.quantity;
      existing.totalPaintCount += Number(item.paintCount);
      categoryMap.set(key, existing);
    }

    return Array.from(categoryMap.values()).sort((a, b) => b.totalPaintCount - a.totalPaintCount);
  }

  async getShopComparison(settlementMonth?: string) {
    const stats = await this.getMonthlyStatistics(settlementMonth);
    return stats.map(s => ({
      shopId: s.shopId,
      shopName: s.shopName,
      shopCode: s.shopCode,
      totalOrders: s.totalOrders,
      totalPaintCount: s.totalPaintCount,
      avgPaintPerOrder: s.totalOrders > 0 ? +(s.totalPaintCount / s.totalOrders).toFixed(2) : 0,
    })).sort((a, b) => b.totalPaintCount - a.totalPaintCount);
  }

  async getYearOverview(year?: number, shopId?: string) {
    const now = new Date();
    const targetYear = year ?? now.getFullYear();

    // 一次查出全年数据，避免循环12次查库
    const yearPrefix = `${targetYear}-`;
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: {
        settlementMonth: { startsWith: yearPrefix },
        ...(shopId && { shopId }),
      },
      select: {
        settlementMonth: true,
        totalPaintCount: true,
        shopId: true,
      },
    });

    // 按月分组
    const monthMap = new Map<string, { totalOrders: number; totalPaintCount: number; shopCount: Set<string> }>();
    for (let m = 1; m <= 12; m++) {
      const monthStr = `${targetYear}-${String(m).padStart(2, '0')}`;
      monthMap.set(monthStr, { totalOrders: 0, totalPaintCount: 0, shopCount: new Set() });
    }

    for (const order of orders) {
      const month = order.settlementMonth;
      if (!month || !monthMap.has(month)) continue;
      const stat = monthMap.get(month)!;
      stat.totalOrders += 1;
      stat.totalPaintCount += Number(order.totalPaintCount);
      stat.shopCount.add(order.shopId);
    }

    return Array.from(monthMap.entries()).map(([settlementMonth, stat]) => {
      const month = parseInt(settlementMonth.split('-')[1], 10);
      return {
        month,
        settlementMonth,
        totalOrders: stat.totalOrders,
        totalPaintCount: stat.totalPaintCount,
        shopCount: stat.shopCount.size,
      };
    });
  }

  /** 获取导出数据（月度工单明细） */
  async getExportData(settlementMonth: string, shopId?: string) {
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: {
        settlementMonth,
        ...(shopId && { shopId }),
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
