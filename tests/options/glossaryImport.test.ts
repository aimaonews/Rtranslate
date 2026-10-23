import { describe, it, expect } from "vitest";
import {
  getEngineOptions,
  parseGlossaryImport,
  mergeGlossaryTerms,
} from "../../src/options/main";
import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { Config } from "../../src/shared/config";

function cfgWithCustomEngines(): Config {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.engine.customEngines = [
    { id: "abc123", name: "我的引擎", endpoint: "https://api.example.com/v1", apiKey: "", model: "", headersJson: "{}" },
    { id: "def456", name: "备用引擎", endpoint: "https://api2.example.com/v1", apiKey: "", model: "", headersJson: "{}" },
  ];
  return cfg;
}

describe("getEngineOptions", () => {
  it("AI猫排第一，内置引擎按固定顺序随后", () => {
    const opts = getEngineOptions(structuredClone(DEFAULT_CONFIG));
    expect(opts.map((o) => o.id)).toEqual([
      "aimao",
      "google",
      "bing",
      "mymemory",
      "deepl",
      "openai",
      "deepseek",
      "claude",
      "gemini",
      "libretranslate",
    ]);
    expect(opts[0].name).toBe("AI猫");
    expect(opts[0].icon).toContain("aimao");
  });

  it("customEngines 追加在内置引擎之后，id 带 custom: 前缀，name 取 entry.name", () => {
    const opts = getEngineOptions(cfgWithCustomEngines());
    expect(opts.length).toBe(12);
    expect(opts[10]).toMatchObject({ id: "custom:abc123", name: "我的引擎" });
    expect(opts[11]).toMatchObject({ id: "custom:def456", name: "备用引擎" });
    // 自定义引擎使用 custom 图标
    expect(opts[10].icon).toContain("custom");
  });

  it("旧单 custom 引擎不出现在下拉中", () => {
    const opts = getEngineOptions(structuredClone(DEFAULT_CONFIG));
    expect(opts.some((o) => o.id === "custom")).toBe(false);
  });
});

describe("parseGlossaryImport", () => {
  it("逗号分隔", () => {
    const r = parseGlossaryImport("apple,苹果\nbanana,香蕉");
    expect(r.terms).toEqual([
      { src: "apple", dst: "苹果" },
      { src: "banana", dst: "香蕉" },
    ]);
    expect(r.skipped).toBe(0);
  });

  it("制表符分隔", () => {
    const r = parseGlossaryImport("apple\t苹果\nbanana\t香蕉");
    expect(r.terms).toEqual([
      { src: "apple", dst: "苹果" },
      { src: "banana", dst: "香蕉" },
    ]);
    expect(r.skipped).toBe(0);
  });

  it("竖线分隔", () => {
    const r = parseGlossaryImport("apple|苹果\nbanana|香蕉");
    expect(r.terms).toEqual([
      { src: "apple", dst: "苹果" },
      { src: "banana", dst: "香蕉" },
    ]);
    expect(r.skipped).toBe(0);
  });

  it("三种分隔符混用按行识别", () => {
    const r = parseGlossaryImport("a,1\nb\t2\nc|3");
    expect(r.terms).toEqual([
      { src: "a", dst: "1" },
      { src: "b", dst: "2" },
      { src: "c", dst: "3" },
    ]);
    expect(r.skipped).toBe(0);
  });

  it("空行与缺列行被跳过，缺列计入 skipped", () => {
    const r = parseGlossaryImport("\n  \napple,苹果\nno-separator\nonly,\n,dst\nbanana,香蕉\n");
    expect(r.terms).toEqual([
      { src: "apple", dst: "苹果" },
      { src: "banana", dst: "香蕉" },
    ]);
    // no-separator / only, / ,dst 三行坏行；空行不计入
    expect(r.skipped).toBe(3);
  });

  it("按 src 大小写不敏感去重，先出现者保留", () => {
    const r = parseGlossaryImport("Apple,苹果\napple,苹果2\nAPPLE,苹果3\nbanana,香蕉");
    expect(r.terms).toEqual([
      { src: "Apple", dst: "苹果" },
      { src: "banana", dst: "香蕉" },
    ]);
    expect(r.skipped).toBe(2);
  });

  it("译文列含分隔符时合并剩余列", () => {
    const r = parseGlossaryImport("phrase,你好,世界");
    expect(r.terms).toEqual([{ src: "phrase", dst: "你好,世界" }]);
  });
});

describe("mergeGlossaryTerms", () => {
  it("与现有术语表合并，现有优先（大小写不敏感）", () => {
    const existing = [
      { src: "Apple", dst: "现有苹果" },
      { src: "banana", dst: "香蕉" },
    ];
    const imported = [
      { src: "apple", dst: "新苹果" },
      { src: "cherry", dst: "樱桃" },
    ];
    const merged = mergeGlossaryTerms(existing, imported);
    expect(merged).toEqual([
      { src: "Apple", dst: "现有苹果" },
      { src: "banana", dst: "香蕉" },
      { src: "cherry", dst: "樱桃" },
    ]);
  });

  it("导入内部有重复时不重复追加", () => {
    const merged = mergeGlossaryTerms([], [
      { src: "a", dst: "1" },
      { src: "A", dst: "2" },
    ]);
    expect(merged).toEqual([{ src: "a", dst: "1" }]);
  });
});
