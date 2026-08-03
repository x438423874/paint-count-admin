import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { MetricsService } from '@lib/shared/metrics/metrics.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { WorkOrderService } from './work-order.service';
import { PaintImageService } from './paint-image.service';
import { SettlementMonthService } from './settlement-month.service';
import { PaintVehicleService } from './paint-vehicle.service';
import { CreateWorkOrderDto } from '../work-order/dto/work-order.dto';

// Mock RedisUtility（工单号生成依赖 Redis）
jest.mock('@lib/shared/redis/redis.util', () => ({
  RedisUtility: {
    get instance() {
      return {
        incr: jest.fn().mockResolvedValue(1),
        set: jest.fn().mockResolvedValue('OK'),
        expire: jest.fn().mockResolvedValue(1),
      };
    },
  },
}));

/**
 * WorkOrderService 单元测试
 *
 * 重点测试工单创建的核心流程：
 * - 重复类别校验
 * - 幅数计算（依赖模板系数）
 * - 工单号生成（事务内并发安全）
 */
describe('WorkOrderService', () => {
  let service: WorkOrderService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      paintShop: {
        findUnique: jest.fn(),
      },
      paintStandardTemplateItem: { findMany: jest.fn() },
      paintSpecialPaint: { findMany: jest.fn() },
      paintWorkOrder: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      paintWorkOrderItem: { deleteMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaintImageService, useValue: {} },
        {
          provide: SettlementMonthService,
          useValue: {
            assertNotSealed: jest.fn().mockResolvedValue(undefined),
            assertOrderNotSealed: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PaintVehicleService,
          useValue: {
            upsertByPlateWithTx: jest.fn().mockResolvedValue({ id: 'veh-1' }),
            refreshStats: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: MetricsService, useValue: { recordWorkOrderCreation: jest.fn(), recordOcrRecognition: jest.fn(), recordExcelImport: jest.fn() } },
        { provide: WINSTON_MODULE_PROVIDER, useValue: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();

    service = module.get(WorkOrderService);
  });

  describe('create', () => {
    const baseDto: CreateWorkOrderDto = {
      shopId: 'shop-1',
      orderDate: '2026-05-02' as any,
      orderNo: 'ORD001',
      items: [
        { categoryId: 'cat-door', quantity: 2, newPartQuantity: 0 },
        { categoryId: 'cat-fender', quantity: 1, newPartQuantity: 0 },
      ],
    } as any;

    beforeEach(() => {
      // 门店关联模板，模板有对应项目系数
      prisma.paintShop.findUnique.mockResolvedValue({
        id: 'shop-1',
        standardTemplate: {
          items: [
            { categoryId: 'cat-door', coefficient: 1.0, newPartAddition: 0 },
            { categoryId: 'cat-fender', coefficient: 0.8, newPartAddition: 0.2 },
          ],
        },
      });
      prisma.paintSpecialPaint.findMany.mockResolvedValue([]);
      prisma.paintWorkOrder.create.mockImplementation(async (args: any) => ({
        id: 'order-1',
        ...args.data,
        items: [],
        shop: { id: 'shop-1', name: '门店A' },
      }));
    });

    it('应正确计算总幅数（系数 × 数量之和）', async () => {
      // 车门: 1.0 × 2 = 2.0
      // 叶子板: 0.8 × 1 = 0.8
      // 合计: 2.8
      await service.create(baseDto);

      const createCall = prisma.paintWorkOrder.create.mock.calls[0][0];
      expect(createCall.data.totalPaintCount).toBeCloseTo(2.8, 2);
    });

    it('新件幅数应使用 (系数 + 新件加幅) × 新件数量', async () => {
      // 叶子板: 2 个全部新件 → (0.8 + 0.2) × 2 = 2.0
      const dto: CreateWorkOrderDto = {
        ...baseDto,
        items: [{ categoryId: 'cat-fender', quantity: 2, newPartQuantity: 2 }],
      } as any;

      await service.create(dto);

      const createCall = prisma.paintWorkOrder.create.mock.calls[0][0];
      expect(createCall.data.totalPaintCount).toBeCloseTo(2.0, 2);
    });

    it('重复类别时应抛出 BadRequestException', async () => {
      const dto: CreateWorkOrderDto = {
        ...baseDto,
        items: [
          { categoryId: 'cat-door', quantity: 1, newPartQuantity: 0 },
          { categoryId: 'cat-door', quantity: 1, newPartQuantity: 0 },
        ],
      } as any;

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.paintWorkOrder.create).not.toHaveBeenCalled();
    });

    it('特殊车漆应按倍数放大幅数', async () => {
      prisma.paintSpecialPaint.findMany.mockResolvedValue([
        { id: 'sp-1', multiplier: 1.5, isActive: true },
      ]);
      // 车门: 1.0 × 2 × 1.5 = 3.0
      const dto: CreateWorkOrderDto = {
        ...baseDto,
        items: [{ categoryId: 'cat-door', quantity: 2, newPartQuantity: 0, specialPaintId: 'sp-1' }],
      } as any;

      await service.create(dto);

      const createCall = prisma.paintWorkOrder.create.mock.calls[0][0];
      expect(createCall.data.totalPaintCount).toBeCloseTo(3.0, 2);
    });

    it('无项目时幅数为 0', async () => {
      const dto: CreateWorkOrderDto = {
        ...baseDto,
        items: [],
      } as any;

      await service.create(dto);

      const createCall = prisma.paintWorkOrder.create.mock.calls[0][0];
      expect(createCall.data.totalPaintCount).toBe(0);
    });

    it('未提供工单号时应自动生成', async () => {
      const dto: CreateWorkOrderDto = { ...baseDto, orderNo: undefined } as any;
      // generateOrderNo 内部查询当日工单
      prisma.paintWorkOrder.findFirst.mockResolvedValue(null);
      prisma.paintWorkOrder.findMany = jest.fn().mockResolvedValue([]);

      await service.create(dto);

      const createCall = prisma.paintWorkOrder.create.mock.calls[0][0];
      // 工单号格式: 店铺码(空) + 日期 + 序号
      expect(createCall.data.orderNo).toBeDefined();
      expect(typeof createCall.data.orderNo).toBe('string');
    });
  });

  describe('update', () => {
    it('工单不存在时应抛出 NotFoundException', async () => {
      prisma.paintWorkOrder.findUnique.mockResolvedValue(null);

      await expect(service.update({ id: 'invalid', items: [] } as any)).rejects.toThrow(NotFoundException);
    });

    it('已审核工单不允许修改', async () => {
      prisma.paintWorkOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'AUDITED',
        shopId: 'shop-1',
        items: [],
      });

      await expect(service.update({ id: 'order-1', items: [] } as any)).rejects.toThrow(BadRequestException);
    });
  });
});
