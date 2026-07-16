import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaintStatisticsService } from './paint-statistics.service';

/**
 * PaintStatisticsService 单元测试
 *
 * 重点测试聚合逻辑：
 * - 按门店分组、按日聚合
 * - 待审核 vs 已审核的拆分
 * - 台均/单均计算
 * - 项目类别分布统计
 */
describe('PaintStatisticsService', () => {
  let service: PaintStatisticsService;
  let prisma: {
    paintShop: { findMany: jest.Mock };
    paintWorkOrder: { findMany: jest.Mock; aggregate: jest.Mock };
    paintWorkOrderItem: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      paintShop: { findMany: jest.fn() },
      paintWorkOrder: { findMany: jest.fn(), aggregate: jest.fn() },
      paintWorkOrderItem: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaintStatisticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PaintStatisticsService);
  });

  describe('getMonthlyStatistics', () => {
    it('应正确聚合每月统计：工单数、幅数、车辆数', async () => {
      prisma.paintShop.findMany.mockResolvedValue([
        { id: 'shop-1', name: '门店A', code: 'SHOPA' },
      ]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        {
          id: 'o1',
          orderDate: new Date('2026-05-02'),
          totalPaintCount: 1.1,
          shopId: 'shop-1',
          status: 'AUDITED',
          plateNumber: '粤A123',
          items: [],
        },
        {
          id: 'o2',
          orderDate: new Date('2026-05-06'),
          totalPaintCount: 4.5,
          shopId: 'shop-1',
          status: 'PENDING',
          plateNumber: '粤B456',
          items: [],
        },
        {
          id: 'o3',
          orderDate: new Date('2026-05-06'),
          totalPaintCount: 2.0,
          shopId: 'shop-1',
          status: 'AUDITED',
          plateNumber: '粤A123', // 与 o1 同车牌
          items: [],
        },
      ]);

      const result = await service.getMonthlyStatistics('2026-05');

      expect(result).toHaveLength(1);
      const stat = result[0];
      expect(stat.shopName).toBe('门店A');
      expect(stat.totalOrders).toBe(3);
      expect(stat.totalPaintCount).toBeCloseTo(7.6, 2);
      expect(stat.totalVehicles).toBe(2); // 粤A123 + 粤B456
      expect(stat.avgPaintPerOrder).toBeCloseTo(7.6 / 3, 2);
      expect(stat.avgPaintPerVehicle).toBeCloseTo(7.6 / 2, 2);
    });

    it('应正确拆分待审核与已审核统计', async () => {
      prisma.paintShop.findMany.mockResolvedValue([
        { id: 'shop-1', name: '门店A', code: 'SHOPA' },
      ]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        { id: 'o1', orderDate: new Date('2026-05-02'), totalPaintCount: 3, shopId: 'shop-1', status: 'AUDITED', plateNumber: 'A', items: [] },
        { id: 'o2', orderDate: new Date('2026-05-03'), totalPaintCount: 5, shopId: 'shop-1', status: 'PENDING', plateNumber: 'B', items: [] },
      ]);

      const result = await service.getMonthlyStatistics('2026-05');

      const stat = result[0];
      // 已审核：1 单 3 幅 1 车
      expect(stat.auditedOrders).toBe(1);
      expect(stat.auditedPaintCount).toBe(3);
      expect(stat.auditedVehicles).toBe(1);
      // 待审核：1 单 5 幅 1 车
      expect(stat.pendingOrders).toBe(1);
      expect(stat.pendingPaintCount).toBe(5);
      expect(stat.pendingVehicles).toBe(1);
    });

    it('应按日期聚合每日统计', async () => {
      prisma.paintShop.findMany.mockResolvedValue([
        { id: 'shop-1', name: '门店A', code: 'SHOPA' },
      ]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        { id: 'o1', orderDate: new Date('2026-05-02'), totalPaintCount: 1.1, shopId: 'shop-1', status: 'AUDITED', plateNumber: 'A', items: [] },
        { id: 'o2', orderDate: new Date('2026-05-02'), totalPaintCount: 2.0, shopId: 'shop-1', status: 'AUDITED', plateNumber: 'B', items: [] },
        { id: 'o3', orderDate: new Date('2026-05-06'), totalPaintCount: 4.5, shopId: 'shop-1', status: 'AUDITED', plateNumber: 'C', items: [] },
      ]);

      const result = await service.getMonthlyStatistics('2026-05');

      const dailyStats = result[0].dailyStats;
      expect(dailyStats).toHaveLength(2);
      const may2 = dailyStats.find(d => d.date === '2026-05-02');
      expect(may2!.orderCount).toBe(2);
      expect(may2!.paintCount).toBeCloseTo(3.1, 2);
      const may6 = dailyStats.find(d => d.date === '2026-05-06');
      expect(may6!.orderCount).toBe(1);
    });

    it('无数据时返回空统计', async () => {
      prisma.paintShop.findMany.mockResolvedValue([]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([]);

      const result = await service.getMonthlyStatistics('2026-05');
      expect(result).toEqual([]);
    });

    it('shopId 不在 accessibleShopIds 内时返回空', async () => {
      const result = await service.getMonthlyStatistics('2026-05', 'shop-1', ['shop-2', 'shop-3']);
      expect(result).toEqual([]);
      expect(prisma.paintShop.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getCategoryBreakdown', () => {
    it('应按类别聚合数量和幅数', async () => {
      prisma.paintWorkOrderItem.findMany.mockResolvedValue([
        { categoryId: 'cat-1', quantity: 1, paintCount: 1.0, category: { id: 'cat-1', name: '车门', code: 'DOOR' }, specialPaint: null },
        { categoryId: 'cat-1', quantity: 2, paintCount: 2.0, category: { id: 'cat-1', name: '车门', code: 'DOOR' }, specialPaint: null },
        { categoryId: 'cat-2', quantity: 1, paintCount: 0.8, category: { id: 'cat-2', name: '叶子板', code: 'FENDER' }, specialPaint: null },
      ]);

      const result = await service.getCategoryBreakdown('2026-05');

      expect(result).toHaveLength(2);
      const doorStat = result.find(r => r.categoryName === '车门');
      // totalCount = 1 + 2 = 3 (数量之和)
      expect(doorStat!.totalCount).toBe(3);
      expect(doorStat!.totalPaintCount).toBeCloseTo(3.0, 2);
      const fenderStat = result.find(r => r.categoryName === '叶子板');
      expect(fenderStat!.totalCount).toBe(1);
      expect(fenderStat!.totalPaintCount).toBeCloseTo(0.8, 2);
    });

    it('无项目数据时返回空数组', async () => {
      prisma.paintWorkOrderItem.findMany.mockResolvedValue([]);
      const result = await service.getCategoryBreakdown('2026-05');
      expect(result).toEqual([]);
    });
  });
});
