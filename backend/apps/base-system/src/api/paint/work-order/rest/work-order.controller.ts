import { Controller, Get, Post, Put, Delete, Body, Query, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkOrderService } from '../../service/work-order.service';
import { WorkOrderAuditService } from '../../service/work-order-audit.service';
import { WorkOrderMergeService } from '../../service/work-order-merge.service';
import { WorkOrderSettlementService } from '../../service/work-order-settlement.service';
import { WorkOrderExcelService } from '../../service/work-order-excel.service';
import { OcrService } from '../../service/ocr.service';
import { CreateWorkOrderDto, UpdateWorkOrderDto, PageWorkOrderDto, WorkOrderItemDto, AuditWorkOrderDto } from '../dto/work-order.dto';
import { ApiRes } from '@lib/infra/rest/res.response';
import { PaintImageType } from '@prisma/client';
import { FastifyRequest, FastifyReply } from 'fastify';

@ApiTags('Paint - WorkOrder')
@Controller('paint/work-order')
export class WorkOrderController {
  constructor(
    private readonly workOrderService: WorkOrderService,
    private readonly auditService: WorkOrderAuditService,
    private readonly mergeService: WorkOrderMergeService,
    private readonly settlementService: WorkOrderSettlementService,
    private readonly ocrService: OcrService,
    private readonly excelService: WorkOrderExcelService,
  ) {}

  @Post('quick-create')
  @ApiOperation({ summary: '快速创建工单（上传图片自动创建，后端OCR识别）' })
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
    const thumbnailBuffer = await getFieldBuffer('thumbnail');

    // 后端 OCR 识别（异步，不阻塞工单创建）
    let ocrPlateNumber = '';
    let ocrOrderNo = '';
    try {
      const ocrResult = await this.ocrService.recognize(buffer);
      ocrPlateNumber = ocrResult.plateNumber || '';
      ocrOrderNo = ocrResult.orderNo || '';
    } catch {
      // OCR 失败不阻塞创建
    }

    // 优先使用前端传入的值，否则使用 OCR 识别结果
    const plateNumber = getFieldValue('plateNumber') || ocrPlateNumber || undefined;
    const orderNo = getFieldValue('orderNo') || ocrOrderNo || undefined;

