import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

/** 标注区域坐标 */
export interface AnnotationRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 创建标注请求 */
export interface CreateAnnotationDto {
  shopId: string;
  orderId?: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  regions: Record<string, AnnotationRegion | null>;
  groundTruth?: Record<string, string>;
  isVerified?: boolean; // 可选，默认 false（待验证）。校准100%准确率时系统设为 true
}

/** 聚合模板结果 */
export interface AggregatedTemplate {
  name: string;
  imageWidth: number;
  imageHeight: number;
  regions: Record<string, { x: number; y: number; width: number; height: number }>;
  annotationCount: number; // 参与聚合的标注数量
  fieldCoverage: Record<string, number>; // 每个字段的标注覆盖率
}

/**
 * OCR 标注服务
 * 管理标注数据的 CRUD 和聚合逻辑
 * 标注越多 → 聚合模板越准 → 识别越好
 */
@Injectable()
export class OcrAnnotationService {
  private readonly logger = new Logger(OcrAnnotationService.name);

  /** 聚合模板缓存：shopId -> { template, expireAt } */
  private templateCache = new Map<string, { template: AggregatedTemplate | null; expireAt: number }>();
  /** 缓存有效期：5 分钟 */
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 使指定门店的聚合模板缓存失效
   * 在标注创建/更新/删除/验证状态变更时调用
   */
  invalidateTemplateCache(shopId: string): void {
    if (this.templateCache.delete(shopId)) {
      this.logger.debug(`聚合模板缓存已失效: shopId=${shopId}`);
    }
  }

