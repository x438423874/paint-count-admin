import { Controller, Get, Post, Put, Delete, Body, Query, Param, Req, Res, Request, BadRequestException, InternalServerErrorException, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WorkOrderService } from '../../service/work-order.service';
import { WorkOrderAuditService } from '../../service/work-order-audit.service';
import { WorkOrderMergeService } from '../../service/work-order-merge.service';
import { WorkOrderSettlementService } from '../../service/work-order-settlement.service';
import { WorkOrderExcelService } from '../../service/work-order-excel.service';
import { OcrService } from '../../service/ocr.service';
import { WorkOrderNoRuleService, OrderNoRule } from '../../service/work-order-no-rule.service';
import { WorkOrderReconcileService } from '../../service/work-order-reconcile.service';
import { UserShopService } from '../../service/user-shop.service';
import { CreateWorkOrderDto, UpdateWorkOrderDto, PageWorkOrderDto, WorkOrderItemDto, AuditWorkOrderDto } from '../dto/work-order.dto';
import { BatchOcrPreviewResponse, BatchCreateItem } from '../dto/batch-ocr.dto';
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
    private readonly excelService: WorkOrderExcelService,
    private readonly noRuleService: WorkOrderNoRuleService,
    private readonly reconcileService: WorkOrderReconcileService,
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
    // OCR 识别模式：basic（仅基础资料）/ items（仅部位）/ all（全部），默认 all
    const ocrMode = (getFieldValue('ocrMode') as 'basic' | 'items' | 'all') || 'all';

    // 优先使用前端传入的值
    const plateNumber = getFieldValue('plateNumber') || undefined;
    const orderNo = getFieldValue('orderNo') || undefined;
    const customerName = getFieldValue('customerName') || undefined;
    const phone = getFieldValue('phone') || undefined;
    const carModel = getFieldValue('carModel') || undefined;
    const vin = getFieldValue('vin') || undefined;
    const brand = getFieldValue('brand') || undefined;
    const orderDate = getFieldValue('orderDate') || undefined;

    // 后端 OCR 识别（仅当启用 OCR 且前端未提供完整字段时执行）
    let ocrPlateNumber = '';
    let ocrOrderNo = '';
    let ocrCustomerName = '';
    let ocrPhone = '';
    let ocrCarModel = '';
    let ocrVin = '';
    let ocrBrand = '';
    let ocrDate = '';
    let ocrItems: { categoryId: string; quantity: number; newPartQuantity: number }[] | undefined;
    if (enableOcr) {
      try {
        const ocrResult = await this.ocrService.recognizeWithTemplate(buffer, shopId, ocrMode);
        ocrPlateNumber = ocrResult.plateNumber || '';
        ocrOrderNo = ocrResult.orderNo || '';
        ocrCustomerName = ocrResult.customerName || '';
        ocrPhone = ocrResult.phone || '';
        ocrCarModel = ocrResult.carModel || '';
        ocrVin = ocrResult.vin || '';
        ocrBrand = ocrResult.brand || '';
        ocrDate = ocrResult.date || '';
        // 提取匹配成功的部位项
        ocrItems = (ocrResult.items || [])
          .filter(it => it.matched && it.categoryId)
          .map(it => ({ categoryId: it.categoryId!, quantity: it.quantity, newPartQuantity: it.newPartQuantity }));
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
    const finalVin = vin || ocrVin || undefined;
    const finalBrand = brand || ocrBrand || undefined;
    const finalOrderDate = orderDate || ocrDate || undefined;

    const saved = await this.workOrderService.quickCreate(shopId, buffer, data.filename, data.mimetype, settlementMonth, finalPlateNumber, finalOrderNo, thumbnailBuffer, finalCustomerName, finalPhone, finalCarModel, finalVin, finalBrand, finalOrderDate, ocrItems);
    return ApiRes.success(saved);
  }

  @Post('batch-ocr-preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '批量OCR预览：上传多张图片，返回识别结果与校验警告' })
  async batchOcrPreview(@Req() request: FastifyRequest) {
    const parts = request.parts();
    const files: { id: string; filename: string; buffer: Buffer }[] = [];
    let shopId = '';
    let ocrMode: 'basic' | 'items' | 'all' = 'all';

    for await (const part of parts) {
      if (part.type === 'file') {
        const id = part.fieldname;
        if (!id || id === 'shopId' || id === 'items' || id === 'ocrMode') continue;
        const buffer = await part.toBuffer();
        if (buffer.length <= 20 * 1024 * 1024) {
          files.push({ id, filename: part.filename, buffer });
        }
      } else {
        if (part.fieldname === 'shopId') shopId = part.value as string;
        if (part.fieldname === 'ocrMode') {
          const v = part.value as string;
          if (v === 'basic' || v === 'items' || v === 'all') ocrMode = v;
        }
      }
    }

    if (!shopId) throw new BadRequestException('请选择门店');
    if (files.length === 0) throw new BadRequestException('请选择图片');
    await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);

    const rules = await this.noRuleService.getRules(shopId);
    const items: BatchOcrPreviewResponse['items'] = [];

    for (const file of files) {
      try {
        const result = await this.ocrService.recognizeWithTemplate(file.buffer, shopId, ocrMode);
        const warnings: string[] = [];
        if (!result.plateNumber) warnings.push('未识别到车牌号');
        if (!result.orderNo) warnings.push('未识别到工单号');
        if (result.orderNo && rules.length > 0 && !this.noRuleService.validate(result.orderNo, rules).valid) {
          warnings.push(`工单号格式不符合规则`);
        }
        if (!result.date) warnings.push('未识别到日期');

        // 生成缩略图 base64（200px 宽度）
        const thumbnail = await this.workOrderService.generateThumbnailBase64(file.buffer, 200);

        items.push({
          id: file.id,
          fileName: file.filename,
          thumbnail,
          result,
          warnings,
          valid: warnings.length === 0,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'OCR识别失败';
        items.push({
          id: file.id,
          fileName: file.filename,
          thumbnail: '',
          result: {
            plateNumber: '', orderNo: '', customerName: '', phone: '', carModel: '', vin: '', brand: '', date: '', rawText: '', items: [],
          },
          warnings: [msg],
          valid: false,
        });
      }
    }

    return ApiRes.success({ items });
  }

  @Post('batch-create')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '批量创建工单：根据批量OCR预览结果创建多个工单' })
  async batchCreate(@Req() request: FastifyRequest) {
    const parts = request.parts();
    const files = new Map<string, { filename: string; buffer: Buffer }>();
    let shopId = '';
    let itemsJson = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const id = part.fieldname;
        const buffer = await part.toBuffer();
        if (buffer.length <= 20 * 1024 * 1024) {
          files.set(id, { filename: part.filename, buffer });
        }
      } else {
        if (part.fieldname === 'shopId') shopId = part.value as string;
        if (part.fieldname === 'items') itemsJson = part.value as string;
      }
    }

    if (!shopId) throw new BadRequestException('请选择门店');
    if (!itemsJson) throw new BadRequestException('缺少创建数据');
    await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);

    let items: BatchCreateItem[] = [];
    try {
      items = JSON.parse(itemsJson);
    } catch {
      throw new BadRequestException('创建数据格式错误');
    }
    if (!Array.isArray(items) || items.length === 0) throw new BadRequestException('创建数据为空');

    const created: any[] = [];
    const errors: { id: string; message: string }[] = [];

    for (const item of items) {
      const file = files.get(item.id);
      if (!file) {
        errors.push({ id: item.id, message: '未找到对应图片' });
        continue;
      }
      try {
        const saved = await this.workOrderService.quickCreate(
          shopId,
          file.buffer,
          file.filename,
          'image/jpeg',
          item.settlementMonth,
          item.plateNumber,
          item.orderNo,
          undefined,
          item.customerName,
          item.phone,
          item.carModel,
          item.vin,
          item.brand,
          item.orderDate,
          item.items,
        );
        created.push(saved);
      } catch (e: any) {
        errors.push({ id: item.id, message: e.message || '创建失败' });
      }
    }

    return ApiRes.success({ created, errors, total: items.length });
  }

  @Post('ocr')
  @HttpCode(HttpStatus.OK)
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
    // OCR 识别模式：basic（仅基础资料）/ items（仅部位）/ all（全部），默认 all
    const ocrMode = (getFieldValue('ocrMode') as 'basic' | 'items' | 'all') || 'all';

    // 数据权限：校验用户是否有权访问该门店
    if (shopId) {
      await this.userShopService.assertShopAccess((request as any).user?.uid, shopId);
    }

    try {
      const result = await this.ocrService.recognizeWithTemplate(buffer, shopId, ocrMode);
      return ApiRes.success(result);
    } catch (e) {
      // 透传 PaddleOCR 不可用等明确错误信息，便于前端提示用户
      const msg = e instanceof Error ? e.message : 'OCR识别失败';
      throw new InternalServerErrorException(msg);
    }
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
  @Throttle({ default: { limit: 120, ttl: 60000 } }) // 每分钟120次：列表页频繁刷新
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
  @ApiOperation({ summary: '结算工单（只改状态）' })
  async settle(@Param('id') id: string, @Body() body: { settlementMonth?: string }, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.settlementService.settle(id, body.settlementMonth, req.user?.uid);
    return ApiRes.success(data);
  }

  @Post(':id/unsettle')
  @ApiOperation({ summary: '取消结算（只改状态）' })
  async unsettle(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.settlementService.unsettle(id);
    return ApiRes.success(data);
  }

  @Post(':id/abnormal')
  @ApiOperation({ summary: '标记/取消异常标注' })
  async toggleAbnormal(@Param('id') id: string, @Body() body: { isAbnormal: boolean; abnormalRemark?: string }, @Request() req: AuthenticatedRequest) {
    await this.userShopService.assertWorkOrderAccess(req.user.uid, id);
    const data = await this.workOrderService.setAbnormal(id, body.isAbnormal, body.abnormalRemark);
    return ApiRes.success(data);
  }

  @Post('reconcile')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '工单对账：上传 Excel 与系统工单进行幅数对比' })
  async reconcile(@Req() request: FastifyRequest, @Request() req: AuthenticatedRequest) {
    const data = await request.file();
    if (!data) {
      throw new BadRequestException('请上传 Excel 文件');
    }

    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/wps-office.xlsx',
      'application/wps-office.xls',
    ];
    if (!allowedTypes.includes(data.mimetype)) {
      throw new BadRequestException('仅支持 xlsx/xls 格式的 Excel 文件');
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Excel 文件大小不能超过 10MB');
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

    const shopId = getFieldValue('shopId');
    const settlementMonth = getFieldValue('settlementMonth');

    if (!shopId) {
      throw new BadRequestException('请选择门店');
    }
    if (!settlementMonth) {
      throw new BadRequestException('请选择结算月份');
    }

    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const result = await this.reconcileService.reconcile(shopId, settlementMonth, buffer);
    return ApiRes.success(result);
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
    @Query('mode') mode: 'detail' | 'summary' = 'detail',
    @Res() reply: FastifyReply,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!shopId) throw new BadRequestException('请指定门店');
    if (!['detail', 'summary'].includes(mode)) {
      throw new BadRequestException('mode 参数只能是 detail 或 summary');
    }

    // 数据权限：校验用户是否有权导出该门店数据
    await this.userShopService.assertShopAccess(req.user.uid, shopId);

    const shopName = await this.workOrderService.getShopName(shopId);
    const filename = `${shopName}_${mode === 'summary' ? '汇总' : '台账'}_${settlementMonth || '全部'}.xlsx`;

    const buf = await this.excelService.exportExcel(shopId, settlementMonth, mode);
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

  @Post('save-template-and-alias-map')
  @ApiOperation({ summary: '统一保存门店Excel模板配置和部位别名映射' })
  async saveTemplateAndAliasMap(
    @Body() body: { shopId: string; config: any; aliasMap: Record<string, string[]> },
    @Request() req: AuthenticatedRequest,
  ) {
    if (!body.shopId || !body.config) throw new BadRequestException('参数不完整');
    await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    const shop = await this.excelService.saveTemplateAndAliasMap(body.shopId, body.config, body.aliasMap || {});
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

  @Get('order-no-rules')
  @ApiOperation({ summary: '获取门店工单号规则' })
  async getOrderNoRules(@Query('shopId') shopId: string, @Request() req: AuthenticatedRequest) {
    if (!shopId) throw new BadRequestException('请指定门店');
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const rules = await this.noRuleService.getRules(shopId);
    return ApiRes.success(rules);
  }

  @Post('order-no-rules')
  @ApiOperation({ summary: '保存门店工单号规则' })
  async saveOrderNoRules(
    @Body() body: { shopId: string; rules: OrderNoRule[] },
    @Request() req: AuthenticatedRequest,
  ) {
    if (!body.shopId) throw new BadRequestException('请指定门店');
    if (!Array.isArray(body.rules)) throw new BadRequestException('rules 必须是数组');
    await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    await this.noRuleService.saveRules(body.shopId, body.rules);
    return ApiRes.ok();
  }

  @Post('analyze-order-no-rules')
  @ApiOperation({ summary: '分析已结算工单并自动生成/更新工单号规则' })
  async analyzeOrderNoRules(@Body() body: { shopId: string }, @Request() req: AuthenticatedRequest) {
    if (!body.shopId) throw new BadRequestException('请指定门店');
    await this.userShopService.assertShopAccess(req.user.uid, body.shopId);
    const rules = await this.noRuleService.analyzeAndSaveRules(body.shopId);
    return ApiRes.success(rules);
  }
}
