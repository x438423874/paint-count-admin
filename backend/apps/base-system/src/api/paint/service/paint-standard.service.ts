import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

@Injectable()
export class PaintStandardService {
  constructor(private readonly prisma: PrismaService) {}

  async findByShopId(shopId: string) {
    return (this.prisma as any).paintStandard.findMany({
      where: { shopId },
      include: { category: true },
      orderBy: { category: { sortOrder: 'asc' } },
    });
  }

  /** 获取门店的可用类别及标准：优先从关联的标准模板获取，没有模板则返回空 */
  async findShopCategoriesWithStandard(shopId: string) {
    // 查找门店关联的标准模板
    const shop = await (this.prisma as any).paintShop.findUnique({
      where: { id: shopId },
      include: { standardTemplate: { include: { items: { include: { category: true, specialPaint: true } } } } },
    });

    if (!shop) throw new NotFoundException('门店不存在');

    // 如果门店没有关联标准模板，返回空
    if (!shop.standardTemplate || !shop.standardTemplate.items?.length) {
      return [];
    }

    // 从标准模板项目获取部位和系数
    return shop.standardTemplate.items.map((item: any) => ({
      categoryId: item.categoryId,
      category: item.category,
      coefficient: item.coefficient,
      newPartAddition: item.newPartAddition || 0,
      alias: item.alias || item.category?.name || null,
      specialPaintId: item.specialPaintId || null,
      specialPaint: item.specialPaint || null,
      standardId: item.id,
    }));
  }

  async setShopStandards(shopId: string, standards: { categoryId: string; coefficient: number; newPartAddition?: number; alias?: string }[]) {
    const shop = await (this.prisma as any).paintShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('店铺不存在');

    await (this.prisma as any).paintStandard.deleteMany({ where: { shopId } });

    if (standards.length === 0) return [];

    return (this.prisma as any).paintStandard.createManyAndReturn({
      data: standards.map(s => ({
        shopId,
        categoryId: s.categoryId,
        coefficient: s.coefficient,
        newPartAddition: s.newPartAddition || 0,
        alias: s.alias || null,
        unit: '幅',
      })),
    });
  }

  async updateStandard(id: string, data: { coefficient?: number; newPartAddition?: number; alias?: string }) {
    return (this.prisma as any).paintStandard.update({
      where: { id },
      data,
    });
  }

  async deleteStandard(id: string) {
    return (this.prisma as any).paintStandard.delete({ where: { id } });
  }
}
