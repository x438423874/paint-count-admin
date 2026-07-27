import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaginationResult } from '@lib/shared/prisma/pagination';
import { PaintImageType, PaintOrderStatus, Prisma } from '@prisma/client';
import { RedisUtility } from '@lib/shared/redis/redis.util';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { MetricsService } from '@lib/shared/metrics/metrics.service';
import { PaintImageService } from './paint-image.service';
import {
  calculatePaintCount,
  findDuplicateCategoryIds,
  formatOrderNo,
  parseOrderNoSeq,
  shouldMigrateSettlementMonth,
} from './paint-calculation';
import { CreateWorkOrderDto, UpdateWorkOrderDto, PageWorkOrderDto, WorkOrderItemDto } from '../work-order/dto/work-order.dto';
import { SettlementMonthService } from './settlement-month.service';
import { PaintVehicleService } from './paint-vehicle.service';
import { Jimp } from 'jimp';

interface OrderItemCreateData {
  categoryId: string;
  quantity: number;
  paintCount: number;
  newPartQuantity: number;
  specialPaintId?: string | null;
  specialPaintMultiplier?: number | null;
}

interface ItemDataWithOrderId extends OrderItemCreateData {
  orderId: string;
}

@Injectable()
export class WorkOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageService: PaintImageService,
    private readonly metricsService: MetricsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly settlementMonthService: SettlementMonthService,
    private readonly vehicleService: PaintVehicleService,
  ) {}

  /** 一次性查询门店标准模板项目，避免 N+1 */
  private async getShopTemplateItemMap(shopId: string): Promise<Map<string, { coefficient: number; newPartAddition: number }>> {
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      include: {
        standardTemplate: {
          include: { items: true },
        },
      },
    });

    const map = new Map<string, { coefficient: number; newPartAddition: number }>();
    for (const item of shop?.standardTemplate?.items || []) {
      map.set(item.categoryId, {
        coefficient: Number(item.coefficient),
        newPartAddition: Number(item.newPartAddition),
      });
    }
    return map;
  }

  /** 一次性查询多个特殊车漆，避免 N+1 */
  private async getSpecialPaintMap(specialPaintIds: string[]): Promise<Map<string, { id: string; multiplier: number }>> {
    const map = new Map<string, { id: string; multiplier: number }>();
    const uniqueIds = [...new Set(specialPaintIds.filter(Boolean))];
    if (uniqueIds.length === 0) return map;

    const paints = await this.prisma.paintSpecialPaint.findMany({
      where: { id: { in: uniqueIds }, isActive: true },
    });
    for (const paint of paints) {
      map.set(paint.id, { id: paint.id, multiplier: Number(paint.multiplier) });
    }
    return map;
  }

  /** 批量计算项目幅数，避免每个 item 单独查询数据库 */
  private calculateItemsPaintCount(
    items: WorkOrderItemDto[],
    templateItemMap: Map<string, { coefficient: number; newPartAddition: number }>,
    specialPaintMap: Map<string, { id: string; multiplier: number }>,
  ): OrderItemCreateData[] {
    return items.map(item => {
      // 手动覆盖幅数：直接使用用户指定的值，跳过自动计算
      if (item.overridePaintCount !== undefined && item.overridePaintCount !== null) {
        const specialPaint = item.specialPaintId ? specialPaintMap.get(item.specialPaintId) : null;
        const specialPaintId = specialPaint ? specialPaint.id : null;
        const specialPaintMultiplier = specialPaint ? specialPaint.multiplier : null;

        return {
          categoryId: item.categoryId,
          quantity: item.quantity || 1,
          paintCount: item.overridePaintCount,
          newPartQuantity: item.newPartQuantity || 0,
          specialPaintId,
          specialPaintMultiplier,
        };
      }

      const templateItem = templateItemMap.get(item.categoryId);
      const coefficient = templateItem?.coefficient ?? 0;
      const newPartAddition = templateItem?.newPartAddition ?? 0;

      const specialPaint = item.specialPaintId ? specialPaintMap.get(item.specialPaintId) : null;
      const specialPaintMultiplier = specialPaint ? specialPaint.multiplier : null;
      const specialPaintId = specialPaint ? specialPaint.id : null;

      const result = calculatePaintCount({
        coefficient,
        newPartAddition,
        quantity: item.quantity || 1,
        newPartQuantity: item.newPartQuantity || 0,
        specialPaintMultiplier,
      });

      return {
        categoryId: item.categoryId,
        quantity: result.quantity,
        paintCount: result.paintCount,
        newPartQuantity: result.newPartQuantity,
        specialPaintId,
        specialPaintMultiplier: result.specialPaintMultiplier,
      };
    });
  }

  async quickCreate(shopId: string, buffer: Buffer, filename: string, mimetype: string, settlementMonth?: string, plateNumber?: string, ocrOrderNo?: string, thumbnailBuffer?: Buffer | null, customerName?: string, phone?: string, carModel?: string, vin?: string, brand?: string, orderDate?: string, ocrItems?: { categoryId: string; quantity: number; newPartQuantity: number }[]) {
    const finalOrderDate: Date | null = orderDate ? new Date(orderDate) : null;

    // 先保存图片文件（事务外操作，不涉及数据库一致性）
    const url = await this.imageService.saveImageFile(buffer, filename, shopId, settlementMonth);
    let thumbnailUrl: string | undefined;
    if (thumbnailBuffer) {
      thumbnailUrl = await this.imageService.saveImageFile(thumbnailBuffer, `thumb_${filename}`, shopId, settlementMonth);
    }

    // 预计算 OCR 部位项目的幅数（事务外查询模板）
    let calculatedItems: OrderItemCreateData[] = [];
    if (ocrItems && ocrItems.length > 0) {
      const templateItemMap = await this.getShopTemplateItemMap(shopId);
      calculatedItems = ocrItems.map(item => {
        const templateItem = templateItemMap.get(item.categoryId);
        const coefficient = templateItem?.coefficient ?? 0;
        const newPartAddition = templateItem?.newPartAddition ?? 0;
        const result = calculatePaintCount({
          coefficient,
          newPartAddition,
          quantity: item.quantity || 1,
          newPartQuantity: item.newPartQuantity || 0,
          specialPaintMultiplier: null,
        });
        return {
          categoryId: item.categoryId,
          quantity: result.quantity,
          paintCount: result.paintCount,
          newPartQuantity: result.newPartQuantity,
          specialPaintId: null,
          specialPaintMultiplier: null,
        };
      });
    }
    const totalPaintCount = calculatedItems.reduce((sum, item) => sum + item.paintCount, 0);

    // 在事务内创建工单（批量上传时不自动生成工单号，等OCR填充）
    const order = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 按车牌号 upsert 车辆主数据（自动沉淀，全局唯一）
      let vehicleId: string | undefined;
      if (plateNumber && plateNumber.trim()) {
        vehicleId = await this.vehicleService.upsertByPlateWithTx(tx, {
          plateNumber: plateNumber.slice(0, 50),
          vin: vin || undefined,
          carModel: carModel || undefined,
          brand: brand || undefined,
          customerName: customerName || undefined,
          phone: phone || undefined,
        }, shopId, finalOrderDate || undefined);
      }

      const created = await tx.paintWorkOrder.create({
        data: {
          orderNo: ocrOrderNo || null,
          shopId,
          orderDate: finalOrderDate,
          plateNumber: (plateNumber || '').slice(0, 50),
          carModel: carModel || '',
          vin: vin || '',
          brand: brand || '',
          customerName: customerName || '',
          phone: phone || '',
          vehicleId: vehicleId || null,
          totalPaintCount,
          status: 'PENDING',
          settlementMonth: settlementMonth || null,
        },
        include: { items: { include: { category: true, specialPaint: true } }, shop: true },
      });

      await tx.paintWorkOrderImage.create({
        data: { orderId: created.id, url, thumbnailUrl, imageType: PaintImageType.BEFORE, fileSize: buffer.length },
      });

      // 创建 OCR 识别的部位项目
      if (calculatedItems.length > 0) {
        await tx.paintWorkOrderItem.createMany({
          data: calculatedItems.map(item => ({ orderId: created.id, ...item })),
        });
      }

      return created;
    });

    // 事务提交后异步刷新车辆统计（不阻塞主流程）
    if (plateNumber && plateNumber.trim()) {
      this.vehicleService.refreshStats(order.vehicleId || '').catch((e) => {
        this.logger?.error?.(`刷新车辆统计失败: ${e instanceof Error ? e.message : e}`);
      });
    }

    return this.findById(order.id);
  }

  async create(dto: CreateWorkOrderDto) {
    let totalPaintCount = 0;
    const itemsData: OrderItemCreateData[] = [];

    if (dto.items?.length) {
      const categoryIds = dto.items.map(i => i.categoryId);
      const duplicates = findDuplicateCategoryIds(categoryIds);
      if (duplicates.length > 0) {
        throw new BadRequestException('不能重复选择同一部位');
      }

      const [templateItemMap, specialPaintMap] = await Promise.all([
        this.getShopTemplateItemMap(dto.shopId),
        this.getSpecialPaintMap(dto.items.map(i => i.specialPaintId).filter((id): id is string => Boolean(id))),
      ]);
      itemsData.push(...this.calculateItemsPaintCount(dto.items, templateItemMap, specialPaintMap));
      totalPaintCount = itemsData.reduce((sum, item) => sum + item.paintCount, 0);
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 按车牌号 upsert 车辆主数据（自动沉淀，全局唯一）
      let vehicleId: string | undefined;
      const orderDateObj = dto.orderDate ? new Date(dto.orderDate) : new Date();
      if (dto.plateNumber && dto.plateNumber.trim()) {
        vehicleId = await this.vehicleService.upsertByPlateWithTx(tx, {
          plateNumber: dto.plateNumber.slice(0, 50),
          vin: dto.vin || undefined,
          carModel: dto.carModel || undefined,
          brand: dto.brand || undefined,
          customerName: dto.customerName || undefined,
          phone: dto.phone || undefined,
          contactPerson: dto.contactPerson || undefined,
        }, dto.shopId, orderDateObj);
      }

      const orderNo = dto.orderNo || null;
      const order = await tx.paintWorkOrder.create({
        data: {
          orderNo,
          shopId: dto.shopId,
          orderDate: orderDateObj,
          settlementMonth: dto.settlementMonth || null,
          carModel: dto.carModel,
          plateNumber: dto.plateNumber ? dto.plateNumber.slice(0, 50) : dto.plateNumber,
          vin: dto.vin,
          brand: dto.brand,
          customerName: dto.customerName,
          phone: dto.phone,
          contactPerson: dto.contactPerson,
          description: dto.description,
          vehicleId: vehicleId || null,
          totalPaintCount,
          remark: dto.remark,
          status: 'DRAFT' as PaintOrderStatus,
          items: { create: itemsData },
        },
        include: { items: { include: { category: true, specialPaint: true } }, shop: true },
      });
      this.metricsService.recordWorkOrderCreation(dto.shopId, 'manual');

      // 事务提交后异步刷新车辆统计
      if (vehicleId) {
        this.vehicleService.refreshStats(vehicleId).catch((e) => {
          this.logger?.error?.(`刷新车辆统计失败: ${e instanceof Error ? e.message : e}`);
        });
      }

      return order;
    });
  }

  async update(dto: UpdateWorkOrderDto) {
    const existing = await this.prisma.paintWorkOrder.findUnique({
      where: { id: dto.id },
    });
    if (!existing) throw new NotFoundException('工单不存在');

    // 封单校验
    const month = existing.settlementMonth || this.getMonthFromDate(existing.orderDate);
    if (month) await this.settlementMonthService.assertNotSealed(existing.shopId, month);

    const audited = existing.status === 'AUDITED' || existing.status === 'SETTLED' || existing.status === 'ABNORMAL';

    // 已审核（含已结算、异常）的工单只允许修正 OCR 基础字段或返工标记，不能修改项目、门店、结算月份等
    const safeOcrFields = ['orderNo', 'plateNumber', 'customerName', 'phone', 'carModel', 'vin', 'brand', 'orderDate'] as const;
    const unsafeFields = ['shopId', 'settlementMonth', 'contactPerson', 'description', 'remark', 'items'] as const;
    const hasUnsafeField = unsafeFields.some(field => dto[field] !== undefined);
    const isOcrCorrection = safeOcrFields.some(field => dto[field] !== undefined);
    const isReworkUpdate = dto.isRework !== undefined || dto.reworkRemark !== undefined;

    if (audited && hasUnsafeField) {
      throw new BadRequestException('已审核的工单只允许修正车牌号、工单号等基础信息');
    }

    if (audited && !isOcrCorrection && !isReworkUpdate) {
      throw new BadRequestException('已审核的工单只允许修正车牌号、工单号等基础信息');
    }

    const updateData: Prisma.PaintWorkOrderUpdateInput = {
      carModel: dto.carModel,
      plateNumber: dto.plateNumber ? dto.plateNumber.slice(0, 50) : dto.plateNumber,
      customerName: dto.customerName,
      phone: dto.phone,
      contactPerson: dto.contactPerson,
      description: dto.description,
      remark: dto.remark,
      isRework: dto.isRework,
      reworkRemark: dto.reworkRemark ? dto.reworkRemark.slice(0, 200) : dto.reworkRemark,
    };

    // 支持编辑工单号（OCR识别可能有误）
    if (dto.orderNo !== undefined) {
      updateData.orderNo = dto.orderNo;
    }

    // 支持编辑工单日期
    if (dto.orderDate !== undefined) {
      updateData.orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
    }

    // 支持编辑门店
    if (dto.shopId !== undefined) {
      updateData.shop = { connect: { id: dto.shopId } };
    }

    // 支持编辑车架号
    if (dto.vin !== undefined) {
      updateData.vin = dto.vin;
    }

    // 支持编辑品牌
    if (dto.brand !== undefined) {
      updateData.brand = dto.brand;
    }

    // 已审核的 OCR 修正不修改项目、结算月份和总幅数
    if (!audited) {
      // 如果更新项目，一次性查询模板和特殊车漆，避免 N+1
      let calculatedItems: OrderItemCreateData[] | undefined;
      if (dto.items?.length) {
        const categoryIds = dto.items.map(i => i.categoryId);
        const duplicates = findDuplicateCategoryIds(categoryIds);
        if (duplicates.length > 0) {
          throw new BadRequestException('不能重复选择同一部位');
        }

        const [templateItemMap, specialPaintMap] = await Promise.all([
          this.getShopTemplateItemMap(existing.shopId),
          this.getSpecialPaintMap(dto.items.map(i => i.specialPaintId).filter((id): id is string => Boolean(id))),
        ]);
        calculatedItems = this.calculateItemsPaintCount(dto.items, templateItemMap, specialPaintMap);
      }

      if (dto.settlementMonth !== undefined) {
        const oldMonth = existing.settlementMonth;
        const newMonth = dto.settlementMonth || null;
        updateData.settlementMonth = newMonth;
        // 结算月份变更时迁移图片文件
        if (shouldMigrateSettlementMonth(oldMonth, newMonth)) {
          const targetMonth = newMonth as string;
          await this.imageService.migrateImages(dto.id, oldMonth, targetMonth);
        }
      }

      if (calculatedItems) {
        const totalPaintCount = calculatedItems.reduce((sum, item) => sum + item.paintCount, 0);
        updateData.totalPaintCount = totalPaintCount;
        updateData.items = {
          deleteMany: {},
          create: calculatedItems,
        };
      } else {
        updateData.totalPaintCount = existing.totalPaintCount;
      }
    }

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 若车牌号或车辆相关字段有变更，同步 upsert 车辆主数据
      const hasVehicleFieldChange =
        dto.plateNumber !== undefined ||
        dto.vin !== undefined ||
        dto.carModel !== undefined ||
        dto.brand !== undefined ||
        dto.customerName !== undefined ||
        dto.phone !== undefined ||
        dto.contactPerson !== undefined;

      let vehicleId = existing.vehicleId;
      // 记录旧车辆ID，用于车牌变更后刷新旧车辆统计
      const oldVehicleId = existing.vehicleId;
      const plateForVehicle = dto.plateNumber !== undefined ? dto.plateNumber : existing.plateNumber;
      if (plateForVehicle && plateForVehicle.trim()) {
        const newVehicleId = await this.vehicleService.upsertByPlateWithTx(tx, {
          plateNumber: plateForVehicle.slice(0, 50),
          vin: dto.vin !== undefined ? dto.vin || undefined : (existing.vin || undefined),
          carModel: dto.carModel !== undefined ? dto.carModel || undefined : (existing.carModel || undefined),
          brand: dto.brand !== undefined ? dto.brand || undefined : (existing.brand || undefined),
          customerName: dto.customerName !== undefined ? dto.customerName || undefined : (existing.customerName || undefined),
          phone: dto.phone !== undefined ? dto.phone || undefined : (existing.phone || undefined),
          contactPerson: dto.contactPerson !== undefined ? dto.contactPerson || undefined : (existing.contactPerson || undefined),
        }, dto.shopId || existing.shopId, dto.orderDate ? new Date(dto.orderDate) : (existing.orderDate || undefined));

        if (newVehicleId !== vehicleId) {
          vehicleId = newVehicleId;
          updateData.vehicle = { connect: { id: newVehicleId } };
        }
      } else if (dto.plateNumber !== undefined && !plateForVehicle?.trim()) {
        // 用户主动清空了车牌，解除车辆关联
        updateData.vehicle = { disconnect: true };
        vehicleId = null;
      }

      // 没有任何车辆字段变更时不调用 upsert，避免无意义写入
      void hasVehicleFieldChange;

      const result = await tx.paintWorkOrder.update({
        where: { id: dto.id },
        data: updateData,
        include: { items: { include: { category: true, specialPaint: true } }, shop: true },
      });

      return { result, vehicleId, oldVehicleId };
    });

    // 事务提交后异步刷新车辆统计
    // 1) 新车辆（或未变更的当前车辆）统计刷新
    if (updated.vehicleId) {
      this.vehicleService.refreshStats(updated.vehicleId).catch((e) => {
        this.logger?.error?.(`刷新车辆统计失败: ${e instanceof Error ? e.message : e}`);
      });
    }
    // 2) 若车牌变更导致车辆切换，旧车辆统计也需刷新（移除本工单的贡献）
    if (updated.oldVehicleId && updated.oldVehicleId !== updated.vehicleId) {
      this.vehicleService.refreshStats(updated.oldVehicleId).catch((e) => {
        this.logger?.error?.(`刷新旧车辆统计失败: ${e instanceof Error ? e.message : e}`);
      });
    }

    return updated.result;
  }

  /** 设置/取消异常标注 */
  async setAbnormal(id: string, isAbnormal: boolean, abnormalRemark?: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('工单不存在');

    // 必须已审核才能标记异常
    if (existing.status !== 'AUDITED' && existing.status !== 'ABNORMAL') {
      throw new BadRequestException('工单未审核，不能标记异常');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id },
      data: {
        abnormalRemark: isAbnormal ? (abnormalRemark || null) : null,
        status: isAbnormal ? ('ABNORMAL' as any) : ('AUDITED' as any),
      },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('工单不存在');

    // 封单校验
    const delMonth = existing.settlementMonth || this.getMonthFromDate(existing.orderDate);
    if (delMonth) await this.settlementMonthService.assertNotSealed(existing.shopId, delMonth);

    // 已审核（含已结算、异常）的工单不允许删除
    if (existing.status === 'AUDITED' || existing.status === 'SETTLED' || existing.status === 'ABNORMAL') {
      throw new BadRequestException('已审核的工单不允许删除');
    }

    // 先清理关联的图片文件和数据库记录
    await this.imageService.deleteOrderImages(id);

    const vehicleIdToRefresh = existing.vehicleId;

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 删除数据库中的图片记录
      await tx.paintWorkOrderImage.deleteMany({ where: { orderId: id } });
      // 删除工单项
      await tx.paintWorkOrderItem.deleteMany({ where: { orderId: id } });
      // 删除工单（vehicleId 关系由 onDelete: SetNull 处理，但工单已删除所以无所谓）
      return tx.paintWorkOrder.delete({ where: { id } });
    });

    // 事务提交后异步刷新车辆统计（工单数 -1）
    if (vehicleIdToRefresh) {
      this.vehicleService.refreshStats(vehicleIdToRefresh).catch((e) => {
        this.logger?.error?.(`删除工单后刷新车辆统计失败: ${e instanceof Error ? e.message : e}`);
      });
    }

    return result;
  }

  /** 补充展示状态（status 已由各操作直接写入数据库，此处不再覆盖） */
  private applyDerivedStatus(record: any) {
    return record;
  }

  async findById(id: string) {
    const record = await this.prisma.paintWorkOrder.findUnique({
      where: { id },
      include: {
        items: { include: { category: true, specialPaint: true } },
        images: { orderBy: { createdAt: 'desc' } },
        shop: true,
      },
    });
    return this.applyDerivedStatus(record);
  }

  async page(
    dto: PageWorkOrderDto,
    accessibleShopIds?: string[] | null,
  ): Promise<PaginationResult<any>> {
    const current = dto.current ?? 1;
    const size = dto.size ?? 10;

    // 状态筛选：直接按 status 字段筛选
    let statusFilter: Prisma.PaintWorkOrderWhereInput = {};
    const bizStatus = dto.status;
    if (bizStatus) {
      statusFilter = { status: bizStatus as any };
    }

    // 数据权限：accessibleShopIds 为 null 表示不限制（超管/财务），数组表示限制到这些门店
    const shopIdFilter = accessibleShopIds
      ? { shopId: { in: accessibleShopIds } }
      : null;

    const where: Prisma.PaintWorkOrderWhereInput = {
      // 若用户传入 shopId，需同时满足数据权限范围
      ...(dto.shopId && { shopId: dto.shopId }),
      ...(dto.plateNumber && { plateNumber: { contains: dto.plateNumber } }),
      ...(dto.customerName && { customerName: { contains: dto.customerName } }),
      ...(dto.settlementMonth && { settlementMonth: dto.settlementMonth }),
      ...statusFilter,
      ...(dto.isRework !== undefined && { isRework: dto.isRework }),
      ...(dto.categoryId && { items: { some: { categoryId: dto.categoryId } } }),
      // 叠加数据权限过滤（与 dto.shopId 取交集）
      ...(shopIdFilter && shopIdFilter),
    };

    // 若指定了 dto.shopId 但不在 accessibleShopIds 范围内，直接返回空
    if (
      accessibleShopIds &&
      dto.shopId &&
      !accessibleShopIds.includes(dto.shopId)
    ) {
      return { current, size, total: 0, records: [] };
    }

    // 并行：1) 轻量字段查询用于重复识别和排序 2) 总幅数聚合 3) 总数 count
    // 注意：重复工单需全局识别（同 orderNo+settlementMonth 出现>1 次），无法直接数据库分页
    // 优化点：select 仅必要字段，配合索引；聚合用 _sum 避免 reduce 全量数据到内存
    const [allOrders, totalPaintCountAgg] = await Promise.all([
      this.prisma.paintWorkOrder.findMany({
        where,
        select: { id: true, orderNo: true, settlementMonth: true, createdAt: true },
        orderBy: [{ orderNo: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.paintWorkOrder.aggregate({
        where,
        _sum: { totalPaintCount: true },
      }),
    ]);

    // 统计每个 orderNo+settlementMonth 组合出现次数（同号不同月不算重复）
    const orderNoMonthCount = new Map<string, number>();
    allOrders.forEach(order => {
      if (order.orderNo) {
        const key = `${order.orderNo}|${order.settlementMonth || ''}`;
        orderNoMonthCount.set(key, (orderNoMonthCount.get(key) || 0) + 1);
      }
    });

    // 重复工单全局优先显示，同 orderNo+settlementMonth 按创建时间排序
    const sortedOrders = allOrders.sort((a, b) => {
      const aKey = `${a.orderNo}|${a.settlementMonth || ''}`;
      const bKey = `${b.orderNo}|${b.settlementMonth || ''}`;
      const aDup = a.orderNo && (orderNoMonthCount.get(aKey) || 0) > 1 ? 0 : 1;
      const bDup = b.orderNo && (orderNoMonthCount.get(bKey) || 0) > 1 ? 0 : 1;
      if (aDup !== bDup) return aDup - bDup;
      if (a.orderNo !== b.orderNo) return (a.orderNo || '').localeCompare(b.orderNo || '');
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const total = sortedOrders.length;
    const pageIds = sortedOrders
      .slice((current - 1) * size, current * size)
      .map(order => order.id);

    const records = pageIds.length > 0
      ? await this.prisma.paintWorkOrder.findMany({
          where: { id: { in: pageIds } },
          include: {
            items: { include: { category: true, specialPaint: true } },
            // 列表页仅查询首图，避免图片过多导致响应臃肿
            images: { orderBy: { createdAt: 'desc' }, take: 1 },
            shop: { select: { id: true, name: true, code: true } },
          },
        })
      : [];

    // 按排序后的 id 顺序整理记录
    const recordMap = new Map(records.map(record => [record.id, record]));
    const orderedRecords = pageIds
      .map(id => recordMap.get(id))
      .filter((record): record is NonNullable<typeof record> => !!record);

    const enrichedRecords = orderedRecords.map(record => {
      const normalized = this.applyDerivedStatus(record);
      const monthKey = `${record.orderNo || ''}|${record.settlementMonth || ''}`;
      return {
        ...normalized,
        _duplicateCount: orderNoMonthCount.get(monthKey) || 1,
        _isDuplicate: (orderNoMonthCount.get(monthKey) || 1) > 1,
      };
    });

    // 批量查询当前页涉及的所有门店+月份的封单状态
    const shopMonthPairs = new Set<string>();
    for (const record of enrichedRecords) {
      const month = record.settlementMonth || this.getMonthFromDate(record.orderDate);
      if (month && record.shopId) {
        shopMonthPairs.add(`${record.shopId}|${month}`);
      }
    }
    const sealedSet = new Set<string>();
    if (shopMonthPairs.size > 0) {
      const sealConditions = Array.from(shopMonthPairs).map(pair => {
        const [shopId, month] = pair.split('|');
        return { shopId, month };
      });
      const sealedRecords = await this.prisma.paintSettlementMonth.findMany({
        where: {
          OR: sealConditions.map(c => ({ shopId: c.shopId, month: c.month, isSealed: true })),
        },
        select: { shopId: true, month: true },
      });
      for (const sr of sealedRecords) {
        sealedSet.add(`${sr.shopId}|${sr.month}`);
      }
    }
    for (const record of enrichedRecords) {
      const month = record.settlementMonth || this.getMonthFromDate(record.orderDate);
      (record as any)._isSealed = !!(month && record.shopId && sealedSet.has(`${record.shopId}|${month}`));
    }

    // 使用数据库聚合结果，避免内存 reduce
    const totalPaintCount = Number(totalPaintCountAgg._sum.totalPaintCount || 0);

    return { current, size, total, totalPaintCount, records: enrichedRecords };
  }

  /** 统计各状态的工单数量 */
  async getStatusCounts(
    shopId?: string,
    settlementMonth?: string,
    accessibleShopIds?: string[] | null,
  ) {
    const baseWhere: Prisma.PaintWorkOrderWhereInput = {
      ...(shopId && { shopId }),
      ...(settlementMonth && { settlementMonth }),
      // 数据权限过滤：accessibleShopIds 为 null 表示不限制
      ...(accessibleShopIds && { shopId: { in: accessibleShopIds } }),
    };

    // 若指定了 shopId 但不在权限范围内，直接返回 0
    if (
      accessibleShopIds &&
      shopId &&
      !accessibleShopIds.includes(shopId)
    ) {
      return { total: 0, pending: 0, audited: 0, settled: 0 };
    }

    const [total, draft, pending, audited, settled, abnormal] = await Promise.all([
      this.prisma.paintWorkOrder.count({ where: baseWhere }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'DRAFT' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'PENDING' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'AUDITED' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'SETTLED' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'ABNORMAL' as any } }),
    ]);

    return { total, draft, pending, audited, settled, abnormal };
  }

  async addItems(orderId: string, items: WorkOrderItemDto[]) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('工单不存在');

    // 封单校验
    await this.settlementMonthService.assertOrderNotSealed(orderId);

    // 已审核（含已结算、异常）的工单不允许添加项目
    if (order.status === 'AUDITED' || order.status === 'SETTLED' || order.status === 'ABNORMAL') {
      throw new BadRequestException('已审核的工单不允许修改');
    }

    // 校验重复部位
    const existingItems = await this.prisma.paintWorkOrderItem.findMany({
      where: { orderId },
      select: { categoryId: true },
    });
    const existingCategoryIds = new Set(existingItems.map(i => i.categoryId));
    for (const item of items) {
      if (existingCategoryIds.has(item.categoryId)) {
        throw new BadRequestException('不能重复选择同一部位');
      }
    }
    // 新增项之间也不能重复
    const newCategoryIds = items.map(i => i.categoryId);
    const duplicates = findDuplicateCategoryIds(newCategoryIds);
    if (duplicates.length > 0) {
      throw new BadRequestException('不能重复选择同一部位');
    }

    const [templateItemMap, specialPaintMap] = await Promise.all([
      this.getShopTemplateItemMap(order.shopId),
      this.getSpecialPaintMap(items.map(i => i.specialPaintId).filter((id): id is string => Boolean(id))),
    ]);
    const calculatedItems = this.calculateItemsPaintCount(items, templateItemMap, specialPaintMap);
    const itemsData: ItemDataWithOrderId[] = calculatedItems.map(item => ({ orderId, ...item }));
    const addedPaintCount = calculatedItems.reduce((sum, item) => sum + item.paintCount, 0);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.paintWorkOrderItem.createMany({ data: itemsData });
      return tx.paintWorkOrder.update({
        where: { id: orderId },
        data: { totalPaintCount: { increment: addedPaintCount } },
      });
    });
  }

  async removeItem(orderId: string, itemId: string) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('工单不存在');

    // 封单校验
    await this.settlementMonthService.assertOrderNotSealed(orderId);

    // 已审核（含已结算、异常）的工单不允许删除项目
    if (order.status === 'AUDITED' || order.status === 'SETTLED' || order.status === 'ABNORMAL') {
      throw new BadRequestException('已审核的工单不允许修改');
    }

    const item = await this.prisma.paintWorkOrderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) throw new NotFoundException('项目不存在');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.paintWorkOrderItem.delete({ where: { id: itemId } });
      return tx.paintWorkOrder.update({
        where: { id: orderId },
        data: { totalPaintCount: { decrement: Number(item.paintCount) } },
      });
    });
  }

  async uploadImage(orderId: string, url: string, imageType: PaintImageType, description?: string) {
    const order = await this.prisma.paintWorkOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('工单不存在');

    return this.prisma.paintWorkOrderImage.create({
      data: { orderId, url, imageType, description },
    });
  }

  async saveAndUploadImage(orderId: string, buffer: Buffer, filename: string, mimetype: string, imageType: PaintImageType, description?: string, thumbnailBuffer?: Buffer | null) {
    const order = await this.prisma.paintWorkOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('工单不存在');

    const url = await this.imageService.saveImageFile(buffer, filename, order.shopId, order.settlementMonth);
    let thumbnailUrl: string | undefined;
    if (thumbnailBuffer) {
      thumbnailUrl = await this.imageService.saveImageFile(thumbnailBuffer, `thumb_${filename}`, order.shopId, order.settlementMonth);
    }
    return this.prisma.paintWorkOrderImage.create({
      data: { orderId, url, thumbnailUrl, imageType, description, fileSize: buffer.length },
    });
  }

  async removeImage(imageId: string) {
    const image = await this.prisma.paintWorkOrderImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('图片不存在');

    // 删除物理文件
    await this.imageService.deletePhysicalFiles(image.url, image.thumbnailUrl);

    return this.prisma.paintWorkOrderImage.delete({ where: { id: imageId } });
  }

  /** 查询图片信息（供权限校验使用） */
  async findImageById(imageId: string) {
    return this.prisma.paintWorkOrderImage.findUnique({
      where: { id: imageId },
      select: { orderId: true },
    });
  }

  /** 获取门店信息（供 controller 拼接文件名使用） */
  async getShopName(shopId: string): Promise<string> {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId }, select: { name: true } });
    return shop?.name || '喷漆';
  }

  /** 获取门店的 Excel 模板配置 */
  async getShopExcelTemplateConfig(shopId: string): Promise<any | null> {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId }, select: { excelTemplateConfig: true } });
    if (!shop) throw new NotFoundException('门店不存在');
    return shop.excelTemplateConfig ? JSON.parse(shop.excelTemplateConfig) : null;
  }

  private async generateOrderNo(shopId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx || this.prisma;
    const shop = await client.paintShop.findUnique({ where: { id: shopId } });
    const shopCode = shop?.code || '';
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const seqKey = `paint:order_seq:${shopCode}:${dateStr}`;

    // 使用 Redis INCR 原子递增，避免并发重复
    let seq = await RedisUtility.instance.incr(seqKey);

    // 新 key 时从数据库同步当天实际最大序号作为初始值
    if (seq === 1) {
      const todayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const todayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
      const todayOrders = await client.paintWorkOrder.findMany({
        where: { shopId, orderDate: { gte: todayStart, lte: todayEnd } },
        select: { orderNo: true },
        orderBy: { orderNo: 'desc' },
        take: 1,
      });
      const maxSeq = todayOrders.length > 0 && todayOrders[0].orderNo
        ? parseOrderNoSeq(todayOrders[0].orderNo)
        : 0;

      // 设置初始值（NX 避免覆盖其他并发请求已设置的值），然后再次递增获取真实序号
      await RedisUtility.instance.set(seqKey, maxSeq, 'EX', 2 * 24 * 60 * 60, 'NX');
      seq = await RedisUtility.instance.incr(seqKey);
    }

    // 确保 key 有过期时间，避免长期残留
    await RedisUtility.instance.expire(seqKey, 2 * 24 * 60 * 60);

    return formatOrderNo(shopCode, date, seq);
  }

  /** 生成图片缩略图 base64 */
  async generateThumbnailBase64(buffer: Buffer, maxWidth: number): Promise<string> {
    try {
      const image = await Jimp.read(buffer);
      if (image.width > maxWidth) {
        image.resize({ w: maxWidth });
      }
      const thumbBuffer = await image.getBuffer('image/jpeg');
      return `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private getMonthFromDate(date: Date | null | undefined): string | null {
    if (!date) return null;
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
