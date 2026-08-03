import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { MetricsService } from '@lib/shared/metrics/metrics.service';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
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

/** 部位名称别名映射：原始表头名称 -> 系统标准名称列表（系统标准名称必须在 paint_item_category 中存在） */
const CATEGORY_NAME_ALIASES: Record<string, string[]> = {
  '机盖': ['前头盖', '头盖', '引擎盖', '发动机盖'],
  '机盖里外': ['前头盖里外', '头盖里外', '引擎盖里外', '发动机盖里外'],
  '机盖半喷': ['前头盖半喷', '头盖半喷', '引擎盖半喷'],
  '后盖': ['尾盖', '尾箱盖', '后备箱盖'],
  '后盖里外': ['尾盖里外', '尾箱盖里外', '后备箱盖里外'],
  '后盖半喷': ['尾盖半喷', '尾箱盖半喷'],
  '前后杠': ['保险杠', '前后保险杠'],
  '前后杠半喷': ['保险杠半喷', '前后保险杠半喷'],
  '前后杠下饰板': ['保险杠下饰板', '杠下饰板'],
  '叶子板': ['翼子板'],
  '车门': ['门'],
  '车门里外': ['门里外'],
  '车门半喷': ['门半喷'],
  '车顶': ['车顶盖'],
  '倒车镜': ['后视镜', '反光镜'],
  '下裙': ['裙边', '侧裙'],
  '尾翼': ['定风翼'],
  '门踏板': ['踏板', '迎宾踏板'],
  '挡泥板': ['泥挡'],
  '倒车雷达/套': ['雷达', '倒车雷达'],
  '龙门架': ['水箱框架', '水箱架'],
  '中网': ['进气格栅'],
  '后围板': ['后围'],
  '前护杠': ['护杠'],
};

/** 反向索引：原始表头名称 -> 系统标准名称 */
const ALIAS_TO_STANDARD_NAME = Object.entries(CATEGORY_NAME_ALIASES).reduce((acc, [standard, aliases]) => {
  for (const alias of aliases) {
    acc[alias] = standard;
  }
  return acc;
}, {} as Record<string, string>);

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
  /** 自动识别时建议的部位别名映射（原始表头名 -> 系统部位ID列表） */
  suggestedAliasMap?: Record<string, string[]>;
}

@Injectable()
export class WorkOrderExcelService {
  constructor(
    private prisma: PrismaService,
    private workOrderService: WorkOrderService,
    private metricsService: MetricsService,
  ) {}

  /** 获取门店的模板配置，无或不完整则返回与默认合并后的配置 */
  private async getTemplateConfig(shopId: string): Promise<ExcelTemplateConfig> {
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    const defaultConfig = this.getDefaultConfig();
    if (shop?.excelTemplateConfig) {
      try {
        const parsed = JSON.parse(shop.excelTemplateConfig);
        // 与默认配置合并，确保 fields / items 永远存在，避免残缺配置导致崩溃
        return {
          ...defaultConfig,
          ...parsed,
          fields: { ...defaultConfig.fields, ...(parsed?.fields || {}) },
          items: Array.isArray(parsed?.items) && parsed.items.length > 0 ? parsed.items : defaultConfig.items,
        };
      } catch { /* 解析失败使用默认 */ }
    }
    return defaultConfig;
  }

