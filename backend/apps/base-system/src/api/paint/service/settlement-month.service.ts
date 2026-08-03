import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

@Injectable()
export class SettlementMonthService {
  constructor(private readonly prisma: PrismaService) {}

  /** 封单：锁定门店+月份，之后不允许修改/删除该月工单 */
  async seal(shopId: string, month: string, sealedBy?: string) {
    await this.assertShopExists(shopId);

    const existing = await this.prisma.paintSettlementMonth.findUnique({
      where: { shopId_month: { shopId, month } },
    });

    if (existing?.isSealed) {
      throw new BadRequestException(`${month} 已封单，请勿重复操作`);
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
