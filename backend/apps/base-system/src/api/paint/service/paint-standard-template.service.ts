import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { CreateStandardTemplateDto, UpdateStandardTemplateDto } from '../standard/dto/standard-template.dto';

@Injectable()
export class PaintStandardTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStandardTemplateDto) {
    const { items, ...data } = dto;
    return this.prisma.paintStandardTemplate.create({
      data: {
        ...data,
        isActive: data.isActive ?? true,
        items: items?.length
          ? {
              create: items.map(i => ({
                categoryId: i.categoryId,
                coefficient: i.coefficient ?? 0,
                newPartAddition: i.newPartAddition ?? 0,
                alias: i.alias || null,
                specialPaintId: i.specialPaintId || null,
                unit: '幅',
              })),
            }
          : undefined,
      },
      include: { items: { include: { category: true, specialPaint: true } } },
    });
  }

  async update(dto: UpdateStandardTemplateDto) {
    const { id, items, ...data } = dto;
    const existing = await this.prisma.paintStandardTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('标准模板不存在');

    if (items !== undefined) {
      // 替换所有项目
      await this.prisma.paintStandardTemplateItem.deleteMany({ where: { templateId: id } });
      if (items.length > 0) {
        await this.prisma.paintStandardTemplateItem.createMany({
          data: items.map(i => ({
            templateId: id,
            categoryId: i.categoryId,
            coefficient: i.coefficient ?? 0,
            newPartAddition: i.newPartAddition ?? 0,
            alias: i.alias || null,
            specialPaintId: i.specialPaintId || null,
            unit: '幅',
          })),
        });
      }
    }

    return this.prisma.paintStandardTemplate.update({
      where: { id },
      data,
      include: { items: { include: { category: true, specialPaint: true } } },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.paintStandardTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('标准模板不存在');

    // 检查是否有门店正在使用
    const shopCount = await this.prisma.paintShop.count({ where: { standardTemplateId: id } });
    if (shopCount > 0) {
      throw new Error(`该标准模板已被 ${shopCount} 个门店使用，无法删除`);
    }

    return this.prisma.paintStandardTemplate.delete({ where: { id } });
  }

  async findById(id: string) {
    return this.prisma.paintStandardTemplate.findUnique({
      where: { id },
      include: { items: { include: { category: true, specialPaint: true } }, shops: { select: { id: true, name: true, code: true } } },
    });
  }

  async findAll() {
    return this.prisma.paintStandardTemplate.findMany({
      include: { _count: { select: { shops: true, items: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 将标准模板应用到门店：复制模板项目到门店的 PaintStandard */
  async applyToShop(templateId: string, shopId: string) {
    const template = await this.prisma.paintStandardTemplate.findUnique({
      where: { id: templateId },
      include: { items: true },
    });
    if (!template) throw new NotFoundException('标准模板不存在');

    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('门店不存在');

    // 删除门店旧标准，写入模板标准
    await this.prisma.paintStandard.deleteMany({ where: { shopId } });

    if (template.items.length > 0) {
      await this.prisma.paintStandard.createMany({
        data: template.items.map(item => ({
          shopId,
          categoryId: item.categoryId,
          coefficient: item.coefficient,
          newPartAddition: item.newPartAddition,
          alias: item.alias,
          unit: item.unit,
        })),
      });
    }

    // 更新门店关联的标准模板
    await this.prisma.paintShop.update({
      where: { id: shopId },
      data: { standardTemplateId: templateId },
    });

    return { applied: template.items.length };
  }
}
