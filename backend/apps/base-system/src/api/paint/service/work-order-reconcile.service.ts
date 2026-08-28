import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import * as XLSX from 'xlsx';

export interface ReconcileExcelRow {
  no: number | string;
  orderNo: string;
  plateNumber: string;
  paintCount: number;
  remark?: string;
}

export interface ReconcileMatchedItem {
  id?: string;
  type: 'matched' | 'diff';
  orderNo: string;
  plateNumber: string;
  excelPaintCount: number;
  systemPaintCount: number;
  diff: number;
  status: string;
  systemRemark?: string | null;
  isRework?: boolean | null;
  reworkRemark?: string | null;
}

export interface ReconcileMissingInSystemItem {
  type: 'missing_in_system';
  orderNo: string;
  plateNumber: string;
  excelPaintCount: number;
  remark?: string;
}

export interface ReconcileExtraInSystemItem {
  id?: string;
  type: 'extra_in_system';
  orderNo: string;
  plateNumber: string;
  systemPaintCount: number;
  status: string;
  isRework?: boolean | null;
  reworkRemark?: string | null;
}

export interface ReconcileDuplicateItem {
  id?: string;
  type: 'duplicate';
  orderNo: string;
  plateNumber: string;
  source: 'excel' | 'system';
  count: number;
}

export interface ReconcileVoidedItem {
  type: 'voided';
  orderNo: string;
  plateNumber: string;
  excelPaintCount?: number;
  systemPaintCount?: number;
  diff?: number;
  voidReason?: string | null;
  remark?: string | null;
}

export type ReconcileItem =
  | ReconcileMatchedItem
  | ReconcileMissingInSystemItem
  | ReconcileExtraInSystemItem
  | ReconcileDuplicateItem
  | ReconcileVoidedItem;

export interface ReconcileResult {
  summary: {
    excelTotal: number;
    systemTotal: number;
    diff: number;
    excelCount: number;
    systemCount: number;
    matchedCount: number;
    diffCount: number;
    missingInSystemCount: number;
    extraInSystemCount: number;
    duplicateCount: number;
    reworkExcludedCount: number;
    reworkExcludedPaintCount: number;
    voidedCount: number;
  };
  items: ReconcileItem[];
}

@Injectable()
export class WorkOrderReconcileService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(shopId: string, settlementMonth: string, fileBuffer: Buffer): Promise<ReconcileResult> {
    if (!shopId) throw new BadRequestException('请选择门店');
    if (!settlementMonth) throw new BadRequestException('请选择结算月份');
    if (!fileBuffer || fileBuffer.length === 0) throw new BadRequestException('请上传对账文件');

    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new BadRequestException('门店不存在');

    let excelRows: ReconcileExcelRow[];
    try {
      excelRows = this.parseExcel(fileBuffer, shop);
    } catch (e: any) {
      throw new BadRequestException(`Excel解析失败: ${e.message || '未知错误'}`);
    }

    if (excelRows.length === 0) {
      throw new BadRequestException('Excel文件中未找到有效数据，请检查文件格式');
    }

    const systemOrders = await this.prisma.paintWorkOrder.findMany({
      where: {
        shopId,
        settlementMonth,
        status: { notIn: ['DRAFT' as any, 'PENDING' as any, 'VOID' as any] },
      },
      select: {
        id: true,
        orderNo: true,
        plateNumber: true,
        totalPaintCount: true,
        status: true,
        remark: true,
        isRework: true,
        reworkRemark: true,
      },
    });

    // 已作废工单：不参与对账统计，但需在对账中展示（标记已作废、不计入对账）
    const voidOrders = await this.prisma.paintWorkOrder.findMany({
      where: { shopId, settlementMonth, status: 'VOID' as any },
      select: { orderNo: true, plateNumber: true, totalPaintCount: true, voidReason: true },
    });
    const voidOrderMap = new Map<string, (typeof voidOrders)[number]>();
    const voidPlateMap = new Map<string, (typeof voidOrders)[number]>();
    for (const vo of voidOrders) {
      if (vo.orderNo) voidOrderMap.set(vo.orderNo, vo);
      if (vo.plateNumber) voidPlateMap.set(vo.plateNumber, vo);
    }
    const coveredVoidKeys = new Set<string>();

    // 返工工单统计（幅数不计入系统总幅数）
    const reworkExcludedCount = systemOrders.filter(o => o.isRework).length;
    const reworkExcludedPaintCount = +systemOrders.filter(o => o.isRework).reduce((sum, o) => sum + Number(o.totalPaintCount), 0).toFixed(2);

