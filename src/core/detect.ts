/**
 * core/detect.ts — 文字系统统计与语种启发式判定，零浏览器 API 依赖。
 */

export interface ScriptStats {
  cjk: number;
  kana: number;
  hangul: number;
  cyrillic: number;
  arabic: number;
  latin: number;
  /** 计入统计的"文字字符"总数（不含数字、标点、空白、emoji） */
  total: number;
}

// 各文字系统 Unicode 区间（取常用平面，不含罕用扩展区）
const RANGES = {
  // CJK 统一表意文字 + 扩展 A + 兼容表意
  cjk: /[一-鿿㐀-䶿豈-﫿]/u,
  // 平假名 + 片假名（含半角片假名与假名扩展）
  kana: /[぀-ゟ゠-ヿｦ-ﾟ]/u,
  // 韩文音节 + 字母
  hangul: /[가-힯ᄀ-ᇿ]/u,
  // 西里尔 + 补充
  cyrillic: /[Ѐ-ӿ]/u,
  // 阿拉伯文 + 补充（不含波斯文扩展区，避免过宽）
  arabic: /[؀-ۿݐ-ݿ]/u,
  // 拉丁：基础 + 拉丁扩展 A/B + 附加扩展
  latin: /[A-Za-zÀ-ɏḀ-ỿ]/u,
} as const;

/**
 * 按 Unicode 区间统计各文字系统字符数。
 * 注意：日文汉字计入 cjk 而非 kana —— kana 只统计假名，
 * 这正是区分中日文本的依据（日文必含假名，中文几乎不含）。
 */
export function scriptStats(text: string): ScriptStats {
  const stats: ScriptStats = {
    cjk: 0,
    kana: 0,
    hangul: 0,
    cyrillic: 0,
    arabic: 0,
    latin: 0,
    total: 0,
  };
  for (const ch of text) {
    if (RANGES.cjk.test(ch)) stats.cjk++;
    else if (RANGES.kana.test(ch)) stats.kana++;
    else if (RANGES.hangul.test(ch)) stats.hangul++;
    else if (RANGES.cyrillic.test(ch)) stats.cyrillic++;
    else if (RANGES.arabic.test(ch)) stats.arabic++;
    else if (RANGES.latin.test(ch)) stats.latin++;
    else continue; // 数字/标点/空白/emoji 等不计入 total
    stats.total++;
  }
  return stats;
}

/**
 * 拉丁字母语言的高频功能词（整词、小写、去重计数）。
 * 拉丁语系共用一套字母，文字占比无法区分语种——用功能词投票：
 * 目标语言需命中 ≥2 个不同功能词，且是所有语言中的唯一最高分，才判"已是目标语言"。
 * 判不出一律返回 false（宁可多翻浪费额度，不可漏翻导致功能缺失）。
 */
const LATIN_STOPWORDS: Record<string, readonly string[]> = {
  en: ["the", "and", "of", "to", "in", "is", "that", "for", "it", "with", "this", "an", "was", "on", "are", "as"],
  de: ["der", "die", "das", "und", "ist", "nicht", "ein", "eine", "mit", "für", "auf", "den", "von", "zu"],
  es: ["que", "el", "los", "las", "una", "con", "por", "del", "se", "en", "un", "es", "la"],
  fr: ["le", "les", "est", "et", "des", "une", "dans", "pour", "pas", "sur", "au", "que", "la"],
  pt: ["que", "em", "para", "com", "não", "uma", "dos", "ao", "seu", "de", "por", "é"],
  it: ["il", "che", "di", "un", "non", "per", "del", "sono", "gli", "con", "la"],
  nl: ["het", "een", "van", "dat", "niet", "met", "voor", "op", "aan", "de"],
  pl: ["nie", "jest", "się", "przez", "oraz", "jak", "ale", "tego"],
  sv: ["och", "att", "det", "som", "på", "är", "för", "med", "inte"],
  da: ["og", "det", "som", "er", "til", "med", "ikke", "for"],
  no: ["og", "det", "som", "er", "til", "ikke", "for", "med"],
  fi: ["on", "ja", "ei", "se", "että", "sekä", "kun", "niin"],
  tr: ["bir", "ve", "bu", "için", "ile", "olarak", "daha", "değil"],
  cs: ["je", "se", "na", "že", "ale", "tak", "jako", "ne"],
  hu: ["az", "egy", "hogy", "nem", "volt", "van", "még"],
  ro: ["și", "este", "în", "care", "nu", "un", "la"],
  id: ["yang", "dan", "itu", "dengan", "untuk", "tidak", "ini"],
  ms: ["yang", "dan", "itu", "dengan", "untuk", "tidak", "ini"],
  vi: ["của", "và", "là", "có", "được", "trong", "không"],
  ca: ["les", "és", "amb", "per", "que", "una"],
  eu: ["eta", "bat", "ez", "da", "baina"],
  sw: ["na", "ya", "wa", "kwa", "ni", "za"],
};

