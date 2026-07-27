/**
 * 车辆主数据历史迁移脚本
 *
 * 执行方式:
 *   cd backend && npx ts-node -r tsconfig-paths/register prisma/seeds/migrate-vehicles.ts
 *
 * 功能:
 *   1. 扫描所有 PaintWorkOrder 中已存在的车牌号（plateNumber）
 *   2. 按车牌聚合，提取每台车辆的最新信息（VIN/车型/品牌/客户/电话/联系人）
 *   3. upsert 到 PaintVehicle 主表（车牌统一大写 + trim）
 *   4. 回填每张工单的 vehicleId 外键
 *   5. 调用 refreshStats 逻辑重算每台车辆的 totalOrderCount / totalPaintCount / lastOrderAt / lastShopId
 *
 * 安全保障:
 *   - 整个迁移过程对每台车辆使用独立事务，单台失败不影响其他车辆
 *   - 不修改工单的任何业务字段，仅回填 vehicleId
 *   - 幂等：重复执行不会创建重复车辆，已回填 vehicleId 的工单会被跳过
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface VehicleAgg {
  plateNumber: string;
  vin: string | null;
  carModel: string | null;
  brand: string | null;
  customerName: string | null;
  phone: string | null;
  contactPerson: string | null;
  latestOrderAt: Date;
  latestShopId: string | null;
  orderIds: string[];
}

/**
 * 标准化车牌号：去前后空格 + 转大写
 * 与 PaintVehicleService.normalizePlate 保持一致
 */
function normalizePlate(plate: string): string {
  return (plate || '').trim().toUpperCase();
}

/**
 * 从所有工单中按车牌聚合车辆信息
 * 同一车牌多张工单：取最新工单（按 orderDate desc, createdAt desc）的非空字段
 */
async function aggregateVehiclesFromOrders(): Promise<Map<string, VehicleAgg>> {
  // 仅处理有车牌且尚未关联 vehicleId 的工单（幂等）
  // 已关联的工单跳过，但其车牌仍可能需要为同车牌其他工单回填
  const orders = await prisma.paintWorkOrder.findMany({
    where: {
      plateNumber: { not: null },
    },
    select: {
      id: true,
      plateNumber: true,
      vin: true,
      carModel: true,
      brand: true,
      customerName: true,
      phone: true,
      contactPerson: true,
      orderDate: true,
      createdAt: true,
      shopId: true,
      vehicleId: true,
    },
    orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
  });

  const vehicleMap = new Map<string, VehicleAgg>();

  for (const order of orders) {
    const rawPlate = order.plateNumber || '';
    const plate = normalizePlate(rawPlate);
    if (!plate) continue;

    // 取每张工单需要回填的标记（vehicleId 为空才需要回填）
    const needBackfill = !order.vehicleId;

    const existing = vehicleMap.get(plate);
    if (existing) {
      // 已存在：仅追加需要回填的工单 ID
      if (needBackfill) existing.orderIds.push(order.id);
      continue;
    }

    // 新车辆：以首条（最新）工单的字段为基准
    vehicleMap.set(plate, {
      plateNumber: plate,
      vin: order.vin?.trim() || null,
      carModel: order.carModel?.trim() || null,
      brand: order.brand?.trim() || null,
      customerName: order.customerName?.trim() || null,
      phone: order.phone?.trim() || null,
      contactPerson: order.contactPerson?.trim() || null,
      latestOrderAt: order.orderDate || order.createdAt,
      latestShopId: order.shopId,
      orderIds: needBackfill ? [order.id] : [],
    });
  }

  return vehicleMap;
}

/**
 * 重算车辆统计：totalOrderCount / totalPaintCount / lastOrderAt / lastShopId
 * 与 PaintVehicleService.refreshStats 逻辑一致
 */
