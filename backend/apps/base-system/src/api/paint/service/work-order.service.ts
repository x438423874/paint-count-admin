import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaginationResult } from '@lib/shared/prisma/pagination';
import { PaintImageType, PaintOrderStatus, Prisma } from '@prisma/client';
import { RedisUtility } from '@lib/shared/redis/redis.util';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { MetricsService } from '@lib/shared/metrics/metrics.service';
import { PaintImageService } from './paint-image.service';
import { OcrAnnotationService } from './ocr-annotation.service';
import {
  calculatePaintCount,
  findDuplicateCategoryIds,
  formatOrderNo,
  parseOrderNoSeq,
  shouldMigrateSettlementMonth,
} from './paint-calculation';
import { CreateWorkOrderDto, UpdateWorkOrderDto, PageWorkOrderDto, WorkOrderItemDto } from '../work-order/dto/work-order.dto';

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
    private readonly annotationService: OcrAnnotationService,
    private readonly metricsService: MetricsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
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

  async quickCreate(shopId: string, buffer: Buffer, filename: string, mimetype: string, settlementMonth?: string, plateNumber?: string, ocrOrderNo?: string, thumbnailBuffer?: Buffer | null, customerName?: string, phone?: string, carModel?: string) {
    const orderDate = new Date();

    // 先保存图片文件（事务外操作，不涉及数据库一致性）
    const url = await this.imageService.saveImageFile(buffer, filename, shopId, settlementMonth);
    let thumbnailUrl: string | undefined;
    if (thumbnailBuffer) {
      thumbnailUrl = await this.imageService.saveImageFile(thumbnailBuffer, `thumb_${filename}`, shopId, settlementMonth);
    }

    // 在事务内生成工单号并创建工单，避免并发冲突
    const order = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const orderNo = ocrOrderNo || await this.generateOrderNo(shopId, tx);
      const created = await tx.paintWorkOrder.create({
        data: {
          orderNo,
          shopId,
          orderDate,
          plateNumber: plateNumber || '',
          carModel: carModel || '',
          customerName: customerName || '',
          phone: phone || '',
          totalPaintCount: 0,
          status: 'PENDING',
          settlementMonth: settlementMonth || null,
        },
        include: { items: { include: { category: true, specialPaint: true } }, shop: true },
      });

      await tx.paintWorkOrderImage.create({
        data: { orderId: created.id, url, thumbnailUrl, imageType: PaintImageType.BEFORE, fileSize: buffer.length },
      });

      return created;
    });

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
      const orderNo = dto.orderNo || await this.generateOrderNo(dto.shopId, tx);
      const order = await tx.paintWorkOrder.create({
        data: {
          orderNo,
          shopId: dto.shopId,
          orderDate: new Date(dto.orderDate),
          settlementMonth: dto.settlementMonth || null,
          carModel: dto.carModel,
          plateNumber: dto.plateNumber,
          vin: dto.vin,
          customerName: dto.customerName,
          phone: dto.phone,
          contactPerson: dto.contactPerson,
          description: dto.description,
          totalPaintCount,
          remark: dto.remark,
          items: { create: itemsData },
        },
        include: { items: { include: { category: true, specialPaint: true } }, shop: true },
      });
      this.metricsService.recordWorkOrderCreation(dto.shopId, 'manual');
      return order;
    });
  }

  async update(dto: UpdateWorkOrderDto) {
    const existing = await this.prisma.paintWorkOrder.findUnique({
      where: { id: dto.id },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('工单不存在');

    // 已审核的工单不允许修改
    if (existing.isAudited) {
      throw new BadRequestException('已审核的工单不允许修改');
    }

    const updateData: Prisma.PaintWorkOrderUpdateInput = {
      carModel: dto.carModel,
      plateNumber: dto.plateNumber,
      customerName: dto.customerName,
      phone: dto.phone,
      status: dto.status,
      remark: dto.remark,
    };

    // 支持编辑工单号（OCR识别可能有误）
    if (dto.orderNo !== undefined) {
      updateData.orderNo = dto.orderNo;
    }

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
        // 如果新月份与之前不同，自动添加结算记录（分次结算支持）
        const existingRecord = await this.prisma.paintSettlementRecord.findFirst({
          where: { orderId: dto.id, settlementMonth: targetMonth },
        });
        if (!existingRecord) {
          // 计算当前幅数
          const currentPaintCount = calculatedItems
            ? calculatedItems.reduce((sum, item) => sum + item.paintCount, 0)
            : Number(existing.totalPaintCount);
          const itemCount = dto.items?.length || existing.items.length;
          await this.prisma.paintSettlementRecord.create({
            data: {
              orderId: dto.id,
              settlementMonth: targetMonth,
              paintCount: currentPaintCount,
              itemCount,
              remark: '修改结算月份自动记录',
            },
          });
        }
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

    const updated = await this.prisma.paintWorkOrder.update({
      where: { id: dto.id },
      data: updateData,
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
    });

    // 自主学习：工单编辑保存后，自动学习字段值作为 ground truth
    // 当工单有图片时，将用户确认/修改的字段值保存为标注数据
    // 这样系统会随着使用越来越准确
    this.autoLearnFromWorkOrderUpdate(dto.id, existing, updated).catch((err) => {
      // 自主学习失败不影响工单更新
      this.logger.warn('自动学习标注失败', {
        orderId: dto.id,
        error: err?.message || String(err),
        stack: err?.stack,
      });
    });

    return updated;
  }

  /**
   * 自主学习：从工单更新中学习字段值作为 ground truth
   * 原理：用户编辑工单时确认/修改的字段值是可信的正确数据
   * 将这些数据保存为标注数据，用于后续 OCR 识别的纠错和模板聚合
   *
   * 重要：自主学习只保存 ground truth（字段值），不保存区域坐标
   * 区域坐标必须由用户在 OCR 模板标注编辑器中手动标注（精确位置）
   * 因此自主学习的标注数据 isVerified=false，不参与聚合模板的坐标计算
   * 但 ground truth 会参与 correctWithAnnotations 的智能纠错
   *
   * 触发条件：
   * 1. 工单有图片（OCR 识别的来源）
   * 2. 至少有一个关键字段（车牌号、工单号）有值
   * 3. 字段值与更新前不同（避免重复学习未修改的数据）
   */
  private async autoLearnFromWorkOrderUpdate(
    orderId: string,
    existing: any,
    updated: any,
  ): Promise<void> {
    // 收集更新后的字段值
    const groundTruth: Record<string, string> = {};
    const fields = ['plateNumber', 'orderNo', 'customerName', 'phone', 'carModel'] as const;

    const toString = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      if (value instanceof Date) return value.toISOString();
      return String(value);
    };

    let hasChange = false;
    for (const field of fields) {
      const oldValue = toString(existing[field]).trim();
      const newValue = toString(updated[field]).trim();
      if (newValue && newValue !== oldValue) {
        groundTruth[field] = newValue;
        hasChange = true;
      }
    }

    // 日期字段：从 orderDate 学习
    const oldDate = toString(existing.orderDate).trim();
    const newDate = toString(updated.orderDate).trim();
    if (newDate && newDate !== oldDate) {
      // 标准化为 YYYY-MM-DD
      const dateMatch = newDate.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
      if (dateMatch) {
        groundTruth.date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
        hasChange = true;
      }
    }

    // 没有字段变更，不需要学习
    if (!hasChange) return;

    // 至少需要车牌号或工单号（关键字段）才学习
    if (!groundTruth.plateNumber && !groundTruth.orderNo) return;

    // 获取工单的第一张图片（OCR 识别的来源）
    const images = await this.prisma.paintWorkOrderImage.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });

    if (images.length === 0) return;

    const image = images[0];
    const shopId = updated.shopId || existing.shopId;
    if (!shopId) return;

    // 自主学习只保存 ground truth，不保存区域坐标
    // regions 设为空对象，isVerified=false
    // 这样不会污染聚合模板的坐标计算，但 ground truth 可用于纠错
    await this.annotationService.createAnnotation({
      shopId,
      orderId,
      imageUrl: image.url,
      imageWidth: 1, // 占位值，避免 image_width=0 被误判
      imageHeight: 1,
      regions: {},
      groundTruth,
      isVerified: false, // 待验证，不自动设为已验证
    });
  }

  /** 设置/取消异常标注 */
  async setAbnormal(id: string, isAbnormal: boolean, abnormalRemark?: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('工单不存在');

    // 必须已审核才能标记异常
    if (!existing.isAudited) {
      throw new BadRequestException('工单未审核，不能标记异常');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id },
      data: {
        isAbnormal,
        abnormalRemark: isAbnormal ? (abnormalRemark || null) : null,
      },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('工单不存在');

    // 已审核的工单不允许删除
    if (existing.isAudited) {
      throw new BadRequestException('已审核的工单不允许删除');
    }

    // 先清理关联的图片文件和数据库记录
    await this.imageService.deleteOrderImages(id);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 删除数据库中的图片记录
      await tx.paintWorkOrderImage.deleteMany({ where: { orderId: id } });
      // 删除工单项
      await tx.paintWorkOrderItem.deleteMany({ where: { orderId: id } });
      // 删除工单
      return tx.paintWorkOrder.delete({ where: { id } });
    });
  }

  async findById(id: string) {
    return this.prisma.paintWorkOrder.findUnique({
      where: { id },
      include: {
        items: { include: { category: true, specialPaint: true } },
        images: { orderBy: { createdAt: 'desc' } },
        shop: true,
      },
    });
  }

  async page(
    dto: PageWorkOrderDto,
    accessibleShopIds?: string[] | null,
  ): Promise<PaginationResult<any>> {
    const current = dto.current ?? 1;
    const size = dto.size ?? 10;

    // 处理业务状态筛选：AUDITED=已审核, SETTLED=已结算
    // 这些不是数据库枚举值，需要转换为实际的查询条件
    let statusFilter: Prisma.PaintWorkOrderWhereInput = {};
    const bizStatus = dto.status;
    if (bizStatus === 'AUDITED') {
      statusFilter = { isAudited: true };
    } else if (bizStatus === 'SETTLED') {
      statusFilter = { isAudited: true, settlements: { some: {} } };
    } else if (bizStatus === 'PENDING') {
      statusFilter = { isAudited: false };
    } else if (bizStatus) {
      statusFilter = { status: bizStatus as PaintOrderStatus };
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
      ...(dto.isAudited !== undefined && { isAudited: dto.isAudited }),
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

    const [records, total] = await Promise.all([
      this.prisma.paintWorkOrder.findMany({
        where,
        skip: (current - 1) * size,
        take: size,
        orderBy: [
          // 有重复的工单排在前面（按orderNo分组，同组连续）
          { orderNo: 'asc' },
          { createdAt: 'asc' },
        ],
        include: {
          items: { include: { category: true, specialPaint: true } },
          images: { orderBy: { createdAt: 'desc' } },
          shop: { select: { id: true, name: true, code: true } },
          settlements: { orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.paintWorkOrder.count({ where }),
    ]);

    // 标记重复工单
    const orderNos = records.map(r => r.orderNo);
    const duplicateCounts = await this.prisma.paintWorkOrder.groupBy({
      by: ['orderNo'],
      where: {
        orderNo: { in: orderNos },
        status: { not: 'CANCELLED' },
      },
      _count: { id: true },
    });
    const duplicateMap = new Map(duplicateCounts.map(d => [d.orderNo, d._count.id]));

    const enrichedRecords = records.map(record => ({
      ...record,
      _duplicateCount: duplicateMap.get(record.orderNo) || 1,
      _isDuplicate: (duplicateMap.get(record.orderNo) || 1) > 1,
    }));

    return { current, size, total, records: enrichedRecords };
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

    const [total, pending, audited, settled] = await Promise.all([
      this.prisma.paintWorkOrder.count({ where: baseWhere }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, isAudited: false } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, isAudited: true } }),
      this.prisma.paintWorkOrder.count({ where: { ...baseWhere, isAudited: true, settlements: { some: {} } } }),
    ]);

    return { total, pending, audited, settled };
  }

  async addItems(orderId: string, items: WorkOrderItemDto[]) {
    const order = await this.prisma.paintWorkOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('工单不存在');

    // 已审核的工单不允许添加项目
    if (order.isAudited) {
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
    const order = await this.prisma.paintWorkOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('工单不存在');

    // 已审核的工单不允许删除项目
    if (order.isAudited) {
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
}
