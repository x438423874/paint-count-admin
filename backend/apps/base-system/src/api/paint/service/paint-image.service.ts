import { Injectable } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import path from 'path';
import fs from 'fs/promises';

@Injectable()
export class PaintImageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取图片存储的相对路径和绝对目录
   * 结构: uploads/paint/{门店编码}/{结算月份或'未结算'}/
   */
  async getImageStoragePath(shopId: string, settlementMonth?: string | null): Promise<{ relativeDir: string; absoluteDir: string }> {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    const shopCode = shop?.code || 'unknown';
    const monthDir = settlementMonth || '未结算';
    const relativeDir = `uploads/paint/${shopCode}/${monthDir}`;
    const absoluteDir = path.join(process.cwd(), relativeDir);
    await fs.mkdir(absoluteDir, { recursive: true });
    return { relativeDir, absoluteDir };
  }

  /**
   * 保存图片文件到指定目录，返回URL
   */
  async saveImageFile(buffer: Buffer, filename: string, shopId: string, settlementMonth?: string | null): Promise<string> {
    const { relativeDir, absoluteDir } = await this.getImageStoragePath(shopId, settlementMonth);
    const ext = path.extname(filename) || '.jpg';
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(absoluteDir, uniqueName);
    await fs.writeFile(filePath, buffer);
    return `/${relativeDir}/${uniqueName}`;
  }

  /**
   * 迁移图片文件（结算月份变更时）
   */
  async migrateImages(orderId: string, oldMonth: string | null, newMonth: string | null) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
      include: { images: true },
    });
    if (!order || !order.images.length) return;

    const { relativeDir: newRelativeDir, absoluteDir: newAbsoluteDir } = await this.getImageStoragePath(order.shopId, newMonth || undefined);

    for (const image of order.images) {
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

  /**
   * 删除单个图片的物理文件（高清图+缩略图）
   */
  async deletePhysicalFiles(url: string, thumbnailUrl?: string | null) {
    for (const fileUrl of [url, thumbnailUrl]) {
      if (!fileUrl) continue;
      const absolutePath = path.join(process.cwd(), fileUrl.replace(/^\//, ''));
      try {
        await fs.access(absolutePath);
        await fs.unlink(absolutePath);
      } catch {
        // 文件不存在则跳过
      }
    }
  }

  /**
   * 删除工单关联的所有图片文件（删除工单时调用）
   */
  async deleteOrderImages(orderId: string) {
    const images = await this.prisma.paintWorkOrderImage.findMany({
      where: { orderId },
    });

    for (const image of images) {
      await this.deletePhysicalFiles(image.url, image.thumbnailUrl);
    }
  }

  /**
   * 清理冗余图片：扫描磁盘文件，删除数据库中无记录的文件
   * 返回清理的文件列表
   */
  async cleanOrphanedFiles(): Promise<{ deleted: string[]; errors: string[] }> {
    const deleted: string[] = [];
    const errors: string[] = [];
    const paintDir = path.join(process.cwd(), 'uploads/paint');

    // 检查目录是否存在
    try {
      await fs.access(paintDir);
    } catch {
      return { deleted, errors };
    }

    // 1. 获取数据库中所有图片URL
    const dbImages = await this.prisma.paintWorkOrderImage.findMany({
      select: { url: true, thumbnailUrl: true },
    });
    const dbUrls = new Set<string>();
    for (const img of dbImages) {
      if (img.url) dbUrls.add(img.url);
      if (img.thumbnailUrl) dbUrls.add(img.thumbnailUrl);
    }

    // 2. 递归扫描磁盘文件
    const diskFiles = await this.scanDirectory(paintDir);

    // 3. 找出冗余文件（磁盘存在但数据库无记录）
    for (const diskFile of diskFiles) {
      const relativeUrl = `/${path.relative(process.cwd(), diskFile).replace(/\\/g, '/')}`;
      if (!dbUrls.has(relativeUrl)) {
        try {
          await fs.unlink(diskFile);
          deleted.push(relativeUrl);
        } catch (e: any) {
          errors.push(`${relativeUrl}: ${e.message}`);
        }
      }
    }

    // 4. 清理空目录
    await this.cleanEmptyDirs(paintDir);

    return { deleted, errors };
  }

  /**
   * 递归扫描目录下所有文件
   */
  private async scanDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return files;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.scanDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  }

  /**
   * 递归清理空目录（保留根目录）
   */
  private async cleanEmptyDirs(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name);
        await this.cleanEmptyDirs(subDir);
        // 检查清理后是否为空
        try {
          const remaining = await fs.readdir(subDir);
          if (remaining.length === 0) {
            await fs.rmdir(subDir);
          }
        } catch {
          // 忽略
        }
      }
    }
  }
}
