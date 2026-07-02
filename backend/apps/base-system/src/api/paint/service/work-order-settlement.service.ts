import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class WorkOrderSettlementService {
  constructor(private readonly prisma: PrismaService) {}

  /** 添加结算记录（结算工单） */
  async addSettlementRecord(orderId: string, settlementMonth: string, remark?: string) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
      include: { items: true, settlements: true },
    });
    if (!order) throw new NotFoundException('工单不存在');

    // 必须已审核才能结算
    if (!order.isAudited) {
      throw new BadRequestException('工单未审核，不能结算');
    }

    // 异常标注的工单不能结算
    if (order.isAbnormal) {
      throw new BadRequestException('工单有异常标注，不能结算');
    }

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

  /** 取消结算（删除结算记录） */
  async removeSettlementRecord(recordId: string) {
    const record = await this.prisma.paintSettlementRecord.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException('结算记录不存在');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.paintSettlementRecord.delete({
        where: { id: recordId },
      });

      // 查看该工单是否还有其他结算记录
      const remaining = await tx.paintSettlementRecord.findFirst({
        where: { orderId: record.orderId },
        orderBy: { createdAt: 'desc' },
      });

      // 更新工单结算月份为最新剩余记录的月份，如果没有则清空
      await tx.paintWorkOrder.update({
        where: { id: record.orderId },
        data: { settlementMonth: remaining?.settlementMonth || null },
      });

      return { success: true };
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
