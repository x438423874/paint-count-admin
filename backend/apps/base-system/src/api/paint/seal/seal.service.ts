import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaintStatsCache } from '../service/paint-stats-cache';

export interface SealOverviewItem {
  shopId: string;
  shopName: string;
  month: string;
  orderCount: number;
  totalPaintCount: number;
  reworkCount: number;
  /** 待审核工单数（封单防线上的重要指标） */
  pendingCount: number;
  /** 待审核幅数合计 */
  pendingPaintCount: number;
  /** 当月是否有工单数据（false = 漏导入风险提示） */
  hasData: boolean;
  isSealed: boolean;
  sealedAt: Date | null;
  sealedBy: string | null;
}

export interface SealOverviewSummary {
  /** 当月有数据的门店数 */
  shopsWithData: number;
  /** 当月无数据的门店数（漏导入风险） */
  shopsWithoutData: number;
  /** 待审核工单合计 */
  pendingOrderTotal: number;
  /** 待审核幅数合计 */
  pendingPaintTotal: number;
  /** 已封单门店数 */
  sealedCount: number;
}

export interface SealOverviewResult {
  list: SealOverviewItem[];
  total: number;
  /** 仅按月份查询时提供，用于封单页「结算就绪度」横幅 */
  summary?: SealOverviewSummary;
}

@Injectable()
export class SealService {
  constructor(private readonly prisma: PrismaService) {}

  /** 封单：锁定门店+月份，之后不允许修改/删除该月工单 */
  async seal(shopId: string, month: string, sealedBy?: string, options?: { force?: boolean }) {
    await this.assertShopExists(shopId);

    const existing = await this.prisma.paintSettlementMonth.findUnique({
      where: { shopId_month: { shopId, month } },
    });

    if (existing?.isSealed) {
      throw new BadRequestException(`${month} 已封单，请勿重复操作`);
    }

    // 防线：尚有未审核工单（草稿/待审核）时默认拒绝封单——未审核单的幅数会计入月度结算金额，
    // 封单后审核被锁死，等于未经人审的数据直接进入结算。确认要带未审核封单需显式 force。
    const unauditedCount = await this.prisma.paintWorkOrder.count({
      where: { shopId, settlementMonth: month, status: { in: ['DRAFT', 'PENDING'] } },
    });
    if (unauditedCount > 0 && !options?.force) {
      throw new BadRequestException(
        `该门店 ${month} 尚有 ${unauditedCount} 单未审核（草稿/待审核），封单后将无法再审核。请先完成审核；确认要强制封单请使用强制封单。`,
      );
    }

    // 查询该月工单统计
    const stats = await this.prisma.paintWorkOrder.aggregate({
      where: {
        shopId,
        settlementMonth: month,
        isRework: false,
      },
      _count: true,
      _sum: { totalPaintCount: true },
    });

    const reworkStats = await this.prisma.paintWorkOrder.aggregate({
      where: {
        shopId,
        settlementMonth: month,
        isRework: true,
      },
      _count: true,
    });

    const result = await this.prisma.paintSettlementMonth.upsert({
      where: { shopId_month: { shopId, month } },
      update: { isSealed: true, sealedAt: new Date(), sealedBy: sealedBy || null },
      create: { shopId, month, isSealed: true, sealedAt: new Date(), sealedBy: sealedBy || null },
    });

    // 封单时自动将该月所有「已审核」工单结算为「已结算」
    const settled = await this.prisma.paintWorkOrder.updateMany({
      where: {
        shopId,
        settlementMonth: month,
        status: 'AUDITED' as any,
      },
      data: {
        status: 'SETTLED' as any,
        settledAt: new Date(),
        settledBy: sealedBy || null,
      },
    });

    // 封单会把该月「已审核」工单批量结算为「已结算」，统计结果随之变化
    PaintStatsCache.invalidate([month, `y${month.slice(0, 4)}`]).catch(() => undefined);

    return {
      ...result,
      settledCount: settled.count,
      stats: {
        orderCount: stats._count,
        totalPaintCount: stats._sum.totalPaintCount || 0,
        reworkCount: reworkStats._count,
      },
    };
  }

