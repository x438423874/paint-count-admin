import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { generateMergeGroupId } from './paint-calculation';

@Injectable()
export class WorkOrderMergeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 合并重复工单：将sourceIds的工单合并到targetId */
  async mergeOrders(targetId: string, sourceIds: string[]) {
    const target = await this.prisma.paintWorkOrder.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('目标工单不存在');

    // 生成合并组ID
    const mergeGroupId = generateMergeGroupId(target.mergeGroupId);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 标记目标工单的合并组
      await tx.paintWorkOrder.update({
        where: { id: targetId },
        data: { mergeGroupId },
      });

      let totalAddedPaintCount = 0;

      for (const sourceId of sourceIds) {
        if (sourceId === targetId) continue;
        const source = await tx.paintWorkOrder.findUnique({
          where: { id: sourceId },
          include: { items: true, images: true },
        });
        if (!source) continue;

        // 迁移喷漆项目到目标工单
        if (source.items.length > 0) {
          await tx.paintWorkOrderItem.updateMany({
            where: { orderId: sourceId },
            data: { orderId: targetId },
          });
          totalAddedPaintCount += Number(source.totalPaintCount);
        }

        // 迁移图片到目标工单
        if (source.images.length > 0) {
          await tx.paintWorkOrderImage.updateMany({
            where: { orderId: sourceId },
            data: { orderId: targetId },
          });
        }

        // 迁移结算记录到目标工单
        await tx.paintSettlementRecord.updateMany({
          where: { orderId: sourceId },
          data: { orderId: targetId },
        });

        // 删除源工单（项目、图片、结算记录已迁移到目标工单，级联删除剩余关联数据）
        await tx.paintWorkOrder.delete({
          where: { id: sourceId },
        });
      }

      // 更新目标工单的总幅数
      if (totalAddedPaintCount > 0) {
        await tx.paintWorkOrder.update({
          where: { id: targetId },
          data: {
            totalPaintCount: { increment: totalAddedPaintCount },
          },
        });
      }

      return tx.paintWorkOrder.findUnique({
        where: { id: targetId },
        include: {
          items: { include: { category: true, specialPaint: true } },
          images: { orderBy: { createdAt: 'desc' } },
          shop: true,
          settlements: { orderBy: { createdAt: 'desc' } },
        },
      });
    });
  }

  /** 查询工单的重复工单列表（同orderNo） */
  async findDuplicateOrders(orderNo: string, excludeId?: string) {
    const where: Prisma.PaintWorkOrderWhereInput = {
      orderNo,
      status: { not: 'CANCELLED' },
    };
    if (excludeId) {
      where.id = { not: excludeId };
    }
    return this.prisma.paintWorkOrder.findMany({
      where,
      include: {
        items: { include: { category: true } },
        shop: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
