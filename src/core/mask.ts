/**
 * Rtranslate core — 敏感信息脱敏（移植自 OpenImmersive sensitive-mask.js，TS 重写并增强）。
 *
 * 发送给翻译引擎前把敏感信息替换成占位符（__PII_EMAIL_1__），翻译返回后按记录还原。
 * 检测与还原全部在本地完成，原文敏感内容不会离开浏览器。
 *
 * 精度优先原则：宁可漏检也不误伤——财务文档里到处是数字，电话/卡号的匹配都带校验或
 * 强格式约束（Luhn / 身份证 mod-11 + 出生日期合理性 / 国际区号 + 前缀），千分位数字
 * （1,234,567）含逗号，不在分隔符集合里，天然不会命中。
 *
 * 本模块为 core 纯逻辑：零浏览器 API、零外部依赖。
 */

// ── 类型 ────────────────────────────────────────────────────────────────────

export type MaskEntityType = 'KEY' | 'EMAIL' | 'IDCARD' | 'PHONE' | 'CARD';

export interface MaskEntity {
  type: MaskEntityType;
  /** 每类独立序号，按原文出现顺序从 1 递增 */
  serial: number;
  /** 原始敏感值（仅本地持有，绝不外发） */
  value: string;
}

export interface MaskResult {
  masked: string;
  entities: MaskEntity[];
}

/**
 * 给 LLM system prompt 追加的保护句：检测到 `__PII_` 占位符时拼接在 system prompt 末尾，
 * 要求引擎把占位符当不透明 token 原样保留。
 */
export const PII_PROTECT_NOTE: string =
  'The source text contains privacy placeholders matching `__PII_<TYPE>_<N>__` ' +
  '(masked sensitive identifiers: API keys, emails, ID numbers, phone numbers, bank cards). ' +
  'Treat each placeholder as an opaque atomic token: keep it byte-for-byte unchanged in your ' +
  'translation — do not translate, reformat, split, reorder, annotate, or drop it, and do not ' +
  'attempt to reconstruct or guess the original value.';

// ── 校验器 ──────────────────────────────────────────────────────────────────

/** Luhn 校验（银行卡）。13-19 位，过滤掉纯格式巧合的数字串。 */
function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function isValidCard(raw: string): boolean {
  return luhnValid(raw.replace(/[ -]/g, ''));
}

/** 中国大陆 18 位身份证：出生日期合理性（1900-2100）+ mod-11 校验码，双重校验后误报率极低。 */
const ID_WEIGHTS: readonly number[] = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK: readonly string[] = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

function isValidCnId(raw: string): boolean {
  const year = Number(raw.slice(6, 10));
  const month = Number(raw.slice(10, 12));
  const day = Number(raw.slice(12, 14));
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (raw.charCodeAt(i) - 48) * ID_WEIGHTS[i];
  return ID_CHECK[sum % 11] === raw[17].toUpperCase();
}

// ── 检测器（按优先级排列，先命中的先占住区间）────────────────────────────────

interface Detector {
  type: MaskEntityType;
  regexes: RegExp[];
  validate?: (raw: string) => boolean;
}