  /** 解封：解除门店+月份的封单锁定 */
  async unseal(shopId: string, month: string) {
    await this.assertShopExists(shopId);

    const existing = await this.prisma.paintSettlementMonth.findUnique({
      where: { shopId_month: { shopId, month } },
    });

    if (!existing || !existing.isSealed) {
      throw new BadRequestException(`${month} 未封单，无需解封`);
    }

    return this.prisma.paintSettlementMonth.update({
      where: { id: existing.id },
      data: { isSealed: false, sealedAt: null, sealedBy: null },
    });
  }

  /** 查询门店某月的封单状态（含该月工单统计） */
  async getSealStatus(shopId: string, month: string) {
    const record = await this.prisma.paintSettlementMonth.findUnique({
      where: { shopId_month: { shopId, month } },
    });

    // 查询该月工单统计
    const stats = await this.prisma.paintWorkOrder.aggregate({
      where: {
        shopId,
        settlementMonth: month,
        isRework: false,
      },
      _count: true,
      _sum: { totalPaintCount: true },
    });

    const reworkStats = await this.prisma.paintWorkOrder.aggregate({
      where: {
        shopId,
        settlementMonth: month,
        isRework: true,
      },
      _count: true,
    });

    return {
      ...(record || { id: null, shopId, month, isSealed: false, sealedAt: null, sealedBy: null, createdAt: null, updatedAt: null }),
      stats: {
        orderCount: stats._count,
        totalPaintCount: stats._sum.totalPaintCount || 0,
        reworkCount: reworkStats._count,
      },
    };
  }

  /** 批量查询门店多个月的封单状态 */
  async getSealStatuses(shopId: string, months: string[]) {
    const records = await this.prisma.paintSettlementMonth.findMany({
      where: { shopId, month: { in: months } },
    });
    return records;
  }

  /** 查询门店所有封单月份 */
  async listSealedMonths(shopId?: string) {
    return this.prisma.paintSettlementMonth.findMany({
      where: {
        ...(shopId ? { shopId } : {}),
        isSealed: true,
      },
      include: { shop: { select: { id: true, name: true } } },
      orderBy: { month: 'desc' },
    });
  }

