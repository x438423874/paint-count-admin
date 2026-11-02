import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

/** 工单操作动作代码（前端映射中文标签） */
export const WORK_ORDER_LOG_ACTIONS = {
  CREATE: '创建',
  IMPORT: 'Excel 导入',
  UPDATE: '编辑',
  DELETE: '删除',
  AUDIT: '审核',
  UNAUDIT: '取消审核',
  SETTLE: '结算',
  UNSETTLE: '取消结算',
  VOID: '作废',
  UNVOID: '恢复作废',
  ABNORMAL: '标记异常',
  UNABNORMAL: '取消异常',
  REWORK: '返工标记',
  MERGE: '合并',
  ITEM_ADD: '添加部位',
  ITEM_DEL: '删除部位',
  IMAGE_ADD: '上传图片',
  IMAGE_DEL: '删除图片',
  MATCH: '图片归类',
  OCR_CORRECT: 'OCR 修正',
} as const;

export type WorkOrderLogAction = keyof typeof WORK_ORDER_LOG_ACTIONS;

export interface WorkOrderLogTarget {
  orderId: string;
  orderNo: string;
  shopId: string;
}

export interface WorkOrderLogUser {
  uid: string;
  username: string;
}

/**
 * 工单操作日志（业务级审计）：
 * - 与工单解绑：工单删除后日志保留（冗余 order_no/shop_id 快照，删除工单的记录仍完整可读）
 * - 删除工单时须在物理删除「之前」写日志（保证留痕）
 * - 写入异步且失败静默：日志绝不影响业务主流程
 */
@Injectable()
export class WorkOrderLogService {
  private readonly logger = new Logger(WorkOrderLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    target: WorkOrderLogTarget,
    user: WorkOrderLogUser | null | undefined,
    action: WorkOrderLogAction,
    detail?: string,
    ip?: string,
  ): Promise<void> {
    try {
      await this.prisma.paintWorkOrderLog.create({
        data: {
          orderId: target.orderId,
          orderNo: target.orderNo || target.orderId,
          shopId: target.shopId,
          userId: user?.uid || '',
          username: user?.username || '',
          action,
          detail: detail ? detail.slice(0, 500) : null,
          ip: ip ? ip.slice(0, 50) : null,
        },
      });
    } catch (e) {
      this.logger.warn(`工单操作日志写入失败 action=${action} order=${target.orderNo}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** 单据维度：某工单的操作流水（倒序） */
  async listByOrder(orderId: string, limit = 200) {
    return this.prisma.paintWorkOrderLog.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }

  /** 全局分页（按账号可见门店过滤；shopIds=null 表示不限门店） */
  async page(params: { shopIds: string[] | null; shopId?: string; action?: string; current?: number; size?: number }) {
    const { shopIds, shopId, action } = params;
    const current = Math.max(Number(params.current) || 1, 1);
    const size = Math.min(Math.max(Number(params.size) || 20, 1), 100);
    const shopFilter = shopId
      ? { shopId }
      : shopIds
        ? { shopId: { in: shopIds } }
        : {};
    const where = { ...shopFilter, ...(action ? { action } : {}) };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.paintWorkOrderLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (current - 1) * size,
        take: size,
      }),
      this.prisma.paintWorkOrderLog.count({ where }),
    ]);
    return { records, total, current, size };
  }
}
