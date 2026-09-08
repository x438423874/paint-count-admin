import { Injectable, BadRequestException, NotFoundException, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaginationResult, pageArgs } from '@lib/shared/prisma/pagination';
import { OcrStatus, PaintImageType, PendingImageStatus, Prisma } from '@prisma/client';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';
import { PaintImageService } from './paint-image.service';
import { OcrService } from './ocr.service';
import { PaintVehicleService } from './paint-vehicle.service';
import { CorrectPendingImageOcrDto, PagePendingImageDto } from '../pending-image/dto/pending-image.dto';
import { BACKEND_ROOT } from './upload-root';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

/**
 * 图片池服务：上传图片到中间池 → OCR 识别（basic 模式，仅基础资料）→
 * 按 orderNo(+shopId+settlementMonth) 自动匹配已有工单 → 只填空缺字段、关联图片，
 * 绝不修改幅数/items/status。
 */
@Injectable()
export class PendingImageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PendingImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageService: PaintImageService,
    private readonly ocrService: OcrService,
    private readonly vehicleService: PaintVehicleService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger,
  ) {}

  // ==================== 上传 ====================

  /**
   * 上传单张图片到图片池，同步 OCR（basic 模式）+ 自动匹配
   * OCR 失败不阻断上传，仅标记 FAILED。
   */
  /**
   * 上传图片到图片池：仅保存文件 + 创建记录并立即返回（ocrStatus=PENDING）。
   * OCR 识别在后台异步进行（processOcr），用户无需等待即可离开页面。
   */
  async upload(params: {
    shopId: string;
    settlementMonth?: string;
    buffer: Buffer;
    filename: string;
    mimetype: string;
    thumbnailBuffer?: Buffer | null;
    uploadedBy?: string;
    source?: 'POOL' | 'CREATE';
  }) {
    const { shopId, settlementMonth, buffer, filename, mimetype, thumbnailBuffer, uploadedBy, source } = params;

    // 1. 保存图片物理文件（与工单图片同目录结构，便于归类后直接复用 URL）
    const url = await this.imageService.saveImageFile(buffer, filename, shopId, settlementMonth);
    let thumbnailUrl: string | undefined;
    if (thumbnailBuffer) {
      thumbnailUrl = await this.imageService.saveImageFile(thumbnailBuffer, `thumb_${filename}`, shopId, settlementMonth);
    }

    const fileHash = crypto.createHash('md5').update(buffer).digest('hex');

    // 2. 创建池记录（先 PENDING，OCR 尚未开始）
    const pending = await this.prisma.paintPendingImage.create({
      data: {
        shopId,
        settlementMonth: settlementMonth || null,
        url,
        thumbnailUrl,
        fileSize: buffer.length,
        fileHash,
        status: PendingImageStatus.PENDING,
        ocrStatus: OcrStatus.PENDING,
        uploadedBy: uploadedBy || null,
        source: source === 'CREATE' ? 'CREATE' : 'POOL',
      },
    });

    // 3. 异步 OCR（不阻塞上传响应，失败仅更新状态，不影响上传成功）
    void this.processOcr(pending.id, shopId, buffer);

    return this.findById(pending.id);
  }

  /**
   * 后台异步 OCR：标记 PROCESSING → 识别 → 写入结果 → 自动匹配。
   * 任何异常都落入 FAILED，保证记录可重试、不会卡死。
   */
  private async processOcr(pendingId: string, shopId: string, buffer: Buffer): Promise<void> {
    try {
      await this.prisma.paintPendingImage.update({
        where: { id: pendingId },
        data: { ocrStatus: OcrStatus.PROCESSING },
      });

      const ocr = await this.ocrService.recognizeWithTemplate(buffer, shopId, 'basic');

      await this.prisma.paintPendingImage.update({
        where: { id: pendingId },
        data: {
          ocrOrderNo: ocr.orderNo || null,
          ocrPlateNumber: ocr.plateNumber || null,
          ocrVin: ocr.vin || null,
          ocrCarModel: ocr.carModel || null,
          ocrBrand: ocr.brand || null,
          ocrCustomerName: ocr.customerName || null,
          ocrPhone: ocr.phone || null,
          ocrDate: ocr.date || null,
          ocrRawJson: JSON.stringify(ocr),
          ocrStatus: OcrStatus.DONE,
        },
      });

      // 识别完成后按来源分流：
      //  CREATE（新建工单时上传）→ 用创建时参数（shopId/settlementMonth）+ OCR 资料补建工单，图片直接归属新工单
      //  POOL（图片池直接上传）→ 匹配已有工单
      const fresh = await this.prisma.paintPendingImage.findUnique({ where: { id: pendingId } });
      if (fresh?.source === 'CREATE') {
        await this.createOrderFromPending(pendingId);
      } else {
        await this.autoMatch(pendingId);
      }
    } catch (e) {
      this.logger.warn(`图片池 OCR 失败 pendingId=${pendingId}: ${e instanceof Error ? e.message : e}`);
      await this.prisma.paintPendingImage
        .update({
          where: { id: pendingId },
          data: { ocrStatus: OcrStatus.FAILED, status: PendingImageStatus.FAILED, matchRemark: 'OCR 识别失败' },
        })
        .catch(() => {});
    }
  }

  /**
   * 将图片直接关联到指定工单（创建工单页“直接创建工单”模式使用）
   * 图片作为该工单的 BEFORE 图，不经图片池、不触发 OCR 自动建单/匹配。
   */
  async attachToOrder(params: { imageBuffer: Buffer; fileName: string; mimeType: string; shopId: string; orderId: string; operatorId?: string; operatorName?: string }) {
    const { imageBuffer, fileName, mimeType, shopId, orderId, operatorId, operatorName } = params

    // 校验工单存在且属于该门店
    const order = await this.prisma.paintWorkOrder.findFirst({ where: { id: orderId, shopId } })
    if (!order) {
      throw new BadRequestException('工单不存在或不属于当前门店')
    }

    const key = `${Date.now()}-${crypto.randomUUID()}-${fileName}`
    const url = await this.imageService.saveImageFile(imageBuffer, key, shopId, undefined)

    const created = await this.prisma.paintWorkOrderImage.create({
      data: {
        orderId: order.id,
        url,
        imageType: PaintImageType.BEFORE,
        fileSize: imageBuffer.length,
        description: operatorName ? `上传人：${operatorName}` : undefined,
      },
    })

    this.logger.log(`图片已直接关联到工单 ${order.orderNo}(${order.id})，imageId=${created.id}`)
    return created
  }

  /** 从记录的 url 读取原图 buffer（用于重试 / 启动恢复） */
  private async readPendingBuffer(url: string): Promise<Buffer> {
    const absPath = path.join(BACKEND_ROOT, url.replace(/^\//, ''));
    return fs.readFile(absPath);
  }

  // ==================== 自动匹配 ====================

  /**
   * 自动匹配：按 orderNo(+shopId+settlementMonth) 优先，车牌兜底。
   * 命中唯一 → MATCHED 并归类；多个候选 → NEEDS_REVIEW；无 → PENDING。
   */
  async autoMatch(pendingId: string): Promise<{ status: PendingImageStatus; matchedOrderId?: string; remark?: string }> {
    const pending = await this.prisma.paintPendingImage.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('图片池记录不存在');
    if (pending.status === PendingImageStatus.MATCHED || pending.status === PendingImageStatus.MANUAL) {
      return { status: pending.status, matchedOrderId: pending.matchedOrderId || undefined };
    }

    const month = pending.settlementMonth || undefined;
    const orderNo = (pending.ocrOrderNo || '').trim();
    const plate = (pending.ocrPlateNumber || '').trim();

    // 1) orderNo 精确匹配
    if (orderNo) {
      const candidates = await this.prisma.paintWorkOrder.findMany({
        where: { orderNo, shopId: pending.shopId, ...(month ? { settlementMonth: month } : {}) },
        select: { id: true, orderNo: true, plateNumber: true, settlementMonth: true },
      });
      if (candidates.length === 1) {
        await this.applyMatch(pending, candidates[0], `按工单号 ${orderNo} 自动匹配`);
        return { status: PendingImageStatus.MATCHED, matchedOrderId: candidates[0].id, remark: `按工单号 ${orderNo} 自动匹配` };
      }
      if (candidates.length > 1) {
        await this.prisma.paintPendingImage.update({
          where: { id: pendingId },
          data: { status: PendingImageStatus.NEEDS_REVIEW, matchRemark: `工单号 ${orderNo} 命中 ${candidates.length} 条候选，待人工确认` },
        });
        return { status: PendingImageStatus.NEEDS_REVIEW, remark: `工单号命中 ${candidates.length} 条候选` };
      }
    }

    // 2) 车牌兜底匹配
    if (plate) {
      const candidates = await this.prisma.paintWorkOrder.findMany({
        where: { plateNumber: plate, shopId: pending.shopId, ...(month ? { settlementMonth: month } : {}) },
        select: { id: true, orderNo: true, plateNumber: true, settlementMonth: true },
      });
      if (candidates.length === 1) {
        await this.applyMatch(pending, candidates[0], `按车牌 ${plate} 自动匹配（建议核对）`);
        return { status: PendingImageStatus.MATCHED, matchedOrderId: candidates[0].id, remark: `按车牌 ${plate} 自动匹配` };
      }
      if (candidates.length > 1) {
        await this.prisma.paintPendingImage.update({
          where: { id: pendingId },
          data: { status: PendingImageStatus.NEEDS_REVIEW, matchRemark: `车牌 ${plate} 命中 ${candidates.length} 条候选，待人工确认` },
        });
        return { status: PendingImageStatus.NEEDS_REVIEW, remark: `车牌命中 ${candidates.length} 条候选` };
      }
    }

    // 3) 无匹配
    const remark = !orderNo && !plate ? 'OCR 未识别出工单号/车牌，等待人工指派' : '未匹配到对应工单，等待人工指派';
    await this.prisma.paintPendingImage.update({
      where: { id: pendingId },
      data: { status: PendingImageStatus.PENDING, matchRemark: remark },
    });
    return { status: PendingImageStatus.PENDING, remark };
  }

  // ==================== 归类到工单（核心：只填空，不动幅数） ====================

  /**
   * 把池图片归类到指定工单：
   *  - 仅当工单字段为空时填 OCR 值（plateNumber/vin/carModel/brand/customerName/phone/orderDate）
   *  - 关联一张 PaintWorkOrderImage（BEFORE）
   *  - 若新填入车牌且工单无 vehicleId → upsert 车辆并关联
   *  - 绝不修改 totalPaintCount / items / status
   * 标记池记录为指定状态（MATCHED 或 MANUAL）。
   */
  private async applyMatch(
    pending: { id: string; url: string; thumbnailUrl: string | null; fileSize: number | null; settlementMonth: string | null; ocrOrderNo: string | null; ocrPlateNumber: string | null; ocrVin: string | null; ocrCarModel: string | null; ocrBrand: string | null; ocrCustomerName: string | null; ocrPhone: string | null; ocrDate: string | null },
    order: { id: string },
    remark: string,
    status: PendingImageStatus = PendingImageStatus.MATCHED,
  ) {
    const fullOrder = await this.prisma.paintWorkOrder.findUnique({ where: { id: order.id } });
    if (!fullOrder) throw new NotFoundException('目标工单不存在');

    // 只填空字段
    const fillEmpty = (cur: string | null | undefined, ocrVal: string | null | undefined): string | undefined => {
      const c = (cur ?? '').trim();
      const n = (ocrVal ?? '').trim();
      if (!n) return undefined;
      if (!c) return n;
      return undefined;
    };

    const newPlate = fillEmpty(fullOrder.plateNumber, pending.ocrPlateNumber);
    const newVin = fillEmpty(fullOrder.vin, pending.ocrVin);
    const newCarModel = fillEmpty(fullOrder.carModel, pending.ocrCarModel);
    const newBrand = fillEmpty(fullOrder.brand, pending.ocrBrand);
    const newCustomerName = fillEmpty(fullOrder.customerName, pending.ocrCustomerName);
    const newPhone = fillEmpty(fullOrder.phone, pending.ocrPhone);
    const newOrderDateStr = fillEmpty(fullOrder.orderDate ? fullOrder.orderDate.toISOString().slice(0, 10) : null, pending.ocrDate);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updateData: Prisma.PaintWorkOrderUpdateInput = {};

      if (newPlate) updateData.plateNumber = newPlate;
      if (newVin) updateData.vin = newVin;
      if (newCarModel) updateData.carModel = newCarModel;
      if (newBrand) updateData.brand = newBrand;
      if (newCustomerName) updateData.customerName = newCustomerName;
      if (newPhone) updateData.phone = newPhone;
      if (newOrderDateStr) updateData.orderDate = new Date(newOrderDateStr);

      // 若新填入车牌且工单未关联车辆 → upsert 车辆并关联
      const plateToUse = newPlate || fullOrder.plateNumber || '';
      if (plateToUse && !fullOrder.vehicleId) {
        const vehicleId = await this.vehicleService.upsertByPlateWithTx(
          tx,
          {
            plateNumber: plateToUse,
            vin: newVin || fullOrder.vin || undefined,
            carModel: newCarModel || fullOrder.carModel || undefined,
            brand: newBrand || fullOrder.brand || undefined,
            customerName: newCustomerName || fullOrder.customerName || undefined,
            phone: newPhone || fullOrder.phone || undefined,
          },
          fullOrder.shopId,
          newOrderDateStr ? new Date(newOrderDateStr) : fullOrder.orderDate || undefined,
        );
        updateData.vehicle = { connect: { id: vehicleId } };
      }

      if (Object.keys(updateData).length > 0) {
        await tx.paintWorkOrder.update({ where: { id: fullOrder.id }, data: updateData });
      }

      // 关联图片（不复用已有 url，直接新建记录）
      await tx.paintWorkOrderImage.create({
        data: {
          orderId: fullOrder.id,
          url: pending.url,
          thumbnailUrl: pending.thumbnailUrl,
          imageType: PaintImageType.BEFORE,
          fileSize: pending.fileSize,
        },
      });

      // 归类成功后从图片池清除该记录（图片已关联到工单，物理文件保留）
      await tx.paintPendingImage.delete({ where: { id: pending.id } });
    });

    // 事务外：若新关联了车辆，刷新车辆统计
    if (newPlate && !fullOrder.vehicleId) {
      const updated = await this.prisma.paintWorkOrder.findUnique({ where: { id: fullOrder.id }, select: { vehicleId: true } });
      if (updated?.vehicleId) {
        await this.vehicleService.refreshStats(updated.vehicleId).catch(() => void 0);
      }
    }

    this.winston.info?.(`图片池归类成功 pendingId=${pending.id} → orderId=${fullOrder.id} (${remark})`);
  }

  // ==================== 人工指派 ====================

  /** 人工指派到指定工单（手动归类），同样只填空字段 + 关联图片 */
  async manualMatch(pendingId: string, orderId: string, remark?: string) {
    const pending = await this.prisma.paintPendingImage.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('图片池记录不存在');
    if (pending.status === PendingImageStatus.MATCHED || pending.status === PendingImageStatus.MANUAL) {
      throw new BadRequestException('该图片已归类，无需重复操作');
    }
    const order = await this.prisma.paintWorkOrder.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) throw new NotFoundException('目标工单不存在');

    await this.applyMatch(pending, order, remark || '人工指派归类', PendingImageStatus.MANUAL);
    return { id: pendingId, status: PendingImageStatus.MANUAL, matchedOrderId: order.id };
  }

  // ==================== 补建工单 ====================

  /**
   * 用 OCR 基础资料为池图片补建一条工单（无幅数、无 items、status=PENDING），
   * 并关联图片 + 沉淀车辆。适用于"图片来了但完全没有对应工单"的场景。
   */
  async createOrderFromPending(pendingId: string, settlementMonthOverride?: string) {
    const pending = await this.prisma.paintPendingImage.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('图片池记录不存在');
    if (pending.status === PendingImageStatus.MATCHED || pending.status === PendingImageStatus.MANUAL) {
      throw new BadRequestException('该图片已归类，无需补建');
    }

    const settlementMonth = settlementMonthOverride || pending.settlementMonth || undefined;
    const orderDate = pending.ocrDate ? new Date(pending.ocrDate) : null;
    const plate = (pending.ocrPlateNumber || '').trim();

    const order = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 沉淀车辆
      let vehicleId: string | undefined;
      if (plate) {
        vehicleId = await this.vehicleService.upsertByPlateWithTx(
          tx,
          {
            plateNumber: plate,
            vin: pending.ocrVin || undefined,
            carModel: pending.ocrCarModel || undefined,
            brand: pending.ocrBrand || undefined,
            customerName: pending.ocrCustomerName || undefined,
            phone: pending.ocrPhone || undefined,
          },
          pending.shopId,
          orderDate || undefined,
        );
      }

      const created = await tx.paintWorkOrder.create({
        data: {
          orderNo: pending.ocrOrderNo || null,
          shopId: pending.shopId,
          orderDate,
          plateNumber: plate || '',
          carModel: pending.ocrCarModel || '',
          vin: pending.ocrVin || '',
          brand: pending.ocrBrand || '',
          customerName: pending.ocrCustomerName || '',
          phone: pending.ocrPhone || '',
          vehicleId: vehicleId || null,
          totalPaintCount: 0, // 无幅数
          status: 'PENDING',
          settlementMonth: settlementMonth || null,
        },
      });

      await tx.paintWorkOrderImage.create({
        data: {
          orderId: created.id,
          url: pending.url,
          thumbnailUrl: pending.thumbnailUrl,
          imageType: PaintImageType.BEFORE,
          fileSize: pending.fileSize,
        },
      });

      // 补建工单并归类成功后，从图片池清除该记录（图片已关联到工单，物理文件保留）
      await tx.paintPendingImage.delete({ where: { id: pending.id } });

      return created;
    });

    if (order.vehicleId) {
      await this.vehicleService.refreshStats(order.vehicleId).catch(() => void 0);
    }
    return { id: pendingId, orderId: order.id, status: PendingImageStatus.MANUAL };
  }

  // ==================== 识别结果修正 ====================

  /**
   * 人工修正 OCR 识别结果（仅未归类的图片可修正），并可选择立即重新匹配。
   * 传了哪些字段就覆盖哪些字段，空串表示清空；未传的字段保持原值。
   * 修正后视为识别完成（ocrStatus=DONE），匹配状态复位为 PENDING，
   * 避免记录停留在此前的 FAILED / NEEDS_REVIEW 状态上。
   */
  async correctOcr(pendingId: string, dto: CorrectPendingImageOcrDto) {
    const pending = await this.prisma.paintPendingImage.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('图片池记录不存在');
    if (pending.status === PendingImageStatus.MATCHED || pending.status === PendingImageStatus.MANUAL) {
      throw new BadRequestException('该图片已归类，不能修改识别结果');
    }
    // 后台识别任务仍在进行时禁止修正，避免异步回调覆盖人工结果
    if (pending.ocrStatus === OcrStatus.PROCESSING) {
      throw new BadRequestException('图片正在识别中，请稍候再修正');
    }

    const norm = (v?: string | null): string | null => {
      const t = (v ?? '').trim();
      return t.length ? t : null;
    };

    const merged = {
      orderNo: dto.orderNo !== undefined ? norm(dto.orderNo) : pending.ocrOrderNo,
      plateNumber: dto.plateNumber !== undefined ? norm(dto.plateNumber) : pending.ocrPlateNumber,
      vin: dto.vin !== undefined ? norm(dto.vin) : pending.ocrVin,
      carModel: dto.carModel !== undefined ? norm(dto.carModel) : pending.ocrCarModel,
      brand: dto.brand !== undefined ? norm(dto.brand) : pending.ocrBrand,
      customerName: dto.customerName !== undefined ? norm(dto.customerName) : pending.ocrCustomerName,
      phone: dto.phone !== undefined ? norm(dto.phone) : pending.ocrPhone,
      date: dto.date !== undefined ? norm(dto.date) : pending.ocrDate,
    };

    // 同步原始识别 JSON，保证其它读取方（候选查询、导出等）拿到修正后的值
    let raw: Record<string, unknown> = {};
    try {
      raw = pending.ocrRawJson ? JSON.parse(pending.ocrRawJson) : {};
    } catch {
      raw = {};
    }

    await this.prisma.paintPendingImage.update({
      where: { id: pendingId },
      data: {
        ocrOrderNo: merged.orderNo,
        ocrPlateNumber: merged.plateNumber,
        ocrVin: merged.vin,
        ocrCarModel: merged.carModel,
        ocrBrand: merged.brand,
        ocrCustomerName: merged.customerName,
        ocrPhone: merged.phone,
        ocrDate: merged.date,
        ocrRawJson: JSON.stringify({ ...raw, ...merged }),
        settlementMonth: dto.settlementMonth !== undefined ? norm(dto.settlementMonth) : pending.settlementMonth,
        ocrStatus: OcrStatus.DONE,
        status: PendingImageStatus.PENDING,
        matchRemark: '识别结果已人工修正',
      },
    });

    let match: { status: PendingImageStatus; matchedOrderId?: string; remark?: string } | null = null;
    if (dto.rematch !== false) {
      match = await this.autoMatch(pendingId);
    }

    // 匹配成功时记录已被删除（图片已归入工单），此处返回 null 属正常
    const record = await this.findById(pendingId);
    this.winston.info?.(`图片池识别结果人工修正 pendingId=${pendingId} rematch=${dto.rematch !== false} → ${match?.status ?? 'NONE'}`);
    return { id: pendingId, record, match };
  }

  // ==================== 删除 ====================

  /**
   * 删除池图片记录。
   * 已归类(MATCHED/MANUAL)的：图片已被工单引用，仅删池记录，不删物理文件。
   * 未归类的：同时删物理文件。
   */
  async delete(pendingId: string) {
    const pending = await this.prisma.paintPendingImage.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('图片池记录不存在');

    const isMatched = pending.status === PendingImageStatus.MATCHED || pending.status === PendingImageStatus.MANUAL;
    if (!isMatched) {
      // 未归类：删物理文件
      await this.imageService.deletePhysicalFiles(pending.url, pending.thumbnailUrl).catch(() => void 0);
    }
    await this.prisma.paintPendingImage.delete({ where: { id: pendingId } });
    return { ok: true };
  }

  // ==================== 查询 ====================

  async findById(id: string) {
    return this.prisma.paintPendingImage.findUnique({
      where: { id },
      include: {
        shop: { select: { id: true, name: true, code: true } },
        order: { select: { id: true, orderNo: true, plateNumber: true, settlementMonth: true, status: true } },
      },
    });
  }

  async page(dto: PagePendingImageDto, accessibleShopIds: string[] | null): Promise<PaginationResult<any>> {
    const { current, size, skip, take } = pageArgs(dto.current, dto.size, 20);

    const where: Prisma.PaintPendingImageWhereInput = {};
    if (dto.shopId) where.shopId = dto.shopId;
    if (dto.settlementMonth) where.settlementMonth = dto.settlementMonth;
    if (dto.status) where.status = dto.status;
    if (dto.keyword && dto.keyword.trim()) {
      const kw = dto.keyword.trim();
      where.OR = [
        { ocrOrderNo: { contains: kw } },
        { ocrPlateNumber: { contains: kw } },
      ];
    }
    // 数据权限：在可访问门店范围内（若指定了门店则进一步限定到该门店）
    if (accessibleShopIds !== null) {
      if (accessibleShopIds.length === 0) return { current, size, total: 0, records: [] };
      where.shopId = dto.shopId
        ? { in: accessibleShopIds, equals: dto.shopId }
        : { in: accessibleShopIds };
    }

    const [records, total] = await Promise.all([
      this.prisma.paintPendingImage.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          shop: { select: { id: true, name: true, code: true } },
          order: { select: { id: true, orderNo: true, plateNumber: true, settlementMonth: true, status: true } },
        },
      }),
      this.prisma.paintPendingImage.count({ where }),
    ]);

    // 状态统计（仅按当前筛选范围外的全局统计更实用，这里返回当前门店范围的统计）
    return { current, size, total, records };
  }

  /** 状态计数（按门店+月份，含数据权限） */
  async statusCounts(shopId?: string, settlementMonth?: string, accessibleShopIds?: string[] | null) {
    const where: Prisma.PaintPendingImageWhereInput = {};
    if (shopId) where.shopId = shopId;
    if (settlementMonth) where.settlementMonth = settlementMonth;
    if (!shopId && accessibleShopIds !== null && accessibleShopIds !== undefined) {
      if (accessibleShopIds.length === 0) {
        return { PENDING: 0, MATCHED: 0, NEEDS_REVIEW: 0, MANUAL: 0, FAILED: 0, total: 0 };
      }
      where.shopId = { in: accessibleShopIds };
    }
    const grouped = await this.prisma.paintPendingImage.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const result: Record<string, number> = {
      PENDING: 0, MATCHED: 0, NEEDS_REVIEW: 0, MANUAL: 0, FAILED: 0, total: 0,
    };
    let total = 0;
    for (const g of grouped) {
      result[g.status] = g._count._all;
      total += g._count._all;
    }
    result.total = total;
    return result;
  }

  /** 重新 OCR（异步：立即返回，后台重新识别） */
  async retryOcr(pendingId: string) {
    const pending = await this.prisma.paintPendingImage.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('图片池记录不存在');
    if (pending.status === PendingImageStatus.MATCHED || pending.status === PendingImageStatus.MANUAL) {
      throw new BadRequestException('该图片已归类，无需重试');
    }

    let buffer: Buffer;
    try {
      buffer = await this.readPendingBuffer(pending.url);
    } catch {
      throw new BadRequestException('图片文件不存在');
    }

    // 重置为处理中并立即返回，后台重新识别
    await this.prisma.paintPendingImage.update({
      where: { id: pendingId },
      data: { ocrStatus: OcrStatus.PROCESSING, status: PendingImageStatus.PENDING, matchRemark: 'OCR 重试中' },
    });

    void this.processOcr(pendingId, pending.shopId, buffer);
    return { id: pendingId };
  }

  /**
   * 应用启动时恢复：扫描因服务重启等原因卡在 PENDING/PROCESSING 的图片，
   * 重新触发后台 OCR，避免记录永久停留在“识别中”。
   */
  async onApplicationBootstrap() {
    try {
      const stuck = await this.prisma.paintPendingImage.findMany({
        where: {
          ocrStatus: { in: [OcrStatus.PENDING, OcrStatus.PROCESSING] },
          status: { notIn: [PendingImageStatus.MATCHED, PendingImageStatus.MANUAL] },
        },
        take: 200,
        orderBy: { createdAt: 'asc' },
      });
      for (const s of stuck) {
        try {
          const buffer = await this.readPendingBuffer(s.url);
          void this.processOcr(s.id, s.shopId, buffer);
        } catch {
          // 文件缺失则标记为失败，避免反复重试
          await this.prisma.paintPendingImage
            .update({
              where: { id: s.id },
              data: { ocrStatus: OcrStatus.FAILED, status: PendingImageStatus.FAILED, matchRemark: 'OCR 恢复失败：原图缺失' },
            })
            .catch(() => {});
        }
      }
      if (stuck.length) this.logger.log(`图片池启动恢复：重新触发 ${stuck.length} 条未完成 OCR`);
    } catch (e) {
      this.logger.warn(`图片池启动恢复失败: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** 查询候选工单（NEEDS_REVIEW 时前端展示候选列表用） */
  async findCandidates(pendingId: string) {
    const pending = await this.prisma.paintPendingImage.findUnique({ where: { id: pendingId } });
    if (!pending) throw new NotFoundException('图片池记录不存在');
    const month = pending.settlementMonth || undefined;
    const orderNo = (pending.ocrOrderNo || '').trim();
    const plate = (pending.ocrPlateNumber || '').trim();

    const where: Prisma.PaintWorkOrderWhereInput = { shopId: pending.shopId, ...(month ? { settlementMonth: month } : {}) };
    if (orderNo) {
      where.OR = [{ orderNo: orderNo }, ...(plate ? [{ plateNumber: plate }] : [])];
    } else if (plate) {
      where.plateNumber = plate;
    } else {
      return [];
    }

    return this.prisma.paintWorkOrder.findMany({
      where,
      select: {
        id: true, orderNo: true, plateNumber: true, carModel: true, settlementMonth: true, status: true, orderDate: true, totalPaintCount: true,
      },
      orderBy: { orderDate: 'desc' },
      take: 20,
    });
  }
}