function latinStopwordHits(words: ReadonlySet<string>, lang: string): number {
  const list = LATIN_STOPWORDS[lang];
  if (!list) return 0;
  let n = 0;
  for (const w of list) if (words.has(w)) n++;
  return n;
}

/**
 * 启发式判断 text 是否"看起来是 lang 语言"。
 * total < 4 时文本太短，一律返回 false（不够统计意义）。
 * lang 传 ISO 码（'zh-CN' / 'zh-TW' / 'ja' / 'ko' / 'en' …）。
 */
export function looksLikeLang(text: string, lang: string): boolean {
  const s = scriptStats(text);
  if (s.total < 4) return false;
  const code = lang.toLowerCase().split("-")[0];
  const ratio = (n: number) => n / s.total;

  switch (code) {
    case "zh":
      // 中文：CJK 占比高。日文含大量汉字，可能也过此阈值——
      // 调用方应先判 ja 再判 zh（detectPageLang 即如此）。
      return ratio(s.cjk) > 0.35;
    case "ja":
      // 日文：有假名基本可判定；或 CJK 高且假名非零（汉字多假名少的日文）
      return ratio(s.kana) > 0.05 || (ratio(s.cjk) > 0.35 && s.kana > 0);
    case "ko":
      return ratio(s.hangul) > 0.3;
    case "ru":
    case "uk":
    case "bg":
      return ratio(s.cyrillic) > 0.5;
    case "ar":
    case "fa":
    case "ur":
      return ratio(s.arabic) > 0.5;
    default: {
      // 拉丁语系：字母占比只是入场券，语种靠功能词投票区分。
      if (ratio(s.latin) <= 0.5 || s.cjk > 0 || s.kana > 0 || s.hangul > 0) return false;
      const words = new Set(text.toLowerCase().match(/[\p{L}\p{M}']+/gu) ?? []);
      const target = latinStopwordHits(words, code);
      if (target < 2) return false;
      let best = 0;
      let ties = 0;
      for (const other of Object.keys(LATIN_STOPWORDS)) {
        const hits = latinStopwordHits(words, other);
        if (hits > best) { best = hits; ties = 1; }
        else if (hits === best && hits > 0) ties++;
      }
      return target === best && ties === 1;
    }
  }
}

export interface DocLike {
  documentElement: { lang?: string };
  body?: { textContent: string | null };
}

/**
 * 页面语种判定：
 * 1. 优先 <html lang> 属性（'en-US' → 'en'；zh-Hans/zh-Hant/zh-CN/zh-TW/… 归一为 'zh-CN' / 'zh-TW'）；
 * 2. 缺失时取 body 前 1000 字符做文字占比统计（阈值 0.2），按 ja → zh → ko → 拉丁 顺序判定
 *    ——假名先行，防止日文页因汉字占比高被误判为中文；
 * 3. 都判不出返回 null（交调用方决定默认行为）。
 */
export function detectPageLang(doc: DocLike): string | null {
  const raw = doc.documentElement.lang;
  if (raw && raw.trim()) {
    const l = raw.trim().toLowerCase().replace("_", "-");
    if (l.startsWith("zh")) {
      // 繁体系（tw/hk/mo/hant）归 zh-TW，其余归 zh-CN
      return /tw|hk|mo|hant/.test(l) ? "zh-TW" : "zh-CN";
    }
    return l.split("-")[0];
  }

  const text = doc.body?.textContent;
  if (!text) return null;
  const s = scriptStats(text.slice(0, 1000));
  if (s.total < 4) return null;
  const ratio = (n: number) => n / s.total;

  if (s.kana > 0 && (ratio(s.kana) > 0.05 || ratio(s.cjk) > 0.2)) return "ja";
  if (ratio(s.cjk) > 0.2) return "zh-CN";
  if (ratio(s.hangul) > 0.2) return "ko";
  if (ratio(s.cyrillic) > 0.2) return "ru";
  if (ratio(s.arabic) > 0.2) return "ar";
  if (ratio(s.latin) > 0.2) return "en";
  return null;
}