async function refreshVehicleStats(vehicleId: string): Promise<void> {
  const orders = await prisma.paintWorkOrder.findMany({
    where: { vehicleId },
    select: { totalPaintCount: true, orderDate: true, createdAt: true, shopId: true },
    orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
  });

  if (orders.length === 0) {
    await prisma.paintVehicle.update({
      where: { id: vehicleId },
      data: {
        totalOrderCount: 0,
        totalPaintCount: 0,
        lastOrderAt: null,
        lastShopId: null,
      },
    });
    return;
  }

  const totalPaintCount = orders.reduce(
    (sum, o) => sum.add(o.totalPaintCount),
    new Prisma.Decimal(0)
  );
  const latest = orders[0];

  await prisma.paintVehicle.update({
    where: { id: vehicleId },
    data: {
      totalOrderCount: orders.length,
      totalPaintCount,
      lastOrderAt: latest.orderDate || latest.createdAt,
      lastShopId: latest.shopId,
    },
  });
}

async function migrate() {
  console.log('=== 车辆主数据迁移开始 ===');
  const startedAt = Date.now();

  const vehicleMap = await aggregateVehiclesFromOrders();
  console.log(`扫描到 ${vehicleMap.size} 个唯一车牌号`);

  let createdCount = 0;
  let updatedCount = 0;
  let backfilledOrderCount = 0;
  let failedCount = 0;

  for (const [plate, agg] of Array.from(vehicleMap.entries())) {
    try {
      await prisma.$transaction(async (tx) => {
        // upsert 车辆主表
        const vehicle = await tx.paintVehicle.upsert({
          where: { plateNumber: plate },
          update: {
            // 仅当主表字段为空时回填，避免覆盖用户在车辆管理页维护的数据
            vin: agg.vin || undefined,
            carModel: agg.carModel || undefined,
            brand: agg.brand || undefined,
            customerName: agg.customerName || undefined,
            phone: agg.phone || undefined,
            contactPerson: agg.contactPerson || undefined,
            // 若已有 lastOrderAt 且比当前更新，则保留；否则更新
            lastOrderAt: agg.latestOrderAt,
            lastShopId: agg.latestShopId,
          },
          create: {
            plateNumber: plate,
            vin: agg.vin,
            carModel: agg.carModel || '',
            brand: agg.brand,
            customerName: agg.customerName || '',
            phone: agg.phone,
            contactPerson: agg.contactPerson,
            lastOrderAt: agg.latestOrderAt,
            lastShopId: agg.latestShopId,
          },
        });

        // 回填工单 vehicleId
        if (agg.orderIds.length > 0) {
          await tx.paintWorkOrder.updateMany({
            where: { id: { in: agg.orderIds } },
            data: { vehicleId: vehicle.id },
          });
          backfilledOrderCount += agg.orderIds.length;
        }

        return vehicle;
      });

      // 统计 created/updated（粗略判断：updatedAt 与 createdAt 差值小于 5 秒视为本次新建）
      const existed = await prisma.paintVehicle.findUnique({
        where: { plateNumber: plate },
        select: { createdAt: true, updatedAt: true },
      });
      const updatedTime = existed?.updatedAt?.getTime() || 0;
      if (existed && Math.abs(existed.createdAt.getTime() - updatedTime) < 5000) {
        createdCount++;
      } else {
        updatedCount++;
      }
    } catch (err) {
      failedCount++;
      console.error(`迁移车牌 ${plate} 失败:`, (err as Error).message);
    }
  }

  // 重算所有车辆的统计字段（确保 totalOrderCount / totalPaintCount 准确）
  console.log('重算车辆统计字段...');
  const allVehicles = await prisma.paintVehicle.findMany({ select: { id: true, plateNumber: true } });
  for (const v of allVehicles) {
    try {
      await refreshVehicleStats(v.id);
    } catch (err) {
      console.error(`重算车辆 ${v.plateNumber} 统计失败:`, (err as Error).message);
    }
  }

  console.log('=== 迁移完成 ===');
  console.log(`唯一车牌数: ${vehicleMap.size}`);
  console.log(`新建车辆: ${createdCount}`);
  console.log(`更新车辆: ${updatedCount}`);
  console.log(`回填工单数: ${backfilledOrderCount}`);
  console.log(`失败数: ${failedCount}`);
  console.log(`车辆总数（重算后）: ${allVehicles.length}`);
  console.log(`耗时: ${Date.now() - startedAt} ms`);
}

migrate()
  .catch((err) => {
    console.error('迁移脚本异常:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
