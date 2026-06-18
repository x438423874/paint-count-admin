import {
  calculatePaintCount,
  findDuplicateCategoryIds,
  hasDuplicateCategoryIds,
  formatOrderNo,
  parseOrderNoSeq,
  getCurrentSettlementMonth,
  shouldMigrateSettlementMonth,
  generateMergeGroupId,
  isDuplicateOrderNo,
} from './paint-calculation';

describe('paint-calculation', () => {
  describe('calculatePaintCount', () => {
    it('仅旧件：幅数 = 系数 × 数量', () => {
      const result = calculatePaintCount({
        coefficient: 2,
        newPartAddition: 0.5,
        quantity: 3,
        newPartQuantity: 0,
        specialPaintMultiplier: null,
      });
      expect(result.paintCount).toBe(6);
      expect(result.quantity).toBe(3);
      expect(result.newPartQuantity).toBe(0);
    });

    it('仅新件：幅数 = (系数 + 新件加幅) × 新件数量', () => {
      const result = calculatePaintCount({
        coefficient: 2,
        newPartAddition: 0.5,
        quantity: 3,
        newPartQuantity: 3,
        specialPaintMultiplier: null,
      });
      // (2 + 0.5) * 3 = 7.5
      expect(result.paintCount).toBe(7.5);
    });

    it('新旧件混合：非新件幅数 + 新件幅数', () => {
      const result = calculatePaintCount({
        coefficient: 2,
        newPartAddition: 0.5,
        quantity: 5,
        newPartQuantity: 2,
        specialPaintMultiplier: null,
      });
      // 旧件: 2 * 3 = 6, 新件: (2 + 0.5) * 2 = 5, 合计 11
      expect(result.paintCount).toBe(11);
    });

    it('特殊车漆：幅数 × 倍数', () => {
      const result = calculatePaintCount({
        coefficient: 2,
        newPartAddition: 0,
        quantity: 3,
        newPartQuantity: 0,
        specialPaintMultiplier: 1.5,
      });
      // 2 * 3 * 1.5 = 9
      expect(result.paintCount).toBe(9);
      expect(result.specialPaintMultiplier).toBe(1.5);
    });

    it('无系数时幅数为 0', () => {
      const result = calculatePaintCount({
        coefficient: 0,
        newPartAddition: 0,
        quantity: 5,
        newPartQuantity: 0,
        specialPaintMultiplier: null,
      });
      expect(result.paintCount).toBe(0);
    });

    it('quantity 为 0 时默认为 1', () => {
      const result = calculatePaintCount({
        coefficient: 2,
        newPartAddition: 0,
        quantity: 0,
        newPartQuantity: 0,
        specialPaintMultiplier: null,
      });
      expect(result.quantity).toBe(1);
      expect(result.paintCount).toBe(2);
    });

    it('特殊车漆倍数为 0 时不乘（falsy 跳过）', () => {
      const result = calculatePaintCount({
        coefficient: 2,
        newPartAddition: 0,
        quantity: 3,
        newPartQuantity: 0,
        specialPaintMultiplier: 0,
      });
      // 0 是 falsy，不执行乘法
      expect(result.paintCount).toBe(6);
    });
  });

  describe('findDuplicateCategoryIds', () => {
    it('无重复时返回空数组', () => {
      expect(findDuplicateCategoryIds(['a', 'b', 'c'])).toEqual([]);
    });

    it('找出重复的类别 ID（去重）', () => {
      expect(findDuplicateCategoryIds(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    });

    it('空数组返回空数组', () => {
      expect(findDuplicateCategoryIds([])).toEqual([]);
    });
  });

  describe('hasDuplicateCategoryIds', () => {
    it('有重复返回 true', () => {
      expect(hasDuplicateCategoryIds(['a', 'a'])).toBe(true);
    });

    it('无重复返回 false', () => {
      expect(hasDuplicateCategoryIds(['a', 'b'])).toBe(false);
    });
  });

  describe('formatOrderNo', () => {
    it('格式化工单号', () => {
      const date = new Date(2026, 5, 17); // 2026-06-17
      expect(formatOrderNo('P', date, 1)).toBe('P202606170001');
    });

    it('序号补零到 4 位', () => {
      const date = new Date(2026, 0, 1);
      expect(formatOrderNo('SHOP01', date, 42)).toBe('SHOP01202601010042');
    });

    it('门店编码为空时使用默认前缀 P', () => {
      const date = new Date(2026, 11, 31);
      expect(formatOrderNo('', date, 999)).toBe('P202612310999');
    });
  });

  describe('parseOrderNoSeq', () => {
    it('解析末尾 4 位序号', () => {
      expect(parseOrderNoSeq('P202606170001')).toBe(1);
      expect(parseOrderNoSeq('SHOP01202601010042')).toBe(42);
    });
  });

  describe('getCurrentSettlementMonth', () => {
    it('返回 yyyy-MM 格式', () => {
      expect(getCurrentSettlementMonth(new Date(2026, 0, 1))).toBe('2026-01');
      expect(getCurrentSettlementMonth(new Date(2026, 11, 31))).toBe('2026-12');
      expect(getCurrentSettlementMonth(new Date(2026, 5, 17))).toBe('2026-06');
    });
  });

  describe('shouldMigrateSettlementMonth', () => {
    it('新旧月份不同且新月份有值时返回 true', () => {
      expect(shouldMigrateSettlementMonth('2026-05', '2026-06')).toBe(true);
    });

    it('新旧月份相同时返回 false', () => {
      expect(shouldMigrateSettlementMonth('2026-06', '2026-06')).toBe(false);
    });

    it('新月份为 null 时返回 false', () => {
      expect(shouldMigrateSettlementMonth('2026-06', null)).toBe(false);
    });

    it('旧月份为 null 新月份有值时返回 true', () => {
      expect(shouldMigrateSettlementMonth(null, '2026-06')).toBe(true);
    });
  });

  describe('generateMergeGroupId', () => {
    it('已有合并组 ID 时复用', () => {
      const existing = 'merge_1234567890';
      expect(generateMergeGroupId(existing)).toBe(existing);
    });

    it('无合并组 ID 时生成新 ID', () => {
      const now = new Date('2026-06-17T00:00:00Z');
      expect(generateMergeGroupId(null, now)).toBe(`merge_${now.getTime()}`);
    });

    it('空字符串时生成新 ID', () => {
      const now = new Date('2026-06-17T00:00:00Z');
      expect(generateMergeGroupId('', now)).toBe(`merge_${now.getTime()}`);
    });
  });

  describe('isDuplicateOrderNo', () => {
    it('相同工单号返回 true', () => {
      expect(isDuplicateOrderNo('P202606170001', 'P202606170001')).toBe(true);
    });

    it('不同工单号返回 false', () => {
      expect(isDuplicateOrderNo('P202606170001', 'P202606170002')).toBe(false);
    });

    it('大小写不敏感', () => {
      expect(isDuplicateOrderNo('p202606170001', 'P202606170001')).toBe(true);
    });

    it('去除前后空格后比较', () => {
      expect(isDuplicateOrderNo('  P202606170001  ', 'P202606170001')).toBe(true);
    });
  });
});
