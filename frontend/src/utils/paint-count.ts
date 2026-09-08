/**
 * 幅数显示格式化（统一口径）
 *
 * 原先 work-order/index、work-order-detail-modal、work-order-operate-drawer 三处逐字重复同一实现。规则：默认 1 位小数，实际值带 2 位小数时显示 2 位。
 */
export function formatPaintCount(val?: number | string | null): string {
  const n = Number(val ?? 0);
  const decimals = String(n).split('.')[1]?.length ?? 0;
  return n.toFixed(Math.min(Math.max(decimals, 1), 2));
}
