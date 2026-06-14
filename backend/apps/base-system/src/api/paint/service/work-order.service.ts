import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { CreateWorkOrderDto, UpdateWorkOrderDto, PageWorkOrderDto, WorkOrderItemDto, AuditWorkOrderDto } from '../work-order/dto/work-order.dto';
import { PaginationResult } from '@lib/shared/prisma/pagination';
import { PaintImageType, Prisma } from '@prisma/client';

interface OrderItemCreateData {
  categoryId: string;
  quantity: number;
  paintCount: number;
  isNewPart: boolean;
  specialPaintId?: string | null;
  specialPaintMultiplier?: number | null;
}

interface ItemDataWithOrderId extends OrderItemCreateData {
  orderId: string;
}

@Injectable()
export class WorkOrderService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取图片存储的相对路径和绝对目录
   * 结构: uploads/paint/{门店名称}/{结算月份或'未结算'}/
   */
  private async getImageStoragePath(shopId: string, settlementMonth?: string | null): Promise<{ relativeDir: string; absoluteDir: string }> {
    const path = await import('path');
    const fs = await import('fs/promises');
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    const shopName = shop?.name || '未知门店';
    const monthDir = settlementMonth || '未结算';
    const relativeDir = `uploads/paint/${shopName}/${monthDir}`;
    const absoluteDir = path.join(process.cwd(), relativeDir);
    await fs.mkdir(absoluteDir, { recursive: true });
    return { relativeDir, absoluteDir };
  }

  /**
   * 保存图片文件到指定目录，返回URL
   */
  private async saveImageFile(buffer: Buffer, filename: string, shopId: string, settlementMonth?: string | null): Promise<string> {
    const path = await import('path');
    const { relativeDir, absoluteDir } = await this.getImageStoragePath(shopId, settlementMonth);
    const ext = path.extname(filename) || '.jpg';
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(absoluteDir, uniqueName);
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, buffer);
    return `/${relativeDir}/${uniqueName}`;
  }

  /**
   * 迁移图片文件（结算月份变更时）
   */
  private async migrateImages(orderId: string, oldMonth: string | null, newMonth: string | null) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
      include: { images: true },
    });
    if (!order || !order.images.length) return;

    const path = await import('path');
    const fs = await import('fs/promises');
    const { relativeDir: newRelativeDir, absoluteDir: newAbsoluteDir } = await this.getImageStoragePath(order.shopId, newMonth || undefined);

    for (const image of order.images) {
      // 迁移高清图和缩略图
      const urls: { oldUrl: string; field: 'url' | 'thumbnailUrl' }[] = [
        { oldUrl: image.url, field: 'url' },
      ];
      if (image.thumbnailUrl) {
        urls.push({ oldUrl: image.thumbnailUrl, field: 'thumbnailUrl' });
      }

      const updateData: Record<string, string> = {};
      for (const { oldUrl, field } of urls) {
        const oldAbsolutePath = path.join(process.cwd(), oldUrl.replace(/^\//, ''));
        const filename = path.basename(oldUrl);
        const newAbsolutePath = path.join(newAbsoluteDir, filename);

        try {
          await fs.access(oldAbsolutePath);
          await fs.rename(oldAbsolutePath, newAbsolutePath);
        } catch {
          // 文件不存在则跳过
        }
        updateData[field] = `/${newRelativeDir}/${filename}`;
      }

      await this.prisma.paintWorkOrderImage.update({
        where: { id: image.id },
        data: updateData,
      });
    }
  }

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
    const newPartAddition = (item.isNewPart && templateItem) ? Number(templateItem.newPartAddition) : 0;
    const quantity = item.quantity || 1;

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

    // 幅数 = (系数 + 新件加幅) * 数量 * 特殊车漆倍数
    const basePaintCount = (coefficient + newPartAddition) * quantity;
    const paintCount = specialPaintMultiplier ? basePaintCount * specialPaintMultiplier : basePaintCount;

    return {
      categoryId: item.categoryId,
      quantity,
      paintCount,
      isNewPart: item.isNewPart || false,
      specialPaintId,
      specialPaintMultiplier,
    };
  }

  async quickCreate(shopId: string, buffer: Buffer, filename: string, mimetype: string, settlementMonth?: string, plateNumber?: string, ocrOrderNo?: string, thumbnailBuffer?: Buffer | null) {
    const orderNo = ocrOrderNo || await this.generateOrderNo(shopId);
    const orderDate = new Date();

    const order = await this.prisma.paintWorkOrder.create({
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

    const url = await this.saveImageFile(buffer, filename, shopId, settlementMonth);
    let thumbnailUrl: string | undefined;
    if (thumbnailBuffer) {
      thumbnailUrl = await this.saveImageFile(thumbnailBuffer, `thumb_${filename}`, shopId, settlementMonth);
    }
    await this.prisma.paintWorkOrderImage.create({
      data: { orderId: order.id, url, thumbnailUrl, imageType: PaintImageType.BEFORE, fileSize: buffer.length },
    });

    return this.findById(order.id);
  }

  async create(dto: CreateWorkOrderDto) {
    const orderNo = dto.orderNo || await this.generateOrderNo(dto.shopId);

    let totalPaintCount = 0;
    const itemsData: OrderItemCreateData[] = [];

    if (dto.items?.length) {
      const categoryIds = dto.items.map(i => i.categoryId);
      const duplicates = categoryIds.filter((id, idx) => categoryIds.indexOf(id) !== idx);
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

    if (dto.settlementMonth !== undefined) {
      const oldMonth = existing.settlementMonth;
      const newMonth = dto.settlementMonth || null;
      updateData.settlementMonth = newMonth;
      // 结算月份变更时迁移图片文件
      if (oldMonth !== newMonth) {
        await this.migrateImages(dto.id, oldMonth, newMonth);
      }
    }

    if (dto.items !== undefined) {
      const categoryIds = dto.items.map(i => i.categoryId);
      const duplicates = categoryIds.filter((id, idx) => categoryIds.indexOf(id) !== idx);
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

    return this.prisma.paintWorkOrder.delete({ where: { id } });
  }

  /** 审核工单 */
  async audit(dto: AuditWorkOrderDto) {
    const existing = await this.prisma.paintWorkOrder.findUnique({ where: { id: dto.id } });
    if (!existing) throw new NotFoundException('工单不存在');

    if (existing.isAudited) {
      throw new BadRequestException('工单已审核，不能重复审核');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id: dto.id },
      data: {
        isAudited: true,
        auditedAt: new Date(),
        auditedBy: dto.auditedBy || null,
        status: 'COMPLETED',
      },
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
    });
  }

  /** 取消审核 */
  async unaudit(id: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('工单不存在');

    if (!existing.isAudited) {
      throw new BadRequestException('工单未审核，无需取消');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id },
      data: {
        isAudited: false,
        auditedAt: null,
        auditedBy: null,
        status: 'PENDING',
      },
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
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
        orderBy: { orderDate: 'desc' },
        include: {
          items: { include: { category: true, specialPaint: true } },
          images: { orderBy: { createdAt: 'desc' } },
          shop: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.paintWorkOrder.count({ where }),
    ]);
    return { current, size, total, records };
  }

  async addItems(orderId: string, items: WorkOrderItemDto[]) {
    const order = await this.prisma.paintWorkOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('工单不存在');

    // 已审核的工单不允许添加项目
    if (order.isAudited) {
      throw new BadRequestException('已审核的工单不允许修改');
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

    const url = await this.saveImageFile(buffer, filename, order.shopId, order.settlementMonth);
    let thumbnailUrl: string | undefined;
    if (thumbnailBuffer) {
      thumbnailUrl = await this.saveImageFile(thumbnailBuffer, `thumb_${filename}`, order.shopId, order.settlementMonth);
    }
    return this.prisma.paintWorkOrderImage.create({
      data: { orderId, url, thumbnailUrl, imageType, description, fileSize: buffer.length },
    });
  }

  async removeImage(imageId: string) {
    const image = await this.prisma.paintWorkOrderImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('图片不存在');

    // 删除物理文件（高清图+缩略图）
    const path = await import('path');
    const fs = await import('fs/promises');
    for (const url of [image.url, image.thumbnailUrl]) {
      if (!url) continue;
      const absolutePath = path.join(process.cwd(), url.replace(/^\//, ''));
      try {
        await fs.access(absolutePath);
        await fs.unlink(absolutePath);
      } catch {
        // 文件不存在则跳过
      }
    }

    return this.prisma.paintWorkOrderImage.delete({ where: { id: imageId } });
  }

  private async generateOrderNo(shopId: string): Promise<string> {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const prefix = shop?.code || 'P';

    // 查找今天该门店已有的最大序号，避免并发竞态
    const todayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    const todayOrders = await this.prisma.paintWorkOrder.findMany({
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
      const lastSeq = todayOrders[0].orderNo.slice(-4);
      seq = parseInt(lastSeq, 10) + 1;
    }

    return `${prefix}${dateStr}${String(seq).padStart(4, '0')}`;
  }
}
