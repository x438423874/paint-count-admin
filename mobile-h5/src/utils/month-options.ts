import type { MyScope } from '@/api/paint'
import { monthInTenure } from '@/utils/tenure'

export interface MonthOption {
  text: string
  value: string
}

/**
 * 「近 N 个月」结算月份选项（统一口径）
 *
 * 原先 create（13 个月）、pending-image（全部+12 个月）、work-order/index
 * （全部+12 个月∩在岗期）、TenureMonthPicker（近 N 个月∩在岗期）四处
 * 各自维护一份循环生成逻辑，此处统一。
 *
 * @param opts 选项对象
 * @param opts.months 向前回溯的月数（含当月），默认 12
 * @param opts.includeAll 是否在头部插入「全部月份」选项（value 为 ''）
 * @param opts.allText 「全部月份」文案
 * @param opts.scope 传入后按在岗期过滤（与后端 tenureCoversMonth 口径一致）
 */
export function recentMonthOptions(opts: {
  months?: number
  includeAll?: boolean
  allText?: string
  scope?: MyScope | null
} = {}): MonthOption[] {
  const { months = 12, includeAll = false, allText = '全部月份', scope = null } = opts
  const list: MonthOption[] = []
  if (includeAll)
    list.push({ text: allText, value: '' })
  const now = new Date()
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (scope && !monthInTenure(value, scope))
      continue
    list.push({ text: value, value })
  }
  return list
}
