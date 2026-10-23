/**
 * @vitest-environment jsdom
 *
 * 10 语言国际化测试：
 * - resolveUiLang 各分支（auto→浏览器语言映射 / 未知回退 en；显式语言直返）
 * - UI_LANGS 顺序与数量（10 项，auto 第一，한국어 最后）
 * - de/es/fr/pt-BR/ja/zh-TW/ko 七语言字典键集合与 EN 键集合一致（无缺漏、无多餘键），
 *   en 字典用 t() 哨兵探针验证键齐全；{n}/{m}/{w}/{d} 占位符保留
 * - 通用页「界面语言」下拉渲染 10 项，切换后按 resolveUiLang 解析后的语言即时重渲染
 *
 * main.ts 在 document 存在时自动 init()，DOM 用例先装 chrome stub 再动态 import。
 */
import { describe, it, expect, vi } from "vitest";
import {
  UI_LANGS,
  resolveUiLang,
  t,
  type ResolvedLang,
} from "../../src/shared/i18n";
import {
  DICT_DE,
  DICT_ES,
  DICT_FR,
  DICT_PT_BR,
  DICT_JA,
  DICT_ZH_TW,
  DICT_KO,
} from "../../src/shared/i18n-dicts";
import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { Config } from "../../src/shared/config";

// ===== EN 字典键集合（与 src/shared/i18n.ts 中 EN 字典一一对应，共 82 键） =====

const EXPECTED_KEYS = [
  // 通用
  "settings",
  "save",
  "saved",
  "cancel",
  "delete",
  "edit",
  "add",
  "test",
  "testing",
  // popup
  "popup.translatePage",
  "popup.restorePage",
  "popup.targetLang",
  "popup.sourceLang",
  "popup.displayMode",
  "popup.bilingual",
  "popup.translationOnly",
  "popup.expert",
  "popup.style",
  "popup.engine",
  "popup.hover",
  "popup.selection",
  "popup.floatingBall",
  "popup.currentSite",
  "popup.alwaysSite",
  "popup.neverSite",
  "popup.pageUnavailable",
  "popup.files",
  "popup.review",
  "popup.tutorial",
  "nav.guide",
  "popup.openSettings",
  "popup.statusLoading",
  "popup.statusIdle",
  "popup.statusTranslated",
  "popup.statusTranslatedFail",
  "popup.opFailed",
  "popup.loadFailed",
  "popup.commonLangs",
  "popup.allLangs",
  "popup.expertBuiltin",
  "popup.expertCustom",
  "popup.stats",
  "popup.statsEmpty",
  // options 标签
  "tab.general",
  "tab.engine",
  "tab.experts",
  "tab.style",
  "tab.privacy",
  "tab.glossary",
  "tab.glossaryLibs",
  "tab.writing",
  "tab.tts",
  "tab.words",
  "tab.interaction",
  "tab.hotkeys",
  // options 页面说明
  "tabDesc.general",
  "tabDesc.engine",
  "tabDesc.experts",
  "tabDesc.style",
  "tabDesc.privacy",
  "tabDesc.glossary",
  "tabDesc.glossaryLibs",
  "tabDesc.writing",
  "tabDesc.tts",
  "tabDesc.hotkeys",
  "tabDesc.words",
  "tabDesc.interaction",
  // 通用页
  "general.uiLang",
  "general.uiLangAuto",
  "general.uiLangDesc",
  "general.targetLang",
  "general.targetLangDesc",
  "general.displayMode",
  "general.displayModeDesc",
  "general.bilingual",
  "general.bilingualDesc",
  "general.translationOnly",
  "general.translationOnlyDesc",
  "general.autoSites",
  "general.autoSitesDesc",
  "general.autoLangs",
  "general.autoLangsDesc",
  "general.neverSites",
  "general.neverSitesDesc",
  "general.domainPlaceholder",
];

// ===== resolveUiLang =====

