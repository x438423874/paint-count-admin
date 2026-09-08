import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { Prisma, PaintVehicle } from '@prisma/client';
import { PaginationResult, pageArgs } from '@lib/shared/prisma/pagination';
import { CreateVehicleDto, UpdateVehicleDto, PageVehicleDto, UpsertVehicleByPlateDto } from '../vehicle/dto/vehicle.dto';
import { toPaintCents } from './paint-calculation';

/** 车辆主数据中可由工单回写的字段 */
export type VehicleFieldKey = 'vin' | 'carModel' | 'brand' | 'customerName' | 'phone' | 'contactPerson';

/**
 * upsert 车辆主数据的写入策略
 */
export interface UpsertVehicleOptions {
  /**
   * 需要强制覆盖的字段。
   *
   * 列在这里的字段，其值来自**用户的显式编辑**（如工单编辑/OCR 修正时提交的车型），
   * 即使车辆主数据里已有值，也以本次提交为准。
   *
   * 未列出的字段仍走智能合并（只补全空值 / 更完整的值），
   * 避免批量导入、OCR 自动建单这类自动化写入把主数据改坏。
   *
   * 注意：空值永远不覆盖主数据，无论是否在列表中。
   */
  overwriteFields?: VehicleFieldKey[];
}

/** 由工单事实数据重算出的车辆统计 */
interface VehicleStatRow {
  vehicleId: string;
  orderCount: number | string;
  paintCount: number | string | null;
  lastOrderAt: Date | string | null;
  lastShopId: string | null;
}

@Injectable()
export class PaintVehicleService {
  private readonly logger = new Logger(PaintVehicleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 标准化车牌号：去前后空格 + 转大写
   * 与前端校验逻辑（value.trim().toUpperCase()）保持一致
   */
  static normalizePlate(plate: string): string {
    return (plate || '').trim().toUpperCase();
  }

  async create(dto: CreateVehicleDto) {
    const plateNumber = PaintVehicleService.normalizePlate(dto.plateNumber);
    await this.assertPlateNotExists(plateNumber);

    return this.prisma.paintVehicle.create({
      data: {
        plateNumber,
        vin: dto.vin?.trim() || null,
        carModel: dto.carModel?.trim() || '',
        brand: dto.brand?.trim() || null,
        customerName: dto.customerName?.trim() || '',
        phone: dto.phone?.trim() || null,
        contactPerson: dto.contactPerson?.trim() || null,
        remark: dto.remark?.trim() || null,
      },
    });
  }

  /**
   * 更新车辆主数据。
   * @returns 更新后的车辆 + syncedOrderCount（本次同步到历史工单的条数，未勾选时为 0）
   */
  async update(dto: UpdateVehicleDto): Promise<PaintVehicle & { syncedOrderCount: number }> {
    const existing = await this.prisma.paintVehicle.findUnique({ where: { id: dto.id } });
    if (!existing) throw new NotFoundException('车辆不存在');

    // 若变更车牌号，校验新车牌是否已被其他车辆占用
    if (dto.plateNumber !== undefined) {
      const newPlate = PaintVehicleService.normalizePlate(dto.plateNumber);
      if (newPlate !== existing.plateNumber) {
        const conflict = await this.prisma.paintVehicle.findUnique({ where: { plateNumber: newPlate } });
        if (conflict && conflict.id !== dto.id) {
          throw new BadRequestException(`车牌号 ${newPlate} 已存在`);
        }
      }
    }

    const data: Prisma.PaintVehicleUpdateInput = {};
    if (dto.plateNumber !== undefined) data.plateNumber = PaintVehicleService.normalizePlate(dto.plateNumber);
    if (dto.vin !== undefined) data.vin = dto.vin?.trim() || null;
    if (dto.carModel !== undefined) data.carModel = dto.carModel?.trim() || '';
    if (dto.brand !== undefined) data.brand = dto.brand?.trim() || null;
    if (dto.customerName !== undefined) data.customerName = dto.customerName?.trim() || '';
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.contactPerson !== undefined) data.contactPerson = dto.contactPerson?.trim() || null;
    if (dto.remark !== undefined) data.remark = dto.remark?.trim() || null;

    const vehicle = await this.prisma.paintVehicle.update({
      where: { id: dto.id },
      data,
    });

    // 显式同步：勾选后，将本次修改的车辆字段同步到该车所有历史工单的冗余字段。
    // 仅同步被修改的字段，避免误覆盖用户未动过的信息；未勾选则不级联。
    let syncedOrderCount = 0;
    if (dto.syncToOrders) {
      const syncData: Prisma.PaintWorkOrderUpdateManyMutationInput = {};
      if (dto.plateNumber !== undefined) syncData.plateNumber = PaintVehicleService.normalizePlate(dto.plateNumber);
      if (dto.vin !== undefined) syncData.vin = dto.vin?.trim() || null;
      if (dto.carModel !== undefined) syncData.carModel = dto.carModel?.trim() || '';
      if (dto.brand !== undefined) syncData.brand = dto.brand?.trim() || null;
      if (dto.customerName !== undefined) syncData.customerName = dto.customerName?.trim() || '';
      if (dto.phone !== undefined) syncData.phone = dto.phone?.trim() || null;
      if (dto.contactPerson !== undefined) syncData.contactPerson = dto.contactPerson?.trim() || null;

      if (Object.keys(syncData).length > 0) {
        const result = await this.prisma.paintWorkOrder.updateMany({
          where: { vehicleId: dto.id },
          data: syncData,
        });
        syncedOrderCount = result.count;
        if (syncedOrderCount > 0) {
          this.logger.log(`车辆 ${vehicle.plateNumber} 同步 ${syncedOrderCount} 张工单的车辆信息`);
        }
      }
    }

    return { ...vehicle, syncedOrderCount };
  }