  /**
   * 封单总览：按「门店 × 月份」聚合工单汇总，并关联封单状态
   */
  async getOverview(params: {
    shopId?: string;
    month?: string;
    current?: number;
    size?: number;
  }): Promise<SealOverviewResult> {
    const { shopId, month, current = 1, size = 20 } = params;

    const baseWhere: any = { settlementMonth: { not: null } };
    if (shopId) baseWhere.shopId = shopId;
    if (month) baseWhere.settlementMonth = month;

    const groups = await this.prisma.paintWorkOrder.groupBy({
      by: ['shopId', 'settlementMonth'],
      where: baseWhere,
      _count: { _all: true },
      _sum: { totalPaintCount: true },
    });

    const reworkGroups = await this.prisma.paintWorkOrder.groupBy({
      by: ['shopId', 'settlementMonth'],
      where: { ...baseWhere, isRework: true },
      _count: { _all: true },
    });

    const pendingGroups = await this.prisma.paintWorkOrder.groupBy({
      by: ['shopId', 'settlementMonth'],
      // 未审核 = 草稿 + 待审核（两者幅数均计入月度结算）
      where: { ...baseWhere, status: { in: ['DRAFT', 'PENDING'] } },
      _count: { _all: true },
      _sum: { totalPaintCount: true },
    });

    const sealWhere: any = {};
    if (shopId) sealWhere.shopId = shopId;
    if (month) sealWhere.month = month;
    const sealRecords = await this.prisma.paintSettlementMonth.findMany({ where: sealWhere });

    const reworkMap = new Map<string, number>();
    reworkGroups.forEach(g => reworkMap.set(`${g.shopId}|${g.settlementMonth}`, g._count._all));

    const pendingCountMap = new Map<string, number>();
    const pendingPaintMap = new Map<string, number>();
    pendingGroups.forEach(g => {
      const key = `${g.shopId}|${g.settlementMonth}`;
      pendingCountMap.set(key, g._count._all);
      pendingPaintMap.set(key, g._sum.totalPaintCount?.toNumber() ?? 0);
    });

    const sealMap = new Map<string, (typeof sealRecords)[number]>();
    sealRecords.forEach(r => sealMap.set(`${r.shopId}|${r.month}`, r));

    const shopIds = Array.from(new Set(groups.map(g => g.shopId)));
    const shops = await this.prisma.paintShop.findMany({
      where: { id: { in: shopIds } },
      select: { id: true, name: true },
    });
    const shopNameMap = new Map(shops.map(s => [s.id, s.name]));

    const all: SealOverviewItem[] = groups.map(g => {
      const m = g.settlementMonth ?? '';
      const key = `${g.shopId}|${m}`;
      const seal = sealMap.get(key);
      return {
        shopId: g.shopId,
        shopName: shopNameMap.get(g.shopId) || '',
        month: m,
        orderCount: g._count._all,
        totalPaintCount: g._sum.totalPaintCount?.toNumber() ?? 0,
        reworkCount: reworkMap.get(key) || 0,
        pendingCount: pendingCountMap.get(key) || 0,
        pendingPaintCount: pendingPaintMap.get(key) || 0,
        hasData: true,
        isSealed: !!seal?.isSealed,
        sealedAt: seal?.sealedAt || null,
        sealedBy: seal?.sealedBy || null,
      };
    });

    // 漏导入防线：按月份查询时，为「启用但当月无任何工单」的门店补零值行，
    // 避免漏导入的门店在封单页隐身导致整月漏算
    if (month) {
      const covered = new Set(all.map(r => `${r.shopId}|${r.month}`));
      const enabledShops = await this.prisma.paintShop.findMany({
        where: { status: 'ENABLED', ...(shopId ? { id: shopId } : {}) },
        select: { id: true, name: true },
      });
      for (const shop of enabledShops) {
        const key = `${shop.id}|${month}`;
        if (covered.has(key)) continue;
        covered.add(key);
        const seal = sealMap.get(key);
        all.push({
          shopId: shop.id,
          shopName: shop.name,
          month,
          orderCount: 0,
          totalPaintCount: 0,
          reworkCount: 0,
          pendingCount: 0,
          pendingPaintCount: 0,
          hasData: false,
          isSealed: !!seal?.isSealed,
          sealedAt: seal?.sealedAt || null,
          sealedBy: seal?.sealedBy || null,
        });
      }
    }

    // 按月降序、无数据行置前提醒、门店升序排序
    all.sort((a, b) =>
      b.month.localeCompare(a.month) ||
      Number(a.hasData) - Number(b.hasData) ||
      a.shopId.localeCompare(b.shopId),
    );

    const total = all.length;
    const start = (current - 1) * size;
    const list = all.slice(start, start + size);

    const summary: SealOverviewSummary | undefined = month
      ? {
          shopsWithData: all.filter(r => r.hasData).length,
          shopsWithoutData: all.filter(r => !r.hasData && !r.isSealed).length,
          pendingOrderTotal: all.filter(r => !r.isSealed).reduce((s, r) => s + r.pendingCount, 0),
          pendingPaintTotal: all.filter(r => !r.isSealed).reduce((s, r) => s + r.pendingPaintCount, 0),
          sealedCount: all.filter(r => r.isSealed).length,
        }
      : undefined;

    return { list, total, summary };
  }

  /** 校验门店+月份是否已封单，若封单则抛出异常 */
  async assertNotSealed(shopId: string, month: string) {
    const record = await this.prisma.paintSettlementMonth.findUnique({
      where: { shopId_month: { shopId, month } },
    });
    if (record?.isSealed) {
      throw new BadRequestException(`${month} 已封单，不允许修改`);
    }
  }

  /** 根据工单ID校验封单状态 */
  async assertOrderNotSealed(orderId: string) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
      select: { shopId: true, settlementMonth: true, orderDate: true },
    });
    if (!order) throw new NotFoundException('工单不存在');

    const month = order.settlementMonth || this.getMonthFromDate(order.orderDate);
    if (month) {
      await this.assertNotSealed(order.shopId, month);
    }
  }

  private async assertShopExists(shopId: string) {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('门店不存在');
  }

  private getMonthFromDate(date: Date | null | undefined): string | null {
    if (!date) return null;
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
