/**
 * 工单号 OCR 自动纠正（规则引导的有界搜索）。
 *
 * 背景：微信拍照 OCR 常见字符混淆（O↔0、丢前导 0、I↔1 等），
 * 识别出的工单号与门店规则（pattern + length）不符。本工具以门店规则为裁判，
 * 对原始号码做「混淆替换 / 插入 / 删除」的有界搜索（默认深度 2、候选上限 5000），
 * 仅当候选中恰好一个匹配规则时才给出纠正；0 个或多于一个返回 null（保守不猜）。
 *
 * 典型案例（江门瑞华宏现）：
 *   raw  BYDEGD61WR0260909014  （丢 0 + O→0，两处错误）
 *   rule BYDEGD061WRO2[0-9]{9}，length 21
 *   →    BYDEGD061WRO260909014（唯一候选，~36ms）
 */

export interface OrderNoRule {
  pattern: string;
  length?: number;
  description?: string;
}

export interface OrderNoCorrection {
  raw: string;
  /** null 表示无法唯一确定，调用方应保留原值走人工流程 */
  corrected: string | null;
  /** 匹配规则的候选（调试/日志用） */
  candidates: string[];
}

/** 常见 OCR 字符混淆表（双向） */
const CONFUSIONS: Record<string, string[]> = {
  '0': ['O', 'D'],
  'O': ['0', 'D', 'Q'],
  '1': ['I', 'L'],
  'I': ['1'],
  'L': ['1'],
  '5': ['S'],
  'S': ['5'],
  '8': ['B'],
  'B': ['8'],
  '2': ['Z'],
  'Z': ['2'],
  '6': ['G'],
  'G': ['6'],
  'Q': ['O', '0'],
};

/** 插入候选字符：覆盖「OCR 丢失字符」场景 */
const INSERT_CHARS = ['0', 'O', '1', 'I', '5', 'S', '8', 'B', '2', 'Z', '6', 'G'];

const MAX_CANDIDATES = 50000;

function buildMatcher(rules: OrderNoRule[]): ((candidate: string) => boolean) | null {
  const matchers = rules
    .map((rule) => {
      try {
        const re = new RegExp(`^${rule.pattern}$`);
        const expectedLength = rule.length ?? null;
        return (candidate: string) =>
          re.test(candidate) && (expectedLength === null || candidate.length === expectedLength);
      } catch {
        // 门店配置了非法正则时跳过该规则，不让坏配置拖垮纠正流程
        return null;
      }
    })
    .filter((fn): fn is (candidate: string) => boolean => fn !== null);

  if (matchers.length === 0) return null;
  return (candidate: string) => matchers.some((match) => match(candidate));
}

function oneEditNeighbors(input: string): Set<string> {
  const out = new Set<string>();
  const chars = input.split('');
  for (let i = 0; i < chars.length; i++) {
    for (const alt of CONFUSIONS[chars[i]] || []) {
      const next = [...chars];
      next[i] = alt;
      out.add(next.join(''));
    }
    // 删除
    out.add(chars.slice(0, i).concat(chars.slice(i + 1)).join(''));
  }
  // 插入
  for (let i = 0; i <= chars.length; i++) {
    for (const ch of INSERT_CHARS) {
      out.add(chars.slice(0, i).concat(ch, chars.slice(i)).join(''));
    }
  }
  return out;
}

export function correctOrderNo(
  raw: string | null | undefined,
  rules: OrderNoRule[] | null | undefined,
  maxDepth = 2,
): OrderNoCorrection {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { raw: trimmed, corrected: null, candidates: [] };

  const matcher = buildMatcher(rules ?? []);
  if (!matcher) return { raw: trimmed, corrected: null, candidates: [] };

  // 已符合规则：无需纠正
  if (matcher(trimmed)) return { raw: trimmed, corrected: trimmed, candidates: [trimmed] };

  // 有界 BFS：逐层扩展一编辑邻域，收集匹配规则的候选
  const seen = new Set<string>([trimmed]);
  let frontier = new Set<string>([trimmed]);
  const all = new Set<string>();
  for (let depth = 0; depth < maxDepth; depth++) {
    const next = new Set<string>();
    for (const candidate of frontier) {
      for (const neighbor of oneEditNeighbors(candidate)) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.add(neighbor);
        if (seen.size >= MAX_CANDIDATES) break;
      }
      if (seen.size >= MAX_CANDIDATES) break;
    }
    next.forEach((candidate) => all.add(candidate));
    frontier = next;
    if (seen.size >= MAX_CANDIDATES) break;
  }

  const candidates = [...all].filter(matcher).sort();
  // 仅唯一匹配时自动纠正，多候选/无候选交给人工（金融数据宁可不改不可改错）
  return {
    raw: trimmed,
    corrected: candidates.length === 1 ? candidates[0] : null,
    candidates,
  };
}