  async delete(id: string) {
    const existing = await this.prisma.paintVehicle.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('车辆不存在');

    // 关联工单的 vehicleId 由 onDelete: SetNull 自动置空，工单数据不会删除
    const orderCount = await this.prisma.paintWorkOrder.count({ where: { vehicleId: id } });
    if (orderCount > 0) {
      this.logger.log(`删除车辆 ${existing.plateNumber}，关联的 ${orderCount} 张工单的 vehicleId 将自动置空`);
    }

    return this.prisma.paintVehicle.delete({ where: { id } });
  }

  async findById(id: string) {
    const vehicle = await this.prisma.paintVehicle.findUnique({
      where: { id },
      include: {
        orders: {
          select: { id: true, orderNo: true, orderDate: true, status: true, totalPaintCount: true, shopId: true, shop: { select: { id: true, name: true } } },
          orderBy: { orderDate: 'desc' },
          take: 5,
        },
      },
    });
    if (!vehicle) return null;
    // 扁平化输出 lastShopName
    return {
      ...vehicle,
      lastShopName: vehicle.orders.find((o) => o.shopId === vehicle.lastShopId)?.shop?.name || null,
    };
  }

  /**
   * 按车牌号查询车辆（工单表单自动填充用）
   * 车牌统一大写查询
   */
  async findByPlateNumber(plateNumber: string) {
    const plate = PaintVehicleService.normalizePlate(plateNumber);
    if (!plate) return null;
    return this.prisma.paintVehicle.findUnique({
      where: { plateNumber: plate },
      include: {
        orders: {
          select: { id: true, orderNo: true, orderDate: true, status: true, totalPaintCount: true },
          orderBy: { orderDate: 'desc' },
          take: 3,
        },
      },
    });
  }

  /**
   * 列表查询（精简，用于下拉/联想）
   */
  async list(keyword: string, accessibleShopIds?: string[] | null) {
    const where: Prisma.PaintVehicleWhereInput = {};
    if (keyword && keyword.trim()) {
      const kw = keyword.trim();
      where.OR = [
        { plateNumber: { contains: kw } },
        { customerName: { contains: kw } },
        { phone: { contains: kw } },
        { vin: { contains: kw } },
      ];
    }
    // 数据权限：仅返回在用户有权访问的门店出现过的车辆
    // null/undefined = 不限制；空数组 = 无绑定门店
    if (accessibleShopIds != null) {
      if (accessibleShopIds.length === 0) return [];
      where.orders = { some: { shopId: { in: accessibleShopIds } } };
    }

    return this.prisma.paintVehicle.findMany({
      where,
      orderBy: { lastOrderAt: 'desc' },
      take: 20,
      select: {
        id: true,
        plateNumber: true,
        carModel: true,
        brand: true,
        customerName: true,
        phone: true,
        totalOrderCount: true,
        lastOrderAt: true,
      },
    });
  }

