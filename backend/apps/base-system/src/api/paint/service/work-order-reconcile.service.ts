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

export type ReconcileItem =
  | ReconcileMatchedItem
  | ReconcileMissingInSystemItem
  | ReconcileExtraInSystemItem
  | ReconcileDuplicateItem;

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
        status: { notIn: ['DRAFT' as any, 'PENDING' as any] },
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

    // 返工工单统计（幅数不计入系统总幅数）
    const reworkExcludedCount = systemOrders.filter(o => o.isRework).length;
    const reworkExcludedPaintCount = +systemOrders.filter(o => o.isRework).reduce((sum, o) => sum + Number(o.totalPaintCount), 0).toFixed(2);

    if (systemOrders.length === 0) {
      throw new BadRequestException(`该门店 ${settlementMonth} 月份没有已审核/已结算的工单，请确认门店和月份是否正确`);
    }

    const excelMap = new Map<string, ReconcileExcelRow[]>();
    const excelPlateMap = new Map<string, ReconcileExcelRow[]>();
    for (const row of excelRows) {
      const key = row.orderNo;
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
    const matchedSystemKeys = new Set<string>();
    const matchedExcelKeys = new Set<string>();
    const matchedSystemOrderIds = new Set<string>();
    const matchedSystemPlateKeys = new Set<string>();
    const matchedExcelPlateKeys = new Set<string>();

    for (const [orderNo, excelGroup] of excelMap.entries()) {
      if (excelGroup.length > 1) {
        items.push({
          type: 'duplicate',
          orderNo,
          plateNumber: excelGroup[0].plateNumber,
          source: 'excel',
          count: excelGroup.length,
        });
      }

      let systemGroup = systemMap.get(orderNo);
      let matchedByPlate = false;

      if (!systemGroup || systemGroup.length === 0) {
        const excelPlate = excelGroup[0].plateNumber;
        if (excelPlate) {
          const plateSystemGroup = systemPlateMap.get(excelPlate);
          if (plateSystemGroup && plateSystemGroup.length > 0) {
            systemGroup = plateSystemGroup;
            matchedByPlate = true;
          }
        }
      }

      if (!systemGroup || systemGroup.length === 0) {
        for (const row of excelGroup) {
          items.push({
            type: 'missing_in_system',
            orderNo: row.orderNo,
            plateNumber: row.plateNumber,
            excelPaintCount: row.paintCount,
            remark: row.remark,
          });
        }
        continue;
      }

      if (systemGroup.length > 1) {
        items.push({
          id: systemGroup[0].id,
          type: 'duplicate',
          orderNo,
          plateNumber: systemGroup[0].plateNumber || '',
          source: 'system',
          count: systemGroup.length,
        });
      }

      const excelRow = excelGroup[0];
      const systemOrder = systemGroup[0];

      if (matchedByPlate) {
        const plateKey = excelRow.plateNumber;
        if (plateKey) {
          matchedSystemPlateKeys.add(plateKey);
          matchedExcelPlateKeys.add(plateKey);
        }
      } else {
        matchedSystemKeys.add(orderNo);
        matchedExcelKeys.add(orderNo);
      }
      matchedSystemOrderIds.add(systemOrder.id);

      const systemPaintCount = Number(systemOrder.totalPaintCount);
      const diff = +(excelRow.paintCount - systemPaintCount).toFixed(2);

      if (Math.abs(diff) < 0.001) {
        items.push({
          id: systemOrder.id,
          type: 'matched',
          orderNo,
          plateNumber: excelRow.plateNumber || systemOrder.plateNumber || '',
          excelPaintCount: excelRow.paintCount,
          systemPaintCount,
          diff: 0,
          status: systemOrder.status,
          systemRemark: systemOrder.remark,
          isRework: systemOrder.isRework,
          reworkRemark: systemOrder.reworkRemark,
        });
      } else {
        items.push({
          id: systemOrder.id,
          type: 'diff',
          orderNo,
          plateNumber: excelRow.plateNumber || systemOrder.plateNumber || '',
          excelPaintCount: excelRow.paintCount,
          systemPaintCount,
          diff,
          status: systemOrder.status,
          systemRemark: systemOrder.remark,
          isRework: systemOrder.isRework,
          reworkRemark: systemOrder.reworkRemark,
        });
      }
    }

    const processedSystemOrders = new Set<string>();
    for (const [orderNo, systemGroup] of systemMap.entries()) {
      if (matchedSystemKeys.has(orderNo)) continue;

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
        
        const plateKey = systemOrder.plateNumber || '';
        if (matchedSystemPlateKeys.has(plateKey)) continue;

        processedSystemOrders.add(systemOrder.id);

        items.push({
          id: systemOrder.id,
          type: 'extra_in_system',
          orderNo: systemOrder.orderNo || '',
          plateNumber: plateKey,
          systemPaintCount: Number(systemOrder.totalPaintCount),
          status: systemOrder.status,
          isRework: systemOrder.isRework,
          reworkRemark: systemOrder.reworkRemark,
        });
      }
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
    let startRow = 0;

    if (config && config.fields) {
      if (config.fields.orderNo) orderNoColIndex = XLSX.utils.decode_col(config.fields.orderNo);
      if (config.fields.plateNumber) plateNumberColIndex = XLSX.utils.decode_col(config.fields.plateNumber);
      if (config.fields.paintCount) paintCountColIndex = XLSX.utils.decode_col(config.fields.paintCount);
      if (config.fields.remark) remarkColIndex = XLSX.utils.decode_col(config.fields.remark);
      if (config.dataStartRow !== undefined) startRow = config.dataStartRow;
    }

    if (orderNoColIndex === -1) {
      const headerRow = config?.headerRow !== undefined ? config.headerRow : 0;
      const headers = jsonData[headerRow] || [];
      for (let i = 0; i < headers.length; i++) {
        const header = String(headers[i] || '').toLowerCase().trim();
        if (header.includes('工单') || header.includes('单号') || header.includes('订单号')) {
          orderNoColIndex = i;
        } else if (header.includes('车牌') || header.includes('牌照') || header.includes('车号')) {
          plateNumberColIndex = i;
        } else if (header.includes('幅数') || header.includes('面积') || header.includes('数量') || header.includes('总计') || header.includes('油漆') || header.includes('涂料') || header.includes('喷漆')) {
          paintCountColIndex = i;
        } else if (header.includes('备注') || header.includes('说明')) {
          remarkColIndex = i;
        }
      }

      if (orderNoColIndex === -1) {
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
      if (!orderNo) continue;

      const plateNumber = plateNumberColIndex >= 0 ? String(row[plateNumberColIndex] || '').trim() : '';
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
}