describe("resolveUiLang", () => {
  it("显式语言直返（不解析浏览器语言）", () => {
    for (const code of [
      "en",
      "de",
      "es",
      "fr",
      "pt-BR",
      "ja",
      "zh-CN",
      "zh-TW",
      "ko",
    ] as const) {
      expect(resolveUiLang(code)).toBe(code);
      // 即使浏览器语言不同也不受影响
      expect(resolveUiLang(code, "ja-JP")).toBe(code);
    }
  });

  it("auto：繁体中文地区（TW/HK/MO/Hant）→ zh-TW，其余中文 → zh-CN", () => {
    expect(resolveUiLang("auto", "zh-TW")).toBe("zh-TW");
    expect(resolveUiLang("auto", "zh-HK")).toBe("zh-TW");
    expect(resolveUiLang("auto", "zh-MO")).toBe("zh-TW");
    expect(resolveUiLang("auto", "zh-Hant-TW")).toBe("zh-TW");
    expect(resolveUiLang("auto", "zh-CN")).toBe("zh-CN");
    expect(resolveUiLang("auto", "zh-SG")).toBe("zh-CN");
    expect(resolveUiLang("auto", "zh")).toBe("zh-CN");
  });

  it("auto：de/es/fr/pt/ja/ko 按前缀映射（pt 一律 pt-BR）", () => {
    expect(resolveUiLang("auto", "de-DE")).toBe("de");
    expect(resolveUiLang("auto", "de-AT")).toBe("de");
    expect(resolveUiLang("auto", "es-ES")).toBe("es");
    expect(resolveUiLang("auto", "es-MX")).toBe("es");
    expect(resolveUiLang("auto", "fr-FR")).toBe("fr");
    expect(resolveUiLang("auto", "fr-CA")).toBe("fr");
    expect(resolveUiLang("auto", "pt-BR")).toBe("pt-BR");
    expect(resolveUiLang("auto", "pt-PT")).toBe("pt-BR");
    expect(resolveUiLang("auto", "ja-JP")).toBe("ja");
    expect(resolveUiLang("auto", "ko-KR")).toBe("ko");
  });

  it("auto：en 与未知语言 → en", () => {
    expect(resolveUiLang("auto", "en-US")).toBe("en");
    expect(resolveUiLang("auto", "en-GB")).toBe("en");
    expect(resolveUiLang("auto", "it-IT")).toBe("en");
    expect(resolveUiLang("auto", "xx-XX")).toBe("en");
    expect(resolveUiLang("auto", "")).toBe("en");
  });

  it("auto：未传 browserLang 时读取 navigator.language（jsdom 默认 en-US）", () => {
    Object.defineProperty(window.navigator, "language", {
      value: "en-US",
      configurable: true,
    });
    expect(resolveUiLang("auto")).toBe("en");
    Object.defineProperty(window.navigator, "language", {
      value: "ja-JP",
      configurable: true,
    });
    expect(resolveUiLang("auto")).toBe("ja");
    Object.defineProperty(window.navigator, "language", {
      value: "zh-HK",
      configurable: true,
    });
    expect(resolveUiLang("auto")).toBe("zh-TW");
  });
});

// ===== UI_LANGS =====

describe("UI_LANGS", () => {
  it("10 项，严格顺序：auto 第一、한국어 最后", () => {
    expect(UI_LANGS.length).toBe(10);
    expect(UI_LANGS.map((l) => l.code)).toEqual([
      "auto",
      "en",
      "de",
      "es",
      "fr",
      "pt-BR",
      "ja",
      "zh-CN",
      "zh-TW",
      "ko",
    ]);
    expect(UI_LANGS[0].name).toBe("跟随系统");
    expect(UI_LANGS[UI_LANGS.length - 1].name).toBe("한국어");
    expect(UI_LANGS.map((l) => l.name)).toEqual([
      "跟随系统",
      "English",
      "Deutsch",
      "Español",
      "Français",
      "Português (Brasil)",
      "日本語",
      "简体中文",
      "繁體中文",
      "한국어",
    ]);
  });
});

