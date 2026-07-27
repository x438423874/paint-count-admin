import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { PaginationResult } from '@lib/shared/prisma/pagination';
import { CreateVehicleDto, UpdateVehicleDto, PageVehicleDto, UpsertVehicleByPlateDto } from '../vehicle/dto/vehicle.dto';

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

  async update(dto: UpdateVehicleDto) {
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

    return this.prisma.paintVehicle.update({
      where: { id: dto.id },
      data,
    });
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
    const current = dto.current ?? 1;
    const size = dto.size ?? 10;

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
        skip: (current - 1) * size,
        take: size,
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
   */
  async upsertByPlateWithTx(
    tx: Prisma.TransactionClient,
    dto: UpsertVehicleByPlateDto,
    shopId: string,
    orderDate?: Date,
  ): Promise<string> {
    const plate = PaintVehicleService.normalizePlate(dto.plateNumber);
    if (!plate) throw new BadRequestException('车牌号不能为空');

    // 先查找已有车辆，以便做智能合并（优先更完整的值）
    const existing = await tx.paintVehicle.findUnique({ where: { plateNumber: plate } });

    // 智能合并：仅当新值更完整时才覆盖已有数据
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

    const updateData: Prisma.PaintVehicleUpdateInput = {
      lastOrderAt: orderDate || new Date(),
      lastShopId: shopId,
    };
    if (existing) {
      const v = smartUpdate(existing.carModel, dto.carModel); if (v) updateData.carModel = v;
      const b = smartUpdate(existing.brand, dto.brand); if (b) updateData.brand = b;
      const vi = fillIfEmpty(existing.vin, dto.vin); if (vi) updateData.vin = vi;
      const cn = fillIfEmpty(existing.customerName, dto.customerName); if (cn) updateData.customerName = cn;
      const ph = fillIfEmpty(existing.phone, dto.phone); if (ph) updateData.phone = ph;
      const cp = fillIfEmpty(existing.contactPerson, dto.contactPerson); if (cp) updateData.contactPerson = cp;
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
      where: { vehicleId },
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
   * 查询车辆历史工单 + 统计摘要
   * @param scope 'all_shops' 默认查全部有权门店；'current_shop' 仅指定门店
   */
  async getHistoryOrders(
    vehicleId: string,
    accessibleShopIds: string[] | null,
    options: { current?: number; size?: number; scope?: 'current_shop' | 'all_shops'; shopId?: string },
  ): Promise<{ records: any[]; total: number; summary: any }> {
    const current = options.current ?? 1;
    const size = options.size ?? 20;
    const scope = options.scope || 'all_shops';

    const where: Prisma.PaintWorkOrderWhereInput = { vehicleId };

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
        skip: (current - 1) * size,
        take: size,
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
