import { getMyScope } from '@/api/paint'
import type { MyScope } from '@/api/paint'

/**
 * 模块级缓存：一次页面会话只请求一次 my-scope，所有组件实例/页面共享，
 * 避免多实例重复请求（失败触发限流或结果不一致导致月份显示不统一）
 */
let scopePromise: Promise<MyScope | null> | null = null

/** 退出/切换账号后调用：清除 my-scope 会话缓存，避免新账号读到上一账号的数据权限与在岗期 */
export function resetScopeCache(): void {
  scopePromise = null
}

export function getMyScopeCached(): Promise<MyScope | null> {
  if (!scopePromise) {
    scopePromise = getMyScope()
      .then(v => v as any as MyScope)
      .catch(() => null)
  }
  return scopePromise
}

/** 日期按本地时区格式化为 yyyy-MM（避免 UTC 截断出现前一天） */
export function monthOf(v: string | Date): string {
  const d = typeof v === 'string' ? new Date(v) : v
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 月份是否被任一在岗期覆盖（与后端 tenureCoversMonth 口径一致：
 * 结算月份与任期月份区间有交集；未加载/超管财务 scope 不限制）
 */
export function monthInTenure(month: string, scope: MyScope | null | undefined): boolean {
  if (!scope || scope.kind === 'all') return true
  if (scope.kind === 'none') return false
  return scope.shops.some((t) => {
    const sm = t.startAt ? monthOf(t.startAt) : ''
    const em = t.endAt ? monthOf(t.endAt) : ''
    if (sm && month < sm) return false
    if (em && month > em) return false
    return true
  })
}

/** 任期覆盖的最新月份（从当前月往前回溯，最多 36 个月） */
export function latestTenureMonth(scope: MyScope | null | undefined): string | null {
  const now = new Date()
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const m = monthOf(d)
    if (monthInTenure(m, scope)) return m
  }
  return null
}

/** 最早的入职月份（各绑定在岗开始时间的最小值，yyyy-MM）；超管/财务或未加载返回 null */
export function earliestTenureMonth(scope: MyScope | null | undefined): string | null {
  if (!scope || scope.kind !== 'tenure') return null
  const months = scope.shops
    .map(t => (t.startAt ? monthOf(t.startAt) : ''))
    .filter(Boolean)
  return months.length ? months.sort()[0] : null
}

/** 最早的入职时间（本地 Date）；超管/财务或未加载返回 null */
export function earliestTenureDate(scope: MyScope | null | undefined): Date | null {
  if (!scope || scope.kind !== 'tenure') return null
  const times = scope.shops
    .map(t => (t.startAt ? new Date(t.startAt).getTime() : Number.NaN))
    .filter(t => !Number.isNaN(t))
  return times.length ? new Date(Math.min(...times)) : null
}
