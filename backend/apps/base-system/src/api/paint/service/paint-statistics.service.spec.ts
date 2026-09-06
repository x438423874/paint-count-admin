import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaintStatisticsService } from './paint-statistics.service';

/**
 * 统计缓存：测试环境不需要真实 Redis，直接降级为"不缓存"
 */
jest.mock('./paint-stats-cache', () => ({
  PaintStatsCache: {
    buildKey: jest.fn().mockResolvedValue('test-key'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
  },
  hashScope: jest.fn().mockReturnValue('h'),
  statsTtlForMonth: jest.fn().mockReturnValue(60),
}));

/**
 * PaintStatisticsService 单元测试
 *
 * 重点覆盖：
 * - 数据权限（未绑定门店不得越权看到全量数据）
 * - 统计口径（返工 / 作废 / 幅数调整单）
 * - 车牌归一化去重
 * - 按门店分组、按日聚合、待审核与已审核拆分
 * - 类别分布（聚合下推到 SQL groupBy）
 * - 年度概览（聚合下推到 SQL）
 */
describe('PaintStatisticsService', () => {
  let service: PaintStatisticsService;
  let prisma: {
    paintShop: { findMany: jest.Mock };
    paintWorkOrder: { findMany: jest.Mock; aggregate: jest.Mock };
    paintWorkOrderItem: { groupBy: jest.Mock };
    paintItemCategory: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  const shop = (id = 'shop-1', name = '门店A', code = 'SHOPA') => ({ id, name, code });

  const order = (over: Record<string, any> = {}) => ({
    id: 'o1',
    orderDate: new Date('2026-05-02'),
    totalPaintCount: 1,
    shopId: 'shop-1',
    status: 'AUDITED',
    isRework: false,
    isAdjustment: false,
    settlementMonth: '2026-05',
    createdAt: new Date('2026-05-02'),
    remark: null,
    plateNumber: '粤A123',
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      paintShop: { findMany: jest.fn() },
      paintWorkOrder: { findMany: jest.fn(), aggregate: jest.fn() },
      paintWorkOrderItem: { groupBy: jest.fn() },
      paintItemCategory: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaintStatisticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PaintStatisticsService);
  });

  // ==================== 数据权限 ====================

  /** 构造在岗期 scope */
  const tenureScope = (
    tenures: { shopId: string; startAt?: Date; endAt?: Date | null }[],
  ) => ({
    kind: 'tenure' as const,
    tenures: tenures.map(t => ({
      shopId: t.shopId,
      startAt: t.startAt ?? new Date('2026-01-01'),
      endAt: t.endAt ?? null,
    })),
  });

  describe('数据权限', () => {
    it('scope 为 none 时返回空（普通用户未绑定门店，不得看到全量数据）', async () => {
      const result = await service.getMonthlyStatistics('2026-05', undefined, { kind: 'none' });

      expect(result).toEqual([]);
      expect(prisma.paintShop.findMany).not.toHaveBeenCalled();
      expect(prisma.paintWorkOrder.findMany).not.toHaveBeenCalled();
    });

    it('scope 为 none 时，类别分布同样返回空', async () => {
      expect(await service.getCategoryBreakdown('2026-05', undefined, { kind: 'none' })).toEqual([]);
      expect(prisma.paintWorkOrderItem.groupBy).not.toHaveBeenCalled();
    });

    it('scope 为 none 时，年度概览同样返回空', async () => {
      expect(await service.getYearOverview(2026, undefined, { kind: 'none' })).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('scope 为 none 时，导出数据同样返回空', async () => {
      expect(await service.getExportData('2026-05', undefined, { kind: 'none' })).toEqual([]);
      expect(prisma.paintWorkOrder.findMany).not.toHaveBeenCalled();
    });

    it('shopId 不在任期内 scope 时返回空', async () => {
      const scope = tenureScope([{ shopId: 'shop-2' }, { shopId: 'shop-3' }]);
      const result = await service.getMonthlyStatistics('2026-05', 'shop-1', scope);
      expect(result).toEqual([]);
      expect(prisma.paintShop.findMany).not.toHaveBeenCalled();
    });

    it('scope 为 all 时不限制（超管/财务）', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([order()]);

      const result = await service.getMonthlyStatistics('2026-05', undefined, { kind: 'all' });
      expect(result).toHaveLength(1);
      expect(prisma.paintShop.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
    });

    it('在岗期 scope：工单查询条件包含任期月份过滤（结算月份口径，未结算按录入时间年月兜底）', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([]);

      const startAt = new Date('2026-03-01');
      const endAt = new Date('2026-06-30');
      await service.getMonthlyStatistics('2026-05', undefined, tenureScope([{ shopId: 'shop-1', startAt, endAt }]));

      expect(prisma.paintWorkOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              {
                shopId: 'shop-1',
                OR: [
                  { settlementMonth: { gte: '2026-03', lte: '2026-06' } },
                  { settlementMonth: null, createdAt: { gte: new Date(2026, 2, 1), lt: new Date(2026, 6, 1) } },
                ],
              },
            ],
          }),
        }),
      );
    });

    it('在岗中（无 endAt）的任期不设月份上界', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([]);

      const startAt = new Date('2026-03-01');
      await service.getMonthlyStatistics('2026-05', undefined, tenureScope([{ shopId: 'shop-1', startAt }]));

      const where = (prisma.paintWorkOrder.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.OR[0].OR[0].settlementMonth).toEqual({ gte: '2026-03' });
      expect(where.OR[0].OR[1].createdAt).toEqual({ gte: new Date(2026, 2, 1) });
    });
  });

  // ==================== 统计口径 ====================

  describe('统计口径', () => {
    it('返工单不计入总幅数/工单数，只计入返工口径', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 10, plateNumber: 'A' }),
        order({ id: 'o2', totalPaintCount: 4, isRework: true, plateNumber: 'B' }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];

      expect(stat.totalOrders).toBe(1);
      expect(stat.totalPaintCount).toBe(10);
      expect(stat.totalVehicles).toBe(1);
      expect(stat.reworkOrders).toBe(1);
      expect(stat.reworkPaintCount).toBe(4);
      expect(stat.reworkVehicles).toBe(1);
    });

    it('作废单完全不计入任何统计', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 10, status: 'AUDITED', plateNumber: 'A' }),
        order({ id: 'o2', totalPaintCount: 99, status: 'VOID', plateNumber: 'B' }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];

      expect(stat.totalOrders).toBe(1);
      expect(stat.totalPaintCount).toBe(10);
      expect(stat.totalVehicles).toBe(1);
      expect(stat.pendingOrders).toBe(0);
      expect(stat.auditedOrders).toBe(1);
    });

    it('幅数调整单只贡献幅数，不贡献工单数/车辆数/日报', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 10, plateNumber: 'A' }),
        order({ id: 'o2', totalPaintCount: -2.5, isAdjustment: true, plateNumber: 'ADJ', status: 'PENDING' }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];

      // 总幅数 = 正常单 + 调整单
      expect(stat.totalPaintCount).toBe(7.5);
      // 工单数 / 车辆数只统计正常单
      expect(stat.totalOrders).toBe(1);
      expect(stat.totalVehicles).toBe(1);
      expect(stat.pendingOrders).toBe(0);
      // 调整单单独出口径
      expect(stat.adjustmentPaintCount).toBe(-2.5);
      expect(stat.adjustments).toHaveLength(1);
    });

    it('调整单幅数为负数时按"四舍五入、绝对值进位"处理，而非 Math.round 的向 +∞ 舍入', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 0, plateNumber: 'A' }),
        order({ id: 'o2', totalPaintCount: -1.25, isAdjustment: true, status: 'PENDING' }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];
      expect(stat.adjustmentPaintCount).toBe(-1.3);
    });

    it('无工单日期的工单仍计入总额，只是不进入日报', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 6, orderDate: null, plateNumber: 'A' }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];

      expect(stat.totalOrders).toBe(1);
      expect(stat.totalPaintCount).toBe(6);
      expect(stat.dailyStats).toHaveLength(0);
    });
  });

  // ==================== 车牌去重 ====================

  describe('车牌归一化', () => {
    it('大小写/空格不同的同一车牌只算一台车', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 2, plateNumber: '粤A123' }),
        order({ id: 'o2', totalPaintCount: 3, plateNumber: '粤a123' }),
        order({ id: 'o3', totalPaintCount: 4, plateNumber: '  粤A123  ' }),
        order({ id: 'o4', totalPaintCount: 5, plateNumber: '粤B456' }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];

      expect(stat.totalVehicles).toBe(2);
      expect(stat.totalOrders).toBe(4);
      expect(stat.totalPaintCount).toBe(14);
    });

    it('空车牌不计入车辆数', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 2, plateNumber: '' }),
        order({ id: 'o2', totalPaintCount: 3, plateNumber: '   ' }),
        order({ id: 'o3', totalPaintCount: 4, plateNumber: null }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];

      expect(stat.totalVehicles).toBe(0);
      expect(stat.totalOrders).toBe(3);
      expect(stat.totalPaintCount).toBe(9);
    });
  });

  // ==================== 基础聚合 ====================

  describe('getMonthlyStatistics 聚合', () => {
    it('应按日期聚合每日统计', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', orderDate: new Date('2026-05-02'), totalPaintCount: 1.1, plateNumber: 'A' }),
        order({ id: 'o2', orderDate: new Date('2026-05-02'), totalPaintCount: 2.0, plateNumber: 'B' }),
        order({ id: 'o3', orderDate: new Date('2026-05-06'), totalPaintCount: 4.5, plateNumber: 'C' }),
      ]);

      const dailyStats = (await service.getMonthlyStatistics('2026-05'))[0].dailyStats;

      expect(dailyStats).toHaveLength(2);
      expect(dailyStats[0]).toEqual({ date: '2026-05-02', orderCount: 2, paintCount: 3.1 });
      expect(dailyStats[1]).toEqual({ date: '2026-05-06', orderCount: 1, paintCount: 4.5 });
    });

    it('应正确拆分待审核与已审核统计', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 3, status: 'AUDITED', plateNumber: 'A' }),
        order({ id: 'o2', totalPaintCount: 5, status: 'PENDING', plateNumber: 'B' }),
        order({ id: 'o3', totalPaintCount: 7, status: 'SETTLED', plateNumber: 'C' }),
        order({ id: 'o4', totalPaintCount: 9, status: 'ABNORMAL', plateNumber: 'D' }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];

      // 已审核口径包含 AUDITED / SETTLED / ABNORMAL
      expect(stat.auditedOrders).toBe(3);
      expect(stat.auditedPaintCount).toBe(19);
      expect(stat.auditedVehicles).toBe(3);
      expect(stat.pendingOrders).toBe(1);
      expect(stat.pendingPaintCount).toBe(5);
      // 异常与已结算单独出口径
      expect(stat.abnormalOrders).toBe(1);
      expect(stat.abnormalPaintCount).toBe(9);
      expect(stat.settledOrders).toBe(1);
      expect(stat.settledPaintCount).toBe(7);
    });

    it('浮点幅数累加不产生误差', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 0.1, plateNumber: 'A' }),
        order({ id: 'o2', totalPaintCount: 0.2, plateNumber: 'B' }),
        order({ id: 'o3', totalPaintCount: 0.3, plateNumber: 'C' }),
      ]);

      const stat = (await service.getMonthlyStatistics('2026-05'))[0];
      expect(stat.totalPaintCount).toBe(0.6);
    });

    it('无数据时返回空统计', async () => {
      prisma.paintShop.findMany.mockResolvedValue([]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([]);

      expect(await service.getMonthlyStatistics('2026-05')).toEqual([]);
    });
  });

  // ==================== 类别分布 ====================

  describe('getCategoryBreakdown', () => {
    it('应按类别聚合数量和幅数（聚合下推到 SQL groupBy）', async () => {
      prisma.paintWorkOrderItem.groupBy.mockResolvedValue([
        { categoryId: 'cat-1', _sum: { quantity: 3, paintCount: 3.0, newPartQuantity: 1 } },
        { categoryId: 'cat-2', _sum: { quantity: 1, paintCount: 0.8, newPartQuantity: 0 } },
      ]);
      prisma.paintItemCategory.findMany.mockResolvedValue([
        { id: 'cat-1', name: '车门', code: 'DOOR' },
        { id: 'cat-2', name: '叶子板', code: 'FENDER' },
      ]);

      const result = await service.getCategoryBreakdown('2026-05');

      expect(result).toHaveLength(2);
      expect(result[0].categoryName).toBe('车门');
      expect(result[0].totalCount).toBe(3);
      expect(result[0].totalPaintCount).toBe(3);
      expect(result[0].totalNewPartQuantity).toBe(1);

      // 口径必须与月度统计一致：排除返工单与作废单
      expect(prisma.paintWorkOrderItem.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({
              settlementMonth: '2026-05',
              status: { not: 'VOID' },
              isRework: false,
            }),
          }),
        }),
      );
    });

    it('无项目数据时返回空数组', async () => {
      prisma.paintWorkOrderItem.groupBy.mockResolvedValue([]);
      expect(await service.getCategoryBreakdown('2026-05')).toEqual([]);
    });
  });

  // ==================== 年度概览 ====================

  describe('getYearOverview', () => {
    it('应返回整年 12 个月，并把聚合下推到 SQL', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          settlementMonth: '2026-05',
          shopCount: 2,
          reworkOrders: 1,
          reworkPaintCount: '4.00',
          reworkVehicles: 1,
          totalOrders: 10,
          totalPaintCount: '20.50',
          pendingOrders: 3,
          pendingPaintCount: '5.50',
          pendingVehicles: 3,
          auditedOrders: 7,
          auditedPaintCount: '15.00',
          auditedVehicles: 6,
        },
      ]);

      const result = await service.getYearOverview(2026);

      expect(result).toHaveLength(12);
      expect(result.every(m => m.settlementMonth.startsWith('2026-'))).toBe(true);

      const may = result.find(m => m.month === 5)!;
      expect(may.settlementMonth).toBe('2026-05');
      expect(may.shopCount).toBe(2);
      expect(may.totalOrders).toBe(10);
      expect(may.totalPaintCount).toBe(20.5);
      expect(may.reworkOrders).toBe(1);
      expect(may.reworkPaintCount).toBe(4);

      const jan = result.find(m => m.month === 1)!;
      expect(jan.totalOrders).toBe(0);
      expect(jan.totalPaintCount).toBe(0);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== 看板聚合 ====================

  describe('getDashboard', () => {
    it('一次调用返回全部统计，且月度统计只查一次库', async () => {
      prisma.paintShop.findMany.mockResolvedValue([shop()]);
      prisma.paintWorkOrder.findMany.mockResolvedValue([
        order({ id: 'o1', totalPaintCount: 10, plateNumber: 'A' }),
        order({ id: 'o2', totalPaintCount: 5, status: 'PENDING', plateNumber: 'B' }),
      ]);
      prisma.paintWorkOrderItem.groupBy.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getDashboard('2026-05');

      expect(result.monthly).toHaveLength(1);
      expect(result.overview.totalOrders).toBe(2);
      expect(result.overview.totalPaintCount).toBe(15);
      expect(result.overview.auditRate).toBe(50);
      expect(result.comparison).toHaveLength(1);
      expect(result.category).toEqual([]);
      expect(result.yearOverview).toHaveLength(12);

      // 关键：comparison / overview 复用同一份月度统计，不再重复查库
      expect(prisma.paintWorkOrder.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== 其他 ====================

  describe('getLatestSettlementMonth', () => {
    it('应通过 aggregate 取最大结算月，避免全索引排序', async () => {
      prisma.paintWorkOrder.aggregate.mockResolvedValue({ _max: { settlementMonth: '2026-05' } });

      expect(await service.getLatestSettlementMonth()).toBe('2026-05');
      expect(prisma.paintWorkOrder.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ _max: { settlementMonth: true } }),
      );
    });
  });
});
