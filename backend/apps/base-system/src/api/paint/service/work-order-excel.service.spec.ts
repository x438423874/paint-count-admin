import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { MetricsService } from '@lib/shared/metrics/metrics.service';
import * as XLSX from 'xlsx';
import { WorkOrderExcelService, ExcelTemplateConfig } from './work-order-excel.service';
import { WorkOrderService } from './work-order.service';

/**
 * WorkOrderExcelService 单元测试
 *
 * 重点测试 Excel 模板自动识别逻辑（detectTemplateConfig），
 * 这是导入功能的核心：表头行扫描、列映射识别、字段定位。
 */
describe('WorkOrderExcelService', () => {
  let service: WorkOrderExcelService;
  let prisma: {
    paintShop: { findUnique: jest.Mock; update: jest.Mock };
    paintItemCategory: { findMany: jest.Mock };
    paintStandardTemplateItem: { findMany: jest.Mock };
    paintWorkOrder: { findFirst: jest.Mock; create: jest.Mock };
  };
  let workOrderService: { create: jest.Mock };

  beforeEach(async () => {
    prisma = {
      paintShop: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      paintItemCategory: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'cat-door', name: '车门', code: 'DOOR' },
          { id: 'cat-fender', name: '叶子板', code: 'FENDER' },
          { id: 'cat-bumper', name: '前后杠', code: 'BUMPER' },
        ]),
      },
      paintStandardTemplateItem: { findMany: jest.fn().mockResolvedValue([]) },
      paintWorkOrder: { findFirst: jest.fn(), create: jest.fn() },
    };
    workOrderService = { create: jest.fn().mockResolvedValue({ id: 'order-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrderExcelService,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkOrderService, useValue: workOrderService },
        { provide: MetricsService, useValue: { recordExcelImport: jest.fn(), recordWorkOrderCreation: jest.fn(), recordOcrRecognition: jest.fn() } },
      ],
    }).compile();

    service = module.get(WorkOrderExcelService);
  });

  /** 构建测试用 Excel buffer（模拟真实台账结构） */
  function buildExcelBuffer(opts?: {
    headerRow?: number; // 0-based 表头行索引
    data?: Array<Record<string, any>>;
  }): Buffer {
    const headerRow = opts?.headerRow ?? 2; // 默认第3行
    const wb = XLSX.utils.book_new();

    // 构建表头行 + 系数行 + 数据行
    const rows: any[][] = [];
    for (let i = 0; i < headerRow; i++) rows.push([]);
    // 表头
    rows.push(['序号', '日期', '车型', '车牌', '工单号', '幅数', '车门', '叶子板', '前后杠', '备注']);
    // 系数行
    rows.push(['', '', '', '', '', '', 1, 0.8, 1.2, '说明']);
    // 数据行
    const data = opts?.data ?? [
      { date: '26.5.2', carModel: '比亚迪', plate: '粤A123', orderNo: 'ORD001', paintCount: 1, door: 1, fender: 0, bumper: 0, remark: '' },
      { date: '26.5.6', carModel: '比亚迪', plate: '粤B456', orderNo: 'ORD002', paintCount: 2.8, door: 0, fender: 0, bumper: 1.2, remark: '测试' },
    ];
    for (const d of data) {
      rows.push([
        '', d.date, d.carModel, d.plate, d.orderNo, d.paintCount,
        d.door, d.fender, d.bumper, d.remark,
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  describe('detectTemplateConfig', () => {
    it('应正确识别表头行和列映射', async () => {
      const buffer = buildExcelBuffer();
      prisma.paintShop.findUnique.mockResolvedValue({ id: 'shop-1', excelTemplateConfig: null });

      const result = await service.detectTemplateConfig(buffer, 'shop-1');

      // 表头行应为 0-based 2（第3行）
      expect(result.headerRow).toBe(2);
      // 应识别出包含的项目列
      expect(result.items.length).toBeGreaterThan(0);
      const doorItem = result.items.find(i => i.categoryName === '车门');
      expect(doorItem).toBeDefined();
      expect(doorItem!.col).toBe('G');
    });

    it('应识别基本字段列（日期/车型/车牌/工单号/幅数/备注）', async () => {
      const buffer = buildExcelBuffer();
      prisma.paintShop.findUnique.mockResolvedValue({ id: 'shop-1', excelTemplateConfig: null });

      const result = await service.detectTemplateConfig(buffer, 'shop-1');

      expect(result.fields.date).toBe('B');
      expect(result.fields.carModel).toBe('C');
      expect(result.fields.plateNumber).toBe('D');
      expect(result.fields.orderNo).toBe('E');
      expect(result.fields.paintCount).toBe('F');
    });

    it('表头行无匹配项目类别时应抛出异常', async () => {
      // 构建一个无项目类别表头的 Excel
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        ['序号', '日期', '车型'],
        ['', '26.5.2', '比亚迪'],
      ]);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

      prisma.paintShop.findUnique.mockResolvedValue({ id: 'shop-1', excelTemplateConfig: null });

      await expect(service.detectTemplateConfig(buffer, 'shop-1')).rejects.toThrow(BadRequestException);
    });

    it('应保存识别到的模板配置到门店', async () => {
      const buffer = buildExcelBuffer();
      const config = await service.detectTemplateConfig(buffer, 'shop-1');
      prisma.paintShop.update.mockResolvedValue({});

      await service.saveTemplateConfig('shop-1', config);

      expect(prisma.paintShop.update).toHaveBeenCalledWith({
        where: { id: 'shop-1' },
        data: { excelTemplateConfig: expect.any(String) },
      });
      // 验证保存的 JSON 可正确解析
      const savedCall = prisma.paintShop.update.mock.calls[0][0];
      const savedConfig: ExcelTemplateConfig = JSON.parse(savedCall.data.excelTemplateConfig);
      expect(savedConfig.headerRow).toBe(2);
      expect(savedConfig.items.length).toBeGreaterThan(0);
    });
  });

  describe('importExcel', () => {
    beforeEach(() => {
      // 门店配置已存在
      prisma.paintShop.findUnique.mockResolvedValue({
        id: 'shop-1',
        excelTemplateConfig: JSON.stringify({
          dataStartRow: 3,
          headerRow: 2,
          coefficientRow: 3,
          fields: { date: 'B', carModel: 'C', plateNumber: 'D', orderNo: 'E', paintCount: 'F', remark: 'J' },
          items: [
            { col: 'G', categoryName: '车门' },
            { col: 'H', categoryName: '叶子板' },
            { col: 'I', categoryName: '前后杠' },
          ],
        }),
        standardTemplate: { items: [] },
      });
      prisma.paintWorkOrder.findFirst.mockResolvedValue(null); // 无重复
    });

    it('应正确导入数据行并跳过空行/合计行', async () => {
      const buffer = buildExcelBuffer({
        data: [
          { date: '26.5.2', carModel: '比亚迪', plate: '粤A123', orderNo: 'ORD001', paintCount: 1, door: 1, fender: 0, bumper: 0, remark: '' },
          { date: '', carModel: '', plate: '', orderNo: '', paintCount: '', door: '', fender: '', bumper: '', remark: '' }, // 空行
          { date: '26.5.6', carModel: '比亚迪', plate: '粤B456', orderNo: 'ORD002', paintCount: 1.2, door: 0, fender: 0, bumper: 1.2, remark: '测试' },
        ],
      });

      const result = await service.importExcel(buffer, 'shop-1', '2026-05');

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(workOrderService.create).toHaveBeenCalledTimes(2);
    });

    it('工单号已存在时应跳过并记录错误', async () => {
      prisma.paintWorkOrder.findFirst.mockResolvedValueOnce({ id: 'existing' }); // 第一条已存在

      const buffer = buildExcelBuffer({
        data: [
          { date: '26.5.2', carModel: '比亚迪', plate: '粤A123', orderNo: 'ORD001', paintCount: 1, door: 1, fender: 0, bumper: 0, remark: '' },
        ],
      });

      const result = await service.importExcel(buffer, 'shop-1', '2026-05');

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('已存在');
    });

    it('门店不存在时应抛出异常', async () => {
      prisma.paintShop.findUnique.mockResolvedValue(null);
      const buffer = buildExcelBuffer();

      await expect(service.importExcel(buffer, 'invalid-shop')).rejects.toThrow(BadRequestException);
    });
  });
});