  async page(dto: PageVehicleDto, accessibleShopIds?: string[] | null): Promise<PaginationResult<any>> {
    const { current, size, skip, take } = pageArgs(dto.current, dto.size);

    const where: Prisma.PaintVehicleWhereInput = {
      ...(dto.plateNumber && { plateNumber: { contains: PaintVehicleService.normalizePlate(dto.plateNumber) } }),
      ...(dto.customerName && { customerName: { contains: dto.customerName.trim() } }),
      ...(dto.phone && { phone: { contains: dto.phone.trim() } }),
      ...(dto.vin && { vin: { contains: dto.vin.trim().toUpperCase() } }),
    };

    // 数据权限：accessibleShopIds 为 null/undefined 表示不限制（超管/财务）
    // 数组表示限制到这些门店出现过；空数组表示无绑定门店，返回空结果
    const shopIdFilter: string[] | null | undefined = dto.shopId ? [dto.shopId] : accessibleShopIds;
    if (shopIdFilter != null) {
      if (shopIdFilter.length === 0) {
        // 无绑定门店，直接返回空
        return { current, size, total: 0, records: [] };
      }
      where.orders = { some: { shopId: { in: shopIdFilter } } };
    }

    const [records, total] = await Promise.all([
      this.prisma.paintVehicle.findMany({
        where,
        skip,
        take,
        orderBy: { lastOrderAt: 'desc' },
        include: {
          orders: {
            where: shopIdFilter != null && shopIdFilter.length > 0
              ? { shopId: { in: shopIdFilter } }
              : undefined,
            select: { shopId: true, shop: { select: { id: true, name: true } } },
            distinct: ['shopId'],
            take: 5,
          },
        },
      }),
      this.prisma.paintVehicle.count({ where }),
    ]);

    // 扁平化输出 lastShopName
    const formattedRecords = records.map((v) => ({
      ...v,
      lastShopName: v.orders.find((o) => o.shopId === v.lastShopId)?.shop?.name || null,
    }));

    return { current, size, total, records: formattedRecords };
  }

