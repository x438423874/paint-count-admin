/**
 * 喷漆幅数计算 - 纯函数模块
 * 将领域规则从 service 中抽出，便于单元测试与复用
 */

/** 单个工单项目的幅数计算输入 */
export interface PaintCountInput {
  /** 部位系数 */
  coefficient: number;
  /** 新件加幅 */
  newPartAddition: number;
  /** 数量 */
  quantity: number;
  /** 新件数量 */
  newPartQuantity: number;
  /** 特殊车漆倍数（null 表示无特殊车漆） */
  specialPaintMultiplier: number | null;
}

/** 幅数计算结果 */
export interface PaintCountResult {
  quantity: number;
  newPartQuantity: number;
  paintCount: number;
  specialPaintMultiplier: number | null;
}

/**
 * 计算单个项目的幅数
 *
 * 公式：
 *   非新件幅数 = 系数 × 旧件数量
 *   新件幅数   = (系数 + 新件加幅) × 新件数量
 *   总幅数     = (非新件幅数 + 新件幅数) × 特殊车漆倍数
 *
 * @param input 计算输入参数
 * @returns 幅数计算结果
 */
export function calculatePaintCount(input: PaintCountInput): PaintCountResult {
  const { coefficient, newPartAddition, specialPaintMultiplier } = input;
  const quantity = input.quantity || 1;
  const newPartQty = input.newPartQuantity || 0;
  const oldPartQty = quantity - newPartQty;

  let paintCount = coefficient * oldPartQty + (coefficient + newPartAddition) * newPartQty;
  if (specialPaintMultiplier) {
    paintCount *= specialPaintMultiplier;
  }

  return {
    quantity,
    newPartQuantity: newPartQty,
    paintCount,
    specialPaintMultiplier,
  };
}

/**
 * 从一组类别 ID 中找出重复的类别
 * @param categoryIds 类别 ID 数组
 * @returns 重复的类别 ID 数组（去重后）
 */
export function findDuplicateCategoryIds(categoryIds: string[]): string[] {
  const duplicates = categoryIds.filter((id, idx) => categoryIds.indexOf(id) !== idx);
  return [...new Set(duplicates)];
}

/**
 * 判断类别 ID 数组中是否存在重复
 */
export function hasDuplicateCategoryIds(categoryIds: string[]): boolean {
  return findDuplicateCategoryIds(categoryIds).length > 0;
}

/**
 * 格式化工单号
 *
 * 格式：{门店编码}{yyyyMMdd}{4位序号}
 * 例：P202606170001
 *
 * @param shopCode 门店编码
 * @param date 工单日期
 * @param seq 当日序号（从 1 开始）
 */
export function formatOrderNo(shopCode: string, date: Date, seq: number): string {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const prefix = shopCode || 'P';
  return `${prefix}${dateStr}${String(seq).padStart(4, '0')}`;
}

/**
 * 从工单号中解析出序号（末尾 4 位）
 */
export function parseOrderNoSeq(orderNo: string): number {
  return parseInt(orderNo.slice(-4), 10);
}

/**
 * 获取当前结算月份字符串（yyyy-MM）
 */
export function getCurrentSettlementMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 判断结算月份是否需要迁移（新旧月份不同且新月份有值）
 */
export function shouldMigrateSettlementMonth(oldMonth: string | null, newMonth: string | null): boolean {
  return oldMonth !== newMonth && !!newMonth;
}

/**
 * 生成合并组 ID
 *
 * 若目标工单已有合并组 ID 则复用，否则生成新的 ID
 *
 * @param existingMergeGroupId 目标工单已有的合并组 ID（可为 null）
 * @param now 当前时间（用于生成唯一 ID）
 */
export function generateMergeGroupId(existingMergeGroupId: string | null, now: Date = new Date()): string {
  return existingMergeGroupId || `merge_${now.getTime()}`;
}

/**
 * 判断两个工单号是否构成重复（去除前后空格后比较，大小写不敏感）
 */
export function isDuplicateOrderNo(orderNoA: string, orderNoB: string): boolean {
  return orderNoA.trim().toLowerCase() === orderNoB.trim().toLowerCase();
}
