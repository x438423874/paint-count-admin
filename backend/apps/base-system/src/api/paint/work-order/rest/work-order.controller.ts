import { Controller, Get, Post, Put, Delete, Body, Query, Param, Req, Res, Request, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WorkOrderService } from '../../service/work-order.service';
import { WorkOrderAuditService } from '../../service/work-order-audit.service';
import { WorkOrderMergeService } from '../../service/work-order-merge.service';
import { WorkOrderSettlementService } from '../../service/work-order-settlement.service';
import { WorkOrderExcelService } from '../../service/work-order-excel.service';
import { OcrService, OcrTemplateConfig } from '../../service/ocr.service';
import { OcrAnnotationService } from '../../service/ocr-annotation.service';
import { UserShopService } from '../../service/user-shop.service';
import { CreateWorkOrderDto, UpdateWorkOrderDto, PageWorkOrderDto, WorkOrderItemDto, AuditWorkOrderDto } from '../dto/work-order.dto';
import { ApiRes } from '@lib/infra/rest/res.response';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';
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
    private readonly annotationService: OcrAnnotationService,
    private readonly excelService: WorkOrderExcelService,
    private readonly userShopService: UserShopService,
  ) {}

  @Post('quick-create')
  @Throttle({ default: { limit: 300, ttl: 60000 } }) // 每分钟300次：支持批量上传场景（已鉴权）
  @ApiOperation({ summary: '快速创建工单（上传图片自动创建，可选OCR识别）' })
  async quickCreate(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      throw new BadRequestException('请选择图片文件');
    }

    // 校验文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(data.mimetype)) {
      throw new BadRequestException('仅支持 JPG/PNG/GIF/WebP 格式的图片');
    }

    // 校验文件大小（最大10MB）
    const buffer = await data.toBuffer();
    if (buffer.length > 20 * 1024 * 1024) {
      throw new BadRequestException('图片大小不能超过20MB');
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
      throw new BadRequestException('请选择门店');
    }

    // 数据权限：校验用户是否有权操作该门店
    await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);

    const settlementMonth = getFieldValue('settlementMonth') || undefined;
    const thumbnailBuffer = await getFieldBuffer('thumbnail');
    // 是否启用 OCR 识别（默认启用）。批量上传时可关闭以加速创建
    const enableOcr = getFieldValue('enableOcr') !== 'false';

    // 优先使用前端传入的值
    const plateNumber = getFieldValue('plateNumber') || undefined;
    const orderNo = getFieldValue('orderNo') || undefined;
    const customerName = getFieldValue('customerName') || undefined;
    const phone = getFieldValue('phone') || undefined;
    const carModel = getFieldValue('carModel') || undefined;

    // 后端 OCR 识别（仅当启用 OCR 且前端未提供完整字段时执行）
    let ocrPlateNumber = '';
    let ocrOrderNo = '';
    let ocrCustomerName = '';
    let ocrPhone = '';
    let ocrCarModel = '';
    if (enableOcr) {
      try {
        const ocrResult = await this.ocrService.recognizeWithTemplate(buffer, shopId);
        ocrPlateNumber = ocrResult.plateNumber || '';
        ocrOrderNo = ocrResult.orderNo || '';
        ocrCustomerName = ocrResult.customerName || '';
        ocrPhone = ocrResult.phone || '';
        ocrCarModel = ocrResult.carModel || '';
      } catch {
        // OCR 失败不阻塞创建
      }
    }

    // 优先使用前端传入的值，否则使用 OCR 识别结果
    const finalPlateNumber = plateNumber || ocrPlateNumber || undefined;
    const finalOrderNo = orderNo || ocrOrderNo || undefined;
    const finalCustomerName = customerName || ocrCustomerName || undefined;
    const finalPhone = phone || ocrPhone || undefined;
    const finalCarModel = carModel || ocrCarModel || undefined;

    const saved = await this.workOrderService.quickCreate(shopId, buffer, data.filename, data.mimetype, settlementMonth, finalPlateNumber, finalOrderNo, thumbnailBuffer, finalCustomerName, finalPhone, finalCarModel);
    return ApiRes.success(saved);
  }

  @Post('ocr')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 每分钟20次：纯OCR识别
  @ApiOperation({ summary: 'OCR识别图片中的工单信息（支持门店模板精准识别）' })
  async ocrRecognize(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      throw new BadRequestException('请选择图片文件');
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 20 * 1024 * 1024) {
      throw new BadRequestException('图片大小不能超过20MB');
    }

    // 从表单字段获取 shopId，用于模板匹配
    const fields = data.fields;
    const getFieldValue = (fieldName: string): string => {
      const field = (fields as any)?.[fieldName];
      if (!field) return '';
      if (Array.isArray(field)) {
        return field[0]?.value?.toString() || '';
      }
      return field?.value?.toString() || '';
    };
    const shopId = getFieldValue('shopId') || undefined;

    // 数据权限：校验用户是否有权访问该门店
    if (shopId) {
      await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);
    }

    try {
      const result = await this.ocrService.recognizeWithTemplate(buffer, shopId);
      return ApiRes.success(result);
    } catch (e) {
      // 透传 PaddleOCR 不可用等明确错误信息，便于前端提示用户
      const msg = e instanceof Error ? e.message : 'OCR识别失败';
      throw new InternalServerErrorException(msg);
    }
  }

  @Post('ocr-smart-annotate')
  @ApiOperation({ summary: '智能标注：自动识别字段区域坐标' })
  async smartAnnotate(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      throw new BadRequestException('请选择图片文件');
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 20 * 1024 * 1024) {
      throw new BadRequestException('图片大小不能超过20MB');
    }

    // 从表单字段获取 shopId，用于加载门店字段别名配置
    const shopId = (data.fields as any)?.shopId?.value as string | undefined;

    // 数据权限：校验用户是否有权访问该门店
    if (shopId) {
      await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);
    }

    try {
      const fieldLabelsConfig = shopId
        ? await this.ocrService.getShopFieldLabels(shopId)
        : undefined;
      const regions = await this.ocrService.smartAnnotate(buffer, fieldLabelsConfig);
      return ApiRes.success(regions);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '智能标注失败';
      throw new InternalServerErrorException(msg);
    }
  }

  @Get('ocr-template')
  @ApiOperation({ summary: '获取门店OCR模板配置' })
  async getOcrTemplate(@Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const config = await this.ocrService.getShopOcrTemplate(shopId);
    return ApiRes.success(config);
  }

  @Post('ocr-template')
  @ApiOperation({ summary: '保存门店OCR模板配置' })
  async saveOcrTemplate(@Body() body: { shopId: string; config: OcrTemplateConfig }, @Request() req: AuthenticatedRequest) {
    if (!body.shopId || !body.config) throw new BadRequestException('参数不完整');
    // 数据权限：校验用户是否有权操作该门店
    await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    await this.ocrService.saveShopOcrTemplate(body.shopId, body.config);
    return ApiRes.ok();
  }

  @Delete('ocr-template')
  @ApiOperation({ summary: '删除门店OCR模板配置' })
  async deleteOcrTemplate(@Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权操作该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    await this.ocrService.deleteShopOcrTemplate(shopId);
    return ApiRes.ok();
  }

  @Get('ocr-field-labels/default')
  @ApiOperation({ summary: '获取默认字段别名配置' })
  async getDefaultFieldLabels() {
    const config = this.ocrService.getDefaultFieldLabels();
    return ApiRes.success(config);
  }

  @Get('ocr-field-labels')
  @ApiOperation({ summary: '获取门店字段别名配置' })
  async getShopFieldLabels(@Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const config = await this.ocrService.getShopFieldLabels(shopId);
    return ApiRes.success(config);
  }

  @Post('ocr-field-labels')
  @ApiOperation({ summary: '保存门店字段别名配置' })
  async saveShopFieldLabels(@Body() body: { shopId: string; config: Record<string, string[]> }, @Request() req: AuthenticatedRequest) {
    if (!body.shopId || !body.config) throw new BadRequestException('参数不完整');
    // 数据权限：校验用户是否有权操作该门店
    await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    await this.ocrService.saveShopFieldLabels(body.shopId, body.config);
    return ApiRes.ok();
  }

  @Post('ocr-diagnose')
  @ApiOperation({ summary: 'OCR诊断：返回详细的识别过程信息，用于排查识别失败问题' })
  async ocrDiagnose(@Req() request: FastifyRequest) {
    const data = await request.file();
    if (!data) {
      throw new BadRequestException('请选择图片文件');
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 20 * 1024 * 1024) {
      throw new BadRequestException('图片大小不能超过20MB');
    }

    const shopId = (data.fields as any)?.shopId?.value as string | undefined;

    // 数据权限：校验用户是否有权访问该门店
    if (shopId) {
      await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);
    }

    try {
      const diagnosis = await this.ocrService.diagnoseRecognize(buffer, shopId);
      return ApiRes.success(diagnosis);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'OCR诊断失败';
      throw new InternalServerErrorException(msg);
    }
  }

  @Post('ocr-batch-validate')
  @ApiOperation({ summary: '批量验证OCR准确率（对比已录入数据与OCR识别结果）' })
  async batchValidate(@Body() body: { shopId: string; limit?: number }, @Request() req: AuthenticatedRequest) {
    if (!body.shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    const result = await this.ocrService.batchValidate(body.shopId, body.limit || 20);
    return ApiRes.success(result);
  }

  @Post()
  @ApiOperation({ summary: '创建工单' })
  async create(@Body() dto: CreateWorkOrderDto, @Request() req: AuthenticatedRequest) {
    // 数据权限：校验用户是否有权操作该门店
    if (dto.shopId) {
      await this.userShopService.assertShopAccess(req.user.uid, dto.shopId);
    }
    const data = await this.workOrderService.create(dto);
    return ApiRes.success(data);
  }

  @Put()
  @ApiOperation({ summary: '更新工单（已审核的工单不允许修改）' })
  async update(@Body() dto: UpdateWorkOrderDto, @Request() req: AuthenticatedRequest) {
    if (dto.id) {
      await this.userShopService.assertWorkOrderAccess(req.user.uid, dto.id);
    }
    const data = await this.workOrderService.update(dto);
    return ApiRes.success(data);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除工单（已审核的工单不允许删除）' })
  async delete(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    await this.workOrderService.delete(id);
    return ApiRes.ok();
  }

  @Post('audit')
  @ApiOperation({ summary: '审核工单（审核后不可修改和删除）' })
  async audit(@Body() dto: AuditWorkOrderDto, @Request() req: AuthenticatedRequest) {
    if (dto.id) {
      await this.userShopService.assertWorkOrderAccess(req.user.uid, dto.id);
    }
    const data = await this.auditService.audit(dto);
    return ApiRes.success(data);
  }

  @Post('unaudit/:id')
  @ApiOperation({ summary: '取消审核' })
  async unaudit(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.auditService.unaudit(id);
    return ApiRes.success(data);
  }

  @Get('status-counts')
  @ApiOperation({ summary: '统计各状态工单数量' })
  async statusCounts(
    @Request() req: AuthenticatedRequest,
    @Query('shopId') shopId?: string,
    @Query('settlementMonth') settlementMonth?: string,
  ) {
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(req.user.uid);
    const data = await this.workOrderService.getStatusCounts(shopId, settlementMonth, accessibleShopIds);
    return ApiRes.success(data);
  }

  @Get('page')
  @ApiOperation({ summary: '分页查询工单（重复工单排前面，含结算历史）' })
  async page(@Query() dto: PageWorkOrderDto, @Request() req: AuthenticatedRequest) {
    // 数据权限：获取当前用户可访问的门店ID（null 表示不限制）
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(req.user.uid);
    const data = await this.workOrderService.page(dto, accessibleShopIds);
    return ApiRes.success(data);
  }

  @Get('duplicates/:orderNo')
  @ApiOperation({ summary: '查询重复工单列表' })
  async findDuplicates(
    @Request() req: AuthenticatedRequest,
    @Param('orderNo') orderNo: string,
    @Query('excludeId') excludeId?: string,
  ) {
    // 数据权限：仅返回当前用户有权访问的门店的重复工单
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(req.user.uid);
    const data = await this.mergeService.findDuplicateOrders(orderNo, excludeId, accessibleShopIds);
    return ApiRes.success(data);
  }

  @Post('merge')
  @ApiOperation({ summary: '合并重复工单' })
  async merge(@Body() body: { targetId: string; sourceIds: string[] }, @Request() req: AuthenticatedRequest) {
    if (!body.targetId || !body.sourceIds?.length) {
      throw new BadRequestException('请指定目标工单和待合并工单');
    }
    // 数据权限：批量校验目标工单和所有源工单的权限（避免 N+1 查询）
    await this.userShopService.assertWorkOrdersAccess(req.user.uid, [body.targetId, ...body.sourceIds]);
    const data = await this.mergeService.mergeOrders(body.targetId, body.sourceIds);
    return ApiRes.success(data);
  }

  @Post(':id/settlement')
  @ApiOperation({ summary: '添加结算记录（结算工单）' })
  async addSettlement(@Param('id') id: string, @Body() body: { settlementMonth: string; remark?: string }, @Request() req: AuthenticatedRequest) {
    if (!body.settlementMonth) {
      throw new BadRequestException('请指定结算月份');
    }
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.settlementService.addSettlementRecord(id, body.settlementMonth, body.remark);
    return ApiRes.success(data);
  }

  @Post(':id/abnormal')
  @ApiOperation({ summary: '标记/取消异常标注' })
  async toggleAbnormal(@Param('id') id: string, @Body() body: { isAbnormal: boolean; abnormalRemark?: string }, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.workOrderService.setAbnormal(id, body.isAbnormal, body.abnormalRemark);
    return ApiRes.success(data);
  }

  @Delete(':id/settlement/:recordId')
  @ApiOperation({ summary: '取消结算（删除结算记录）' })
  async removeSettlement(@Param('id') id: string, @Param('recordId') recordId: string, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.settlementService.removeSettlementRecord(recordId);
    return ApiRes.success(data);
  }

  @Get(':id/settlements')
  @ApiOperation({ summary: '获取工单结算历史' })
  async getSettlements(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    // 数据权限：校验工单权限
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.settlementService.getSettlementHistory(id);
    return ApiRes.success(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取工单详情(含项目和图片)' })
  async findById(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.workOrderService.findById(id);
    return ApiRes.success(data);
  }

  @Post(':id/items')
  @ApiOperation({ summary: '添加喷漆项目（已审核的工单不允许）' })
  async addItems(@Param('id') id: string, @Body() items: WorkOrderItemDto[], @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.workOrderService.addItems(id, items);
    return ApiRes.success(data);
  }

  @Delete(':orderId/items/:itemId')
  @ApiOperation({ summary: '删除喷漆项目（已审核的工单不允许）' })
  async removeItem(@Param('orderId') orderId: string, @Param('itemId') itemId: string, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, orderId);
    const data = await this.workOrderService.removeItem(orderId, itemId);
    return ApiRes.success(data);
  }

  @Post(':id/images')
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 每分钟30次：图片上传
  @ApiOperation({ summary: '上传工单图片' })
  async uploadImage(@Param('id') id: string, @Req() request: FastifyRequest) {
    // 数据权限校验（通过 header 中的 token 已解析出 req.user）
    await this.userShopService.assertWorkOrderAccess((request as any).user?.uid, id);
    const data = await request.file();
    if (!data) {
      throw new BadRequestException('请选择图片文件');
    }

    // 校验文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(data.mimetype)) {
      throw new BadRequestException('仅支持 JPG/PNG/GIF/WebP 格式的图片');
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
    if (buffer.length > 20 * 1024 * 1024) {
      throw new BadRequestException('图片大小不能超过20MB');
    }

    const imageType = (getFieldValue('imageType') as PaintImageType) || PaintImageType.BEFORE;
    const description = getFieldValue('description') || undefined;
    const thumbnailBuffer = await getFieldBuffer('thumbnail');
    const saved = await this.workOrderService.saveAndUploadImage(id, buffer, data.filename, data.mimetype, imageType, description, thumbnailBuffer);
    return ApiRes.success(saved);
  }

  @Delete('images/:imageId')
  @ApiOperation({ summary: '删除工单图片' })
  async removeImage(@Param('imageId') imageId: string, @Request() req: AuthenticatedRequest) {
    // 删除图片需校验图片所属工单的门店权限
    const image = await this.workOrderService.findImageById(imageId);
    if (image?.orderId) {
      await this.userShopService.assertWorkOrderAccess(req.user.uid, image.orderId);
    }
    await this.workOrderService.removeImage(imageId);
    return ApiRes.ok();
  }

  @Post('import')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 每分钟5次：Excel导入较重
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
      throw new BadRequestException('请选择Excel文件');
    }
    if (!shopId) throw new BadRequestException('请指定门店');

    // 数据权限：校验用户是否有权操作该门店
    await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);

    const result = await this.excelService.importExcel(fileBuffer, shopId, settlementMonth || undefined);
    return ApiRes.success(result);
  }

  @Get('export')
  @ApiOperation({ summary: '导出Excel台账' })
  async exportExcel(
    @Query('shopId') shopId: string,
    @Query('settlementMonth') settlementMonth: string,
    @Res() reply: FastifyReply,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!shopId) throw new BadRequestException('请指定门店');

    // 数据权限：校验用户是否有权导出该门店数据
    await this.userShopService.assertShopAccess(req.user.uid, shopId);

    const shopName = await this.workOrderService.getShopName(shopId);
    const filename = `${shopName}_台账_${settlementMonth || '全部'}.xlsx`;

    const buf = await this.excelService.exportExcel(shopId, settlementMonth);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    reply.send(buf);
  }

  @Get('template')
  @ApiOperation({ summary: '下载导入模板' })
  async downloadTemplate(@Query('shopId') shopId: string, @Res() reply: FastifyReply, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);

    const shopName = await this.workOrderService.getShopName(shopId);
    const filename = `${shopName}_导入模板.xlsx`;

    const buf = await this.excelService.downloadTemplate(shopId);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    reply.send(buf);
  }

  @Post('detect-template')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 每分钟10次：Excel解析
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

    if (!fileBuffer) throw new BadRequestException('请选择Excel文件');
    if (!shopId) throw new BadRequestException('请指定门店');

    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);

    const config = await this.excelService.detectTemplateConfig(fileBuffer, shopId);
    return ApiRes.success(config);
  }

  @Post('save-template')
  @ApiOperation({ summary: '保存门店Excel模板配置' })
  async saveTemplate(@Body() body: { shopId: string; config: any }, @Request() req: AuthenticatedRequest) {
    if (!body.shopId || !body.config) throw new BadRequestException('参数不完整');
    // 数据权限：校验用户是否有权操作该门店
    await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    const shop = await this.excelService.saveTemplateConfig(body.shopId, body.config);
    return ApiRes.success(shop);
  }

  @Get('template-config')
  @ApiOperation({ summary: '获取门店Excel模板配置' })
  async getTemplateConfig(@Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const config = await this.workOrderService.getShopExcelTemplateConfig(shopId);
    return ApiRes.success(config);
  }

  // ========== OCR 标注学习相关 API ==========

  @Post('ocr-annotation')
  @ApiOperation({ summary: '保存OCR标注（用于训练学习）' })
  async saveAnnotation(@Body() body: any, @Request() req: AuthenticatedRequest) {
    if (!body.shopId || !body.imageUrl) throw new BadRequestException('请提供门店ID和图片URL');
    // 数据权限：校验用户是否有权操作该门店
    await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    const annotation = await this.annotationService.createAnnotation(body);
    return ApiRes.success(annotation);
  }

  @Get('ocr-annotations')
  @ApiOperation({ summary: '查询门店OCR标注列表' })
  async getAnnotations(
    @Request() req: AuthenticatedRequest,
    @Query('shopId') shopId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const result = await this.annotationService.getAnnotations(shopId, page, pageSize || 20);
    return ApiRes.success(result);
  }

  @Delete('ocr-annotation/:id')
  @ApiOperation({ summary: '删除OCR标注' })
  async deleteAnnotation(@Param('id') id: string, @Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权操作该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    await this.annotationService.deleteAnnotation(id, shopId);
    return ApiRes.ok();
  }

  @Post('ocr-annotation/:id/verify')
  @ApiOperation({ summary: '验证标注是否正确' })
  async verifyAnnotation(@Param('id') id: string, @Body() body: { isCorrect: boolean }, @Request() req: AuthenticatedRequest) {
    // 数据权限：通过标注ID查询所属门店并校验
    const shopId = await this.annotationService.getAnnotationShopId(id);
    if (shopId) {
      await this.userShopService.assertShopAccess(req.user.uid, shopId);
    }
    await this.annotationService.verifyAnnotation(id, body.isCorrect);
    return ApiRes.ok();
  }

  @Get('ocr-aggregated-template')
  @ApiOperation({ summary: '获取聚合后的最优模板（从多张标注中计算）' })
  async getAggregatedTemplate(@Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const template = await this.annotationService.aggregateTemplate(shopId);
    return ApiRes.success(template);
  }

  @Get('ocr-annotation-stats')
  @ApiOperation({ summary: '获取门店标注统计（标注数量、字段覆盖率等）' })
  async getAnnotationStats(@Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const stats = await this.annotationService.getStats(shopId);
    return ApiRes.success(stats);
  }

  @Get('ocr-annotated-order-ids')
  @ApiOperation({ summary: '获取门店已标注的工单ID列表（用于区分已标注/未标注）' })
  async getAnnotatedOrderIds(@Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const orderIds = await this.annotationService.getAnnotatedOrderIds(shopId);
    return ApiRes.success(orderIds);
  }

  @Post('ocr-fix-verified-status')
  @ApiOperation({ summary: '修复脏数据：没有有效区域标注但标记为已验证的记录重置为待验证' })
  async fixInvalidVerifiedStatus(@Body() body: { shopId?: string }, @Request() req: AuthenticatedRequest) {
    // 数据权限：若指定 shopId 则校验用户是否有权操作该门店
    if (body.shopId) {
      await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    }
    const result = await this.annotationService.fixInvalidVerifiedStatus(body.shopId);
    return ApiRes.success(result);
  }
}
