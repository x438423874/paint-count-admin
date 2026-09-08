import { Controller, Get, Post, Delete, Body, Query, Param, Req, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';

import { Log } from '@lib/infra/decorators/log.decorator';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';
import { ApiRes } from '@lib/infra/rest/res.response';

import { PendingImageService } from '../../service/pending-image.service';
import { UserShopService } from '../../service/user-shop.service';
import { PagePendingImageDto, ManualMatchDto, CreateOrderFromPendingDto, CorrectPendingImageOcrDto } from '../dto/pending-image.dto';


@ApiTags('Paint - PendingImage')
@Log('图片池')
@Controller('paint/pending-image')
export class PendingImageController {
  constructor(
    private readonly pendingImageService: PendingImageService,
    private readonly userShopService: UserShopService,
  ) {}

  /** 上传单张图片到图片池（上传即返回，OCR 后台异步识别） */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: '上传图片到图片池（OCR 后台异步识别 + 自动匹配工单）' })
  async upload(@Req() request: FastifyRequest) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    // 用 parts() 遍历全部 multipart 部分，不依赖字段与文件的顺序
    // （request.file() 的 data.fields 只含出现在文件之前的字段，前端 file 在前会导致 shopId 丢失）
    const parts = (request as any).parts();
    const fields: Record<string, string> = {};
    let buffer: Buffer | null = null;
    let filename = '';
    let mimetype = '';
    let thumbnailBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === 'file') {
        if (part.fieldname === 'thumbnail') {
          thumbnailBuffer = await part.toBuffer();
        } else if (!buffer) {
          buffer = await part.toBuffer();
          filename = part.filename;
          mimetype = part.mimetype;
        } else {
          // 多余的文件部分：消费掉流避免挂起
          await part.toBuffer();
        }
      } else {
        fields[part.fieldname] = part.value?.toString() || '';
      }
    }

    if (!buffer) throw new BadRequestException('请选择图片文件');
    if (!allowedTypes.includes(mimetype)) {
      throw new BadRequestException('仅支持 JPG/PNG/GIF/WebP 格式的图片');
    }
    if (buffer.length > 20 * 1024 * 1024) throw new BadRequestException('图片大小不能超过20MB');

    const shopId = fields.shopId || '';
    if (!shopId) throw new BadRequestException('请选择门店');
    await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);

    const settlementMonth = fields.settlementMonth || undefined;
    const uploadedBy = (request as any).user?.uid || undefined;
    const source = (fields.source === 'CREATE' ? 'CREATE' : 'POOL') as 'CREATE' | 'POOL';

    const result = await this.pendingImageService.upload({
      shopId,
      settlementMonth,
      buffer,
      filename,
      mimetype,
      thumbnailBuffer,
      uploadedBy,
      source,
    });
    return ApiRes.success(result);
  }

  /** 直接上传图片到指定工单（创建工单页“直接创建工单”模式：图片作为工单 BEFORE 图，不经图片池） */
  @Post('attach-to-order')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: '上传图片直接关联到指定工单（作为 BEFORE 图，不进图片池）' })
  async attachToOrder(@Req() request: FastifyRequest) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const parts = (request as any).parts();
    const fields: Record<string, string> = {};
    let buffer: Buffer | null = null;
    let filename = '';
    let mimetype = '';
    let thumbnailBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === 'file') {
        if (!buffer) {
          buffer = await part.toBuffer();
          filename = part.filename;
          mimetype = part.mimetype;
        } else if (!thumbnailBuffer) {
          // 第二个文件视为缩略图（列表展示用），与 upload/quick-create 端点约定一致
          thumbnailBuffer = await part.toBuffer();
        } else {
          await part.toBuffer();
        }
      } else {
        fields[part.fieldname] = part.value?.toString() || '';
      }
    }

    if (!buffer) throw new BadRequestException('请选择图片文件');
    if (!allowedTypes.includes(mimetype)) {
      throw new BadRequestException('仅支持 JPG/PNG/GIF/WebP 格式的图片');
    }
    if (buffer.length > 20 * 1024 * 1024) throw new BadRequestException('图片大小不能超过20MB');

    const shopId = fields.shopId || '';
    if (!shopId) throw new BadRequestException('请选择门店');
    const orderId = fields.orderId || '';
    if (!orderId) throw new BadRequestException('请指定工单');
    await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);

    const result = await this.pendingImageService.attachToOrder({
      shopId,
      orderId,
      imageBuffer: buffer,
      fileName: filename,
      mimeType: mimetype,
      thumbnailBuffer,
      operatorId: (request as any).user?.uid,
      operatorName: (request as any).user?.username,
    });
    return ApiRes.success(result);
  }

  /** 批量上传：multipart 多文件 + 公共 shopId/settlementMonth 字段（上传即返回，OCR 后台异步） */
  @Post('batch-upload')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '批量上传图片到图片池（OCR 后台异步识别）' })
  async batchUpload(@Req() request: FastifyRequest) {
    const parts = (request as any).parts();
    const fields: Record<string, string> = {};
    const files: { buffer: Buffer; filename: string; mimetype: string }[] = [];
    for await (const part of parts) {
      if (part.type === 'file') {
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(part.mimetype)) continue;
        const buffer = await part.toBuffer();
        if (buffer.length > 20 * 1024 * 1024) continue;
        files.push({ buffer, filename: part.filename, mimetype: part.mimetype });
      } else {
        fields[part.fieldname] = part.value?.toString() || '';
      }
    }

    const shopId = fields.shopId;
    if (!shopId) throw new BadRequestException('请选择门店');
    await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);
    const settlementMonth = fields.settlementMonth || undefined;
    const uploadedBy = (request as any).user?.uid || undefined;
    const source = (fields.source === 'CREATE' ? 'CREATE' : 'POOL') as 'CREATE' | 'POOL';

    if (files.length === 0) throw new BadRequestException('未收到有效图片文件');

    const results: any[] = [];
    for (const f of files) {
      try {
        const r = await this.pendingImageService.upload({
          shopId,
          settlementMonth,
          buffer: f.buffer,
          filename: f.filename,
          mimetype: f.mimetype,
          uploadedBy,
          source,
        });
        results.push({ ok: true, filename: f.filename, data: r });
      } catch (e) {
        results.push({ ok: false, filename: f.filename, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return ApiRes.success({ total: files.length, results });
  }

  /** 分页查询图片池 */
  @Get('page')
  @ApiOperation({ summary: '分页查询图片池' })
  async page(@Query() dto: PagePendingImageDto, @Req() request: AuthenticatedRequest) {
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(request.user.uid);
    if (dto.shopId) {
      await this.userShopService.assertShopAccess(request.user.uid, dto.shopId);
    }
    const data = await this.pendingImageService.page(dto, accessibleShopIds);
    return ApiRes.success(data);
  }

  /** 状态计数 */
  @Get('status-counts')
  @ApiOperation({ summary: '图片池状态计数' })
  async statusCounts(@Query('shopId') shopId: string, @Query('settlementMonth') settlementMonth: string, @Req() request: AuthenticatedRequest) {
    if (shopId) await this.userShopService.assertShopAccess(request.user.uid, shopId);
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(request.user.uid);
    const data = await this.pendingImageService.statusCounts(shopId || undefined, settlementMonth || undefined, accessibleShopIds);
    return ApiRes.success(data);
  }

  /** 详情 */
  @Get(':id')
  @ApiOperation({ summary: '图片池详情' })
  async detail(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const data = await this.pendingImageService.findById(id);
    if (data) await this.userShopService.assertShopAccess(request.user.uid, data.shopId);
    return ApiRes.success(data);
  }

  /** 候选工单列表（NEEDS_REVIEW 时供前端展示） */
  @Get(':id/candidates')
  @ApiOperation({ summary: '查询匹配候选工单' })
  async candidates(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const pending = await this.pendingImageService.findById(id);
    if (!pending) throw new BadRequestException('图片池记录不存在');
    await this.userShopService.assertShopAccess(request.user.uid, pending.shopId);
    const data = await this.pendingImageService.findCandidates(id);
    return ApiRes.success(data);
  }

  /** 重新自动匹配（工单后导入场景） */
  @Post(':id/auto-match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重新自动匹配' })
  async autoMatch(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const pending = await this.pendingImageService.findById(id);
    if (!pending) throw new BadRequestException('图片池记录不存在');
    await this.userShopService.assertShopAccess(request.user.uid, pending.shopId);
    const data = await this.pendingImageService.autoMatch(id);
    return ApiRes.success(data);
  }

  /** 人工指派到指定工单 */
  @Post(':id/match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '人工指派到工单（手动归类）' })
  async manualMatch(@Param('id') id: string, @Body() dto: ManualMatchDto, @Req() request: AuthenticatedRequest) {
    const pending = await this.pendingImageService.findById(id);
    if (!pending) throw new BadRequestException('图片池记录不存在');
    await this.userShopService.assertShopAccess(request.user.uid, pending.shopId);
    await this.userShopService.assertWorkOrderAccess(request.user.uid, dto.orderId);
    const data = await this.pendingImageService.manualMatch(id, dto.orderId);
    return ApiRes.success(data);
  }

  /** 补建工单（用 OCR 资料建无幅数工单 + 关联图片） */
  @Post(':id/create-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '补建工单（无幅数）' })
  async createOrder(@Param('id') id: string, @Body() dto: CreateOrderFromPendingDto, @Req() request: AuthenticatedRequest) {
    const pending = await this.pendingImageService.findById(id);
    if (!pending) throw new BadRequestException('图片池记录不存在');
    await this.userShopService.assertShopAccess(request.user.uid, pending.shopId);
    const data = await this.pendingImageService.createOrderFromPending(id, dto.settlementMonth);
    return ApiRes.success(data);
  }

  /** 人工修正 OCR 识别结果（待匹配/待确认/失败的图片均可修正），并立即重新匹配 */
  @Post(':id/correct-ocr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '修正 OCR 识别结果并重新匹配' })
  async correctOcr(@Param('id') id: string, @Body() dto: CorrectPendingImageOcrDto, @Req() request: AuthenticatedRequest) {
    const pending = await this.pendingImageService.findById(id);
    if (!pending) throw new BadRequestException('图片池记录不存在');
    await this.userShopService.assertShopAccess(request.user.uid, pending.shopId);
    const data = await this.pendingImageService.correctOcr(id, dto);
    return ApiRes.success(data);
  }

  /** 重新 OCR */
  @Post(':id/retry-ocr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重新 OCR 识别' })
  async retryOcr(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const pending = await this.pendingImageService.findById(id);
    if (!pending) throw new BadRequestException('图片池记录不存在');
    await this.userShopService.assertShopAccess(request.user.uid, pending.shopId);
    const data = await this.pendingImageService.retryOcr(id);
    return ApiRes.success(data);
  }

  /** 删除图片池记录 */
  @Delete(':id')
  @ApiOperation({ summary: '删除图片池记录' })
  async delete(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const pending = await this.pendingImageService.findById(id);
    if (!pending) throw new BadRequestException('图片池记录不存在');
    await this.userShopService.assertShopAccess(request.user.uid, pending.shopId);
    const data = await this.pendingImageService.delete(id);
    return ApiRes.success(data);
  }
}