    const saved = await this.workOrderService.quickCreate(shopId, buffer, data.filename, data.mimetype, settlementMonth, plateNumber, orderNo, thumbnailBuffer);
    return ApiRes.success(saved);
  }

  @Post('ocr')
  @ApiOperation({ summary: 'OCR识别图片中的车牌号和工单号' })
  async ocrRecognize(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      return ApiRes.error(400, '请选择图片文件');
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) {
      return ApiRes.error(400, '图片大小不能超过10MB');
    }

    try {
      const result = await this.ocrService.recognize(buffer);
      return ApiRes.success(result);
    } catch {
      return ApiRes.error(500, 'OCR识别失败');
    }
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
    const data = await this.auditService.audit(dto);
    return ApiRes.success(data);
  }

  @Post('unaudit/:id')
  @ApiOperation({ summary: '取消审核' })
  async unaudit(@Param('id') id: string) {
    const data = await this.auditService.unaudit(id);
    return ApiRes.success(data);
  }

  @Get('page')
  @ApiOperation({ summary: '分页查询工单（重复工单排前面，含结算历史）' })
  async page(@Query() dto: PageWorkOrderDto) {
    const data = await this.workOrderService.page(dto);
    return ApiRes.success(data);
  }

  @Get('duplicates/:orderNo')
  @ApiOperation({ summary: '查询重复工单列表' })
  async findDuplicates(@Param('orderNo') orderNo: string, @Query('excludeId') excludeId?: string) {
    const data = await this.mergeService.findDuplicateOrders(orderNo, excludeId);
    return ApiRes.success(data);
  }

  @Post('merge')
  @ApiOperation({ summary: '合并重复工单' })
  async merge(@Body() body: { targetId: string; sourceIds: string[] }) {
    if (!body.targetId || !body.sourceIds?.length) {
      return ApiRes.error(400, '请指定目标工单和待合并工单');
    }
    const data = await this.mergeService.mergeOrders(body.targetId, body.sourceIds);
    return ApiRes.success(data);
  }

  @Post(':id/settlement')
  @ApiOperation({ summary: '添加结算记录（支持分次结算）' })
  async addSettlement(@Param('id') id: string, @Body() body: { settlementMonth: string; remark?: string }) {
    if (!body.settlementMonth) {
      return ApiRes.error(400, '请指定结算月份');
    }
    const data = await this.settlementService.addSettlementRecord(id, body.settlementMonth, body.remark);
    return ApiRes.success(data);
  }

  @Get(':id/settlements')
  @ApiOperation({ summary: '获取工单结算历史' })
  async getSettlements(@Param('id') id: string) {
    const data = await this.settlementService.getSettlementHistory(id);
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

  @Post('import')
  @ApiOperation({ summary: '导入Excel台账数据' })
  async importExcel(@Req() request: FastifyRequest) {
    const parts = (request as any).parts();
    let fileBuffer: Buffer | null = null;
    let shopId = '';
    let settlementMonth = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
      } else if (part.type === 'field') {
        if (part.fieldname === 'shopId') shopId = part.value;
        if (part.fieldname === 'settlementMonth') settlementMonth = part.value;
      }
    }

    if (!fileBuffer) {
      return ApiRes.error(400, '请选择Excel文件');
    }
    if (!shopId) return ApiRes.error(400, '请指定门店');

    const result = await this.excelService.importExcel(fileBuffer, shopId, settlementMonth || undefined);
    return ApiRes.success(result);
  }

  @Get('export')
  @ApiOperation({ summary: '导出Excel台账' })
  async exportExcel(
    @Query('shopId') shopId: string,
    @Query('settlementMonth') settlementMonth: string,
    @Res() reply: FastifyReply,
  ) {
    if (!shopId) return ApiRes.error(400, '请指定门店');

    const shopName = await this.workOrderService.getShopName(shopId);
    const filename = `${shopName}_台账_${settlementMonth || '全部'}.xlsx`;

    const buf = await this.excelService.exportExcel(shopId, settlementMonth);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    reply.send(buf);
  }

  @Get('template')
  @ApiOperation({ summary: '下载导入模板' })
  async downloadTemplate(@Query('shopId') shopId: string, @Res() reply: FastifyReply) {
    if (!shopId) return ApiRes.error(400, '请指定门店');

    const shopName = await this.workOrderService.getShopName(shopId);
    const filename = `${shopName}_导入模板.xlsx`;

    const buf = await this.excelService.downloadTemplate(shopId);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    reply.send(buf);
  }

  @Post('detect-template')
  @ApiOperation({ summary: '从Excel文件自动识别模板列映射' })
  async detectTemplate(@Req() request: FastifyRequest) {
    const parts = (request as any).parts();
    let fileBuffer: Buffer | null = null;
    let shopId = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
      } else if (part.type === 'field') {
        if (part.fieldname === 'shopId') shopId = part.value;
      }
    }

    if (!fileBuffer) return ApiRes.error(400, '请选择Excel文件');
    if (!shopId) return ApiRes.error(400, '请指定门店');

    const config = await this.excelService.detectTemplateConfig(fileBuffer, shopId);
    return ApiRes.success(config);
  }

  @Post('save-template')
  @ApiOperation({ summary: '保存门店Excel模板配置' })
  async saveTemplate(@Body() body: { shopId: string; config: any }) {
    if (!body.shopId || !body.config) return ApiRes.error(400, '参数不完整');
    const shop = await this.excelService.saveTemplateConfig(body.shopId, body.config);
    return ApiRes.success(shop);
  }

  @Get('template-config')
  @ApiOperation({ summary: '获取门店Excel模板配置' })
  async getTemplateConfig(@Query('shopId') shopId: string) {
    if (!shopId) return ApiRes.error(400, '请指定门店');
    const config = await this.workOrderService.getShopExcelTemplateConfig(shopId);
    return ApiRes.success(config);
  }
}
