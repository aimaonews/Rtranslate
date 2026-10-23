import { describe, it, expect } from "vitest";
import {
  normalizeText,
  isIdentifierLike,
  isMeaningfulText,
  splitLongText,
  sameText,
  textHash,
} from "../../src/core/text";

describe("normalizeText", () => {
  it("折叠多个半角空格为单空格", () => {
    expect(normalizeText("a   b\tc\nd")).toBe("a b c d");
  });
  it("折叠全角空格 U+3000 与 NBSP", () => {
    expect(normalizeText("a　b　　c")).toBe("a b c");
    expect(normalizeText("a b")).toBe("a b");
  });
  it("trim 首尾空白", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
    expect(normalizeText("　你好　")).toBe("你好");
  });
  it("空串返回空串", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("isIdentifierLike", () => {
  const yes = [
    // URL / 域名
    "https://example.com/path?q=1",
    "http://foo.bar/baz",
    "www.example.com",
    "example.com",
    "sub.example.co.uk",
    // 邮箱 / handle
    "user@example.com",
    "a.b+c@sub.domain.org",
    "@username",
    "@user.name",
    // 数字 / 千分位 / 货币 / 百分比 / 版本
    "42",
    "1234567",
    "1,234,567",
    "3.14",
    "-3.14",
    "$3.50",
    "¥1,000",
    "100%",
    "10px",
    "1.2.3",
    "v10.0.1",
    // 日期
    "2024-01-31",
    "2024/01/31",
    "2024-01-31T10:20:30Z",
    // 文件名
    "index.js",
    "App.tsx",
    "style.css",
    "report.pdf",
    "archive.tar.gz",
    // UUID
    "550e8400-e29b-41d4-a716-446655440000",
    // 十六进制色值
    "#fff",
    "#FF8800",
    "#ff880080",
    // CSS 选择器
    ".foo",
    "#bar",
    "div.cls",
    "a:hover",
    "li:nth-child(2)",
    // 模板占位符
    "{{name}}",
    "${user}",
    "__PII_PHONE_1__",
    "%s",
  ];
  const no = [
    "hello",
    "hello world",
    "你好，世界",
    "The quick brown fox jumps over the lazy dog",
    "v1 is great", // 含版本号样式但整体是句子
    "a",
    "me@home but not really", // 含空格不是纯邮箱
    "Read the docs",
  ];

  it.each(yes)("标识符 → true: %s", (s) => {
    expect(isIdentifierLike(s)).toBe(true);
  });
  it.each(no)("普通文本 → false: %s", (s) => {
    expect(isIdentifierLike(s)).toBe(false);
  });
  it("空串 → false", () => {
    expect(isIdentifierLike("")).toBe(false);
    expect(isIdentifierLike("   ")).toBe(false);
  });
});

describe("isMeaningfulText", () => {
  it("正常英文/中文 → true", () => {
    expect(isMeaningfulText("Hello world")).toBe(true);
    expect(isMeaningfulText("这是一个测试句子")).toBe(true);
  });
  it("短于 minLen → false", () => {
    expect(isMeaningfulText("a", 2)).toBe(false);
    expect(isMeaningfulText("hi", 3)).toBe(false);
  });
  it("少于两个字母 → false（图标/符号）", () => {
    expect(isMeaningfulText("×")).toBe(false);
    expect(isMeaningfulText("→")).toBe(false);
    expect(isMeaningfulText("a")).toBe(false);
    expect(isMeaningfulText("©")).toBe(false);
  });
  it("标识符 → false", () => {
    expect(isMeaningfulText("https://example.com")).toBe(false);
    expect(isMeaningfulText("42")).toBe(false);
    expect(isMeaningfulText("user@example.com")).toBe(false);
  });
  it("自定义 minLen", () => {
    expect(isMeaningfulText("ok", 5)).toBe(false);
    expect(isMeaningfulText("okay done", 5)).toBe(true);
  });
  it("自定义 minLen=1 单字符仍要求两个字母", () => {
    expect(isMeaningfulText("a", 1)).toBe(false);
  });
});

describe("splitLongText", () => {
  it("空输入返回 []", () => {
    expect(splitLongText("", 10)).toEqual([]);
  });
  it("短文本原样返回（单段）", () => {
    expect(splitLongText("short", 100)).toEqual(["short"]);
  });
  it("按句子边界切分，每段 <= maxLen", () => {
    const text = "First sentence here. Second one follows. Third and final.";
    const parts = splitLongText(text, 40);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(40);
    expect(parts.join("")).toBe(text);
  });
  it("支持中文句末标点", () => {
    const text = "这是第一句。这是第二句！这是第三句？";
    const parts = splitLongText(text, 12);
    // 贪心合并：6+6=12 恰好在限内合成一段，第三句独立成段
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe("这是第一句。这是第二句！");
    expect(parts.join("")).toBe(text);
  });
  it("贪心合并相邻短句", () => {
    const text = "A. B. C. D.";
    const parts = splitLongText(text, 6);
    expect(parts.join("")).toBe(text);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(6);
  });
  it("无标点长句按空白硬切", () => {
    const text = "word ".repeat(30).trim(); // 149 chars, no sentence punct
    const parts = splitLongText(text, 50);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(50);
    // 空白硬切保留词边界，拼接应还原（词间空格保留在段尾）
    expect(parts.join("").replace(/\s+/g, " ").trim()).toBe(
      text.replace(/\s+/g, " ").trim(),
    );
  });
  it("无空白长句定长硬断", () => {
    const text = "a".repeat(100); // 无空格无标点
    const parts = splitLongText(text, 30);
    expect(parts.length).toBe(4);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(30);
    expect(parts.join("")).toBe(text);
  });
  it("超长句子与正常句子混合", () => {
    const long = "x".repeat(80);
    const text = `Start. ${long} End here.`;
    const parts = splitLongText(text, 50);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(50);
    expect(parts.join("")).toBe(text);
  });
  it("maxLen <= 0 时原样返回单段", () => {
    expect(splitLongText("anything", 0)).toEqual(["anything"]);
  });
  it("保留原文换行结构", () => {
    const text = "Line one here.\nLine two here.\nLine three.";
    const parts = splitLongText(text, 60);
    expect(parts.join("")).toBe(text);
    expect(text).toContain("\n");
  });
  it("句末标点在行尾（lookahead $ 分支）", () => {
    const text = "Sentence one.\nSentence two.";
    const parts = splitLongText(text, 14);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.join("")).toBe(text);
  });
});

describe("sameText", () => {
  it("完全相同 → true", () => {
    expect(sameText("hello", "hello")).toBe(true);
  });
  it("大小写差异 → true", () => {
    expect(sameText("Hello", "hello")).toBe(true);
    expect(sameText("HELLO WORLD", "hello world")).toBe(true);
  });
  it("全角/半角差异 → true", () => {
    expect(sameText("Ｈｅｌｌｏ", "Hello")).toBe(true);
    expect(sameText("ｈｅｌｌｏ　ｗｏｒｌｄ", "hello world")).toBe(true);
  });
  it("标点差异 → true", () => {
    expect(sameText("hello, world!", "hello world")).toBe(true);
    expect(sameText("你好，世界！", "你好世界")).toBe(true);
  });
  it("空白差异 → true", () => {
    expect(sameText("hello   world", "hello world")).toBe(true);
  });
  it("不同文本 → false", () => {
    expect(sameText("hello", "world")).toBe(false);
    expect(sameText("你好", "你好吗")).toBe(false);
  });
  it("全角标点转半角后等价", () => {
    expect(sameText("ｈｅｌｌｏ，ｗｏｒｌｄ！", "hello,world")).toBe(true);
  });
});

describe("textHash", () => {
  it("稳定：同输入同输出", () => {
    expect(textHash("hello world")).toBe(textHash("hello world"));
  });
  it("短输入输出短哈希", () => {
    const h = textHash("abc");
    expect(h.length).toBeGreaterThan(0);
    expect(h.length).toBeLessThan(15);
  });
  it("不同输入大概率不同", () => {
    expect(textHash("abc")).not.toBe(textHash("abd"));
    expect(textHash("hello")).not.toBe(textHash("world"));
  });
  it("长文本也可处理", () => {
    const long = "x".repeat(10000);
    const h = textHash(long);
    expect(typeof h).toBe("string");
    expect(h).toMatch(/^[0-9a-z]+$/);
  });
  it("空串有确定输出", () => {
    expect(textHash("")).toBe(textHash(""));
    expect(textHash("")).toMatch(/^[0-9a-z]+$/);
  });
});
