import type { PaintOrderStatus } from '@/service/api';

/**
 * 工单状态（PaintOrderStatus）统一映射
 *
 * 原先 work-order(index, detail-modal) / vehicle-history-drawer / seal / adjustment 各自维护一份 状态 -> 文案/tag颜色 映射，已出现多处口径漂移：
 * PENDING 的颜色在 vehicle-history 是 info 其余是 warning；AUDITED/SETTLED 的颜色在 work-order/index 与 seal 相反；adjustment 甚至把 DRAFT
 * 的文案 写成了「待审核」。此处统一定义（与移动端 H5 的 order-status 常量口径一致）， 全端共用。
 */

type TagType = 'default' | 'primary' | 'info' | 'success' | 'warning' | 'error';

/** NaiveUI NTag 的 type */
export const PAINT_ORDER_STATUS_TAG_TYPE: Record<string, TagType> = {
  DRAFT: 'default',
  PENDING: 'warning',
  AUDITED: 'info',
  SETTLED: 'success',
  ABNORMAL: 'error',
  VOID: 'error',
  /** 后端遗留状态，兜底保留 */
  COMPLETED: 'success'
};

/** 完整文案 */
export const PAINT_ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  AUDITED: '已审核',
  SETTLED: '已结算',
  ABNORMAL: '异常',
  VOID: '作废',
  COMPLETED: '已完成'
};

/** tag 颜色，未识别状态回退 default */
export function getPaintOrderStatusTagType(status?: string | null): TagType {
  return PAINT_ORDER_STATUS_TAG_TYPE[status || ''] || 'default';
}

/** 文案，未识别状态回退状态码本身 */
export function getPaintOrderStatusLabel(status?: string | null): string {
  if (!status) return '-';
  return PAINT_ORDER_STATUS_LABEL[status] || status;
}

/** 兼容旧用法：PaintOrderStatus 全量映射的文案表 */
export const paintOrderStatusLabel: Record<PaintOrderStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  AUDITED: '已审核',
  SETTLED: '已结算',
  ABNORMAL: '异常',
  VOID: '作废'
};