    if (systemOrders.length === 0) {
      throw new BadRequestException(`该门店 ${settlementMonth} 月份没有已审核/已结算的工单，请确认门店和月份是否正确`);
    }

    const excelMap = new Map<string, ReconcileExcelRow[]>();
    const excelPlateMap = new Map<string, ReconcileExcelRow[]>();
    for (const row of excelRows) {
      // 分组键：优先工单号，无工单号时用车牌（兼容宏现等无工单号台账，靠车牌对账）
      const key = row.orderNo || row.plateNumber;
      if (!excelMap.has(key)) excelMap.set(key, []);
      excelMap.get(key)!.push(row);

      const plateKey = row.plateNumber;
      if (plateKey) {
        if (!excelPlateMap.has(plateKey)) excelPlateMap.set(plateKey, []);
        excelPlateMap.get(plateKey)!.push(row);
      }
    }

    const systemMap = new Map<string, typeof systemOrders>();
    const systemPlateMap = new Map<string, typeof systemOrders>();
    for (const order of systemOrders) {
      const key = order.orderNo || `__null_${order.id}`;
      if (!systemMap.has(key)) systemMap.set(key, []);
      systemMap.get(key)!.push(order);

      const plateKey = order.plateNumber || '';
      if (plateKey) {
        if (!systemPlateMap.has(plateKey)) systemPlateMap.set(plateKey, []);
        systemPlateMap.get(plateKey)!.push(order);
      }
    }

    const items: ReconcileItem[] = [];
    const matchedSystemOrderIds = new Set<string>();

    // 将一行 excel 与一条系统工单比对，产出 matched / diff 项
    const compareRow = (excelRow: ReconcileExcelRow, systemOrder: (typeof systemOrders)[number]) => {
      const systemPaintCount = Number(systemOrder.totalPaintCount);
      const diff = +(excelRow.paintCount - systemPaintCount).toFixed(2);
      matchedSystemOrderIds.add(systemOrder.id);
      const base = {
        id: systemOrder.id,
        orderNo: excelRow.orderNo || systemOrder.orderNo || '',
        plateNumber: excelRow.plateNumber || systemOrder.plateNumber || '',
        excelPaintCount: excelRow.paintCount,
        systemPaintCount,
        diff,
        status: systemOrder.status,
        systemRemark: systemOrder.remark,
        isRework: systemOrder.isRework,
        reworkRemark: systemOrder.reworkRemark,
      };
      items.push(Math.abs(diff) < 0.001 ? { ...base, type: 'matched' } : { ...base, type: 'diff' });
    };

    // 阶段1：仅按工单号严格匹配（excel 含工单号的行；有工单号绝不回退车牌）
    for (const [orderNo, excelGroup] of excelMap.entries()) {
      if (!excelGroup[0].orderNo) continue;

      if (excelGroup.length > 1) {
        items.push({
          type: 'duplicate',
          orderNo,
          plateNumber: excelGroup[0].plateNumber,
          source: 'excel',
          count: excelGroup.length,
        });
      }

      const systemGroup = systemMap.get(orderNo) || [];
      if (systemGroup.length === 0) {
        // 有工单号但系统无此单：若该单已作废则单独标记，否则判定为系统缺失
        for (const row of excelGroup) {
          const vo = voidOrderMap.get(row.orderNo);
          if (vo) {
            coveredVoidKeys.add(row.orderNo);
            const sys = +Number(vo.totalPaintCount).toFixed(2);
            items.push({
              type: 'voided',
              orderNo: row.orderNo,
              plateNumber: row.plateNumber,
              excelPaintCount: row.paintCount,
              systemPaintCount: sys,
              diff: +(row.paintCount - sys).toFixed(2),
              voidReason: vo.voidReason ?? null,
              remark: row.remark,
            });
          } else {
            items.push({
              type: 'missing_in_system',
              orderNo: row.orderNo,
              plateNumber: row.plateNumber,
              excelPaintCount: row.paintCount,
              remark: row.remark,
            });
          }
        }
        continue;
      }

      if (systemGroup.length > 1) {
        items.push({
          type: 'duplicate',
          orderNo,
          plateNumber: systemGroup[0].plateNumber || '',
          source: 'system',
          count: systemGroup.length,
        });
      }
      // 系统同单号多条时逐条比对
      for (const systemOrder of systemGroup) {
        compareRow(excelGroup[0], systemOrder);
      }
    }

