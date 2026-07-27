import type { OrderNoRule } from '@/api/paint';

/** pattern 解析后的 token */
interface PatternToken {
  type: 'literal' | 'class';
  char?: string; // literal 时
  classType?: 'letter' | 'digit' | 'alphanumeric'; // class 时
  raw: string;
  position: number; // 0-based 逻辑位置
}

/**
 * 解析 pattern 字符串为 token 数组
 * pattern 格式如 "XA[0-9][0-9][0-9][A-Z][A-Z]" 或 "[A-Z][A-Z]\\-[0-9][0-9][0-9][0-9]"
 */
function parsePattern(pattern: string): PatternToken[] {
  const tokens: PatternToken[] = [];
  let position = 0;
  let i = 0;

  while (i < pattern.length) {
    if (pattern[i] === '[') {
      // 字符类：扫描到 ']' 结束
      const j = pattern.indexOf(']', i);
      if (j === -1) break; // 不应发生
      const raw = pattern.substring(i, j + 1);
      // 判断 classType
      const hasLetter = /[A-Z]/.test(raw);
      const hasDigit = /[0-9]/.test(raw);
      let classType: 'letter' | 'digit' | 'alphanumeric';
      if (hasLetter && hasDigit) classType = 'alphanumeric';
      else if (hasLetter) classType = 'letter';
      else classType = 'digit';

      tokens.push({ type: 'class', classType, raw, position });
      position++;
      i = j + 1;
    } else if (pattern[i] === '\\' && i + 1 < pattern.length) {
      // 转义字面量（如 \\- 表示 '-'）
      tokens.push({ type: 'literal', char: pattern[i + 1], raw: pattern.substring(i, i + 2), position });
      position++;
      i += 2;
    } else {
      // 普通字面量字符
      tokens.push({ type: 'literal', char: pattern[i], raw: pattern[i], position });
      position++;
      i++;
    }
  }

  return tokens;
}

/** 描述字符类型 */
function describeCharType(char: string): string {
  if (/[0-9]/.test(char)) return '数字';
  if (/[a-z]/.test(char)) return '小写字母';
  if (/[A-Z]/.test(char)) return '字母';
  if (/[\u4e00-\u9fff]/.test(char)) return '中文';
  return '特殊字符';
}

/** 描述期望类型的中文 */
function describeExpectedType(classType: 'letter' | 'digit' | 'alphanumeric'): string {
  switch (classType) {
    case 'letter': return '字母';
    case 'digit': return '数字';
    case 'alphanumeric': return '字母或数字';
  }
}

/**
 * 分析工单号与规则的逐位差异，返回具体错误消息数组
 * @param orderNo 已 trim 且 toUpperCase 的工单号
 * @param rules 工单号规则列表
 * @returns 错误消息数组，最多 5 条
 */
export function analyzeOrderNoErrors(orderNo: string, rules: OrderNoRule[]): string[] {
  if (!orderNo || rules.length === 0) return [];

  const upper = orderNo.trim().toUpperCase();
  const errors: string[] = [];

  // 优先选择长度匹配的规则
  let rule = rules.find(r => r.length === upper.length);
  if (!rule) rule = rules[0];

  const tokens = parsePattern(rule.pattern);

  // 长度校验
  if (upper.length < rule.length) {
    errors.push(`工单号长度不足，应为${rule.length}位，当前仅${upper.length}位`);
  } else if (upper.length > rule.length) {
    errors.push(`工单号长度超出，应为${rule.length}位，当前有${upper.length}位`);
  }

  // 逐位校验（最多校验到 tokens 覆盖的范围）
  const checkCount = Math.min(upper.length, tokens.length);
  let positionErrors = 0;

  for (let i = 0; i < checkCount; i++) {
    const token = tokens[i];
    const char = upper[i];

    if (token.type === 'literal') {
      if (char !== token.char!.toUpperCase()) {
        const charDesc = describeCharType(char);
        errors.push(`第${i + 1}位应为${token.char}，但输入了${charDesc === '特殊字符' || charDesc === '中文' ? charDesc : charDesc + char}`);
        positionErrors++;
      }
    } else {
      // class 类型
      const classType = token.classType!;
      let matches = false;
      switch (classType) {
        case 'letter': matches = /[A-Z]/.test(char); break;
        case 'digit': matches = /[0-9]/.test(char); break;
        case 'alphanumeric': matches = /[A-Z0-9]/.test(char); break;
      }
      if (!matches) {
        const expected = describeExpectedType(classType);
        const charDesc = describeCharType(char);
        errors.push(`第${i + 1}位应为${expected}，但输入了${charDesc}${char}`);
        positionErrors++;
      }
    }

    // 最多报告 5 个位置错误
    if (positionErrors >= 5) break;
  }

  return errors;
}
