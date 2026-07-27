import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { generateMergeGroupId } from './paint-calculation';
import { PaintVehicleService } from './paint-vehicle.service';

@Injectable()
export class WorkOrderMergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicleService: PaintVehicleService,
  ) {}

  /** 合并重复工单：将 sourceIds 的图片合并到 targetId，并补充目标工单缺失的基础信息 */
  async mergeOrders(targetId: string, sourceIds: string[]) {
    const target = await this.prisma.paintWorkOrder.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('目标工单不存在');

    // 生成合并组ID
    const mergeGroupId = generateMergeGroupId(target.mergeGroupId);

    // 收集源工单的 vehicleId，用于合并后刷新车辆统计
    const vehicleIdsToRefresh = new Set<string>();
    if (target.vehicleId) vehicleIdsToRefresh.add(target.vehicleId);

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 收集所有源工单，用于后续补充基础信息
      const sourceOrders = [];
      for (const sourceId of sourceIds) {
        if (sourceId === targetId) continue;
        const source = await tx.paintWorkOrder.findUnique({
          where: { id: sourceId },
          include: { images: true },
        });
        if (source) {
          // 防御性校验：跨月工单不允许合并（拆单结算方案下同号不同月为独立工单）
          if ((source.settlementMonth || '') !== (target.settlementMonth || '')) {
            throw new BadRequestException('不能合并不同结算月份的工单');
          }
          sourceOrders.push(source);
          if (source.vehicleId) vehicleIdsToRefresh.add(source.vehicleId);
        }
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

    // 异步刷新涉及车辆的统计（源工单被删除后需重算）
    for (const vid of vehicleIdsToRefresh) {
      this.vehicleService.refreshStats(vid).catch(() => {});
    }

    return result;
  }

  /** 查询工单的重复工单列表（同orderNo） */
  async findDuplicateOrders(
    orderNo: string,
    excludeId?: string,
    accessibleShopIds?: string[] | null,
    settlementMonth?: string,
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
    // 同号不同结算月份不算重复，仅查询同月的
    if (settlementMonth) {
      where.settlementMonth = settlementMonth;
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
