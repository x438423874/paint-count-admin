/**
 * 工单状态（PaintOrderStatus）统一映射
 *
 * 原先 index / work-order(index) / work-order(detail) / vehicle-history
 * 各自维护一份 status -> 文案/颜色/图标 的映射表，改一处容易漏掉其余，
 * 且已出现「待审核 vs 待审」这类文案不一致。此处统一定义，全端共用。
 */

/** vant Tag 的 type */
export const ORDER_STATUS_TAG_TYPE: Record<string, string> = {
  DRAFT: 'default',
  PENDING: 'warning',
  AUDITED: 'primary',
  SETTLED: 'success',
  ABNORMAL: 'danger',
}

/** 完整文案（列表、详情等空间充足处） */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  AUDITED: '已审核',
  SETTLED: '已结算',
  ABNORMAL: '异常',
}

/** 短文案（空间受限处，如车辆历史工单卡片） */
export const ORDER_STATUS_SHORT_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审',
  AUDITED: '已审',
  SETTLED: '已结',
  ABNORMAL: '异常',
}

/** 详情页状态 banner 的 CSS class 后缀 */
export const ORDER_STATUS_CLASS: Record<string, string> = {
  DRAFT: 'draft',
  PENDING: 'pending',
  AUDITED: 'audited',
  SETTLED: 'settled',
  ABNORMAL: 'abnormal',
}

/** vant 图标名 */
export const ORDER_STATUS_ICON: Record<string, string> = {
  DRAFT: 'notes-o',
  PENDING: 'clock-o',
  AUDITED: 'success',
  SETTLED: 'balance-o',
  ABNORMAL: 'warning-o',
}

/** 文字态颜色（车辆历史卡片等用色值着色的场景） */
export const ORDER_STATUS_COLOR: Record<string, string> = {
  DRAFT: '#909399',
  PENDING: '#e6a23c',
  AUDITED: '#409eff',
  SETTLED: '#67c23a',
  ABNORMAL: '#f56c6c',
}

/** 状态文案；未知/空返回原值或 '-' */
export function orderStatusLabel(status?: string, short = false): string {
  const map = short ? ORDER_STATUS_SHORT_LABEL : ORDER_STATUS_LABEL
  return map[status || ''] || status || '-'
}

/** vant Tag type */
export function orderStatusTagType(status?: string): string {
  return ORDER_STATUS_TAG_TYPE[status || ''] || 'default'
}

/** banner CSS class 后缀 */
export function orderStatusClass(status?: string): string {
  return ORDER_STATUS_CLASS[status || ''] || 'pending'
}

/** vant 图标名 */
export function orderStatusIcon(status?: string): string {
  return ORDER_STATUS_ICON[status || ''] || 'clock-o'
}

/** 文字态色值 */
export function orderStatusColor(status?: string): string {
  return ORDER_STATUS_COLOR[status || ''] || '#909399'
}
