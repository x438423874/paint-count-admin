import { Controller, Get, Post, Put, Delete, Body, Query, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkOrderService } from '../../service/work-order.service';
import { CreateWorkOrderDto, UpdateWorkOrderDto, PageWorkOrderDto, WorkOrderItemDto, AuditWorkOrderDto } from '../dto/work-order.dto';
import { ApiRes } from '@lib/infra/rest/res.response';
import { PaintImageType } from '@prisma/client';
import { FastifyRequest, FastifyReply } from 'fastify';

@ApiTags('Paint - WorkOrder')
@Controller('paint/work-order')
export class WorkOrderController {
  constructor(private readonly workOrderService: WorkOrderService) {}

  @Post('quick-create')
  @ApiOperation({ summary: '快速创建工单（上传图片自动创建）' })
  async quickCreate(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      return ApiRes.error(400, '请选择图片文件');
    }

    // 校验文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(data.mimetype)) {
      return ApiRes.error(400, '仅支持 JPG/PNG/GIF/WebP 格式的图片');
    }

    // 校验文件大小（最大10MB）
    const buffer = await data.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) {
      return ApiRes.error(400, '图片大小不能超过10MB');
    }

    const fields = data.fields;
    const getFieldValue = (fieldName: string): string => {
      const field = (fields as any)?.[fieldName];
      if (!field) return '';
      if (Array.isArray(field)) {
        return field[0]?.value?.toString() || '';
      }
      return field?.value?.toString() || '';
    };

    const getFieldBuffer = async (fieldName: string): Promise<Buffer | null> => {
      const field = (fields as any)?.[fieldName];
      if (!field) return null;
      const f = Array.isArray(field) ? field[0] : field;
      if (f && f.type === 'file') {
        return f.toBuffer ? await f.toBuffer() : null;
      }
      return null;
    };

    const shopId = getFieldValue('shopId');
    if (!shopId) {
      return ApiRes.error(400, '请选择门店');
    }

    const settlementMonth = getFieldValue('settlementMonth') || undefined;
    const plateNumber = getFieldValue('plateNumber') || undefined;
    const orderNo = getFieldValue('orderNo') || undefined;
    const thumbnailBuffer = await getFieldBuffer('thumbnail');

    const saved = await this.workOrderService.quickCreate(shopId, buffer, data.filename, data.mimetype, settlementMonth, plateNumber, orderNo, thumbnailBuffer);
    return ApiRes.success(saved);
  }

  @Post()
  @ApiOperation({ summary: '创建工单' })
  async create(@Body() dto: CreateWorkOrderDto) {
    const data = await this.workOrderService.create(dto);
    return ApiRes.success(data);
  }

  @Put()
  @ApiOperation({ summary: '更新工单（已审核的工单不允许修改）' })
  async update(@Body() dto: UpdateWorkOrderDto) {
    const data = await this.workOrderService.update(dto);
    return ApiRes.success(data);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除工单（已审核的工单不允许删除）' })
  async delete(@Param('id') id: string) {
    await this.workOrderService.delete(id);
    return ApiRes.ok();
  }

  @Post('audit')
  @ApiOperation({ summary: '审核工单（审核后不可修改和删除）' })
  async audit(@Body() dto: AuditWorkOrderDto) {
    const data = await this.workOrderService.audit(dto);
    return ApiRes.success(data);
  }

  @Post('unaudit/:id')
  @ApiOperation({ summary: '取消审核' })
  async unaudit(@Param('id') id: string) {
    const data = await this.workOrderService.unaudit(id);
    return ApiRes.success(data);
  }

  @Get('page')
  @ApiOperation({ summary: '分页查询工单' })
  async page(@Query() dto: PageWorkOrderDto) {
    const data = await this.workOrderService.page(dto);
    return ApiRes.success(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取工单详情(含项目和图片)' })
  async findById(@Param('id') id: string) {
    const data = await this.workOrderService.findById(id);
    return ApiRes.success(data);
  }

  @Post(':id/items')
  @ApiOperation({ summary: '添加喷漆项目（已审核的工单不允许）' })
  async addItems(@Param('id') id: string, @Body() items: WorkOrderItemDto[]) {
    const data = await this.workOrderService.addItems(id, items);
    return ApiRes.success(data);
  }

  @Delete(':orderId/items/:itemId')
  @ApiOperation({ summary: '删除喷漆项目（已审核的工单不允许）' })
  async removeItem(@Param('orderId') orderId: string, @Param('itemId') itemId: string) {
    const data = await this.workOrderService.removeItem(orderId, itemId);
    return ApiRes.success(data);
  }

  @Post(':id/images')
  @ApiOperation({ summary: '上传工单图片' })
  async uploadImage(@Param('id') id: string, @Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      return ApiRes.error(400, '请选择图片文件');
    }

    // 校验文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(data.mimetype)) {
      return ApiRes.error(400, '仅支持 JPG/PNG/GIF/WebP 格式的图片');
    }

    const fields = data.fields;
    const getFieldValue = (fieldName: string): string => {
      const field = (fields as any)?.[fieldName];
      if (!field) return '';
      if (Array.isArray(field)) {
        return field[0]?.value?.toString() || '';
      }
      return field?.value?.toString() || '';
    };

    const getFieldBuffer = async (fieldName: string): Promise<Buffer | null> => {
      const field = (fields as any)?.[fieldName];
      if (!field) return null;
      const f = Array.isArray(field) ? field[0] : field;
      if (f && f.type === 'file') {
        return f.toBuffer ? await f.toBuffer() : null;
      }
      return null;
    };

    const buffer = await data.toBuffer();
    // 校验文件大小（最大10MB）
    if (buffer.length > 10 * 1024 * 1024) {
      return ApiRes.error(400, '图片大小不能超过10MB');
    }

    const imageType = (getFieldValue('imageType') as PaintImageType) || PaintImageType.BEFORE;
    const description = getFieldValue('description') || undefined;
    const thumbnailBuffer = await getFieldBuffer('thumbnail');
    const saved = await this.workOrderService.saveAndUploadImage(id, buffer, data.filename, data.mimetype, imageType, description, thumbnailBuffer);
    return ApiRes.success(saved);
  }

  @Delete('images/:imageId')
  @ApiOperation({ summary: '删除工单图片' })
  async removeImage(@Param('imageId') imageId: string) {
    await this.workOrderService.removeImage(imageId);
    return ApiRes.ok();
  }
}