  /**
   * 工单创建/编辑时调用：按车牌 upsert 车辆主数据，返回 vehicleId
   * 传入 Prisma 事务客户端，确保与工单创建在同一事务内
   *
   * 关键约束：
   * - 车牌统一大写 + trim
   * - 空字符串不覆盖已有非空值
   * - 更新 lastOrderAt / lastShopId 统计字段
   * - options.overwriteFields 中列出的字段以本次提交为准强制覆盖
   */
  async upsertByPlateWithTx(
    tx: Prisma.TransactionClient,
    dto: UpsertVehicleByPlateDto,
    shopId: string,
    orderDate?: Date,
    options?: UpsertVehicleOptions,
  ): Promise<string> {
    const plate = PaintVehicleService.normalizePlate(dto.plateNumber);
    if (!plate) throw new BadRequestException('车牌号不能为空');

    // 先查找已有车辆，以便做智能合并（优先更完整的值）
    const existing = await tx.paintVehicle.findUnique({ where: { plateNumber: plate } });

    // 默认（非强制覆盖）走的智能合并策略：仅当新值更完整时才覆盖已有数据
    // carModel/brand: 优先更长的值（更具体，如"海豹06DM-i" > "海豹"）
    // vin/customerName/phone/contactPerson: 仅填充空字段，不覆盖已有值
    const smartUpdate = (currentVal: string | null, newVal: string | undefined): string | undefined => {
      const cur = (currentVal || '').trim();
      const nv = (newVal || '').trim();
      if (!nv) return undefined; // 新值为空，不更新
      if (!cur) return nv; // 当前值为空，用新值
      if (nv.length > cur.length) return nv; // 新值更长（更具体），用新值
      return undefined; // 新值不比当前值更完整，保留当前值
    };

    const fillIfEmpty = (currentVal: string | null, newVal: string | undefined): string | undefined => {
      const cur = (currentVal || '').trim();
      const nv = (newVal || '').trim();
      if (!nv) return undefined;
      if (!cur) return nv;
      return undefined; // 已有值，不覆盖
    };

    const overwrite = new Set<VehicleFieldKey>(options?.overwriteFields ?? []);

    /**
     * 决定某个字段的最终取值：
     * - 新值为空：一律不写，避免把主数据清空
     * - 在 overwriteFields 中：用户显式编辑，强制以新值为准
     * - 否则：走智能合并（smartUpdate / fillIfEmpty）
     */
    const resolveField = (
      key: VehicleFieldKey,
      currentVal: string | null,
      newVal: string | undefined,
      merge: (cur: string | null, nv: string | undefined) => string | undefined,
    ): string | undefined => {
      const nv = (newVal || '').trim();
      if (!nv) return undefined;
      if (overwrite.has(key)) return nv;
      return merge(currentVal, newVal);
    };

    const updateData: Prisma.PaintVehicleUpdateInput = {
      lastOrderAt: orderDate || new Date(),
      lastShopId: shopId,
    };
    if (existing) {
      const v = resolveField('carModel', existing.carModel, dto.carModel, smartUpdate); if (v) updateData.carModel = v;
      const b = resolveField('brand', existing.brand, dto.brand, smartUpdate); if (b) updateData.brand = b;
      const vi = resolveField('vin', existing.vin, dto.vin, fillIfEmpty); if (vi) updateData.vin = vi;
      const cn = resolveField('customerName', existing.customerName, dto.customerName, fillIfEmpty); if (cn) updateData.customerName = cn;
      const ph = resolveField('phone', existing.phone, dto.phone, fillIfEmpty); if (ph) updateData.phone = ph;
      const cp = resolveField('contactPerson', existing.contactPerson, dto.contactPerson, fillIfEmpty); if (cp) updateData.contactPerson = cp;
    } else {
      // 新建车辆：所有非空字段都写入
      if (dto.carModel?.trim()) updateData.carModel = dto.carModel.trim();
      if (dto.brand?.trim()) updateData.brand = dto.brand.trim();
      if (dto.vin?.trim()) updateData.vin = dto.vin.trim();
      if (dto.customerName?.trim()) updateData.customerName = dto.customerName.trim();
      if (dto.phone?.trim()) updateData.phone = dto.phone.trim();
      if (dto.contactPerson?.trim()) updateData.contactPerson = dto.contactPerson.trim();
    }

    const createData: Prisma.PaintVehicleCreateInput = {
      plateNumber: plate,
      vin: dto.vin?.trim() || null,
      carModel: dto.carModel?.trim() || '',
      brand: dto.brand?.trim() || null,
      customerName: dto.customerName?.trim() || '',
      phone: dto.phone?.trim() || null,
      contactPerson: dto.contactPerson?.trim() || null,
      lastOrderAt: orderDate || new Date(),
      lastShopId: shopId,
    };

    const vehicle = existing
      ? await tx.paintVehicle.update({ where: { id: existing.id }, data: updateData })
      : await tx.paintVehicle.create({ data: createData });

    return vehicle.id;
  }

