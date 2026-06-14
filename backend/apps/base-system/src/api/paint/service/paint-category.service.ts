import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

@Injectable()
export class PaintCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.paintItemCategory.findMany({
      where: { shopId: null },
      orderBy: [{ sortOrder: 'asc' }],
    });
  }

  async create(data: { name: string; code: string; sortOrder?: number; isSpecial?: boolean }) {
    if (!data.name?.trim()) {
      throw new BadRequestException('部位名称不能为空');
    }
    if (!data.code?.trim()) {
      throw new BadRequestException('部位编码不能为空');
    }
    const existing = await this.prisma.paintItemCategory.findFirst({ where: { code: data.code.trim() } });
    if (existing) {
      throw new BadRequestException('部位编码已存在');
    }
    return this.prisma.paintItemCategory.create({
      data: {
        name: data.name.trim(),
        code: data.code.trim(),
        sortOrder: data.sortOrder ?? 0,
        isSpecial: data.isSpecial ?? false,
        shopId: null,
      },
    });
  }

  async update(id: string, data: { name?: string; code?: string; sortOrder?: number; isSpecial?: boolean }) {
    return this.prisma.paintItemCategory.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    const templateItemCount = await this.prisma.paintStandardTemplateItem.count({ where: { categoryId: id } });
    if (templateItemCount > 0) {
      throw new BadRequestException(`该部位已被 ${templateItemCount} 个标准模板项目引用，无法删除`);
    }
    const orderItemCount = await this.prisma.paintWorkOrderItem.count({ where: { categoryId: id } });
    if (orderItemCount > 0) {
      throw new BadRequestException(`该部位已被 ${orderItemCount} 个工单引用，无法删除`);
    }
    await this.prisma.paintItemCategory.delete({ where: { id } });
  }
}
