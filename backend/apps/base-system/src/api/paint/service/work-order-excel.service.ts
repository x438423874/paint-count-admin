import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import * as XLSX from 'xlsx';
import { WorkOrderService } from './work-order.service';

/** 默认列映射（作为后备） */
const DEFAULT_COLUMN_MAP: { col: string; categoryName: string }[] = [
  { col: 'G', categoryName: '车门' },
  { col: 'H', categoryName: '车门里外' },
  { col: 'I', categoryName: '车门半喷' },
  { col: 'J', categoryName: '叶子板' },
  { col: 'K', categoryName: '前头盖' },
  { col: 'L', categoryName: '前头盖里外' },
  { col: 'M', categoryName: '后盖' },
  { col: 'N', categoryName: '后盖里外' },
  { col: 'O', categoryName: '车顶' },
  { col: 'P', categoryName: '前后杠' },
  { col: 'Q', categoryName: '前后杠半喷' },
  { col: 'R', categoryName: '下裙' },
  { col: 'S', categoryName: '尾翼' },
  { col: 'T', categoryName: '门踏板' },
  { col: 'U', categoryName: '倒车镜' },
  { col: 'V', categoryName: '挡泥板' },
  { col: 'W', categoryName: '倒车雷达/套' },
  { col: 'X', categoryName: '龙门架' },
  { col: 'Y', categoryName: '中网' },
  { col: 'Z', categoryName: '后围板' },
  { col: 'AA', categoryName: '前护杠' },
  { col: 'AB', categoryName: '前后杠下饰板' },
  { col: 'AC', categoryName: '抛光（单独项）' },
  { col: 'AD', categoryName: '全车外表' },
  { col: 'AE', categoryName: '全车内外' },
  { col: 'AF', categoryName: '全车改色' },
];

/** 模板配置结构 */
export interface ExcelTemplateConfig {
  /** 数据起始行（0-based），默认3 */
  dataStartRow?: number;
  /** 表头行（0-based），默认2 */
  headerRow?: number;
  /** 系数行（0-based），默认3 */
  coefficientRow?: number;
  /** 基本字段列映射 */
  fields: {
    date: string;       // 日期列
    carModel: string;   // 车型列
    plateNumber: string; // 车牌列
    orderNo: string;    // 工单号列
    paintCount: string; // 副数列
    remark: string;     // 备注列
  };
  /** 喷漆项目列映射 */
  items: { col: string; categoryName: string }[];
}

@Injectable()
export class WorkOrderExcelService {
  constructor(
    private prisma: PrismaService,
    private workOrderService: WorkOrderService,
  ) {}

  /** 获取门店的模板配置，无则返回默认 */
  private async getTemplateConfig(shopId: string): Promise<ExcelTemplateConfig> {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    if (shop?.excelTemplateConfig) {
      try {
        return JSON.parse(shop.excelTemplateConfig);
      } catch { /* 使用默认 */ }
    }
    return this.getDefaultConfig();
  }

  private getDefaultConfig(): ExcelTemplateConfig {
    return {
      dataStartRow: 3,
      headerRow: 2,
      coefficientRow: 3,
      fields: {
        date: 'B',
        carModel: 'C',
        plateNumber: 'D',
        orderNo: 'E',
        paintCount: 'F',
        remark: 'AG',
      },
      items: DEFAULT_COLUMN_MAP,
    };
  }

  /**
   * 从Excel文件自动识别列映射
   * 扫描表头行，匹配系统中的项目类别名称
   */
  async detectTemplateConfig(buffer: Buffer, shopId: string) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

    const categories = await this.prisma.paintItemCategory.findMany();
    const categoryNames = new Set(categories.map(c => c.name));

    // 扫描每行，找到包含最多项目类别名的行作为表头行
    let headerRow = -1;
    let maxMatches = 0;
    let detectedItems: { col: string; categoryName: string }[] = [];
    let detectedFields: ExcelTemplateConfig['fields'] = {
      date: 'B', carModel: 'C', plateNumber: 'D', orderNo: 'E', paintCount: 'F', remark: 'AG',
    };