  /**
   * 重新聚合车辆统计字段：totalOrderCount / totalPaintCount / lastOrderAt / lastShopId
   * 在工单创建/状态变更/删除后调用以保持统计准确
   */
  async refreshStats(vehicleId: string): Promise<void> {
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: { vehicleId, status: { not: 'VOID' as any } },
      select: { totalPaintCount: true, orderDate: true, createdAt: true, shopId: true, isRework: true },
      orderBy: { orderDate: 'desc' },
    });

    if (orders.length === 0) {
      // 没有关联工单，统计清零
      await this.prisma.paintVehicle.update({
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

    // 返工工单照常计入 totalOrderCount，但其 totalPaintCount 仍然计入（与系统总幅数计算区分）
    const totalPaintCount = orders.reduce((sum, o) => sum.add(o.totalPaintCount), new Prisma.Decimal(0));
    const latest = orders[0];

    await this.prisma.paintVehicle.update({
      where: { id: vehicleId },
      data: {
        totalOrderCount: orders.length,
        totalPaintCount: totalPaintCount,
        lastOrderAt: latest.orderDate || latest.createdAt,
        lastShopId: latest.shopId,
      },
    });
  }

  /**
   * 归一化历史工单的车牌号（trim + 大写）
   *
   * 工单写入路径原本未做归一化，存量的 `粤a123` / `粤A123` 会在
   * "按车牌去重统计车辆数"时被算成多台车，导致总车次、台均幅数虚高。
   * 写入路径已修复，这里负责修复存量数据。
   */
  async normalizeLegacyPlateNumbers(): Promise<number> {
    const affected = await this.prisma.$executeRaw`
      UPDATE paint_work_order
      SET plate_number = UPPER(TRIM(plate_number))
      WHERE plate_number IS NOT NULL
        AND plate_number <> ''
        AND plate_number <> UPPER(TRIM(plate_number))
    `;
    return Number(affected);
  }

  /**
   * 以工单为事实来源，重算车辆的统计快照
   *
   * 只统计有工单的车辆；无工单的车辆在 reconcileStats 中按 0 处理。
   * 口径与 refreshStats 一致：排除作废单，返工单计入工单数与幅数。
   */
  private async queryVehicleStatsFromOrders(vehicleIds: string[]): Promise<VehicleStatRow[]> {
    if (vehicleIds.length === 0) return [];
    return this.prisma.$queryRaw<VehicleStatRow[]>`
      SELECT
        agg.vehicle_id AS vehicleId,
        agg.order_count AS orderCount,
        agg.paint_count AS paintCount,
        agg.last_at AS lastOrderAt,
        last_o.shop_id AS lastShopId
      FROM (
        SELECT
          vehicle_id,
          COUNT(*) AS order_count,
          COALESCE(SUM(total_paint_count), 0) AS paint_count,
          MAX(COALESCE(order_date, created_at)) AS last_at
        FROM paint_work_order
        WHERE vehicle_id IN (${Prisma.join(vehicleIds)}) AND status <> 'VOID'
        GROUP BY vehicle_id
      ) agg
      INNER JOIN paint_work_order last_o ON last_o.id = (
        SELECT o2.id
        FROM paint_work_order o2
        WHERE o2.vehicle_id = agg.vehicle_id AND o2.status <> 'VOID'
        ORDER BY o2.order_date DESC, o2.created_at DESC, o2.id DESC
        LIMIT 1
      )
    `;
  }

  /**
   * 车辆统计对账（供定时任务调用）
   *
   * refreshStats 在工单写操作后是异步补偿执行、失败只打日志，
   * 长此以往 PaintVehicle 的统计会与工单真实数据永久偏离且无人发现。
   * 这里以工单为唯一事实来源批量重算，只更新发生偏离的记录。
   *
   * @returns 检查车辆数、修复车辆数、修复的历史车牌数
   */
  async reconcileStats(batchSize = 500): Promise<{ checked: number; fixed: number; fixedPlates: number }> {
    const fixedPlates = await this.normalizeLegacyPlateNumbers();

    let checked = 0;
    let fixed = 0;
    let cursor: string | null = null;

    for (;;) {
      const query: Prisma.PaintVehicleFindManyArgs = {
        select: { id: true, totalOrderCount: true, totalPaintCount: true, lastOrderAt: true, lastShopId: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      };
      if (cursor) {
        query.cursor = { id: cursor };
        query.skip = 1;
      }
      const vehicles = await this.prisma.paintVehicle.findMany(query);
      if (vehicles.length === 0) break;

      const statMap = new Map(
        (await this.queryVehicleStatsFromOrders(vehicles.map(v => v.id))).map(s => [s.vehicleId, s]),
      );

      for (const vehicle of vehicles) {
        const stat = statMap.get(vehicle.id);
        const expectedOrderCount = stat ? Number(stat.orderCount) : 0;
        const expectedPaintCents = toPaintCents(stat?.paintCount);
        const expectedLastAt = stat?.lastOrderAt ? new Date(stat.lastOrderAt) : null;
        const expectedShopId = stat?.lastShopId ?? null;
        checked += 1;

        const data: Prisma.PaintVehicleUpdateInput = {};
        if (vehicle.totalOrderCount !== expectedOrderCount) {
          data.totalOrderCount = expectedOrderCount;
        }
        if (toPaintCents(vehicle.totalPaintCount) !== expectedPaintCents) {
          data.totalPaintCount = new Prisma.Decimal(expectedPaintCents).dividedBy(100);
        }
        if ((vehicle.lastOrderAt?.getTime() ?? null) !== (expectedLastAt?.getTime() ?? null)) {
          data.lastOrderAt = expectedLastAt;
        }
        if ((vehicle.lastShopId ?? null) !== expectedShopId) {
          data.lastShopId = expectedShopId;
        }

        if (Object.keys(data).length === 0) continue;
        await this.prisma.paintVehicle.update({ where: { id: vehicle.id }, data });
        fixed += 1;
      }

      if (vehicles.length < batchSize) break;
      cursor = vehicles[vehicles.length - 1].id;
    }

    if (fixedPlates > 0) {
      this.logger.log(`归一化历史工单车牌 ${fixedPlates} 条`);
    }
    if (fixed > 0) {
      this.logger.warn(`车辆统计对账：检查 ${checked} 台，修复偏离 ${fixed} 台`);
    }
    return { checked, fixed, fixedPlates };
  }

  /**
   * 查询车辆历史工单 + 统计摘要
   * @param scope 'all_shops' 默认查全部有权门店；'current_shop' 仅指定门店
   */
  async getHistoryOrders(
    vehicleId: string,
    accessibleShopIds: string[] | null,
    options: { current?: number; size?: number; scope?: 'current_shop' | 'all_shops'; shopId?: string },
  ): Promise<{ records: any[]; total: number; summary: any }> {
    const { current, size, skip, take } = pageArgs(options.current, options.size, 20);
    const scope = options.scope || 'all_shops';

    const where: Prisma.PaintWorkOrderWhereInput = { vehicleId, status: { not: 'VOID' as any } };

    // 数据权限：accessibleShopIds 为 null 表示不限制（超管/财务）
    if (accessibleShopIds !== null) {
      const shopFilter = scope === 'current_shop' && options.shopId ? [options.shopId] : accessibleShopIds;
      if (shopFilter) {
        where.shopId = { in: shopFilter };
      }
    }

    const [records, total, allOrders] = await Promise.all([
      this.prisma.paintWorkOrder.findMany({
        where,
        skip,
        take,
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          shop: { select: { id: true, name: true } },
          items: { select: { id: true, paintCount: true, quantity: true } },
        },
      }),
      this.prisma.paintWorkOrder.count({ where }),
      this.prisma.paintWorkOrder.findMany({
        where: { vehicleId, ...(accessibleShopIds !== null ? { shopId: { in: accessibleShopIds } } : {}) },
        select: { totalPaintCount: true, orderDate: true, createdAt: true, shopId: true, isRework: true, status: true },
        orderBy: { orderDate: 'asc' },
      }),
    ]);

    // 统计摘要
    const summary = {
      totalOrders: allOrders.length,
      totalPaintCount: allOrders.reduce((sum, o) => sum.add(o.totalPaintCount), new Prisma.Decimal(0)).toNumber(),
      firstOrderAt: allOrders[0]?.orderDate || allOrders[0]?.createdAt || null,
      lastOrderAt: allOrders[allOrders.length - 1]?.orderDate || allOrders[allOrders.length - 1]?.createdAt || null,
      shopCount: new Set(allOrders.map((o) => o.shopId)).size,
      reworkCount: allOrders.filter((o) => o.isRework).length,
      abnormalCount: allOrders.filter((o) => o.status === 'ABNORMAL').length,
    };

    return { records, total, summary };
  }

  private async assertPlateNotExists(plateNumber: string) {
    const existing = await this.prisma.paintVehicle.findUnique({ where: { plateNumber } });
    if (existing) {
      throw new BadRequestException(`车牌号 ${plateNumber} 已存在`);
    }
  }
}
