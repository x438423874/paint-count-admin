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

  /** 获取门店的可用类别及标准：优先从关联的标准模板获取，没有模板则返回空。按使用频次排序（使用越多的部位越靠前） */
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

    // 统计每个部位的使用频次（该门店所有工单中该部位被使用的次数）
    const usageCounts = await (this.prisma as any).paintWorkOrderItem.groupBy({
      by: ['categoryId'],
      where: {
        order: { shopId },
      },
      _sum: { quantity: true },
    });
    const usageMap = new Map<string, number>();
    for (const uc of usageCounts) {
      usageMap.set(uc.categoryId, uc._sum.quantity || 0);
    }

    // 从标准模板项目获取部位和系数，按使用频次降序排序（使用多的在前），频次相同的按sortOrder排
    const items = shop.standardTemplate.items.map((item: any) => ({
      categoryId: item.categoryId,
      category: item.category,
      coefficient: item.coefficient,
      newPartAddition: item.newPartAddition || 0,
      alias: item.alias || item.category?.name || null,
      specialPaintId: item.specialPaintId || null,
      specialPaint: item.specialPaint || null,
      standardId: item.id,
      _usageCount: usageMap.get(item.categoryId) || 0,
    }));

    items.sort((a: any, b: any) => {
      // 使用频次高的在前
      if (b._usageCount !== a._usageCount) return b._usageCount - a._usageCount;
      // 频次相同，按sortOrder排
      return (a.category?.sortOrder || 0) - (b.category?.sortOrder || 0);
    });

    return items.map(({ _usageCount, ...rest }: any) => rest);
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

  /** 查询单个标准所属门店 ID，用于数据权限校验 */
  async findShopIdByStandardId(id: string): Promise<string | null> {
    const standard = await (this.prisma as any).paintStandard.findUnique({
      where: { id },
      select: { shopId: true },
    });
    return standard?.shopId ?? null;
  }
}