    // 阶段2：仅按车牌匹配（excel 无工单号、仅有车牌的行）
    for (const excelGroup of excelMap.values()) {
      if (excelGroup[0].orderNo) continue;
      const plate = excelGroup[0].plateNumber;
      if (!plate) continue;

      if (excelGroup.length > 1) {
        items.push({
          type: 'duplicate',
          orderNo: plate,
          plateNumber: plate,
          source: 'excel',
          count: excelGroup.length,
        });
      }

      const systemGroup = systemPlateMap.get(plate) || [];
      if (systemGroup.length === 0) {
        for (const row of excelGroup) {
          const vo = voidPlateMap.get(plate);
          if (vo) {
            coveredVoidKeys.add(plate);
            const sys = +Number(vo.totalPaintCount).toFixed(2);
            items.push({
              type: 'voided',
              orderNo: row.plateNumber,
              plateNumber: row.plateNumber,
              excelPaintCount: row.paintCount,
              systemPaintCount: sys,
              diff: +(row.paintCount - sys).toFixed(2),
              voidReason: vo.voidReason ?? null,
              remark: row.remark,
            });
          } else {
            items.push({
              type: 'missing_in_system',
              orderNo: row.plateNumber,
              plateNumber: row.plateNumber,
              excelPaintCount: row.paintCount,
              remark: row.remark,
            });
          }
        }
        continue;
      }

      if (systemGroup.length > 1) {
        items.push({
          type: 'duplicate',
          orderNo: plate,
          plateNumber: systemGroup[0].plateNumber || '',
          source: 'system',
          count: systemGroup.length,
        });
      }
      // 系统同车牌多条时逐条比对
      for (const systemOrder of systemGroup) {
        compareRow(excelGroup[0], systemOrder);
      }
    }

    // 系统有、excel 无匹配项 -> 多出于系统
    const processedSystemOrders = new Set<string>();
    for (const [orderNo, systemGroup] of systemMap.entries()) {
      if (systemGroup.length > 1 && !orderNo.startsWith('__null_')) {
        const firstOrder = systemGroup[0];
        items.push({
          id: firstOrder.id,
          type: 'duplicate',
          orderNo,
          plateNumber: firstOrder.plateNumber || '',
          source: 'system',
          count: systemGroup.length,
        });
      }

      for (const systemOrder of systemGroup) {
        if (processedSystemOrders.has(systemOrder.id)) continue;
        if (matchedSystemOrderIds.has(systemOrder.id)) continue;

        processedSystemOrders.add(systemOrder.id);

        items.push({
          id: systemOrder.id,
          type: 'extra_in_system',
          orderNo: systemOrder.orderNo || '',
          plateNumber: systemOrder.plateNumber || '',
          systemPaintCount: Number(systemOrder.totalPaintCount),
          status: systemOrder.status,
          isRework: systemOrder.isRework,
          reworkRemark: systemOrder.reworkRemark,
        });
      }
    }

    // 系统已作废但 Excel 未出现的工单：一并展示（标记已作废、不计入对账）
    for (const vo of voidOrders) {
      const key = vo.orderNo || vo.plateNumber || '';
      if (key && coveredVoidKeys.has(key)) continue;
      items.push({
        type: 'voided',
        orderNo: vo.orderNo || '',
        plateNumber: vo.plateNumber || '',
        systemPaintCount: +Number(vo.totalPaintCount).toFixed(2),
        voidReason: vo.voidReason ?? null,
      });
    }

    const excelTotal = +excelRows.reduce((sum, r) => sum + r.paintCount, 0).toFixed(2);
    // 系统总幅数不计入返工工单
    const systemTotal = +systemOrders.filter(o => !o.isRework).reduce((sum, o) => sum + Number(o.totalPaintCount), 0).toFixed(2);
    const diff = +(excelTotal - systemTotal).toFixed(2);

    const matchedCount = items.filter(i => i.type === 'matched').length;
    const diffCount = items.filter(i => i.type === 'diff').length;
    const missingInSystemCount = items.filter(i => i.type === 'missing_in_system').length;
    const extraInSystemCount = items.filter(i => i.type === 'extra_in_system').length;
    const duplicateCount = items.filter(i => i.type === 'duplicate').length;
    const voidedCount = items.filter(i => i.type === 'voided').length;

