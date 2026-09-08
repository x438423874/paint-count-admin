// 用 type 而非 interface：对象类型别名的隐式索引签名才能赋给 NaiveUI 的 SelectOption
export type MonthOption = {
  label: string;
  value: string;
};

/**
 * 「近 N 个月」结算月份选项（统一口径）
 *
 * 原先 pending-image 与 work-order_reconcile 各自维护一份循环生成逻辑， 此处统一。选项形状为 NaiveUI NSelect 的 { label, value }。
 *
 * @param opts 选项对象
 * @param opts.months 向前回溯的月数（含当月），默认 12
 * @param opts.includeAll 是否在头部插入「全部月份」选项（value 为 ''）
 */
export function recentMonthOptions(opts: { months?: number; includeAll?: boolean } = {}): MonthOption[] {
  const { months = 12, includeAll = false } = opts;
  const list: MonthOption[] = [];
  if (includeAll) list.push({ label: '全部月份', value: '' });
  const now = new Date();
  for (let i = 0; i < months; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    list.push({ label: value, value });
  }
  return list;
}
