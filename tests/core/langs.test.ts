import { describe, it, expect } from "vitest";
import {
  LANGS,
  COMMON_LANG_CODES,
  langName,
  normalizeLangCode,
} from "../../src/core/langs";

describe("normalizeLangCode", () => {
  it("auto 原样保留（忽略大小写与空白）", () => {
    expect(normalizeLangCode("auto")).toBe("auto");
    expect(normalizeLangCode(" AUTO ")).toBe("auto");
    expect(normalizeLangCode("Auto")).toBe("auto");
  });

  it("丢弃地区子标签：en-US→en、en_GB→en、pt-BR→pt", () => {
    expect(normalizeLangCode("en-US")).toBe("en");
    expect(normalizeLangCode("en_GB")).toBe("en");
    expect(normalizeLangCode("EN")).toBe("en");
    expect(normalizeLangCode("pt-BR")).toBe("pt");
    expect(normalizeLangCode("es-419")).toBe("es");
  });

  it("zh-Hans→zh-CN", () => {
    expect(normalizeLangCode("zh-Hans")).toBe("zh-CN");
    expect(normalizeLangCode("zh-CN")).toBe("zh-CN");
    expect(normalizeLangCode("zh-SG")).toBe("zh-CN");
  });

  it("zh-Hant/zh-HK/zh-MO→zh-TW", () => {
    expect(normalizeLangCode("zh-Hant")).toBe("zh-TW");
    expect(normalizeLangCode("zh-HK")).toBe("zh-TW");
    expect(normalizeLangCode("zh-MO")).toBe("zh-TW");
    expect(normalizeLangCode("zh-TW")).toBe("zh-TW");
  });

  it("zh 无地区默认 zh-CN", () => {
    expect(normalizeLangCode("zh")).toBe("zh-CN");
    expect(normalizeLangCode("ZH")).toBe("zh-CN");
  });

  it("空白与下划线容错", () => {
    expect(normalizeLangCode("  fr  ")).toBe("fr");
    expect(normalizeLangCode("zh_hant")).toBe("zh-TW");
  });
});

describe("langName", () => {
  it("默认返回英文全名（LLM prompt 用）", () => {
    expect(langName("en")).toBe("English");
    expect(langName("zh-CN")).toBe("Simplified Chinese");
    expect(langName("auto")).toBe("Auto-detect");
    expect(langName("ja")).toBe("Japanese");
  });

  it("uiLang='zh' 返回中文名", () => {
    expect(langName("en", "zh")).toBe("英语");
    expect(langName("zh-CN", "zh")).toBe("简体中文");
    expect(langName("zh-TW", "zh")).toBe("繁體中文");
    expect(langName("auto", "zh")).toBe("自动检测");
  });

  it("带地区码的输入先归一再查名", () => {
    expect(langName("en-US")).toBe("English");
    expect(langName("zh-Hant")).toBe("Traditional Chinese");
    expect(langName("zh-HK", "zh")).toBe("繁體中文");
    expect(langName("pt-BR", "zh")).toBe("葡萄牙语");
  });

  it("未命中回退归一后的码本身", () => {
    expect(langName("xx-YY")).toBe("xx");
    expect(langName("tlh")).toBe("tlh");
  });
});

describe("LANGS 表", () => {
  it("覆盖 40+ 种常用语言", () => {
    expect(LANGS.length).toBeGreaterThanOrEqual(40);
  });

  it("code 唯一且含 auto/zh-CN/zh-TW/en", () => {
    const codes = LANGS.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const required of ["auto", "zh-CN", "zh-TW", "en"]) {
      expect(codes).toContain(required);
    }
  });

  it("任务点名的语言全部在表", () => {
    const codes = new Set(LANGS.map((l) => l.code));
    const required = [
      "ja", "ko", "fr", "de", "es", "pt", "it", "ru", "ar", "hi", "th", "vi",
      "id", "ms", "tr", "nl", "pl", "sv", "da", "fi", "no", "cs", "el", "he",
      "uk", "ro", "hu", "ca", "eu", "fa", "ur", "bn", "ta", "te", "ml", "sw",
    ];
    for (const code of required) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it("所有 code 均已归一（normalizeLangCode 幂等）", () => {
    for (const l of LANGS) {
      expect(normalizeLangCode(l.code)).toBe(l.code);
    }
  });
});

describe("COMMON_LANG_CODES", () => {
  it("约 20 种且含 auto", () => {
    expect(COMMON_LANG_CODES.length).toBeGreaterThanOrEqual(18);
    expect(COMMON_LANG_CODES.length).toBeLessThanOrEqual(24);
    expect(COMMON_LANG_CODES).toContain("auto");
  });

  it("每个码都在 LANGS 表中", () => {
    const codes = new Set(LANGS.map((l) => l.code));
    for (const code of COMMON_LANG_CODES) {
      expect(codes.has(code)).toBe(true);
    }
  });
});