    return {
      summary: {
        excelTotal,
        systemTotal,
        diff,
        excelCount: excelRows.length,
        systemCount: systemOrders.length,
        matchedCount,
        diffCount,
        missingInSystemCount,
        extraInSystemCount,
        duplicateCount,
        reworkExcludedCount,
        reworkExcludedPaintCount,
        voidedCount,
      },
      items,
    };
  }

  private parseExcel(fileBuffer: Buffer, shop: { excelTemplateConfig?: string | null }): ReconcileExcelRow[] {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    if (workbook.SheetNames.length === 0) {
      throw new Error('Excel文件没有工作表');
    }
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

    if (!jsonData || jsonData.length === 0) {
      throw new Error('Excel文件内容为空');
    }

    let config: {
      dataStartRow?: number;
      headerRow?: number;
      fields?: { orderNo?: string; plateNumber?: string; paintCount?: string; remark?: string };
    } | null = null;

    if (shop.excelTemplateConfig) {
      try {
        config = JSON.parse(shop.excelTemplateConfig);
      } catch {
        config = null;
      }
    }

    let orderNoColIndex = -1;
    let plateNumberColIndex = -1;
    let paintCountColIndex = -1;
    let remarkColIndex = -1;
    let headerRow = config?.headerRow !== undefined ? config.headerRow : 0;
    let startRow = 0;

    // 先尝试自动识别表头，供模板不适用时回退使用
    const detectedHeader = this.detectReconcileHeader(jsonData);
    let useConfig = false;

    // 门店模板（明细台账）仅适用于符合其结构的文件。若上传的是汇总/对账文件
    // （如 序号/单号/车牌/副数），直接套用会把列读错（工单号读到空列、副数被当成车牌），
    // 因此校验配置表头行在 orderNo/paintCount 列上是否出现对应表头文字，否则放弃模板。
    if (config && config.fields) {
      const hRow = (jsonData[config.headerRow ?? 0] || []) as unknown[];
      const orderHdrCol = config.fields.orderNo ? XLSX.utils.decode_col(config.fields.orderNo) : -1;
      const paintHdrCol = config.fields.paintCount ? XLSX.utils.decode_col(config.fields.paintCount) : -1;
      const orderHeader = orderHdrCol >= 0 ? String(hRow[orderHdrCol] ?? '').toLowerCase() : '';
      const paintHeader = paintHdrCol >= 0 ? String(hRow[paintHdrCol] ?? '').toLowerCase() : '';
      const orderOk =
        orderHeader.includes('工单') ||
        orderHeader.includes('单号') ||
        orderHeader.includes('订单号') ||
        orderHeader.includes('维修单');
      const paintOk =
        paintHeader.includes('副数') ||
        paintHeader.includes('幅数') ||
        paintHeader.includes('总幅') ||
        paintHeader.includes('总计') ||
        paintHeader.includes('面积') ||
        paintHeader.includes('油漆') ||
        paintHeader.includes('涂料') ||
        paintHeader.includes('喷漆') ||
        paintHeader.includes('数量');
      if (orderOk && paintOk) {
        useConfig = true;
      } else {
        config = null;
      }
    }

    if (useConfig && config && config.fields) {
      if (config.fields.orderNo) orderNoColIndex = XLSX.utils.decode_col(config.fields.orderNo);
      if (config.fields.plateNumber) plateNumberColIndex = XLSX.utils.decode_col(config.fields.plateNumber);
      if (config.fields.paintCount) paintCountColIndex = XLSX.utils.decode_col(config.fields.paintCount);
      if (config.fields.remark) remarkColIndex = XLSX.utils.decode_col(config.fields.remark);
      if (config.dataStartRow !== undefined) startRow = config.dataStartRow;
    }

    if (orderNoColIndex === -1) {
      // 自动识别表头行：支持"台账"格式（含标题/合计行、系数行）与汇总格式
      const detected = detectedHeader;
      if (detected) {
        headerRow = detected.headerRow;
        orderNoColIndex = detected.orderNoColIndex;
        plateNumberColIndex = detected.plateNumberColIndex;
        paintCountColIndex = detected.paintCountColIndex;
        remarkColIndex = detected.remarkColIndex;
      } else {
        const headers = jsonData[0] || [];
        if (headers.length >= 2) {
          orderNoColIndex = 1;
          if (plateNumberColIndex === -1) plateNumberColIndex = 2;
          if (paintCountColIndex === -1) paintCountColIndex = 3;
          if (remarkColIndex === -1) remarkColIndex = 4;
        } else {
          throw new Error('无法识别工单号列，请确保Excel包含"工单号"或"单号"列');
        }
      }

      if (config?.dataStartRow === undefined) {
        startRow = headerRow + 1;
      }
    }

    const rows: ReconcileExcelRow[] = [];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

    for (let i = startRow; i <= range.e.r; i++) {
      const row = jsonData[i];
      if (!row) continue;

      const orderNo = String(row[orderNoColIndex] || '').trim();
      const plateNumber = plateNumberColIndex >= 0 ? String(row[plateNumberColIndex] || '').trim() : '';

      // 允许"无工单号但有车牌"的行参与对账（如宏现台账：工单号/车架号列为空，靠车牌匹配系统工单）
      if (!orderNo && !plateNumber) continue;

      const paintCountRaw = paintCountColIndex >= 0 ? row[paintCountColIndex] : undefined;
      const remark = remarkColIndex >= 0 ? (row[remarkColIndex] ? String(row[remarkColIndex]) : undefined) : undefined;

      if (orderNo.includes('合计') || orderNo.includes('总计')) continue;

      let paintCount = 0;
      if (typeof paintCountRaw === 'number') {
        paintCount = paintCountRaw;
      } else if (paintCountRaw !== undefined && paintCountRaw !== null) {
        const parsed = parseFloat(String(paintCountRaw).trim());
        if (!isNaN(parsed)) paintCount = parsed;
      }

      rows.push({
        no: i + 1,
        orderNo,
        plateNumber,
        paintCount,
        remark,
      });
    }

    return rows;
  }

  /**
   * 自动定位表头行并识别关键列（工单号/车牌/总幅数/备注）。
   * 兼容两类台账：
   *  - 明细台账：含标题行、合计行、部位列、系数行（如"江门瑞华比亚迪喷漆维修台账"）
   *  - 汇总台账：仅含"工单号/车牌/总幅数"等少量列
   * 只要某行同时出现"工单号"与"总幅数/副数"类表头，即视为表头行；
   * 数据起始行自动设为表头行 + 1（系数行因工单号为空会被自动跳过）。
   */
  private detectReconcileHeader(jsonData: any[][]): {
    headerRow: number;
    orderNoColIndex: number;
    plateNumberColIndex: number;
    paintCountColIndex: number;
    remarkColIndex: number;
  } | null {
    const maxRow = Math.min(20, jsonData.length);
    let best: {
      headerRow: number;
      score: number;
      orderNo: number;
      plate: number;
      paint: number;
      remark: number;
    } | null = null;

    for (let r = 0; r < maxRow; r++) {
      const headers = jsonData[r] || [];
      let orderNo = -1;
      let plate = -1;
      let paint = -1;
      let remark = -1;
      for (let c = 0; c < headers.length; c++) {
        const h = String(headers[c] || '').toLowerCase().trim();
        if (h.includes('工单') || h.includes('单号') || h.includes('订单号') || h.includes('维修单')) {
          if (orderNo === -1) orderNo = c;
        } else if (h.includes('车牌') || h.includes('牌照') || h.includes('车号')) {
          if (plate === -1) plate = c;
        } else if (
          h.includes('副数') ||
          h.includes('幅数') ||
          h.includes('总幅') ||
          h.includes('总计') ||
          h.includes('面积') ||
          h.includes('油漆') ||
          h.includes('涂料') ||
          h.includes('喷漆') ||
          h.includes('数量')
        ) {
          // 优先匹配"副数/幅数/总幅"等总幅数列，'数量'作为兜底
          if (paint === -1) paint = c;
        } else if (h.includes('备注') || h.includes('说明')) {
          if (remark === -1) remark = c;
        }
      }

      // 表头行必须同时具备工单号与总幅数列
      if (orderNo === -1 || paint === -1) continue;

      const score =
        (orderNo !== -1 ? 1 : 0) +
        (plate !== -1 ? 1 : 0) +
        (paint !== -1 ? 1 : 0) +
        (remark !== -1 ? 1 : 0);
      if (!best || score > best.score) {
        best = { headerRow: r, score, orderNo, plate, paint, remark };
      }
    }

    if (!best) return null;
    return {
      headerRow: best.headerRow,
      orderNoColIndex: best.orderNo,
      plateNumberColIndex: best.plate,
      paintCountColIndex: best.paint,
      remarkColIndex: best.remark,
    };
  }
}