    for (let r = 0; r <= Math.min(10, range.e.r); r++) {
      const matches: { col: string; categoryName: string }[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell?.v) continue;
        const val = String(cell.v).trim();
        if (categoryNames.has(val)) {
          matches.push({ col: XLSX.utils.encode_col(c), categoryName: val });
        }
      }
      if (matches.length > maxMatches) {
        maxMatches = matches.length;
        headerRow = r;
        detectedItems = matches;

        // 同时识别基本字段列
        for (let c = 0; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell?.v) continue;
          const val = String(cell.v).trim();
          const col = XLSX.utils.encode_col(c);
          if (val === '日期' || val === '接车日期') detectedFields.date = col;
          else if (val === '车型') detectedFields.carModel = col;
          else if (val === '车牌' || val === '车牌号') detectedFields.plateNumber = col;
          else if (val === '工单号' || val === '维修单号') detectedFields.orderNo = col;
          else if (val === '副数' || val === '幅数') detectedFields.paintCount = col;
          else if (val === '备注' || val === '说明') detectedFields.remark = col;
        }
      }
    }

    if (headerRow === -1 || maxMatches === 0) {
      throw new BadRequestException('无法识别Excel表头，请确保表头行包含项目类别名称');
    }

    const config: ExcelTemplateConfig = {
      dataStartRow: headerRow + 1,
      headerRow,
      coefficientRow: headerRow + 1,
      fields: detectedFields,
      items: detectedItems,
    };

    return config;
  }

  /**
   * 保存门店模板配置
   */
  async saveTemplateConfig(shopId: string, config: ExcelTemplateConfig) {
    return this.prisma.paintShop.update({
      where: { id: shopId },
      data: { excelTemplateConfig: JSON.stringify(config) },
    });
  }

  /**
   * 导入Excel台账数据
   */
  async importExcel(buffer: Buffer, shopId: string, settlementMonth?: string) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];

    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      include: { standardTemplate: { include: { items: true } } },
    });
    if (!shop) throw new BadRequestException('门店不存在');

    // 使用门店专属配置
    const config = await this.getTemplateConfig(shopId);

    const categories = await this.prisma.paintItemCategory.findMany();
    const categoryMap = new Map(categories.map(c => [c.name, c]));

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (let r = config.dataStartRow ?? 3; r <= range.e.r; r++) {
      try {
        const dateCell = ws[`${config.fields.date}${r + 1}`];
        const carModelCell = ws[`${config.fields.carModel}${r + 1}`];
        const plateNumberCell = ws[`${config.fields.plateNumber}${r + 1}`];
        const orderNoCell = ws[`${config.fields.orderNo}${r + 1}`];
        const remarkCell = ws[`${config.fields.remark}${r + 1}`];

        if (!orderNoCell?.v && !plateNumberCell?.v && !dateCell?.v) continue;

        const orderNo = orderNoCell ? String(orderNoCell.v).trim() : '';
        const plateNumber = plateNumberCell ? String(plateNumberCell.v).trim() : '';
        const carModel = carModelCell ? String(carModelCell.v).trim() : '';
        const remark = remarkCell ? String(remarkCell.v).trim() : '';

        let orderDate = new Date().toISOString().split('T')[0];
        if (dateCell?.v) {
          const dateStr = String(dateCell.v).trim();
          const match = dateStr.match(/^(\d{2,4})\.(\d{1,2})\.(\d{1,2})$/);
          if (match) {
            let year = parseInt(match[1]);
            if (year < 100) year += 2000;
            orderDate = `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
          } else if (typeof dateCell.v === 'number') {
            const d = XLSX.SSF.parse_date_code(dateCell.v);
            if (d) orderDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
          }
        }

        const items: { categoryId: string; quantity: number; newPartQuantity: number }[] = [];
        for (const mapping of config.items) {
          const colIndex = XLSX.utils.decode_col(mapping.col);
          const cell = ws[XLSX.utils.encode_cell({ r, c: colIndex })];
          if (cell && cell.v) {
            const category = categoryMap.get(mapping.categoryName);
            if (!category) {
              results.errors.push(`行${r + 1}: 项目"${mapping.categoryName}"在系统中不存在`);
              continue;
            }
            const quantity = Math.round(Number(cell.v)) || 1;
            items.push({ categoryId: category.id, quantity, newPartQuantity: 0 });
          }
        }

        if (orderNo) {
          const existing = await this.prisma.paintWorkOrder.findFirst({
            where: { orderNo, shopId },
          });
          if (existing) {
            results.errors.push(`行${r + 1}: 工单号${orderNo}已存在，跳过`);
            results.failed++;
            continue;
          }
        }

        await this.workOrderService.create({
          shopId,
          orderDate,
          settlementMonth: settlementMonth || undefined,
          orderNo: orderNo || undefined,
          plateNumber: plateNumber || undefined,
          carModel: carModel || undefined,
          remark: remark || undefined,
          items,
        });

        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`行${r + 1}: ${err.message}`);
      }
    }

    return results;
  }

  /**
   * 导出Excel台账（按门店专属模板格式）
   */
  async exportExcel(shopId: string, settlementMonth?: string) {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new BadRequestException('门店不存在');

    const config = await this.getTemplateConfig(shopId);
    const categories = await this.prisma.paintItemCategory.findMany();
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    const where: any = { shopId };
    if (settlementMonth) where.settlementMonth = settlementMonth;
    const orders = await this.prisma.paintWorkOrder.findMany({
      where,
      include: { items: true, shop: true },
      orderBy: { orderDate: 'asc' },
    });

    const wb = XLSX.utils.book_new();

    // 表头
    const headers = ['序号', '日期', '车型', '车牌', '工单号', '副数'];
    const itemHeaders = config.items.map(m => m.categoryName);
    const allHeaders = [...headers, ...itemHeaders, '备注'];

    // 系数行
    const coeffRow = ['', '', '', '', '', ''];
    const templateItems = shop.standardTemplateId
      ? await this.prisma.paintStandardTemplateItem.findMany({
          where: { templateId: shop.standardTemplateId },
          include: { category: true },
        })
      : [];
    const templateMap = new Map(templateItems.map(t => [t.category.name, Number(t.coefficient)]));
    for (const mapping of config.items) {
      coeffRow.push(templateMap.get(mapping.categoryName)?.toString() || '');
    }
    coeffRow.push('其他/说明');

    // 数据行
    const dataRows: (string | number)[][] = [];
    orders.forEach((order, index) => {
      const row: (string | number)[] = [
        index + 1,
        this.formatDate(order.orderDate),
        order.carModel || '',
        order.plateNumber || '',
        order.orderNo || '',
        Number(order.totalPaintCount),
      ];
      const itemValues: (string | number)[] = new Array(config.items.length).fill('');
      for (const item of order.items) {
        const cat = categoryMap.get(item.categoryId);
        if (!cat) continue;
        const colIndex = config.items.findIndex(m => m.categoryName === cat.name);
        if (colIndex >= 0) {
          itemValues[colIndex] = item.quantity;
        }
      }
      row.push(...itemValues);
      row.push(order.remark || '');
      dataRows.push(row);
    });

    const titleRow = [`${shop.name}·喷漆维修车辆台账`];
    const subTitleRow = ['总件数：', '', '', '', '', String(orders.length)];

    const wsData = [titleRow, subTitleRow, allHeaders, coeffRow, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = [
      { wch: 5 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 6 },
      ...new Array(config.items.length).fill(null).map(() => ({ wch: 8 })),
      { wch: 15 },
    ];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: allHeaders.length - 1 } }];

    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * 下载导入模板（按门店专属配置）
   */
  async downloadTemplate(shopId: string) {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new BadRequestException('门店不存在');

    const config = await this.getTemplateConfig(shopId);
    const wb = XLSX.utils.book_new();
    const headers = ['序号', '日期', '车型', '车牌', '工单号', '副数'];
    const itemHeaders = config.items.map(m => m.categoryName);
    const allHeaders = [...headers, ...itemHeaders, '备注'];

    const coeffRow = ['', '', '', '', '', ''];
    const templateItems = shop.standardTemplateId
      ? await this.prisma.paintStandardTemplateItem.findMany({
          where: { templateId: shop.standardTemplateId },
          include: { category: true },
        })
      : [];
    const templateMap = new Map(templateItems.map(t => [t.category.name, Number(t.coefficient)]));
    for (const mapping of config.items) {
      coeffRow.push(templateMap.get(mapping.categoryName)?.toString() || '');
    }
    coeffRow.push('其他/说明');

    const titleRow = [`${shop.name}·喷漆维修车辆台账（导入模板）`];
    const wsData = [titleRow, allHeaders, coeffRow];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = [
      { wch: 5 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 28 }, { wch: 6 },
      ...new Array(config.items.length).fill(null).map(() => ({ wch: 8 })),
      { wch: 15 },
    ];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: allHeaders.length - 1 } }];

    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  private formatDate(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
  }
}