  /**
   * 当门店存储的模板配置不完整（缺少部位列 items）时，
   * 尝试按当前 Excel 文件自动识别表头；识别失败则回退默认模板。
   */
  private async resolveConfigForImport(buffer: Buffer, shopId: string, rawConfig: string | null): Promise<ExcelTemplateConfig> {
    const hasValidItems = (() => {
      if (!rawConfig) return false;
      try {
        const parsed = JSON.parse(rawConfig);
        return Array.isArray(parsed?.items) && parsed.items.length > 0;
      } catch {
        return false;
      }
    })();

    if (hasValidItems) {
      return this.getTemplateConfig(shopId);
    }

    // 残缺配置：优先用当前文件自动识别，失败回退默认
    try {
      return await this.detectTemplateConfig(buffer);
    } catch {
      return this.getDefaultConfig();
    }
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
   * 扫描表头行，匹配系统中的项目类别名称及其别名
   */
  async detectTemplateConfig(buffer: Buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

    const categories = await this.prisma.paintItemCategory.findMany();
    const categoryNames = new Set(categories.map(c => c.name));
    const categoryNameToId = new Map(categories.map(c => [c.name, c.id]));

    // 扫描每行，找到包含最多项目类别名（含别名）的行作为表头行
    let headerRow = -1;
    let maxMatches = 0;
    let detectedItems: { col: string; categoryName: string }[] = [];
    let detectedSuggestedAliasMap: Record<string, string[]> = {};
    let detectedFields: ExcelTemplateConfig['fields'] = {
      date: 'B', carModel: 'C', plateNumber: 'D', orderNo: 'E', paintCount: 'F', remark: 'AG',
    };

    for (let r = 0; r <= Math.min(10, range.e.r); r++) {
      const matches: { col: string; categoryName: string }[] = [];
      const suggestedAliasMap: Record<string, string[]> = {};

      for (let c = 0; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell?.v) continue;
        const val = String(cell.v).trim();

        // 优先精确匹配系统部位名，其次匹配别名
        let matchedName = '';
        if (categoryNames.has(val)) {
          matchedName = val;
        } else if (ALIAS_TO_STANDARD_NAME[val]) {
          matchedName = ALIAS_TO_STANDARD_NAME[val];
          const matchedId = categoryNameToId.get(matchedName);
          if (matchedId) {
            suggestedAliasMap[val] = [matchedId];
          }
        }

        if (matchedName) {
          matches.push({ col: XLSX.utils.encode_col(c), categoryName: val });
        }
      }

      if (matches.length > maxMatches) {
        maxMatches = matches.length;
        headerRow = r;
        detectedItems = matches;
        detectedSuggestedAliasMap = suggestedAliasMap;

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
      suggestedAliasMap: detectedSuggestedAliasMap,
    };

    return config;
  }

  /**
   * 根据模板列名自动补齐内置别名映射（用户未手动配置的列）
   */
  private async buildAliasMapWithDefaults(
    aliasMap: Record<string, string[]>,
    items: { categoryName: string }[],
  ): Promise<Record<string, string[]>> {
    const categories = await this.prisma.paintItemCategory.findMany();
    const categoryNameToId = new Map(categories.map(c => [c.name, c.id]));

    const result: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(aliasMap)) {
      if (Array.isArray(value) && value.length > 0) result[key] = value;
    }

    for (const item of items) {
      const name = item.categoryName;
      if (result[name]?.length > 0) continue; // 用户已手动配置

      const standardName = ALIAS_TO_STANDARD_NAME[name];
      if (!standardName) continue;

      const categoryId = categoryNameToId.get(standardName);
      if (categoryId) {
        result[name] = [categoryId];
      }
    }

    return result;
  }

  /**
   * 保存门店模板配置
   */
  async saveTemplateConfig(shopId: string, config: ExcelTemplateConfig) {
    // 保存模板配置时，同步把内置别名映射也写入 categoryAliasMap
    const autoAliasMap = await this.buildAliasMapWithDefaults({}, config.items || []);
    return this.prisma.paintShop.update({
      where: { id: shopId },
      data: {
        excelTemplateConfig: JSON.stringify(config),
        categoryAliasMap: JSON.stringify(autoAliasMap),
      },
    });
  }

