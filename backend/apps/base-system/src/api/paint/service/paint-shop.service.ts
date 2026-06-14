import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { CreateShopDto, UpdateShopDto, PageShopDto } from '../shop/dto/shop.dto';
import { PaginationResult } from '@lib/shared/prisma/pagination';

@Injectable()
export class PaintShopService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateShopDto) {
    const data: any = {
      name: dto.name,
      code: dto.code,
      brand: dto.brand,
      address: dto.address,
      phone: dto.phone,
    };

    // 如果指定了标准模板，关联并复制标准到门店
    let template: any = null;
    if (dto.standardTemplateId) {
      template = await this.prisma.paintStandardTemplate.findUnique({
        where: { id: dto.standardTemplateId },
        include: { items: true },
      });
      if (!template) throw new NotFoundException('标准模板不存在');
      data.standardTemplateId = dto.standardTemplateId;
    }

    const shop = await this.prisma.paintShop.create({ data });

    // 如果关联了标准模板，复制模板项目到门店标准
    if (template?.items.length) {
      await this.prisma.paintStandard.createMany({
        data: template.items.map((item: any) => ({
          shopId: shop.id,
          categoryId: item.categoryId,
          coefficient: item.coefficient,
          newPartAddition: item.newPartAddition,
          alias: item.alias,
          unit: item.unit,
        })),
      });
    }

    return this.findById(shop.id);
  }

  async update(dto: UpdateShopDto) {
    const existing = await this.prisma.paintShop.findUnique({ where: { id: dto.id } });
    if (!existing) throw new NotFoundException('店铺不存在');

    const data: any = {
      name: dto.name,
      brand: dto.brand,
      address: dto.address,
      phone: dto.phone,
    };

    // 如果更换了标准模板，重新复制标准到门店
    if (dto.standardTemplateId !== undefined && dto.standardTemplateId !== existing.standardTemplateId) {
      data.standardTemplateId = dto.standardTemplateId || null;

      if (dto.standardTemplateId) {
        const template = await this.prisma.paintStandardTemplate.findUnique({
          where: { id: dto.standardTemplateId },
          include: { items: true },
        });
        if (!template) throw new NotFoundException('标准模板不存在');

        // 删除旧标准，写入模板标准
        await this.prisma.paintStandard.deleteMany({ where: { shopId: dto.id } });
        if (template.items.length) {
          await this.prisma.paintStandard.createMany({
            data: template.items.map((item: any) => ({
              shopId: dto.id,
              categoryId: item.categoryId,
              coefficient: item.coefficient,
              newPartAddition: item.newPartAddition,
              alias: item.alias,
              unit: item.unit,
            })),
          });
        }
      }
    }

    return this.prisma.paintShop.update({
      where: { id: dto.id },
      data,
      include: { standards: { include: { category: true } }, standardTemplate: true },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.paintShop.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('店铺不存在');

    // 检查是否有关联的工单
    const orderCount = await this.prisma.paintWorkOrder.count({ where: { shopId: id } });
    if (orderCount > 0) {
      throw new BadRequestException(`该门店有 ${orderCount} 个工单，无法删除`);
    }

    return this.prisma.paintShop.delete({ where: { id } });
  }

  async findById(id: string) {
    return this.prisma.paintShop.findUnique({
      where: { id },
      include: {
        standards: { include: { category: true } },
        standardTemplate: true,
      },
    });
  }

  async page(dto: PageShopDto): Promise<PaginationResult<any>> {
    const current = dto.current ?? 1;
    const size = dto.size ?? 10;

    const where = {
      ...(dto.name && { name: { contains: dto.name, mode: 'insensitive' as const } }),
      ...(dto.brand && { brand: { contains: dto.brand, mode: 'insensitive' as const } }),
    };
    const [records, total] = await Promise.all([
      this.prisma.paintShop.findMany({
        where,
        skip: (current - 1) * size,
        take: size,
        orderBy: { createdAt: 'desc' },
        include: { standardTemplate: { select: { id: true, name: true } } },
      }),
      this.prisma.paintShop.count({ where }),
    ]);
    return { current, size, total, records };
  }

  async findAll() {
    return this.prisma.paintShop.findMany({
      orderBy: { createdAt: 'desc' },
      include: { standardTemplate: { select: { id: true, name: true } } },
    });
  }
}
