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
  normalizePlateNumber,
  parseOrderNoSeq,
  shouldMigrateSettlementMonth,
  toOrderAccessWhere,
  type OrderAccessScope,
} from './paint-calculation';
import { PaintStatsCache } from './paint-stats-cache';
import { CreateWorkOrderDto, UpdateWorkOrderDto, PageWorkOrderDto, WorkOrderItemDto } from '../work-order/dto/work-order.dto';
import { SealService } from '../seal/seal.service';
import { maskCustomerName, maskPhone, maskVin } from './customer-masking.util';
import { PaintVehicleService, type VehicleFieldKey } from './paint-vehicle.service';
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
    private readonly sealService: SealService,
    private readonly vehicleService: PaintVehicleService,
  ) {}

  /**
   * 一次性查询门店各部位的幅数系数，避免 N+1
   *
   * 系数优先级：**门店专属标准（paint_standard）> 标准模板（paint_standard_template_item）**
   *
   * 历史实现只读标准模板，导致在「门店标准」页维护的门店专属系数对幅数计算完全不生效
   * （页面上改了系数，工单算出来的幅数却没变）。这里先以模板为基线，再用门店标准覆盖。
   */
  private async getShopTemplateItemMap(shopId: string): Promise<Map<string, { coefficient: number; newPartAddition: number }>> {
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      include: {
        standardTemplate: {
          include: { items: true },
        },
        standards: true,
      },
    });

    const map = new Map<string, { coefficient: number; newPartAddition: number }>();
    // 1) 基线：标准模板
    for (const item of shop?.standardTemplate?.items || []) {
      map.set(item.categoryId, {
        coefficient: Number(item.coefficient),
        newPartAddition: Number(item.newPartAddition),
      });
    }
    // 2) 覆盖：门店专属标准
    for (const std of (shop as any)?.standards || []) {
      map.set(std.categoryId, {
        coefficient: Number(std.coefficient),
        newPartAddition: Number(std.newPartAddition ?? 0),
      });
    }
    return map;
  }

  /**
   * 使受影响的统计缓存失效
   * 同时失效月度缓存与对应年度缓存，避免年度趋势停留在旧数据
   */
  private invalidateStatsCache(...months: (string | null | undefined)[]): void {
    const targets = new Set<string>();
    for (const month of months) {
      if (!month) continue;
      targets.add(month);
      const year = month.slice(0, 4);
      if (/^\d{4}$/.test(year)) targets.add(`y${year}`);
    }
    if (targets.size === 0) return;
    PaintStatsCache.invalidate([...targets]).catch(e => {
      this.logger?.warn?.(`统计缓存失效失败: ${e instanceof Error ? e.message : e}`);
    });
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

    // 车牌精确命中系统车辆时，工单的不变属性（VIN/车型/品牌/客户名）优先采用系统沉淀值——
    // OCR 对这些字段的识别质量远低于多次工单沉淀 + 人工修正后的主档。
    // 电话是易变联系方式，保留纸质单上的 OCR 识别值。
    const existingVehicle = plateNumber?.trim()
      ? await this.vehicleService.findExactByPlate(plateNumber)
      : null;
    const orderVin = existingVehicle?.vin || vin || '';
    const orderCarModel = existingVehicle?.carModel || carModel || '';
    const orderBrand = existingVehicle?.brand || brand || '';
    const orderCustomerName = existingVehicle?.customerName || customerName || '';

    // 在事务内创建工单（批量上传时不自动生成工单号，等OCR填充）
    const order = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 按车牌号 upsert 车辆主数据（自动沉淀，全局唯一）
      let vehicleId: string | undefined;
      if (plateNumber && plateNumber.trim()) {
        vehicleId = await this.vehicleService.upsertByPlateWithTx(tx, {
          plateNumber: normalizePlateNumber(plateNumber).slice(0, 50),
          vin: vin || undefined,
          carModel: carModel || undefined,
          brand: brand || undefined,
          customerName: customerName || undefined,
          phone: phone || undefined,
        }, shopId, finalOrderDate || undefined, {
          // 系统已有该车辆时不让 OCR 值改写主档属性（工单上的字段已优先采用系统值）
          preserveAttributesIfExisting: !!existingVehicle,
        });
      }

      const created = await tx.paintWorkOrder.create({
        data: {
          orderNo: ocrOrderNo || null,
          shopId,
          orderDate: finalOrderDate,
          plateNumber: normalizePlateNumber(plateNumber).slice(0, 50),
          carModel: orderCarModel,
          vin: orderVin,
          brand: orderBrand,
          customerName: orderCustomerName,
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

    this.invalidateStatsCache(settlementMonth || null);

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
    } else if (typeof dto.importTotalPaintCount === 'number' && Number.isFinite(dto.importTotalPaintCount)) {
      // 幅数汇总表（如「盛通别克油漆幅数」）：无明细部位列，直接以副数列作为总幅数
      totalPaintCount = dto.importTotalPaintCount;
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 按车牌号 upsert 车辆主数据（自动沉淀，全局唯一）
      let vehicleId: string | undefined;
      const orderDateObj = dto.orderDate ? new Date(dto.orderDate) : null;
      if (dto.plateNumber && dto.plateNumber.trim()) {
        vehicleId = await this.vehicleService.upsertByPlateWithTx(tx, {
          plateNumber: normalizePlateNumber(dto.plateNumber).slice(0, 50),
          vin: dto.vin || undefined,
          carModel: dto.carModel || undefined,
          brand: dto.brand || undefined,
          customerName: dto.customerName || undefined,
          phone: dto.phone || undefined,
          contactPerson: dto.contactPerson || undefined,
        }, dto.shopId, orderDateObj ?? undefined);
      }

      const orderNo = dto.orderNo || null;
      // 负幅数自动识别为调整单（用于抵消/订正月报）：前端未显式传值时按总幅数判定，
      // 保证「有负数的工单就是调整单」这一不变量在后端也成立
      const isAdjustment = dto.isAdjustment ?? totalPaintCount < 0;
      const order = await tx.paintWorkOrder.create({
        data: {
          orderNo,
          shopId: dto.shopId,
          orderDate: orderDateObj,
          settlementMonth: dto.settlementMonth || null,
          carModel: dto.carModel,
          plateNumber: dto.plateNumber === undefined ? undefined : normalizePlateNumber(dto.plateNumber).slice(0, 50),
          vin: dto.vin,
          brand: dto.brand,
          customerName: dto.customerName,
          phone: dto.phone,
          contactPerson: dto.contactPerson,
          description: dto.description,
          vehicleId: vehicleId || null,
          totalPaintCount,
          remark: dto.remark,
          isAdjustment,
          status: (isAdjustment ? 'AUDITED' : 'DRAFT') as PaintOrderStatus,
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

      this.invalidateStatsCache(dto.settlementMonth || null);

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
    if (month) await this.sealService.assertNotSealed(existing.shopId, month);

    const audited = existing.status === 'AUDITED' || existing.status === 'SETTLED' || existing.status === 'ABNORMAL';

    // 已审核（含已结算、异常）的工单只允许修正 OCR 基础字段或返工标记，不能修改项目、门店、结算月份等
    const safeOcrFields = ['orderNo', 'plateNumber', 'customerName', 'phone', 'carModel', 'vin', 'brand', 'orderDate'] as const;
    const unsafeFields = ['shopId', 'settlementMonth', 'contactPerson', 'description', 'remark', 'items'] as const;
    const hasUnsafeField = unsafeFields.some(field => dto[field] !== undefined);
    const isOcrCorrection = safeOcrFields.some(field => dto[field] !== undefined);
    const isReworkUpdate = dto.isRework !== undefined || dto.reworkRemark !== undefined;

    // 已结算的工单不允许修正OCR（含仅基础字段的请求），需先取消结算
    if (existing.status === 'SETTLED' && (isOcrCorrection || hasUnsafeField)) {
      throw new BadRequestException('已结算的工单不允许修正OCR，如需修改请先取消结算');
    }

    if (audited && hasUnsafeField) {
      throw new BadRequestException('已审核的工单只允许修正车牌号、工单号等基础信息');
    }

    if (audited && !isOcrCorrection && !isReworkUpdate) {
      throw new BadRequestException('已审核的工单只允许修正车牌号、工单号等基础信息');
    }

    const updateData: Prisma.PaintWorkOrderUpdateInput = {
      carModel: dto.carModel,
      // 车牌统一 trim + 大写，保证"按车牌去重统计车辆数"时同一台车只算一台
      plateNumber: dto.plateNumber === undefined ? undefined : normalizePlateNumber(dto.plateNumber).slice(0, 50),
      customerName: dto.customerName,
      phone: dto.phone,
      contactPerson: dto.contactPerson,
      description: dto.description,
      remark: dto.remark,
      isRework: dto.isRework,
      reworkRemark: dto.reworkRemark ? dto.reworkRemark.slice(0, 200) : dto.reworkRemark,
      isAdjustment: dto.isAdjustment,
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

      /**
       * 本次请求里用户显式提交的车辆字段，需要以工单为准回写车辆主数据。
       *
       * 典型场景：OCR 把车型识别成 "BYD7150ADHEV1 80KM尊贵型"，用户在工单上修正为
       * "海豹06DM-i"。智能合并策略（新值更长才覆盖）会认为新值"更不完整"而丢弃用户的修正，
       * 导致车辆管理里的主数据永远不跟随工单。
       * 未提交的字段仍走智能合并，避免自动化写入把主数据改坏。
       */
      const overwriteFields: VehicleFieldKey[] = [];
      if (dto.vin !== undefined) overwriteFields.push('vin');
      if (dto.carModel !== undefined) overwriteFields.push('carModel');
      if (dto.brand !== undefined) overwriteFields.push('brand');
      if (dto.customerName !== undefined) overwriteFields.push('customerName');
      if (dto.phone !== undefined) overwriteFields.push('phone');
      if (dto.contactPerson !== undefined) overwriteFields.push('contactPerson');

      if (plateForVehicle && plateForVehicle.trim()) {
        const newVehicleId = await this.vehicleService.upsertByPlateWithTx(tx, {
          plateNumber: normalizePlateNumber(plateForVehicle).slice(0, 50),
          vin: dto.vin !== undefined ? dto.vin || undefined : (existing.vin || undefined),
          carModel: dto.carModel !== undefined ? dto.carModel || undefined : (existing.carModel || undefined),
          brand: dto.brand !== undefined ? dto.brand || undefined : (existing.brand || undefined),
          customerName: dto.customerName !== undefined ? dto.customerName || undefined : (existing.customerName || undefined),
          phone: dto.phone !== undefined ? dto.phone || undefined : (existing.phone || undefined),
          contactPerson: dto.contactPerson !== undefined ? dto.contactPerson || undefined : (existing.contactPerson || undefined),
        }, dto.shopId || existing.shopId, dto.orderDate ? new Date(dto.orderDate) : (existing.orderDate || undefined), { overwriteFields });

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

    // 结算月份 / 工单日期都可能被修改，新旧月份都要失效
    this.invalidateStatsCache(
      existing.settlementMonth || null,
      updated.result.settlementMonth || null,
      this.getMonthFromDate(existing.orderDate),
      this.getMonthFromDate(updated.result.orderDate),
    );

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

    const updated = await this.prisma.paintWorkOrder.update({
      where: { id },
      data: {
        abnormalRemark: isAbnormal ? (abnormalRemark || null) : null,
        status: isAbnormal ? ('ABNORMAL' as any) : ('AUDITED' as any),
      },
    });
    this.invalidateStatsCache(existing.settlementMonth || null);
    return updated;
  }

  /** 作废工单：不再计入幅数统计与对账 */
  async setVoid(id: string, voidReason?: string, operator?: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('工单不存在');
    if (existing.status === 'VOID') throw new BadRequestException('该工单已作废');
    // 封单的工单不允许作废
    const delMonth = existing.settlementMonth || (existing as any).settlement_month;
    if (existing.shopId && delMonth) {
      await this.sealService.assertNotSealed(existing.shopId, delMonth);
    }
    const updated = await this.prisma.paintWorkOrder.update({
      where: { id },
      data: {
        status: 'VOID' as any,
        voidReason: voidReason || null,
        voidedAt: new Date(),
        voidedBy: operator || null,
        voidedFromStatus: String(existing.status),
      },
    });
    if (existing.vehicleId) {
      this.vehicleService.refreshStats(existing.vehicleId).catch((e) => {
        this.logger?.error?.(`作废工单后刷新车辆统计失败: ${e instanceof Error ? e.message : e}`);
      });
    }
    this.invalidateStatsCache(existing.settlementMonth || null);
    return updated;
  }

  /** 恢复已作废的工单到作废前的状态 */
  async unvoid(id: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('工单不存在');
    if (existing.status !== 'VOID') throw new BadRequestException('该工单未作废，无法恢复');
    const restoreMonth = existing.settlementMonth || (existing as any).settlement_month;
    if (existing.shopId && restoreMonth) {
      await this.sealService.assertNotSealed(existing.shopId, restoreMonth);
    }
    const restoredStatus = (existing as any).voidedFromStatus || 'AUDITED';
    const updated = await this.prisma.paintWorkOrder.update({
      where: { id },
      data: {
        status: restoredStatus as any,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
        voidedFromStatus: null,
      },
    });
    if (existing.vehicleId) {
      this.vehicleService.refreshStats(existing.vehicleId).catch((e) => {
        this.logger?.error?.(`恢复作废工单后刷新车辆统计失败: ${e instanceof Error ? e.message : e}`);
      });
    }
    this.invalidateStatsCache(existing.settlementMonth || null);
    return updated;
  }

  async delete(id: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('工单不存在');

    // 封单校验（幅数调整单不受封单限制，可随时订正月报）
    const delMonth = existing.settlementMonth || this.getMonthFromDate(existing.orderDate);
    if (delMonth && !existing.isAdjustment) await this.sealService.assertNotSealed(existing.shopId, delMonth);

    // 已审核（含已结算、异常）的工单不允许删除；但幅数调整单（纠正极）可删除
    if (!existing.isAdjustment && (existing.status === 'AUDITED' || existing.status === 'SETTLED' || existing.status === 'ABNORMAL')) {
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

    this.invalidateStatsCache(delMonth || null, existing.settlementMonth || null);

    return result;
  }

  /** 补充展示状态（status 已由各操作直接写入数据库，此处不再覆盖） */
  private applyDerivedStatus(record: any) {
    return record;
  }

  async findById(id: string, viewCustomer = true) {
    const record = await this.prisma.paintWorkOrder.findUnique({
      where: { id },
      include: {
        items: { include: { category: true, specialPaint: true } },
        images: { orderBy: { createdAt: 'desc' } },
        shop: true,
      },
    });
    const normalized = this.applyDerivedStatus(record);
    if (!record) return normalized;

    // 附带封单状态：详情页据此隐藏审核/结算/取消结算等修改入口（与列表口径一致）
    const month = record.settlementMonth || this.getMonthFromDate(record.orderDate);
    const seal = month
      ? await this.prisma.paintSettlementMonth.findUnique({
          where: { shopId_month: { shopId: record.shopId, month } },
          select: { isSealed: true },
        })
      : null;
    const finalized =
      record.status === 'SETTLED' || record.status === 'VOID' || !!seal?.isSealed;
    const customerMasked = !viewCustomer && finalized;
    let result: any = { ...normalized, _isSealed: !!seal?.isSealed, _customerMasked: customerMasked };
    if (customerMasked) {
      result.customerName = maskCustomerName(result.customerName);
      result.phone = maskPhone(result.phone);
      result.vin = maskVin(result.vin);
    }
    return result;
  }

  /**
   * 同单号在各结算月的工单摘要（列表「跨月结算」标签点击后的明细弹层）。
   * 只读汇总且不受查看人在岗期限制：跨月标签本身就是门店维度的事实，
   * 否则后入职员工看不到入职前月份的已结记录，标签幅数也就无从展示。
   */
  async findSettlementsByOrderNo(orderNo: string, shopId?: string) {
    if (!orderNo) throw new BadRequestException('orderNo 不能为空');
    return this.prisma.paintWorkOrder.findMany({
      where: { orderNo, ...(shopId ? { shopId } : {}) },
      select: {
        id: true,
        orderNo: true,
        settlementMonth: true,
        totalPaintCount: true,
        status: true,
        orderDate: true,
        shop: { select: { id: true, name: true } },
      },
      orderBy: [{ settlementMonth: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async page(
    dto: PageWorkOrderDto,
    orderScope?: OrderAccessScope,
    viewCustomer = true,
  ): Promise<PaginationResult<any>> {
    const current = dto.current ?? 1;
    const size = dto.size ?? 10;

    // 状态筛选：直接按 status 字段筛选
    let statusFilter: Prisma.PaintWorkOrderWhereInput = {};
    const bizStatus = dto.status;
    if (bizStatus) {
      statusFilter = { status: bizStatus as any };
    }

    // 数据权限：all/未传 表示不限制（超管/财务），tenure 按门店在岗期过滤，none 无任何数据
    const accessWhere =
      !orderScope || orderScope.kind === 'all' ? undefined : toOrderAccessWhere(orderScope);

    const where: Prisma.PaintWorkOrderWhereInput = {
      // 若用户传入 shopId，需同时满足数据权限范围
      ...(dto.shopId && { shopId: dto.shopId }),
      // 车牌号 / 工单号 组合搜索（H5 列表共用一个搜索框）
      ...(dto.plateNumber && {
        OR: [
          { plateNumber: { contains: dto.plateNumber } },
          { orderNo: { contains: dto.plateNumber } },
        ],
      }),
      ...(dto.customerName && { customerName: { contains: dto.customerName } }),
      ...(dto.orderNo && { orderNo: { contains: dto.orderNo } }),
      ...(dto.settlementMonth && { settlementMonth: dto.settlementMonth }),
      ...statusFilter,
      ...(dto.isRework !== undefined && { isRework: dto.isRework }),
      ...(dto.isAdjustment !== undefined && {
        isAdjustment: dto.isAdjustment,
      }),
      // 部位 / 新件筛选：组合进同一个 items.some，确保匹配"同一工单项同时满足部位且为新件"
      ...((dto.categoryId || dto.isNewPart) && {
        items: {
          some: {
            ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
            ...(dto.isNewPart ? { newPartQuantity: { gt: 0 } } : {}),
          },
        },
      }),
      // 叠加数据权限过滤（含在岗期，与 dto.shopId 取交集）
      ...(accessWhere && { AND: [accessWhere] }),
    };

    // 若指定了 dto.shopId 但不在数据权限范围内，直接返回空
    if (
      orderScope?.kind === 'none' ||
      (orderScope?.kind === 'tenure' &&
        dto.shopId &&
        !orderScope.tenures.some(t => t.shopId === dto.shopId))
    ) {
      return { current, size, total: 0, records: [] };
    }

    // 总数与总幅数聚合（数据库侧计算，避免全量载入内存）
    const [total, totalPaintCountAgg] = await Promise.all([
      this.prisma.paintWorkOrder.count({ where }),
      this.prisma.paintWorkOrder.aggregate({
        where,
        _sum: { totalPaintCount: true },
      }),
    ]);

    // 重复工单识别：仅对去重的 orderNo+settlementMonth 组合做 groupBy（结果集远小于全部工单，内存可控），
    // 避免为全局重复置顶而把全部门店工单一次性载入内存
    const orderNoMonthGroups = await this.prisma.paintWorkOrder.groupBy({
      by: ['orderNo', 'settlementMonth'],
      where,
      _count: { _all: true },
    });
    const duplicateCountMap = new Map<string, number>();
    for (const g of orderNoMonthGroups) {
      if (g.orderNo && (g._count._all ?? 0) > 1) {
        duplicateCountMap.set(`${g.orderNo}|${g.settlementMonth || ''}`, g._count._all);
      }
    }

    // 全局重复置顶：先取轻量字段（id/orderNo/settlementMonth/createdAt）全量排序，
    // 仅载入 id 列表（内存可控），再按分页切片回查完整记录（完整记录只查一页）。
    const lightweight = await this.prisma.paintWorkOrder.findMany({
      where,
      select: { id: true, orderNo: true, settlementMonth: true, createdAt: true },
      orderBy: [{ orderNo: 'asc' }, { createdAt: 'asc' }],
    });
    // 全局稳定排序：重复工单优先，再按 orderNo/createdAt 维持原顺序
    const sortedIds = lightweight
      .map(r => {
        const monthKey = `${r.orderNo || ''}|${r.settlementMonth || ''}`;
        const isDup = (duplicateCountMap.get(monthKey) || 1) > 1;
        return { ...r, _isDuplicate: isDup };
      })
      .sort((a, b) => {
        const ad = a._isDuplicate ? 0 : 1;
        const bd = b._isDuplicate ? 0 : 1;
        if (ad !== bd) return ad - bd;
        if ((a.orderNo || '') !== (b.orderNo || '')) return (a.orderNo || '').localeCompare(b.orderNo || '');
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })
      .map(r => r.id);

    const pageIds = sortedIds.slice((current - 1) * size, current * size);

    if (pageIds.length === 0) {
      return { current, size, total, totalPaintCount: Number(totalPaintCountAgg._sum.totalPaintCount || 0), records: [] };
    }

    const pageRecords = await this.prisma.paintWorkOrder.findMany({
      where: { id: { in: pageIds } },
      include: {
        items: { include: { category: true, specialPaint: true } },
        // 列表页仅查询首图用于缩略图，避免图片过多导致响应臃肿
        images: { orderBy: { createdAt: 'desc' }, take: 1 },
        // 返回真实图片总数，供列表展示图片数量（不受首图 take:1 限制影响）
        _count: { select: { images: true } },
        shop: { select: { id: true, name: true, code: true } },
      },
    });
    // 按全局排序后的 id 顺序还原本页记录
    const recordById = new Map(pageRecords.map(r => [r.id, r]));
    // 跨月结算识别：同一 orderNo 在多个结算月份均有记录时，需在前端标注"其他月份有结算"
    const pageOrderNos = Array.from(
      new Set(pageRecords.map(r => r.orderNo).filter((n): n is string => !!n)),
    );
    // 跨月识别必须按门店维度统计，不能叠加查看人的数据权限（accessWhere/在岗期）——
    // 否则在岗期之前的历史月份结算会被权限过滤掉，跨月标签对后入职的员工不可见。
    const pageShopIds = Array.from(new Set(pageRecords.map(r => r.shopId).filter((v): v is string => !!v)));
    const crossMonthGroups = pageOrderNos.length
      ? await this.prisma.paintWorkOrder.groupBy({
          by: ['orderNo', 'settlementMonth'],
          where: {
            orderNo: { in: pageOrderNos },
            ...(dto.shopId ? { shopId: dto.shopId } : (pageShopIds.length > 0 && { shopId: { in: pageShopIds } })),
          },
          _sum: { totalPaintCount: true },
        })
      : [];
    // orderNo -> (结算月 -> 该月结算幅数合计)
    const monthsByOrderNo = new Map<string, Map<string, number>>();
    for (const g of crossMonthGroups) {
      if (!g.orderNo) continue;
      const byMonth = monthsByOrderNo.get(g.orderNo) ?? new Map<string, number>();
      const monthKey = g.settlementMonth || '';
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + Number(g._sum.totalPaintCount ?? 0));
      monthsByOrderNo.set(g.orderNo, byMonth);
    }
    const enrichedRecords = pageIds
      .map(id => recordById.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(record => {
        const normalized = this.applyDerivedStatus(record);
        const monthKey = `${record.orderNo || ''}|${record.settlementMonth || ''}`;
        const dupCount = duplicateCountMap.get(monthKey) || 1;
        const byMonth = monthsByOrderNo.get(record.orderNo || '');
        const hasOtherMonthSettlement = (byMonth?.size || 1) > 1;
        const currentMonthKey = record.settlementMonth || '';
        let otherMonthPaintCount = 0;
        for (const [monthKey, monthSum] of byMonth ?? []) {
          if (monthKey !== currentMonthKey) otherMonthPaintCount += monthSum;
        }
        return {
          ...normalized,
          _duplicateCount: dupCount,
          _isDuplicate: dupCount > 1,
          _hasOtherMonthSettlement: hasOtherMonthSettlement,
          _otherMonthPaintCount: Number(otherMonthPaintCount.toFixed(2)),
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

    // 客户信息脱敏（按状态分级）：无 paint:work-order:view-customer 权限者，
    // 仅对完结数据脱敏（已结算/作废/封单月）；进行中的工单（草稿/待审核/已审核/异常）保持明文
    if (!viewCustomer) {
      for (const record of enrichedRecords) {
        const finalized =
          record.status === 'SETTLED' || record.status === 'VOID' || record._isSealed;
        if (finalized) {
          record.customerName = maskCustomerName(record.customerName) as any;
          record.phone = maskPhone(record.phone) as any;
          record.vin = maskVin(record.vin) as any;
          (record as any)._customerMasked = true;
        }
      }
    }
    return { current, size, total, totalPaintCount, records: enrichedRecords };
  }

  /** 统计各状态的工单数量 */
  async getStatusCounts(
    shopId?: string,
    settlementMonth?: string,
    orderScope?: OrderAccessScope,
  ) {
    // 数据权限：all/未传 表示不限制，tenure 按门店在岗期过滤，none 无任何数据
    const accessWhere =
      !orderScope || orderScope.kind === 'all' ? undefined : toOrderAccessWhere(orderScope);

    const baseWhere: Prisma.PaintWorkOrderWhereInput = {
      ...(shopId && { shopId }),
      ...(settlementMonth && { settlementMonth }),
      ...(accessWhere && { AND: [accessWhere] }),
    };

    // 若指定了 shopId 但不在数据权限范围内，直接返回 0
    if (
      orderScope?.kind === 'none' ||
      (orderScope?.kind === 'tenure' &&
        shopId &&
        !orderScope.tenures.some(t => t.shopId === shopId))
    ) {
      return { total: 0, draft: 0, pending: 0, audited: 0, settled: 0, abnormal: 0, void: 0 };
    }

    const [total, draft, pending, audited, settled, abnormal, voidCount] = await Promise.all([
      this.prisma.paintWorkOrder.count({ where: baseWhere }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'DRAFT' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'PENDING' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'AUDITED' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'SETTLED' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'ABNORMAL' as any } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, status: 'VOID' as any } }),
    ]);

    return { total, draft, pending, audited, settled, abnormal, void: voidCount };
  }

  async addItems(orderId: string, items: WorkOrderItemDto[]) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('工单不存在');

    // 封单校验
    await this.sealService.assertOrderNotSealed(orderId);

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

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.paintWorkOrderItem.createMany({ data: itemsData });
      return tx.paintWorkOrder.update({
        where: { id: orderId },
        data: { totalPaintCount: { increment: addedPaintCount } },
      });
    });
    this.invalidateStatsCache(order.settlementMonth || null);
    return updated;
  }

  async removeItem(orderId: string, itemId: string) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('工单不存在');

    // 封单校验
    await this.sealService.assertOrderNotSealed(orderId);

    // 已审核（含已结算、异常）的工单不允许删除项目
    if (order.status === 'AUDITED' || order.status === 'SETTLED' || order.status === 'ABNORMAL') {
      throw new BadRequestException('已审核的工单不允许修改');
    }

    const item = await this.prisma.paintWorkOrderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) throw new NotFoundException('项目不存在');

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.paintWorkOrderItem.delete({ where: { id: itemId } });
      return tx.paintWorkOrder.update({
        where: { id: orderId },
        data: { totalPaintCount: { decrement: Number(item.paintCount) } },
      });
    });
    this.invalidateStatsCache(order.settlementMonth || null);
    return updated;
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

  /** 获取门店的 OCR 品牌/车型映射配置 */
  async getShopOcrConfig(shopId: string): Promise<any | null> {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId }, select: { ocrConfig: true } });
    if (!shop) throw new NotFoundException('门店不存在');
    return shop.ocrConfig ? JSON.parse(shop.ocrConfig) : null;
  }

  /** 保存门店的 OCR 品牌/车型映射配置 */
  async saveShopOcrConfig(shopId: string, config: any): Promise<void> {
    await this.prisma.paintShop.update({ where: { id: shopId }, data: { ocrConfig: JSON.stringify(config) } });
  }

  private async generateOrderNo(shopId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx || this.prisma;
    const shop = await client.paintShop.findUnique({ where: { id: shopId } });
    const shopCode = shop?.code || '';
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const seqKey = `paint:order_seq:${shopCode}:${dateStr}`;

    // 使用 Redis INCR 原子递增，避免并发重复；Redis 不可用时回退数据库兜底，保证录单不中断
    let seq: number;
    try {
      seq = await RedisUtility.instance.incr(seqKey);

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
    } catch {
      // Redis 故障兜底：查当日最大序号 +1 继续生成。降级窗口内无原子递增，极端并发下
      // 同店同日可能重号，属可接受代价；Redis 恢复后自动回到 INCR 路径（seq===1 时会重同步）。
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
      seq = maxSeq + 1;
    }

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