  /**
   * 统一保存门店 Excel 模板配置和部位别名映射
   */
  async saveTemplateAndAliasMap(
    shopId: string,
    config: ExcelTemplateConfig,
    aliasMap: Record<string, string[]>,
  ) {
    const finalAliasMap = await this.buildAliasMapWithDefaults(aliasMap || {}, config.items || []);
    return this.prisma.paintShop.update({
      where: { id: shopId },
      data: {
        excelTemplateConfig: JSON.stringify(config),
        categoryAliasMap: JSON.stringify(finalAliasMap),
      },
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

    // 门店配置若不完整（缺部位列），按当前文件自动识别表头，再回退默认模板
    const config = await this.resolveConfigForImport(buffer, shopId, shop.excelTemplateConfig);
    const aliasMap = await this.getCategoryAliasMap(shopId);

    const categories = await this.prisma.paintItemCategory.findMany();
    const categoryMap = new Map(categories.map(c => [c.id, c]));
    const categoryNameMap = new Map(categories.map(c => [c.name, c]));

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const results = { success: 0, failed: 0, errors: [] as string[], mode: 'quantity' as 'quantity' | 'paintCount' };

    // 扫描整表所有部位列，判断数值语义：
    // 只要出现任意非整数（小数）数值，整表即视为「部位幅数」模式；
    // 全部为整数才视为「数量」模式。
    let isPaintCountMode = false;
    for (let r = config.dataStartRow ?? 3; r <= range.e.r; r++) {
      for (const mapping of config.items) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: XLSX.utils.decode_col(mapping.col) })];
        if (!cell?.v) continue;
        const num = Number(cell.v);
        if (Number.isFinite(num) && !Number.isInteger(num)) {
          isPaintCountMode = true;
          break;
        }
      }
      if (isPaintCountMode) break;
    }
    results.mode = isPaintCountMode ? 'paintCount' : 'quantity';

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

        const aggMap = new Map<string, { quantity: number; paintCount: number }>();
        const unmappedNames: string[] = [];
        for (const mapping of config.items) {
          const colIndex = XLSX.utils.decode_col(mapping.col);
          const cell = ws[XLSX.utils.encode_cell({ r, c: colIndex })];
          if (!cell || !cell.v) continue;

          const raw = Number(cell.v);
          if (!Number.isFinite(raw)) continue;

          const applyTo = (categoryId: string) => {
            const entry = aggMap.get(categoryId) || { quantity: 0, paintCount: 0 };
            if (isPaintCountMode) {
              // 幅数模式：直接累加数值作为该部位幅数，不再乘以系数
              entry.paintCount += raw;
            } else {
              // 数量模式：数值代表数量（取整），幅数由模板系数计算
              entry.quantity += Math.round(raw) || 1;
            }
            aggMap.set(categoryId, entry);
          };

          const mappedCategoryIds = aliasMap[mapping.categoryName];
          if (mappedCategoryIds && mappedCategoryIds.length > 0) {
            for (const categoryId of mappedCategoryIds) {
              if (!categoryMap.has(categoryId)) continue;
              applyTo(categoryId);
            }
            continue;
          }

          // 优先按模板列名精确匹配系统部位
          let category = categoryNameMap.get(mapping.categoryName);

          // 未精确匹配时，尝试内置别名映射
          if (!category && ALIAS_TO_STANDARD_NAME[mapping.categoryName]) {
            const standardName = ALIAS_TO_STANDARD_NAME[mapping.categoryName];
            category = categoryNameMap.get(standardName);
          }

          if (category) {
            applyTo(category.id);
          } else {
            unmappedNames.push(mapping.categoryName);
          }
        }

        const items = Array.from(aggMap.entries()).map(([categoryId, agg]) =>
          isPaintCountMode
            ? {
                categoryId,
                quantity: 1,
                newPartQuantity: 0,
                overridePaintCount: Number(agg.paintCount.toFixed(2)),
              }
            : { categoryId, quantity: agg.quantity, newPartQuantity: 0 },
        );

        const extraRemark = unmappedNames.length > 0 ? `未识别部位：${unmappedNames.join('、')}` : '';
        const finalRemark = remark && extraRemark ? `${remark}；${extraRemark}` : remark || extraRemark;

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

    this.metricsService.recordExcelImport(shopId, results.success > 0);
    return results;
  }

  /** 解析门店部位别名映射（兼容旧版单字符串格式） */
  private async getCategoryAliasMap(shopId: string): Promise<Record<string, string[]>> {
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      select: { categoryAliasMap: true },
    });
    if (!shop?.categoryAliasMap) return {};
    try {
      const parsed = JSON.parse(shop.categoryAliasMap);
      const normalized: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) normalized[key] = value.filter((v): v is string => typeof v === 'string');
        else if (typeof value === 'string' && value) normalized[key] = [value];
      }
      return normalized;
    } catch {
      return {};
    }
  }

  /**
   * 导出Excel台账（按门店专属模板格式）
   * @param mode detail=明细（含各部位列），summary=汇总（只含总幅数）
   */
  async exportExcel(shopId: string, settlementMonth?: string, mode: 'detail' | 'summary' = 'detail') {
    const isSummary = mode === 'summary';
    const shop = await this.prisma.paintShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new BadRequestException('门店不存在');

    const config = await this.getTemplateConfig(shopId);
    const aliasMap = await this.getCategoryAliasMap(shopId);
    const categories = await this.prisma.paintItemCategory.findMany();
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    const where: any = { shopId };
    if (settlementMonth) where.settlementMonth = settlementMonth;

    // 预估总条数：用于合计行公式与副标题，避免一次性把全部工单及 items 载入内存导致 OOM
    const totalOrders = await this.prisma.paintWorkOrder.count({ where });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '喷漆幅数统计系统';
    const ws = workbook.addWorksheet('Sheet1');

    // 表头
    const headers = ['序号', '日期', '车型', '车牌', '工单号', isSummary ? '总幅数' : '副数'];
    const itemHeaders = isSummary ? [] : config.items.map(m => m.categoryName);
    const allHeaders = [...headers, ...itemHeaders, '备注'];
    const totalColCount = allHeaders.length;
    const remarkColNumber = totalColCount; // ExcelJS 列号从 1 开始

    // 系数行
    const coeffRowValues = ['', '', '', '', '', ''];
    const templateItems = shop.standardTemplateId && !isSummary
      ? await this.prisma.paintStandardTemplateItem.findMany({
          where: { templateId: shop.standardTemplateId },
          include: { category: true },
        })
      : [];
    const templateMap = new Map(templateItems.map(t => [t.category.name, Number(t.coefficient)]));
    if (!isSummary) {
      for (const mapping of config.items) {
        // 系数行优先使用别名映射对应的系统部位系数（取第一个映射）
        const mappedCatIds = aliasMap[mapping.categoryName];
        const mappedCatId = Array.isArray(mappedCatIds) && mappedCatIds.length > 0 ? mappedCatIds[0] : undefined;
        const mappedCat = mappedCatId ? categoryMap.get(mappedCatId) : null;
        const coeff = mappedCat
          ? templateMap.get(mappedCat.name)
          : templateMap.get(mapping.categoryName);
        coeffRowValues.push(coeff?.toString() || '');
      }
    }
    coeffRowValues.push('其他/说明');

    // 标题行
    const titleText = isSummary ? `${shop.name}·喷漆车辆汇总台账` : `${shop.name}·喷漆维修车辆台账`;
    const titleRow = ws.addRow([titleText]);
    ws.mergeCells(1, 1, 1, totalColCount);
    titleRow.getCell(1).font = { size: 14, bold: true };
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // 副标题行（未匹配部位的明细已写入每行单元格批注，这里仅显示总数）
    const subTitleText = `总件数：${totalOrders}`;
    const subTitleRow = ws.addRow([subTitleText, ...new Array(totalColCount - 1).fill('')]);
    ws.mergeCells(2, 1, 2, totalColCount);
    subTitleRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

    // 表头行
    const headerRow = ws.addRow(allHeaders);
    headerRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // 系数行（汇总模式下不显示）
    if (!isSummary) {
      ws.addRow(coeffRowValues);
    }

    // 数据行起始/结束行号（ExcelJS 1-based）
    const firstDataRow = isSummary ? 4 : 5;
    const lastDataRow = firstDataRow + totalOrders - 1;

    let index = 0;
    // 分批游标拉取工单，逐行写出：避免一次性把所有工单及 items 载入内存导致 OOM。
    // 每批仅保留 BATCH_SIZE 条工单在内存，写出后即释放。
    const BATCH_SIZE = 500;
    let cursorId: string | undefined;
    do {
      const batchWhere: any = { ...where };
      if (cursorId) batchWhere.id = { gt: cursorId };
      const batch = await this.prisma.paintWorkOrder.findMany({
        where: batchWhere,
        include: { items: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      for (const order of batch) {
        const itemValues: (string | number)[] = new Array(config.items.length).fill('');
        const unmatchedItems: string[] = [];
        let orderTotal = 0;

        for (const item of order.items) {
          const cat = categoryMap.get(item.categoryId);
          if (!cat) continue;

          const qty = Number(item.paintCount);
          orderTotal += qty;

          // 汇总模式不需要填部位列
          if (isSummary) continue;

          // 优先按门店别名映射匹配模板列
          let colIndex = -1;
          for (let i = 0; i < config.items.length; i++) {
            if (aliasMap[config.items[i].categoryName]?.includes(cat.id)) {
              colIndex = i;
              break;
            }
          }
          // 未命中别名映射时按名称精确匹配
          if (colIndex < 0) {
            colIndex = config.items.findIndex(m => m.categoryName === cat.name);
          }

          if (colIndex >= 0) {
            itemValues[colIndex] = qty;
          } else {
            unmatchedItems.push(`${cat.name}${qty.toFixed(1)}幅`);
          }
        }

        // 备注显示未匹配部位的总幅数（表格中没有列的部位），0 幅时不填数字
        const unmatchedTotal = isSummary
          ? 0
          : order.items
              .filter(item => {
                const cat = categoryMap.get(item.categoryId);
                if (!cat) return false;
                const aliasMatched = config.items.some(m => aliasMap[m.categoryName]?.includes(cat.id));
                const nameMatched = config.items.some(m => m.categoryName === cat.name);
                return !aliasMatched && !nameMatched;
              })
              .reduce((sum, item) => sum + Number(item.paintCount), 0);

        const remark = unmatchedTotal > 0 ? unmatchedTotal : '';

        const rowValues = [
          index + 1,
          order.orderDate ? this.formatDate(order.orderDate) : '',
          order.carModel || '',
          order.plateNumber || '',
          order.orderNo || '',
          isSummary ? orderTotal : '',
          ...itemValues,
          remark,
        ];

        const row = ws.addRow(rowValues);
        row.alignment = { vertical: 'middle' };

        if (!isSummary) {
          // 每个工单幅数合计使用 SUM 公式（横向汇总部位列到备注列）
          const firstItemCol = ws.getColumn(7).letter;
          const remarkCol = ws.getColumn(remarkColNumber).letter;
          const currentRow = firstDataRow + index;
          row.getCell(6).value = { formula: `SUM(${firstItemCol}${currentRow}:${remarkCol}${currentRow})` };
        }

        // 备注列批注：未匹配项目明细 + 原始备注
        const noteParts = [...unmatchedItems];
        if (order.remark) {
          noteParts.push(`备注：${order.remark}`);
        }
        if (noteParts.length > 0) {
          row.getCell(remarkColNumber).note = noteParts.join('；');
        }

        index++;
      }

      cursorId = batch[batch.length - 1].id;
      batch.length = 0; // 释放批次引用，便于 GC
    } while (cursorId && index < totalOrders);

    // 合计行
    const totalRow = ws.addRow(['合计', '', '', '', '', '', ...new Array(itemHeaders.length).fill(''), '']);
    totalRow.alignment = { vertical: 'middle' };
    totalRow.eachCell(cell => {
      cell.font = { bold: true };
    });

    // 总幅数合计：纵向汇总每个工单的总幅数
    const totalCol = ws.getColumn(6).letter;
    totalRow.getCell(6).value = { formula: `SUM(${totalCol}${firstDataRow}:${totalCol}${lastDataRow})` };

    // 各部位列合计（明细模式）
    if (!isSummary) {
      for (let i = 0; i < config.items.length; i++) {
        const itemCol = ws.getColumn(7 + i).letter;
        totalRow.getCell(7 + i).value = { formula: `SUM(${itemCol}${firstDataRow}:${itemCol}${lastDataRow})` };
      }
    }

    // 备注列合计（未匹配部位总幅数，明细模式）
    if (!isSummary) {
      const remarkCol = ws.getColumn(remarkColNumber).letter;
      totalRow.getCell(remarkColNumber).value = { formula: `SUM(${remarkCol}${firstDataRow}:${remarkCol}${lastDataRow})` };
    }

    // 列宽
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 8;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 28;
    ws.getColumn(6).width = 10;
    ws.getColumn(6).numFmt = '0.0';
    for (let i = 0; i < itemHeaders.length; i++) {
      ws.getColumn(7 + i).width = 8;
      ws.getColumn(7 + i).numFmt = '0.0';
    }
    ws.getColumn(remarkColNumber).width = 15;
    ws.getColumn(remarkColNumber).numFmt = '0.0';

    // 表格区域加边框线
    for (let r = 1; r <= ws.rowCount; r++) {
      for (let c = 1; c <= totalColCount; c++) {
        ws.getCell(r, c).border = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } },
        };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
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
