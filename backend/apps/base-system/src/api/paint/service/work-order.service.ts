import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaginationResult } from '@lib/shared/prisma/pagination';
import { PaintImageType, Prisma } from '@prisma/client';
import { PaintImageService } from './paint-image.service';
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
  ) {}

  /** 计算单个项目的幅数，从门店关联的标准模板获取系数 */
  private async calculateItemPaintCount(
    shopId: string,
    item: WorkOrderItemDto,
  ): Promise<OrderItemCreateData> {
    // 从门店关联的标准模板获取系数
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      include: {
        standardTemplate: {
          include: { items: { where: { categoryId: item.categoryId } } },
        },
      },
    });

    const templateItem = shop?.standardTemplate?.items?.[0];
    const coefficient = templateItem ? Number(templateItem.coefficient) : 0;
    const newPartAddition = templateItem ? Number(templateItem.newPartAddition) : 0;

    // 特殊车漆倍数
    let specialPaintMultiplier: number | null = null;
    let specialPaintId: string | null = null;
    if (item.specialPaintId) {
      const specialPaint = await this.prisma.paintSpecialPaint.findUnique({
        where: { id: item.specialPaintId },
      });
      if (specialPaint && specialPaint.isActive) {
        specialPaintMultiplier = Number(specialPaint.multiplier);
        specialPaintId = specialPaint.id;
      }
    }

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
  }

  async quickCreate(shopId: string, buffer: Buffer, filename: string, mimetype: string, settlementMonth?: string, plateNumber?: string, ocrOrderNo?: string, thumbnailBuffer?: Buffer | null) {
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
          carModel: '',
          customerName: '',
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

      for (const item of dto.items) {
        const itemData = await this.calculateItemPaintCount(dto.shopId, item);
        totalPaintCount += itemData.paintCount;
        itemsData.push(itemData);
      }
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

    const updateData: any = {
      carModel: dto.carModel,
      plateNumber: dto.plateNumber,
      customerName: dto.customerName,
      phone: dto.phone,
      status: dto.status as any,
      remark: dto.remark,
    };

    // 支持编辑工单号（OCR识别可能有误）
    if (dto.orderNo !== undefined) {
      updateData.orderNo = dto.orderNo;
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
          let currentPaintCount = Number(existing.totalPaintCount);
          if (dto.items !== undefined) {
            currentPaintCount = 0;
            for (const item of dto.items) {
              const itemData = await this.calculateItemPaintCount(existing.shopId, item);
              currentPaintCount += itemData.paintCount;
            }
          }
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

    if (dto.items !== undefined) {
      const categoryIds = dto.items.map(i => i.categoryId);
      const duplicates = findDuplicateCategoryIds(categoryIds);
      if (duplicates.length > 0) {
        throw new BadRequestException('不能重复选择同一部位');
      }

      let totalPaintCount = 0;
      const itemsData: OrderItemCreateData[] = [];

      for (const item of dto.items) {
        const itemData = await this.calculateItemPaintCount(existing.shopId, item);
        totalPaintCount += itemData.paintCount;
        itemsData.push(itemData);
      }

      updateData.totalPaintCount = totalPaintCount;
      updateData.items = {
        deleteMany: {},
        create: itemsData,
      };
    } else {
      updateData.totalPaintCount = existing.totalPaintCount;
    }

    return this.prisma.paintWorkOrder.update({
      where: { id: dto.id },
      data: updateData,
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
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

  async page(dto: PageWorkOrderDto): Promise<PaginationResult<any>> {
    const current = dto.current ?? 1;
    const size = dto.size ?? 10;

    const where: Prisma.PaintWorkOrderWhereInput = {
      ...(dto.shopId && { shopId: dto.shopId }),
      ...(dto.plateNumber && { plateNumber: { contains: dto.plateNumber } }),
      ...(dto.customerName && { customerName: { contains: dto.customerName } }),
      ...(dto.settlementMonth && { settlementMonth: dto.settlementMonth }),
      ...(dto.status && { status: dto.status as any }),
      ...(dto.isAudited !== undefined && { isAudited: dto.isAudited }),
    };

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

    let addedPaintCount = 0;
    const itemsData: ItemDataWithOrderId[] = [];
    for (const item of items) {
      const itemData = await this.calculateItemPaintCount(order.shopId, item);
      addedPaintCount += itemData.paintCount;
      itemsData.push({ orderId, ...itemData });
    }

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
    const date = new Date();

    // 查找今天该门店已有的最大序号
    const todayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    const todayOrders = await client.paintWorkOrder.findMany({
      where: {
        shopId,
        orderDate: { gte: todayStart, lte: todayEnd },
      },
      select: { orderNo: true },
      orderBy: { orderNo: 'desc' },
      take: 1,
    });

    let seq = 1;
    if (todayOrders.length > 0 && todayOrders[0].orderNo) {
      seq = parseOrderNoSeq(todayOrders[0].orderNo) + 1;
    }

    return formatOrderNo(shop?.code || '', date, seq);
  }
}
