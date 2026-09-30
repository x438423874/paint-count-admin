/**
 * 幅数计算与显示精度（统一口径）
 *
 * 原先 work-order/create 与 work-order/detail 各自维护一份
 * 「自动幅数计算 + 小数位控制」，两处算法必须严格一致否则
 * 新建与编辑显示的总幅数对不上。此处统一。
 */
import type { CreateWorkOrderItemDto, PaintSpecialPaint, PaintStandard } from '@/api/types/paint'

/** 计算单个部位项目的自动幅数（未手动覆盖时使用） */
export function computeItemPaintCount(
  item: Pick<CreateWorkOrderItemDto, 'quantity' | 'newPartQuantity' | 'specialPaintId'>,
  standard: PaintStandard | undefined,
  specialPaints: PaintSpecialPaint[],
): number {
  if (!item.quantity || item.quantity <= 0 || !standard)
    return 0
  const coefficient = Number(standard.coefficient) || 0
  const newPartAddition = Number(standard.newPartAddition) || 0
  let specialMultiplier = 1
  if (item.specialPaintId) {
    const sp = specialPaints.find(s => s.id === item.specialPaintId)
    if (sp)
      specialMultiplier = Number(sp.multiplier) || 1
  }
  return (item.quantity * coefficient + (item.newPartQuantity || 0) * newPartAddition) * specialMultiplier
}

/**
 * 汇总整单幅数（手动覆盖项直接取覆盖值）
 * 注意：与原实现一致，先按数量过滤再取覆盖值——数量为 0 的项目
 * 即使有覆盖幅数也不计入。
 */
export function computeTotalPaintCount(
  items: CreateWorkOrderItemDto[],
  standards: PaintStandard[],
  specialPaints: PaintSpecialPaint[],
): number {
  return items.reduce((sum, item) => {
    if (!item.quantity || item.quantity <= 0)
      return sum
    if (item.overridePaintCount !== undefined && item.overridePaintCount !== null)
      return sum + item.overridePaintCount
    const std = standards.find(s => s.categoryId === item.categoryId)
    return sum + computeItemPaintCount(item, std, specialPaints)
  }, 0)
}

/**
 * 幅数显示小数位：默认 1 位，实际值带 2 位小数时显示 2 位；
 * 聚焦输入时允许输入 2 位（focusIndex 为当前聚焦项下标）
 */
export function getPaintDecimalLength(focusIndex: number | null, index: number, value?: number | string | null): number {
  if (focusIndex === index)
    return 2
  const decimals = String(value ?? '').split('.')[1]?.length ?? 0
  return Math.min(Math.max(decimals, 1), 2)
}

/** 失焦后规范化覆盖幅数为最多 2 位小数，避免浮点误差与超长小数 */
export function normalizeOverridePaintCount(item: CreateWorkOrderItemDto): void {
  if (item.overridePaintCount !== undefined && item.overridePaintCount !== null) {
    item.overridePaintCount = Number(Number(item.overridePaintCount).toFixed(2))
  }
}

/**
 * 自动幅数显示格式：未选特殊漆保持 1 位小数；
 * 选择特殊漆后系数可能产生 2 位小数（如 0.8 × 1.6 = 1.28），按 2 位精确显示（去尾零）
 */
export function formatAutoPaintCount(value: number, hasSpecialPaint?: boolean): string {
  const text = hasSpecialPaint ? value.toFixed(2) : value.toFixed(1)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}