  /**
   * 保存标注（同一工单+同一图片去重：已存在则更新）
   */
  async createAnnotation(dto: CreateAnnotationDto): Promise<any> {
    // 去重：同一门店+同一工单+同一图片，只保留最新标注
    if (dto.orderId && dto.imageUrl) {
      const existing = await this.prisma.ocrAnnotation.findFirst({
        where: {
          shopId: dto.shopId,
          orderId: dto.orderId,
          imageUrl: dto.imageUrl,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        // 更新已有标注（覆盖旧数据）
        // 如果传入 isVerified=true（校准100%），则设为已验证；否则重置为待验证
        const updated = await this.prisma.ocrAnnotation.update({
          where: { id: existing.id },
          data: {
            imageWidth: dto.imageWidth,
            imageHeight: dto.imageHeight,
            regions: dto.regions as any,
            groundTruth: dto.groundTruth ? dto.groundTruth as any : undefined,
            isVerified: dto.isVerified === true, // 只有系统校准100%时才为true
          },
        });
        this.logger.log(`更新标注: id=${updated.id}, shop=${dto.shopId}, order=${dto.orderId}, verified=${updated.isVerified}`);
        this.invalidateTemplateCache(dto.shopId);
        return updated;
      }
    }

    const annotation = await this.prisma.ocrAnnotation.create({
      data: {
        shopId: dto.shopId,
        orderId: dto.orderId,
        imageUrl: dto.imageUrl,
        imageWidth: dto.imageWidth,
        imageHeight: dto.imageHeight,
        regions: dto.regions as any,
        groundTruth: dto.groundTruth ? dto.groundTruth as any : undefined,
        isVerified: dto.isVerified === true, // 只有系统校准100%时才为true
      },
    });

    this.logger.log(`保存标注: id=${annotation.id}, shop=${dto.shopId}, order=${dto.orderId || 'N/A'}`);
    this.invalidateTemplateCache(dto.shopId);
    return annotation;
  }

  /**
   * 查询门店的所有标注
   */
  async getAnnotations(shopId: string, page?: number, pageSize?: number) {
    const skip = page && pageSize ? (page - 1) * pageSize : undefined;
    const take = pageSize;

    const [list, total] = await Promise.all([
      this.prisma.ocrAnnotation.findMany({
        where: { shopId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.ocrAnnotation.count({ where: { shopId } }),
    ]);

    return { list, total };
  }

  /**
   * 获取门店已标注的工单ID列表（用于前端区分已标注/未标注）
   */
  async getAnnotatedOrderIds(shopId: string): Promise<string[]> {
    const annotations = await this.prisma.ocrAnnotation.findMany({
      where: { shopId, orderId: { not: null } },
      select: { orderId: true },
    });
    return annotations.map(a => a.orderId!).filter(Boolean);
  }

  /**
   * 删除标注
   */
  async deleteAnnotation(id: string, shopId: string): Promise<void> {
    await this.prisma.ocrAnnotation.deleteMany({
      where: { id, shopId },
    });
    this.logger.log(`删除标注: id=${id}`);
    this.invalidateTemplateCache(shopId);
  }

  /**
   * 聚合标注数据生成最优模板
   *
   * 原理：
   * 1. 收集该门店所有已验证的标注
   * 2. 对每个字段，计算所有标注区域的加权平均位置（相对坐标）
   * 3. 排除异常值（偏离中位数太远的）
   * 4. 输出聚合后的最优模板
   *
   * 标注越多 → 统计样本越大 → 模板越准确
   */
  async aggregateTemplate(shopId: string): Promise<AggregatedTemplate | null> {
    // 检查缓存
    const cached = this.templateCache.get(shopId);
    if (cached && cached.expireAt > Date.now()) {
      this.logger.debug(`使用聚合模板缓存: shopId=${shopId}`);
      return cached.template;
    }

    // 获取所有已验证的标注
    const allAnnotations = await this.prisma.ocrAnnotation.findMany({
      where: { shopId, isVerified: true },
      orderBy: { createdAt: 'desc' },
    });

    // 过滤掉无效标注：必须有图片尺寸且至少有一个区域标注
    // 无效标注（image_width=0 或 regions 为空）会污染聚合模板的坐标计算
    const annotations = allAnnotations.filter(ann => {
      if (!ann.imageWidth || !ann.imageHeight || ann.imageWidth <= 0 || ann.imageHeight <= 0) {
        return false;
      }
      const regions = ann.regions as any;
      if (!regions || typeof regions !== 'object') return false;
      return Object.values(regions).some((v: any) => v !== null && v !== undefined && typeof v.x === 'number');
    });

    this.logger.log(`聚合模板: 共 ${allAnnotations.length} 条已验证标注，其中 ${annotations.length} 条有效`);

    // 至少需要1条有效标注即可生成聚合模板（单条也能用，只是没有多条聚合的优势）
    let template: AggregatedTemplate | null = null;
    if (annotations.length >= 1) {
      template = this.computeAggregatedTemplate(annotations, shopId);
    }

    // 写入缓存
    this.templateCache.set(shopId, {
      template,
      expireAt: Date.now() + OcrAnnotationService.CACHE_TTL_MS,
    });

    return template;
  }

  /**
   * 计算聚合模板的核心算法
   */
  private computeAggregatedTemplate(annotations: any[], shopId: string): AggregatedTemplate {
    const fields = ['orderNo', 'plateNumber', 'customerName', 'phone', 'carModel'];
    const aggregatedRegions: Record<string, any> = {};
    const fieldCoverage: Record<string, number> = {};

    // 使用平均图片尺寸
    let avgWidth = 0;
    let avgHeight = 0;

    for (const ann of annotations) {
      avgWidth += ann.imageWidth || 0;
      avgHeight += ann.imageHeight || 0;
    }
    avgWidth = Math.round(avgWidth / annotations.length);
    avgHeight = Math.round(avgHeight / annotations.length);

    for (const field of fields) {
      // 收集该字段所有有效的区域标注
      const validRegions: Array<{ x: number; y: number; w: number; h: number }> = [];

      for (const ann of annotations) {
        const regions = ann.regions as any;
        if (regions && regions[field]) {
          const r = regions[field];
          // 归一化为相对坐标（0-1范围），消除不同图片尺寸的影响
          const imgW = ann.imageWidth || avgWidth || 1;
          const imgH = ann.imageHeight || avgHeight || 1;
          validRegions.push({
            x: r.x / imgW,
            y: r.y / imgH,
            w: r.width / imgW,
            h: r.height / imgH,
          });
        }
      }

      fieldCoverage[field] = validRegions.length;

      if (validRegions.length === 0) {
        continue;
      }

      if (validRegions.length === 1) {
        // 只有一个标注，直接使用
        const r = validRegions[0];
        aggregatedRegions[field] = {
          x: Math.round(r.x * avgWidth),
          y: Math.round(r.y * avgHeight),
          width: Math.round(r.w * avgWidth),
          height: Math.round(r.h * avgHeight),
        };
        continue;
      }

      // 多个标注：计算加权平均（排除异常值）
      // 1. 计算各维度的中位数
      const xs = validRegions.map(r => r.x).sort((a, b) => a - b);
      const ys = validRegions.map(r => r.y).sort((a, b) => a - b);
      const ws = validRegions.map(r => r.w).sort((a, b) => a - b);
      const hs = validRegions.map(r => r.h).sort((a, b) => a - b);

      const medianX = xs[Math.floor(xs.length / 2)];
      const medianY = ys[Math.floor(ys.length / 2)];
      const medianW = ws[Math.floor(ws.length / 2)];
      const medianH = hs[Math.floor(hs.length / 2)];

      // 2. 计算MAD（绝对中位差）用于异常检测
      const madX = this.mad(xs.map(v => Math.abs(v - medianX)));
      const madY = this.mad(ys.map(v => Math.abs(v - medianY)));
      const madW = this.mad(ws.map(v => Math.abs(v - medianW)));
      const madH = this.mad(hs.map(v => Math.abs(v - medianH)));

      // 3. 过滤异常值（偏离中位数超过3倍MAD）
      const threshold = 3;
      const filtered = validRegions.filter(r =>
        Math.abs(r.x - medianX) <= threshold * madX &&
        Math.abs(r.y - medianY) <= threshold * madY &&
        Math.abs(r.w - medianW) <= threshold * madW &&
        Math.abs(r.h - medianH) <= threshold * madH
      );

      // 4. 对过滤后的数据取平均值
      const finalRegions = filtered.length > 2 ? filtered : validRegions;
      const avgX = finalRegions.reduce((s, r) => s + r.x, 0) / finalRegions.length;
      const avgY = finalRegions.reduce((s, r) => s + r.y, 0) / finalRegions.length;
      const avgW = finalRegions.reduce((s, r) => s + r.w, 0) / finalRegions.length;
      const avgH = finalRegions.reduce((s, r) => s + r.h, 0) / finalRegions.length;

      // 还原为绝对坐标
      aggregatedRegions[field] = {
        x: Math.round(avgX * avgWidth),
        y: Math.round(avgY * avgHeight),
        width: Math.round(avgW * avgWidth),
        height: Math.round(avgH * avgHeight),
      };

      this.logger.debug(
        `字段 ${field}: ${finalRegions.length}/${validRegions.length} 个有效标注, ` +
        `位置=(${Math.round(avgX * avgWidth)}, ${Math.round(avgY * avgHeight)}, ` +
        `${Math.round(avgW * avgWidth)}x${Math.round(avgH * avgHeight)})`
      );
    }

    return {
      name: `${shopId} 聚合模板 (${annotations.length}张标注)`,
      imageWidth: avgWidth,
      imageHeight: avgHeight,
      regions: aggregatedRegions,
      annotationCount: annotations.length,
      fieldCoverage,
    };
  }

  /**
   * 计算绝对中位差 (Median Absolute Deviation)
   */
  private mad(values: number[]): number {
    if (values.length === 0) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const devs = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
    const result = devs[Math.floor(devs.length / 2)];
    return result > 0 ? result : 1; // 避免除零
  }

  /**
   * 验证标注：将识别结果与实际值对比，标记是否正确
   */
  /** 获取标注所属门店ID（用于权限校验） */
  async getAnnotationShopId(id: string): Promise<string | null> {
    const annotation = await this.prisma.ocrAnnotation.findUnique({
      where: { id },
      select: { shopId: true },
    });
    return annotation?.shopId || null;
  }

  async verifyAnnotation(id: string, isCorrect: boolean): Promise<void> {
    // 先查询 shopId 用于失效缓存
    const annotation = await this.prisma.ocrAnnotation.findUnique({
      where: { id },
      select: { shopId: true },
    });

    await this.prisma.ocrAnnotation.update({
      where: { id },
      data: { isVerified: isCorrect },
    });

    if (annotation?.shopId) {
      this.invalidateTemplateCache(annotation.shopId);
    }
  }

  /**
   * 获取门店标注统计
   */
  async getStats(shopId: string) {
    const [total, verified, unverified] = await Promise.all([
      this.prisma.ocrAnnotation.count({ where: { shopId } }),
      this.prisma.ocrAnnotation.count({ where: { shopId, isVerified: true } }),
      this.prisma.ocrAnnotation.count({ where: { shopId, isVerified: false } }),
    ]);

    // 各字段覆盖率
    const annotations = await this.prisma.ocrAnnotation.findMany({
      where: { shopId },
    });

    const fieldCounts: Record<string, number> = {
      orderNo: 0,
      plateNumber: 0,
      customerName: 0,
      phone: 0,
      carModel: 0,
    };

    for (const ann of annotations) {
      const regions = ann.regions as any;
      for (const field of Object.keys(fieldCounts)) {
        if (regions && regions[field]) {
          fieldCounts[field]++;
        }
      }
    }

    return {
      total,
      verified,
      unverified,
      coverage: fieldCounts,
    };
  }

  /**
   * 修复脏数据：没有有效区域标注但 isVerified=true 的记录，重置为待验证
   */
  async fixInvalidVerifiedStatus(shopId?: string): Promise<{ fixed: number }> {
    const where: any = { isVerified: true };
    if (shopId) where.shopId = shopId;

    const verifiedAnnotations = await this.prisma.ocrAnnotation.findMany({
      where,
      select: { id: true, regions: true },
    });

    const invalidIds: string[] = [];
    for (const ann of verifiedAnnotations) {
      const regions = ann.regions as any;
      const hasValidRegions = regions && typeof regions === 'object' &&
        Object.values(regions).some((v: any) => v !== null && v !== undefined);
      if (!hasValidRegions) {
        invalidIds.push(ann.id);
      }
    }

    if (invalidIds.length > 0) {
      await this.prisma.ocrAnnotation.updateMany({
        where: { id: { in: invalidIds } },
        data: { isVerified: false },
      });
      this.logger.log(`修复脏数据: ${invalidIds.length} 条无区域标注的已验证记录重置为待验证`);
      // 失效相关缓存
      if (shopId) {
        this.invalidateTemplateCache(shopId);
      } else {
        // 全局修复，清除所有缓存
        this.templateCache.clear();
      }
    }

    return { fixed: invalidIds.length };
  }
}
