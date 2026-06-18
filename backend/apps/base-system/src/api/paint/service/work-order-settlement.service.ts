import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class WorkOrderSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  /** 添加结算记录 */
  async addSettlementRecord(orderId: string, settlementMonth: string, remark?: string) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('工单不存在');

    // 检查是否已有该月份的结算记录
    const existing = await this.prisma.paintSettlementRecord.findFirst({
      where: { orderId, settlementMonth },
    });
    if (existing) {
      throw new BadRequestException(`工单已在 ${settlementMonth} 结算过`);
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const record = await tx.paintSettlementRecord.create({
        data: {
          orderId,
          settlementMonth,
          paintCount: order.totalPaintCount,
          itemCount: order.items.length,
          remark,
        },
      });

      // 更新工单的结算月份为最新的结算月份
      await tx.paintWorkOrder.update({
        where: { id: orderId },
        data: { settlementMonth },
      });

      return record;
    });
  }

  /** 获取工单的结算历史 */
  async getSettlementHistory(orderId: string) {
    return this.prisma.paintSettlementRecord.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