// ===== 字典完整性 =====

const REGISTERED_DICTS: ReadonlyArray<[ResolvedLang, Record<string, string>]> = [
  ["de", DICT_DE],
  ["es", DICT_ES],
  ["fr", DICT_FR],
  ["pt-BR", DICT_PT_BR],
  ["ja", DICT_JA],
  ["zh-TW", DICT_ZH_TW],
  ["ko", DICT_KO],
];

describe("字典键集合与 EN 一致", () => {
  it("EN 字典（i18n.ts 注册）覆盖全部 82 键（哨兵探针）", () => {
    const SENTINEL = "MISSING";
    for (const key of EXPECTED_KEYS) {
      expect(t(key, "en", SENTINEL)).not.toBe(SENTINEL);
    }
  });

  it.each(REGISTERED_DICTS)("%s：键集合与 EN 完全一致（无缺漏、无多餘键）", (_lang, dict) => {
    expect(Object.keys(dict).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it.each(REGISTERED_DICTS)("%s：所有词条为非空字符串", (_lang, dict) => {
    for (const [k, v] of Object.entries(dict)) {
      expect(typeof v, k).toBe("string");
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  it.each(REGISTERED_DICTS)("%s：占位符 {n}/{m}/{w}/{d} 原样保留", (_lang, dict) => {
    expect(dict["popup.statusTranslated"]).toContain("{n}");
    expect(dict["popup.statusTranslatedFail"]).toContain("{n}");
    expect(dict["popup.statusTranslatedFail"]).toContain("{m}");
    expect(dict["popup.stats"]).toContain("{w}");
    expect(dict["popup.stats"]).toContain("{d}");
  });

  it("注册已生效：t() 能取到各语言词条（不回退中文）", () => {
    expect(t("tab.general", "de", "通用")).toBe("Allgemein");
    expect(t("tab.general", "es", "通用")).toBe("General");
    expect(t("tab.general", "fr", "通用")).toBe("Général");
    expect(t("tab.general", "pt-BR", "通用")).toBe("Geral");
    expect(t("tab.general", "ja", "通用")).toBe("一般");
    expect(t("tab.general", "zh-TW", "通用")).toBe("一般");
    expect(t("tab.general", "ko", "通用")).toBe("일반");
    // zh-CN 为源语言，直接回退中文原文
    expect(t("tab.general", "zh-CN", "通用")).toBe("通用");
  });
});

// ===== 通用页「界面语言」下拉（DOM） =====

let stored: Config;

function installChromeStub(): void {
  const sendMessage = vi.fn(
    async (msg: { kind: string; patch?: Partial<Config> }) => {
      if (msg.kind === "getConfig") return { ok: true, data: stored };
      if (msg.kind === "setConfig") {
        // background store 为浅合并：patch 中的嵌套对象总是整对象传入
        stored = { ...stored, ...msg.patch };
        return { ok: true, data: stored };
      }
      return { ok: true, data: null };
    },
  );
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage,
      getURL: (p: string) => `chrome-extension://mock/${p}`,
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setNavigatorLanguage(lang: string): void {
  Object.defineProperty(window.navigator, "language", {
    value: lang,
    configurable: true,
  });
}

/** 全新模块 + DOM + chrome stub 启动设置页（默认落在「通用」标签页） */
async function boot(cfg: Config, browserLang = "zh-CN"): Promise<void> {
  setNavigatorLanguage(browserLang);
  stored = cfg;
  installChromeStub();
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await import("../../src/options/main");
  await flush();
}

function qs<T extends Element>(sel: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`未找到元素：${sel}`);
  return node;
}

function cardByTitle(title: string): HTMLElement {
  const card = Array.from(
    document.querySelectorAll<HTMLElement>(".content > .card"),
  ).find((c) => c.querySelector(".card-title")?.textContent === title);
  if (!card) throw new Error(`未找到卡片：${title}`);
  return card;
}

function navLabels(): string[] {
  return Array.from(document.querySelectorAll(".nav-btn")).map(
    (b) => b.textContent ?? "",
  );
}

function cardTitles(): string[] {
  return Array.from(
    document.querySelectorAll(".content > .card > .card-title"),
  ).map((h) => h.textContent ?? "");
}

describe("通用页界面语言下拉", () => {
  it("渲染 10 项（UI_LANGS 严格顺序），默认 auto 选中", async () => {
    await boot(structuredClone(DEFAULT_CONFIG)); // DEFAULT_CONFIG.uiLang === 'auto'

    const uiCard = cardByTitle("界面语言"); // auto + 浏览器 zh-CN → 中文界面
    const sel = qs<HTMLSelectElement>("select.control", uiCard);
    expect(sel.options.length).toBe(10);
    expect(Array.from(sel.options).map((o) => o.value)).toEqual([
      "auto",
      "en",
      "de",
      "es",
      "fr",
      "pt-BR",
      "ja",
      "zh-CN",
      "zh-TW",
      "ko",
    ]);
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      "跟随系统",
      "English",
      "Deutsch",
      "Español",
      "Français",
      "Português (Brasil)",
      "日本語",
      "简体中文",
      "繁體中文",
      "한국어",
    ]);
    expect(sel.value).toBe("auto");
    // auto 按浏览器 zh-CN 解析：导航与页标题为中文
    expect(navLabels()[0]).toBe("通用");
    expect(qs<HTMLElement>(".page-title").textContent).toBe("通用");
  });

  it("切换 Deutsch：写入 config.uiLang 并即时按德语重渲染导航/标题/通用页", async () => {
    await boot(structuredClone(DEFAULT_CONFIG));

    const sel = qs<HTMLSelectElement>(
      "select.control",
      cardByTitle("界面语言"),
    );
    sel.value = "de";
    sel.dispatchEvent(new Event("change"));
    await flush();

    expect(stored.uiLang).toBe("de");
    expect(navLabels()[0]).toBe("Allgemein");
    expect(navLabels()[1]).toBe("Engines");
    expect(qs<HTMLElement>(".page-title").textContent).toBe("Allgemein");
    expect(qs<HTMLElement>(".page-desc").textContent).toBe(
      "Sprache, Anzeigemodus sowie Website- und Sprachlisten",
    );
    expect(cardTitles()).toEqual([
      "Zielsprache",
      "Oberflächensprache",
      "Anzeigemodus",
      "Diese Websites immer übersetzen",
      "Diese Sprachen immer übersetzen",
      "Diese Websites nie übersetzen",
    ]);
    // 重渲染后下拉保持 Deutsch 选中，且仍为 10 项
    const selAfter = qs<HTMLSelectElement>(
      "select.control",
      cardByTitle("Oberflächensprache"),
    );
    expect(selAfter.value).toBe("de");
    expect(selAfter.options.length).toBe(10);
  });

  it("切换 日本語：导航与页标题即时按日语重渲染", async () => {
    await boot(structuredClone(DEFAULT_CONFIG));

    const sel = qs<HTMLSelectElement>(
      "select.control",
      cardByTitle("界面语言"),
    );
    sel.value = "ja";
    sel.dispatchEvent(new Event("change"));
    await flush();

    expect(stored.uiLang).toBe("ja");
    expect(navLabels()[0]).toBe("一般");
    expect(qs<HTMLElement>(".page-title").textContent).toBe("一般");
    expect(cardTitles()[0]).toBe("翻訳先の言語");
    expect(cardTitles()[1]).toBe("表示言語");
  });

  it("auto 跟随浏览器：浏览器 en-US 时按英文渲染", async () => {
    await boot(structuredClone(DEFAULT_CONFIG), "en-US");

    expect(navLabels()[0]).toBe("General");
    expect(qs<HTMLElement>(".page-title").textContent).toBe("General");
    const sel = qs<HTMLSelectElement>(
      "select.control",
      cardByTitle("Interface language"),
    );
    expect(sel.value).toBe("auto");
  });
});
