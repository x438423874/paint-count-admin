import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

@Injectable()
export class PaintSpecialPaintService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(templateId?: string, activeOnly?: boolean) {
    const where: any = {};
    if (templateId) where.templateId = templateId;
    if (activeOnly) where.isActive = true;
    return this.prisma.paintSpecialPaint.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(data: { templateId: string; name: string; multiplier: number; description?: string; isActive?: boolean }) {
    if (!data.templateId) {
      throw new BadRequestException('模板ID不能为空');
    }
    if (!data.name?.trim()) {
      throw new BadRequestException('车漆名称不能为空');
    }
    if (!data.multiplier || data.multiplier < 1) {
      throw new BadRequestException('倍数必须大于等于1');
    }
    return this.prisma.paintSpecialPaint.create({
      data: {
        templateId: data.templateId,
        name: data.name.trim(),
        multiplier: data.multiplier,
        description: data.description,
        isActive: data.isActive ?? true,
      },
    });
  }

  async update(id: string, data: { name?: string; multiplier?: number; description?: string; isActive?: boolean }) {
    return this.prisma.paintSpecialPaint.update({ where: { id }, data });
  }

  async delete(id: string) {
    const orderItemCount = await this.prisma.paintWorkOrderItem.count({ where: { specialPaintId: id } });
    if (orderItemCount > 0) {
      throw new BadRequestException(`该特殊车漆已被 ${orderItemCount} 个工单引用，无法删除`);
    }
    await this.prisma.paintSpecialPaint.delete({ where: { id } });
  }
}
