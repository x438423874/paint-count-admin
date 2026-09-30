import { Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { FastifyReply, FastifyRequest } from 'fastify';

import { PrismaService } from '@lib/shared/prisma/prisma.service';

import { UserShopService } from '../../service/user-shop.service';
import { BACKEND_ROOT, UPLOAD_DIR } from '../../service/upload-root';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * 上传文件受控访问。
 *
 * 此前 /uploads 通过 fastifyStatic 公开挂载，任何未认证请求可直接下载工单照片
 * （含车牌、客户姓名、电话）。现改为 Nest 控制器流式返回：
 *  - 鉴权：全局 JwtAuthGuard（支持 ?access_token= 查询参数，供 <img> 标签使用）
 *  - 数据权限：路径形如 /uploads/paint/{门店编码}/{结算月份}/{文件}，
 *    按门店编码反查门店后走 assertShopAccess（超管/财务 bypass）
 *  - 防目录穿越：解析后的绝对路径必须位于 UPLOAD_DIR 之内
 */
@ApiTags('Paint - Uploads')
@Controller('uploads')
export class UploadsController {
  /** 门店编码 → shopId 缓存（门店极少变更，5 分钟过期） */
  private readonly shopCodeCache = new Map<string, { shopId: string | null; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly userShopService: UserShopService,
  ) {}

  @Get('paint/:shopCode/:month/:file')
  @ApiOperation({ summary: '受控访问上传的工单图片（需登录 + 门店数据权限）' })
  async serve(
    @Param('shopCode') shopCode: string,
    @Param('month') month: string,
    @Param('file') file: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    // 存储结构固定为 uploads/paint/{门店编码}/{结算月份|未结算}/{文件}
    const relative = `uploads/paint/${shopCode}/${month}/${file}`;

    // 防目录穿越：解析后的绝对路径必须落在 uploads 目录内
    const absolute = path.resolve(BACKEND_ROOT, relative);
    if (!absolute.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      throw new NotFoundException('图片路径不合法');
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new NotFoundException('图片不存在或已被删除');
    }

    const shopId = await this.resolveShopId(shopCode);
    if (!shopId) {
      throw new NotFoundException('图片所属门店不存在');
    }
    const user = (request as any).user;
    await this.userShopService.assertShopAccess(user.uid, shopId);

    const stat = statSync(absolute);
    reply
      .type(MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream')
      .header('Cache-Control', 'private, max-age=3600')
      .header('Content-Length', stat.size)
      .send(createReadStream(absolute));
  }

  private async resolveShopId(shopCode: string): Promise<string | null> {
    const hit = this.shopCodeCache.get(shopCode);
    if (hit && Date.now() - hit.at < 5 * 60_000) {
      return hit.shopId;
    }
    const shop = await this.prisma.paintShop.findUnique({
      where: { code: shopCode },
      select: { id: true },
    });
    this.shopCodeCache.set(shopCode, { shopId: shop?.id || null, at: Date.now() });
    return shop?.id || null;
  }
}
