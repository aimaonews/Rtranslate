/**
 * core/text.ts — 纯文本工具，零浏览器 API 依赖，可 node 单测。
 */

/** 折叠所有空白（含全角空格 U+3000；\s 已覆盖 &nbsp; U+00A0）为单个半角空格并 trim。 */
export function normalizeText(s: string): string {
  return s.replace(/[\s　]+/g, " ").trim();
}

/**
 * 标识符/机器文本判定：命中任一模式即视为"不值得翻译"。
 * 思想移植自 KISS Translator 的 BUILTIN_SKIP_PATTERNS（URL/邮箱/数字/占位符等），
 * 按本项目需要重组为独立正则组合，保持每条规则可单独阅读。
 */
const IDENTIFIER_PATTERNS: RegExp[] = [
  // URL：http/https/ftp/file 协议或 www. 开头
  /^(?:(?:https?|ftp|file):\/\/|www\.)[^\s]+$/i,
  // 裸域名：example.com、sub.example.co.uk（要求 TLD 为 2+ 字母，避免误伤普通句子缩写）
  /^(?:[\w-]+\.)+[a-zA-Z]{2,}(?::\d{1,5})?(?:\/[^\s]*)?$/,
  // 邮箱
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  // @handle（@username / @user.name）
  /^@[\w.-]+$/,
  // 纯数字：整数/小数/千分位（1,234,567 / 3.14），可带货币符号、百分号、常见单位
  /^[$\u00A2-\u00A5\u20A0-\u20CF]?\s?-?\d+(?:[.,]\d+)*(?:\s?(?:px|%|em|rem|pt|vw|vh|deg|s|ms))?$/,
  // 版本号：v1.2.3 / 10.0.1
  /^v?\d+(?:\.\d+){1,3}$/i,
  // 日期/时间：2024-01-31、2024/01/31、ISO 8601 带时间
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  // 文件名：name.ext（仅列常见开发/文档扩展名，避免误伤普通英文缩写句）
  /^[\w][\w .-]*\.(?:js|ts|jsx|tsx|mjs|cjs|json|css|scss|less|html?|xml|ya?ml|md|txt|pdf|zip|tar|gz|png|jpe?g|gif|webp|svg|mp[34]|mov|avi|exe|dll|so|py|java|go|rs|c|cpp|h|sh|bat|lock|log|csv)$/i,
  // UUID
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  // 十六进制色值：#rgb / #rrggbb / #rrggbbaa
  /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
  // CSS 选择器：.class / #id / 组合 div.cls / a:hover / li:nth-child(2)（必须含 . # : 之一，避免误伤普通单词）
  /^(?:[\w-]+)?(?:[.#:][\w-]+(?:\([^)]*\))?)+$/,
  // 模板占位符：{{var}} / ${var} / __VAR__ / %var（含 printf 风格 %s）
  /^(?:\{\{[^{}]+\}\}|\$\{[^{}]+\}|__\w+__|%\w+)$/,
];

export function isIdentifierLike(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return IDENTIFIER_PATTERNS.some((re) => re.test(t));
}

/**
 * 是否"有意义的可翻译文本"：长度达标、含至少两个 Unicode 字母、且不是标识符。
 * 两个字母的要求用于过滤单个图标字符（如 "×"、"→" 与单字母徽标）。
 */
export function isMeaningfulText(s: string, minLen = 2): boolean {
  const t = normalizeText(s);
  if (t.length < minLen) return false;
  const letters = t.match(/\p{L}/gu);
  if (!letters || letters.length < 2) return false;
  return !isIdentifierLike(t);
}

// 句子边界：句末标点后跟空白或行尾（lookahead 不消费分隔符，保证切点落在标点之后）
const SENTENCE_END = /([。！？.!?；;]+)(?=\s|$)/g;

/**
 * 按句子边界贪心切分长文本，保证每段 <= maxLen。
 * - 单个句子超过 maxLen 时按空白硬切（尽量保词完整）；无空白可切时才定长硬断。
 * - 分隔空白随句子保留在段内，不在切点处额外增删字符。
 * - 空输入返回 []。
 */
export function splitLongText(text: string, maxLen: number): string[] {
  if (!text) return [];
  if (maxLen <= 0) return [text];
  if (text.length <= maxLen) return [text];

  // 1) 按句子边界切出句子（保留句末标点）
  const sentences: string[] = [];
  let last = 0;
  SENTENCE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(text)) !== null) {
    const end = m.index + m[1].length;
    sentences.push(text.slice(last, end));
    last = end;
  }
  if (last < text.length) sentences.push(text.slice(last));

  // 2) 超长句子按空白硬切
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= maxLen) {
      pieces.push(s);
    } else {
      pieces.push(...hardSplit(s, maxLen));
    }
  }

  // 3) 贪心合并相邻碎片，合并后不得超过 maxLen
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (!cur) {
      cur = p;
    } else if (cur.length + p.length <= maxLen) {
      cur += p;
    } else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 按空白硬切；窗口内找不到空白时退化为定长硬断。 */
function hardSplit(s: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen + 1);
    const ws = window.search(/\s(?![\s\S]*\s)/); // 窗口内最后一个空白的位置
    if (ws > 0) {
      out.push(rest.slice(0, ws + 1));
      rest = rest.slice(ws + 1);
    } else {
      out.push(rest.slice(0, maxLen));
      rest = rest.slice(maxLen);
    }
  }
  if (rest) out.push(rest);
  return out;
}

/** 全角字母数字/符号转半角（U+FF01–U+FF5E 整体偏移 0xFEE0）。 */
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 宽松等价比较：归一化（全角转半角 → 去全部空白 → 去标点/符号 → 小写）后比较。
 * 用于"译文 == 原文"判定，防止引擎原样返回时双语重复插入。
 */
export function sameText(a: string, b: string): boolean {
  const norm = (s: string) =>
    toHalfWidth(s)
      .replace(/[\s　]+/g, "")
      .replace(/[\p{P}\p{S}]+/gu, "")
      .toLowerCase();
  return norm(a) === norm(b);
}

/**
 * cyrb53 双哈希（公开域算法，bryc 发布），输出 base36 短串。
 * 非加密用途：仅作缓存 key / 去重指纹，要求跨进程稳定。
 */
export function textHash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // 拼成 53bit 正整数后转 base36，保证短且稳定
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(36);
}
