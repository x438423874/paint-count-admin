import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { generateMergeGroupId } from './paint-calculation';

@Injectable()
export class WorkOrderMergeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 合并重复工单：将 sourceIds 的图片合并到 targetId，并补充目标工单缺失的基础信息 */
  async mergeOrders(targetId: string, sourceIds: string[]) {
    const target = await this.prisma.paintWorkOrder.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('目标工单不存在');

    // 生成合并组ID
    const mergeGroupId = generateMergeGroupId(target.mergeGroupId);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 收集所有源工单，用于后续补充基础信息
      const sourceOrders = [];
      for (const sourceId of sourceIds) {
        if (sourceId === targetId) continue;
        const source = await tx.paintWorkOrder.findUnique({
          where: { id: sourceId },
          include: { images: true },
        });
        if (source) sourceOrders.push(source);
      }

      // 补充目标工单缺失的基础信息（按 sourceIds 顺序，取第一个非空值）
      const patchData: Prisma.PaintWorkOrderUpdateInput = {};
      const fieldsToFill: (keyof typeof target)[] = [
        'plateNumber',
        'carModel',
        'vin',
        'brand',
        'customerName',
        'phone',
        'contactPerson',
        'description',
        'remark',
        'orderNo',
      ];
      for (const field of fieldsToFill) {
        const currentValue = target[field];
        if (currentValue === null || currentValue === undefined || currentValue === '') {
          for (const source of sourceOrders) {
            const sourceValue = source[field];
            if (sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
              (patchData as any)[field] = sourceValue;
              break;
            }
          }
        }
      }

      // 标记目标工单的合并组，并应用补充字段
      await tx.paintWorkOrder.update({
        where: { id: targetId },
        data: {
          mergeGroupId,
          ...patchData,
        },
      });

      for (const source of sourceOrders) {
        // 迁移图片到目标工单
        if (source.images.length > 0) {
          await tx.paintWorkOrderImage.updateMany({
            where: { orderId: source.id },
            data: { orderId: targetId },
          });
        }

        // 删除源工单（图片已迁移，级联删除剩余关联数据）
        await tx.paintWorkOrder.delete({
          where: { id: source.id },
        });
      }

      // 合并不需要改状态
      return tx.paintWorkOrder.findUnique({
        where: { id: targetId },
        include: {
          items: { include: { category: true, specialPaint: true } },
          images: { orderBy: { createdAt: 'desc' } },
          shop: true,
        },
      });
    });
  }

  /** 查询工单的重复工单列表（同orderNo） */
  async findDuplicateOrders(
    orderNo: string,
    excludeId?: string,
    accessibleShopIds?: string[] | null,
  ) {
    const where: Prisma.PaintWorkOrderWhereInput = {
      orderNo,
    };
    if (excludeId) {
      where.id = { not: excludeId };
    }
    // 数据权限：accessibleShopIds 为 null 表示不限制，数组表示限制到这些门店
    if (accessibleShopIds) {
      where.shopId = { in: accessibleShopIds };
    }
    return this.prisma.paintWorkOrder.findMany({
      where,
      include: {
        items: { include: { category: true } },
        images: { select: { id: true } },
        shop: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