const DETECTORS: readonly Detector[] = [
  {
    // 已知前缀的 API key / token（强前缀本身即充分证据，无需附加校验）。
    // sk- 字符集含 `.`/`@`：真实 key 常带点号，且要保证 KEY 能整体抢占含邮箱形态的
    // 重叠区间（如 sk-alice@example.com-xxxx 必须作为 KEY 整体命中，而非降级成 EMAIL）。
    type: 'KEY',
    regexes: [
      /\bsk-[A-Za-z0-9._@-]{20,}/g, // OpenAI / DeepSeek / Stripe
      /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, // GitHub
      /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key
      /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
      /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
    ],
  },
  {
    type: 'EMAIL',
    regexes: [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  },
  {
    type: 'IDCARD',
    regexes: [/(?<!\d)\d{17}[0-9Xx](?!\d)/g],
    validate: isValidCnId,
  },
  {
    // PHONE 必须先于 CARD：+86 分组号码的纯数字部分可能碰巧通过 Luhn；
    // 反向不会误伤——卡号无 + 前缀，且连续/分隔形态不满足电话正则的边界
    type: 'PHONE',
    regexes: [
      /\+\d{1,3}[ -]?\d{2,4}(?:[ -]\d{2,4}){1,4}(?!\d)/g, // 国际格式（必须带 +）
      /(?<!\d)(?:\(\d{3}\)\s?|\d{3}[-.])\d{3}[-.]\d{4}(?!\d)/g, // 美式 (555) 123-4567 / 555-123-4567
      /(?<!\d)1[3-9]\d{9}(?!\d)/g, // 中国大陆手机 11 位
    ],
  },
  {
    type: 'CARD',
    regexes: [/(?<!\d)\d(?:[ -]?\d){12,18}(?![\d-])/g],
    validate: isValidCard,
  },
];

function placeholderFor(type: MaskEntityType, serial: number): string {
  return `__PII_${type}_${serial}__`;
}

// ── 打码 ────────────────────────────────────────────────────────────────────

interface Span {
  start: number;
  end: number;
  type: MaskEntityType;
  value: string;
}

/**
 * 打码。返回 { masked, entities }；entities 为空数组表示没有命中，调用方可跳过 restore。
 * DETECTORS 按优先级抢占区间：同一区间只归优先级最高的类型。
 *
 * 增强（相对 OpenImmersive 原版）：带校验的检测器（IDCARD）拒收某个区间后，该区间
 * 进入"tainted"集合——低优先级检测器（CARD）不得再认领与其重叠的命中。否则形如
 * 110101215003078937（出生年份越界、mod-11 失败的身份证）这类字符串会因恰好通过
 * Luhn 而被 CARD 误捞为银行卡。"宁可漏检不误伤"：18 位且疑似身份证的串被拒后，
 * 不降级解释成卡号。
 */
export function maskSensitive(text: string): MaskResult {
  if (!text) return { masked: text, entities: [] };

  const spans: Span[] = [];
  // 被高优先级校验明确拒收的区间（如校验码错误的身份证），低优先级类型不得认领
  const tainted: Array<Pick<Span, 'start' | 'end'>> = [];
  const overlaps = (s: number, e: number): boolean =>
    spans.some((x) => s < x.end && e > x.start) ||
    tainted.some((x) => s < x.end && e > x.start);

  for (const det of DETECTORS) {
    for (const re of det.regexes) {
      re.lastIndex = 0; // 模块级共享正则，每次使用前复位
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (m[0].length === 0) {
          re.lastIndex++; // 防御零宽匹配死循环
          continue;
        }
        if (overlaps(start, end)) continue;
        if (det.validate && !det.validate(m[0])) {
          tainted.push({ start, end });
          continue;
        }
        spans.push({ start, end, type: det.type, value: m[0] });
      }
    }
  }
  if (spans.length === 0) return { masked: text, entities: [] };

  // 序号按出现顺序（每类独立计数）；替换从后往前，避免偏移失效。
  spans.sort((a, b) => a.start - b.start);
  const counters: Partial<Record<MaskEntityType, number>> = {};
  const entities: MaskEntity[] = spans.map((s) => {
    counters[s.type] = (counters[s.type] ?? 0) + 1;
    return { type: s.type, serial: counters[s.type] as number, value: s.value };
  });

  let masked = text;
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i];
    const e = entities[i];
    masked = masked.slice(0, s.start) + placeholderFor(e.type, e.serial) + masked.slice(s.end);
  }
  return { masked, entities };
}

// ── 还原 ────────────────────────────────────────────────────────────────────

/**
 * 还原。占位符文本即 key（不依赖位置映射）。容忍引擎对占位符的常见改写：
 * 大小写变化、下划线旁插空格（含 `_ _` 下划线之间、首尾下划线被空格拆开，
 * 如 `_ _PII _ EMAIL _ 1_ _`）、尾部下划线丢失。
 * 找不到的占位符跳过（该实体在译文中缺失，只影响完整性不泄露信息）。
 */
export function restoreSensitive(text: string, entities: MaskEntity[]): string {
  if (!text || entities.length === 0) return text;
  let out = text;
  // 序号降序还原，配合 (?!\d) 避免 _1 误吞 _11
  const ordered = [...entities].sort((a, b) => b.serial - a.serial);
  for (const e of ordered) {
    const re = new RegExp(
      '(?:_\\s*){1,4}PII[_\\s]+' + e.type + '[_\\s]+' + e.serial + '(?!\\d)(?:\\s*_{1}){0,4}',
      'gi',
    );
    // 函数回调：value 原样返回，防止其中 `$&` 等被当作替换串特殊序列解释
    out = out.replace(re, () => e.value);
  }
  return out;
}
