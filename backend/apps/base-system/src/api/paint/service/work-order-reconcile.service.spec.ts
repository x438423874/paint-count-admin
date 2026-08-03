import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import * as XLSX from 'xlsx';
import { WorkOrderReconcileService } from './work-order-reconcile.service';

/** 构造对账 Excel 缓冲区：使用显式模板配置，避免依赖表头自动识别 */
function buildReconcileExcel(rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ['序号', '单号', '车牌', '幅数', '备注'],
    ...rows,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const EXCEL_TEMPLATE_CONFIG = JSON.stringify({
  headerRow: 0,
  dataStartRow: 1,
  fields: { orderNo: 'B', plateNumber: 'C', paintCount: 'D', remark: 'E' },
});

describe('WorkOrderReconcileService', () => {
  let service: WorkOrderReconcileService;
  let prisma: any;

  const shop = {
    id: 'shop-1',
    excelTemplateConfig: EXCEL_TEMPLATE_CONFIG,
    standardTemplate: {
      id: 'tpl-1',
      items: [
        { categoryId: 'cat-door', coefficient: 1.0 },
        { categoryId: 'cat-fender', coefficient: 0.8 },
      ],
    },
  };

  const categories = [
    { id: 'cat-door', name: '车门' },
    { id: 'cat-fender', name: '叶子板' },
  ];

  const templateItems = [
    { categoryId: 'cat-door', coefficient: 1.0 },
    { categoryId: 'cat-fender', coefficient: 0.8 },
  ];

  beforeEach(async () => {
    prisma = {
      paintShop: {
        findUnique: jest.fn().mockResolvedValue(shop),
      },
      paintItemCategory: { findMany: jest.fn().mockResolvedValue(categories) },
      paintStandardTemplateItem: { findMany: jest.fn().mockResolvedValue(templateItems) },
      paintWorkOrder: { findMany: jest.fn() },
      paintImage: { findMany: jest.fn().mockResolvedValue([]) },
      paintSettlementMonth: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrderReconcileService,
        { provide: PrismaService, useValue: prisma },
        { provide: WINSTON_MODULE_PROVIDER, useValue: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();

    service = module.get(WorkOrderReconcileService);
  });

  describe('reconcile（金额正确性 characterization）', () => {
    it('工单号+月份+车牌完全匹配时，金额对账一致（diff=0）', async () => {
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        {
          id: 'order-1',
          orderNo: 'ORD001',
          plateNumber: '沪A12345',
          totalPaintCount: 2.8,
          status: 'AUDITED',
          remark: null,
          isRework: false,
          reworkRemark: null,
        },
      ]);

      const buffer = buildReconcileExcel([['1', 'ORD001', '沪A12345', 2.8, '']]);
      const result = await service.reconcile('shop-1', '2026-05', buffer);

      expect(result.summary.excelCount).toBe(1);
      expect(result.summary.systemCount).toBe(1);
      expect(result.summary.matchedCount).toBe(1);
      expect(result.summary.diffCount).toBe(0);
      expect(result.summary.excelTotal).toBeCloseTo(2.8, 2);
      expect(result.summary.systemTotal).toBeCloseTo(2.8, 2);
      expect(result.summary.diff).toBeCloseTo(0, 2);

      const matched = result.items.find(i => i.type === 'matched');
      expect(matched).toBeDefined();
      expect((matched as any).systemPaintCount).toBeCloseTo(2.8, 2);
      expect((matched as any).diff).toBeCloseTo(0, 2);
    });

    it('Excel 幅数大于系统幅数时，diff 为正且计入差异', async () => {
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        {
          id: 'order-1',
          orderNo: 'ORD001',
          plateNumber: '沪A12345',
          totalPaintCount: 2.0,
          status: 'AUDITED',
          remark: null,
          isRework: false,
          reworkRemark: null,
        },
      ]);

      const buffer = buildReconcileExcel([['1', 'ORD001', '沪A12345', 2.8, '']]);
      const result = await service.reconcile('shop-1', '2026-05', buffer);

      expect(result.summary.diffCount).toBe(1);
      // excel 2.8 - system 2.0 = 0.8
      expect(result.summary.diff).toBeCloseTo(0.8, 2);
    });

    it('返工工单的幅数不计入系统总幅数（资金红线）', async () => {
      // 系统侧：1 笔正常(2.8) + 1 笔返工(5.0)；Excel 仅含正常那笔
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        {
          id: 'order-1',
          orderNo: 'ORD001',
          plateNumber: '沪A12345',
          totalPaintCount: 2.8,
          status: 'AUDITED',
          remark: null,
          isRework: false,
          reworkRemark: null,
        },
        {
          id: 'order-rework',
          orderNo: 'ORD002',
          plateNumber: '沪B66666',
          totalPaintCount: 5.0,
          status: 'AUDITED',
          remark: null,
          isRework: true,
          reworkRemark: '返工',
        },
      ]);

      const buffer = buildReconcileExcel([['1', 'ORD001', '沪A12345', 2.8, '']]);
      const result = await service.reconcile('shop-1', '2026-05', buffer);

      // 系统总幅数必须排除返工订单，仅 2.8
      expect(result.summary.systemTotal).toBeCloseTo(2.8, 2);
      expect(result.summary.reworkExcludedCount).toBe(1);
      expect(result.summary.reworkExcludedPaintCount).toBeCloseTo(5.0, 2);
      // 返工订单虽在系统侧，但因未在 Excel 匹配，应作为 extra_in_system 且标记 isRework
      const extra = result.items.find(i => i.type === 'extra_in_system' && i.id === 'order-rework');
      expect(extra).toBeDefined();
      expect((extra as any).isRework).toBe(true);
    });
  });

  describe('参数校验', () => {
    it('缺少门店时抛出 BadRequestException', async () => {
      await expect(service.reconcile('', '2026-05', Buffer.from('x'))).rejects.toThrow(BadRequestException);
    });

    it('缺少结算月份时抛出 BadRequestException', async () => {
      await expect(service.reconcile('shop-1', '', Buffer.from('x'))).rejects.toThrow(BadRequestException);
    });

    it('空文件时抛出 BadRequestException', async () => {
      await expect(service.reconcile('shop-1', '2026-05', Buffer.from(''))).rejects.toThrow(BadRequestException);
    });
  });
});
