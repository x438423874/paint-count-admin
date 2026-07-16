import { Injectable } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

export interface OrderNoRule {
  pattern: string;
  length: number;
  description?: string;
}

/** 通用 OCR 易混淆字符替换表 */
export const DEFAULT_OCR_SUBSTITUTIONS: Record<string, string[]> = {
  '0': ['O'],
  'O': ['0'],
  'o': ['0'],
  '1': ['I', 'l'],
  'I': ['1', 'l'],
  'i': ['1', 'l'],
  'l': ['1', 'I'],
  '2': ['Z'],
  'Z': ['2'],
  'z': ['2'],
  '5': ['S'],
  'S': ['5'],
  's': ['5'],
  '8': ['B'],
  'B': ['8'],
  'b': ['8'],
  '6': ['G'],
  'G': ['6'],
  'g': ['6'],
};

@Injectable()
export class WorkOrderNoRuleService {
  constructor(private readonly prisma: PrismaService) {}

  /** 获取门店工单号规则 */
  async getRules(shopId: string): Promise<OrderNoRule[]> {
    const shop = await this.prisma.paintShop.findUnique({
      where: { id: shopId },
      select: { orderNoRules: true },
    });
    if (!shop?.orderNoRules) return [];
    try {
      const parsed = JSON.parse(shop.orderNoRules);
      return Array.isArray(parsed) ? parsed.filter(this.isValidRule) : [];
    } catch {
      return [];
    }
  }

  /** 保存门店工单号规则 */
  async saveRules(shopId: string, rules: OrderNoRule[]) {
    return this.prisma.paintShop.update({
      where: { id: shopId },
      data: { orderNoRules: JSON.stringify(rules) },
    });
  }

  /** 基于已结算工单分析并生成规则 */
  async analyzeAndSaveRules(shopId: string): Promise<OrderNoRule[]> {
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: { shopId, status: 'SETTLED' },
      select: { orderNo: true },
    });

    const orderNos = orders
      .map(o => o.orderNo?.trim().toUpperCase())
      .filter((o): o is string => !!o && o.length >= 4);

    const rules = this.generateRules(orderNos);
    await this.saveRules(shopId, rules);
    return rules;
  }

  /** 校验工单号是否符合规则 */
  validate(orderNo: string, rules: OrderNoRule[]): { valid: boolean; matchedRule?: OrderNoRule } {
    if (!orderNo) return { valid: false };
    const upper = orderNo.trim().toUpperCase();
    for (const rule of rules) {
      const regex = new RegExp(`^${rule.pattern}$`);
      if (regex.test(upper)) return { valid: true, matchedRule: rule };
    }
    return { valid: false };
  }

  /**
   * 对 OCR 识别出的工单号进行纠正
   * @returns 原始值、是否有效、候选列表（按匹配规则优先）
   */
  correct(orderNo: string, rules: OrderNoRule[], substitutions = DEFAULT_OCR_SUBSTITUTIONS) {
    if (!orderNo) {
      return { original: '', valid: false, candidates: [] as string[] };
    }

    const original = orderNo.trim().toUpperCase();
    const { valid, matchedRule } = this.validate(original, rules);
    if (valid) {
      return { original, valid: true, matchedRule, candidates: [] as string[] };
    }

    const candidates = this.generateCandidates(original, rules, substitutions);
    return { original, valid: false, candidates };
  }

  private generateCandidates(orderNo: string, rules: OrderNoRule[], substitutions: Record<string, string[]>): string[] {
    const results = new Set<string>();

    // 只处理存在易混淆字符的位置
    const ambiguousPositions: number[] = [];
    for (let i = 0; i < orderNo.length; i++) {
      if (substitutions[orderNo[i]]?.length) ambiguousPositions.push(i);
    }

    // 如果歧义位置太多，只处理前 5 个，避免组合爆炸
    const positions = ambiguousPositions.slice(0, 5);
    if (positions.length === 0) return [];

    // 生成所有替换组合（最多 2^5 = 32 种）
    const total = 1 << positions.length;
    for (let mask = 1; mask < total; mask++) {
      const chars = orderNo.split('');
      for (let i = 0; i < positions.length; i++) {
        if ((mask >> i) & 1) {
          const pos = positions[i];
          const subs = substitutions[chars[pos]];
          chars[pos] = subs[0]; // 取第一个候选
        }
      }
      const candidate = chars.join('');
      if (this.validate(candidate, rules).valid) {
        results.add(candidate);
      }
    }

    return Array.from(results).slice(0, 10);
  }

  private generateRules(orderNos: string[]): OrderNoRule[] {
    if (orderNos.length === 0) return [];

    // 按长度分组
    const lengthMap = new Map<number, string[]>();
    for (const no of orderNos) {
      const list = lengthMap.get(no.length) || [];
      list.push(no);
      lengthMap.set(no.length, list);
    }

    // 保留所有出现过的长度（避免遗漏少见的工单号格式）
    // 过滤掉极端长度，防止错误数据干扰
    const sorted = Array.from(lengthMap.entries())
      .filter(([length]) => length >= 4 && length <= 50)
      .sort((a, b) => b[1].length - a[1].length);

    return sorted.map(([length, samples]) => {
      const pattern = this.buildPattern(samples);
      return {
        pattern,
        length,
        description: `基于 ${samples.length} 条已结算工单生成`,
      };
    });
  }

  private buildPattern(samples: string[]): string {
    if (samples.length === 0) return '';
    const length = samples[0].length;
    const charsAtPos: string[][] = Array.from({ length }, () => []);

    for (const sample of samples) {
      for (let i = 0; i < length; i++) {
        charsAtPos[i].push(sample[i]);
      }
    }

    return charsAtPos
      .map(chars => {
        const unique = Array.from(new Set(chars));
        if (unique.length === 1) return this.escapeRegex(unique[0]);
        const hasLetter = unique.some(c => /[A-Z]/.test(c));
        const hasDigit = unique.some(c => /[0-9]/.test(c));
        if (hasLetter && hasDigit) return '[A-Z0-9]';
        if (hasLetter) return '[A-Z]';
        return '[0-9]';
      })
      .join('');
  }

  private escapeRegex(char: string): string {
    return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }

  private isValidRule(rule: any): rule is OrderNoRule {
    return rule && typeof rule.pattern === 'string' && typeof rule.length === 'number';
  }
}
