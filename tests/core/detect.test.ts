import { describe, it, expect } from "vitest";
import {
  scriptStats,
  looksLikeLang,
  detectPageLang,
} from "../../src/core/detect";

describe("scriptStats", () => {
  it("统计中文 CJK 字符", () => {
    const s = scriptStats("你好世界");
    expect(s.cjk).toBe(4);
    expect(s.total).toBe(4);
    expect(s.latin).toBe(0);
  });
  it("统计日文假名", () => {
    const s = scriptStats("こんにちは");
    expect(s.kana).toBe(5);
    expect(s.total).toBe(5);
  });
  it("日文混合：汉字计入 cjk、假名计入 kana", () => {
    const s = scriptStats("日本語のテキスト");
    expect(s.kana).toBeGreaterThan(0);
    expect(s.cjk).toBeGreaterThan(0);
    expect(s.total).toBe(s.cjk + s.kana);
  });
  it("统计韩文谚文", () => {
    const s = scriptStats("안녕하세요");
    expect(s.hangul).toBe(5);
    expect(s.total).toBe(5);
  });
  it("统计西里尔/阿拉伯/拉丁", () => {
    expect(scriptStats("привет").cyrillic).toBe(6);
    expect(scriptStats("مرحبا").arabic).toBe(5);
    expect(scriptStats("hello").latin).toBe(5);
  });
  it("数字/空白/标点不计入 total", () => {
    const s = scriptStats("ab 12, ");
    expect(s.latin).toBe(2);
    expect(s.total).toBe(2);
  });
});

describe("looksLikeLang", () => {
  it("中文 → zh-*", () => {
    expect(looksLikeLang("这是一段中文文本内容", "zh-CN")).toBe(true);
    expect(looksLikeLang("这是一段中文文本内容", "zh-TW")).toBe(true);
  });
  it("英文 → en，中文 → 非 en", () => {
    expect(looksLikeLang("This is an English sentence", "en")).toBe(true);
    expect(looksLikeLang("这是一段中文文本", "en")).toBe(false);
  });
  it("日文：假名触发 ja", () => {
    expect(looksLikeLang("これは日本語のテキストです", "ja")).toBe(true);
    expect(looksLikeLang("こんにちは世界", "ja")).toBe(true);
  });
  it("日文：CJK 高且含假名 → ja", () => {
    // 汉字为主但含假名 → ja
    expect(looksLikeLang("日本語の文章本文", "ja")).toBe(true);
  });
  it("纯汉字无假名 → 不判 ja（契约：ja 必须有假名，防中日混淆）", () => {
    expect(looksLikeLang("日本語文章本文", "ja")).toBe(false);
  });
  it("中文不是 ja（无假名）", () => {
    expect(looksLikeLang("这是一段中文文本内容", "ja")).toBe(false);
  });
  it("韩文 → ko", () => {
    expect(looksLikeLang("이것은 한국어 텍스트입니다", "ko")).toBe(true);
    expect(looksLikeLang("This is English", "ko")).toBe(false);
  });
  it("短文本（total<4）一律 false", () => {
    expect(looksLikeLang("abc", "en")).toBe(false);
    expect(looksLikeLang("你好", "zh-CN")).toBe(false);
  });
  it("空串 → false", () => {
    expect(looksLikeLang("", "en")).toBe(false);
  });
  it("拉丁语系互译不得误判为已是目标语言（回归：英→德/法/西/葡曾全被跳过）", () => {
    const en =
      "In an industry obsessed with speed, a small movement of developers is rediscovering the value of doing less.";
    expect(looksLikeLang(en, "de")).toBe(false);
    expect(looksLikeLang(en, "fr")).toBe(false);
    expect(looksLikeLang(en, "es")).toBe(false);
    expect(looksLikeLang(en, "pt")).toBe(false);
    expect(looksLikeLang(en, "it")).toBe(false);
    expect(looksLikeLang(en, "nl")).toBe(false);
  });
  it("英文 → en 仍判 true", () => {
    expect(looksLikeLang("The principles are simple and clear for it", "en")).toBe(true);
  });
  it("德文 → de 判 true（已是目标语言跳过）", () => {
    expect(looksLikeLang("In einer Branche, die von Geschwindigkeit besessen ist, ist weniger mehr", "de")).toBe(true);
  });
  it("法文 → fr 判 true", () => {
    expect(looksLikeLang("Dans une industrie obsédée par la vitesse, il est des leçons", "fr")).toBe(true);
  });
  it("西文 → es 判 true", () => {
    expect(looksLikeLang("En una industria obsesionada con la velocidad, el movimiento es pequeño", "es")).toBe(true);
  });
  it("葡文 → pt 判 true", () => {
    expect(looksLikeLang("Em uma indústria obcecada por velocidade, não é sobre minutos", "pt")).toBe(true);
  });
  it("无功能词的短拉丁文本 → false（保守翻译）", () => {
    expect(looksLikeLang("Practical guidelines", "de")).toBe(false);
  });
});

describe("detectPageLang", () => {
  const fakeDoc = (lang: string, body: string | null) => ({
    documentElement: { lang },
    body: { textContent: body },
  });

  it("html lang 属性优先", () => {
    expect(detectPageLang(fakeDoc("en-US", "随便什么正文都可以"))).toBe("en");
    expect(detectPageLang(fakeDoc("zh-CN", ""))).toBe("zh-CN");
    expect(detectPageLang(fakeDoc("ja", ""))).toBe("ja");
  });
  it("zh 系归一：Hans/Hant/TW/HK", () => {
    expect(detectPageLang(fakeDoc("zh-Hans", ""))).toBe("zh-CN");
    expect(detectPageLang(fakeDoc("zh-Hant", ""))).toBe("zh-TW");
    expect(detectPageLang(fakeDoc("zh-TW", ""))).toBe("zh-TW");
    expect(detectPageLang(fakeDoc("zh-HK", ""))).toBe("zh-TW");
    expect(detectPageLang(fakeDoc("zh_CN", ""))).toBe("zh-CN");
  });
  it("lang 缺失时从正文推断（英文）", () => {
    const body = "This is a long English paragraph with enough characters.";
    expect(detectPageLang(fakeDoc("", body))).toBe("en");
  });
  it("lang 缺失时从正文推断（中文）", () => {
    const body = "这是一段足够长的中文正文内容用来进行语种推断";
    expect(detectPageLang(fakeDoc("", body))).toBe("zh-CN");
  });
  it("lang 缺失时从正文推断（日文，假名先行防误判中文）", () => {
    const body = "これは日本語のページです。十分な文字数があります。";
    expect(detectPageLang(fakeDoc("", body))).toBe("ja");
  });
  it("日文汉字多假名少 → ja", () => {
    const body = "日本語漢字仮名交じり文。十分長い文章ですね。";
    expect(detectPageLang(fakeDoc("", body))).toBe("ja");
  });
  it("lang 缺失且正文过短 → null", () => {
    expect(detectPageLang(fakeDoc("", "abc"))).toBe(null);
    expect(detectPageLang(fakeDoc("", null))).toBe(null);
  });
  it("正文为空 → null", () => {
    expect(detectPageLang(fakeDoc("", ""))).toBe(null);
  });
  it("韩文正文推断", () => {
    const body = "이것은 한국어로 작성된 웹 페이지의 본문 내용입니다";
    expect(detectPageLang(fakeDoc("", body))).toBe("ko");
  });
  it("无 body → null", () => {
    expect(
      detectPageLang({ documentElement: { lang: "" } }),
    ).toBe(null);
  });
});
