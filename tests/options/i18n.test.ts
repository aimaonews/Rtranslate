/**
 * @vitest-environment jsdom
 *
 * 10 语言国际化测试：
 * - resolveUiLang 各分支（auto→浏览器语言映射 / 未知回退 en；显式语言直返）
 * - UI_LANGS 顺序与数量（10 项，auto 第一，한국어 最后）
 * - de/es/fr/pt-BR/ja/zh-TW/ko 七语言字典键集合与 EN 键集合一致（无缺漏、无多馀键），
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
import { PAGE_DICTS } from "../../src/shared/i18n-pages";
import { TRANSLATION_STYLES } from "../../src/core/styles";
import { BUILTIN_EXPERTS } from "../../src/core/experts";
import { BUILTIN_ENGINES } from "../../src/shared/engines";
import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { Config } from "../../src/shared/config";

// ===== EN 字典键集合（与 src/shared/i18n.ts 中 EN 字典一一对应，共 82 键） =====

const EXPECTED_KEYS = [
  "style.soft-gray",
  "style.underline-dotted",
  "style.highlight-yellow",
  "style.highlight-green",
  "style.blur-mask",
  "settings",
  "lang.autoDetect",
  "lang.commonGroup",
  "lang.allGroup",
  "brand.settings",
  "sel.writeFailed",
  "sel.ai",
  "sel.write",
  "sel.save",
  "sel.speak",
  "sel.stop",
  "sel.copy",
  "sel.close",
  "sel.translating",
  "sel.translateFailed",
  "sel.copied",
  "sel.copyFailed",
  "sel.savedWord",
  "sel.ttsUnavailable",
  "sel.aiThinking",
  "sel.aiStartHint",
  "sel.aiFollowPh",
  "sel.aiBusy",
  "sel.aiSend",
  "sel.aiRequestFailed",
  "sel.generating",
  "sel.replace",
  "sel.replaced",
  "sel.replaceFailed",
  "sel.notEditable",
  "sel.write.polish",
  "sel.write.continue",
  "sel.write.summarize",
  "sel.write.reply",
  "sel.write.translate",
  "sel.tone.default",
  "sel.tone.formal",
  "sel.tone.casual",
  "sel.tone.humorous",
  "sel.tone.professional",
  "sel.length.default",
  "sel.length.shorter",
  "sel.length.longer",
  "ball.tip",
  "input.replaced",
  "input.replaceFailed",
  "render.loading",
  "render.retry",
  "cmp.targetLang",
  "cmp.engineFailed",
  "cmp.runFailed",
  "sel.aiUnavailable",
  "sel.saveFailed",
  "cmp.title",
  "cmp.close",
  "cmp.placeholder",
  "cmp.run",
  "cmp.hint",
  "cmp.engine.google",
  "cmp.engine.bing",
  "cmp.engine.openai",
  "cmp.engine.custom",
  "engine.aimao",
  "engine.aimaoDesc",
  "engine.google",
  "engine.googleDesc",
  "engine.bing",
  "engine.bingDesc",
  "engine.mymemory",
  "engine.mymemoryDesc",
  "engine.deepl",
  "engine.deeplDesc",
  "engine.openai",
  "engine.openaiDesc",
  "engine.deepseek",
  "engine.deepseekDesc",
  "engine.claude",
  "engine.claudeDesc",
  "engine.gemini",
  "engine.geminiDesc",
  "engine.libretranslate",
  "engine.libretranslateDesc",
  "engine.getApiKey",
  "engine.aimaoKeyPh",
  "opt.s1",
  "opt.s2",
  "opt.s3",
  "opt.s4",
  "opt.s5",
  "opt.s6",
  "opt.s7",
  "opt.s8",
  "opt.s9",
  "opt.s10",
  "opt.s11",
  "opt.s12",
  "opt.s13",
  "opt.s14",
  "opt.s15",
  "opt.s16",
  "opt.s17",
  "opt.s18",
  "opt.s19",
  "opt.s20",
  "opt.s21",
  "opt.s22",
  "opt.s23",
  "opt.s24",
  "opt.s25",
  "opt.s26",
  "opt.s27",
  "opt.s28",
  "opt.s29",
  "opt.s30",
  "opt.s31",
  "opt.s32",
  "opt.s33",
  "opt.s34",
  "opt.s35",
  "opt.s36",
  "opt.s37",
  "opt.s38",
  "opt.s39",
  "opt.s40",
  "opt.s41",
  "opt.s42",
  "opt.s43",
  "opt.s44",
  "opt.s45",
  "opt.s46",
  "opt.s47",
  "opt.s48",
  "opt.s49",
  "opt.s50",
  "opt.s51",
  "opt.s52",
  "opt.s53",
  "opt.s54",
  "opt.s55",
  "opt.s56",
  "opt.s57",
  "opt.s58",
  "opt.s59",
  "opt.s60",
  "opt.s61",
  "opt.s62",
  "opt.s63",
  "opt.s64",
  "opt.s65",
  "opt.s66",
  "opt.s67",
  "opt.s68",
  "opt.s69",
  "opt.s70",
  "opt.s71",
  "opt.s72",
  "opt.s73",
  "opt.s74",
  "opt.s75",
  "opt.s76",
  "opt.s77",
  "opt.s78",
  "opt.s79",
  "opt.s80",
  "opt.s81",
  "opt.s82",
  "opt.s83",
  "opt.s84",
  "opt.s85",
  "opt.s86",
  "opt.s87",
  "opt.s88",
  "opt.s89",
  "opt.s90",
  "opt.s91",
  "opt.s92",
  "opt.s93",
  "opt.s94",
  "opt.s95",
  "opt.s96",
  "opt.s97",
  "opt.s98",
  "opt.s99",
  "opt.s100",
  "opt.s101",
  "opt.s102",
  "opt.s103",
  "opt.s104",
  "opt.s105",
  "opt.s106",
  "opt.s107",
  "opt.s108",
  "opt.s109",
  "opt.s110",
  "opt.s111",
  "opt.s112",
  "opt.s113",
  "opt.s114",
  "opt.s115",
  "opt.s116",
  "opt.s117",
  "opt.s118",
  "opt.s119",
  "opt.s120",
  "opt.s121",
  "opt.s122",
  "opt.s123",
  "opt.s124",
  "opt.s125",
  "opt.s126",
  "opt.s127",
  "opt.s128",
  "opt.s129",
  "opt.s130",
  "opt.s131",
  "opt.s132",
  "opt.s133",
  "opt.s134",
  "opt.s135",
  "opt.s136",
  "opt.s137",
  "opt.s138",
  "opt.experts.s1",
  "opt.experts.s2",
  "opt.experts.s3",
  "opt.experts.s4",
  "opt.experts.s5",
  "opt.experts.s6",
  "opt.experts.s7",
  "opt.experts.s8",
  "opt.experts.s9",
  "opt.experts.s10",
  "opt.experts.s11",
  "opt.experts.s12",
  "opt.experts.s13",
  "opt.experts.s14",
  "opt.experts.s15",
  "opt.experts.s16",
  "opt.experts.s17",
  "opt.experts.s18",
  "opt.experts.s19",
  "opt.experts.s20",
  "opt.experts.s21",
  "opt.experts.s22",
  "opt.experts.s23",
  "opt.experts.s24",
  "opt.experts.s25",
  "opt.experts.s26",
  "opt.glossaryLibs.s1",
  "opt.glossaryLibs.s2",
  "opt.glossaryLibs.s3",
  "opt.glossaryLibs.s4",
  "opt.glossaryLibs.s5",
  "opt.glossaryLibs.s6",
  "opt.glossaryLibs.s7",
  "opt.glossaryLibs.s8",
  "opt.glossaryLibs.s9",
  "opt.glossaryLibs.s10",
  "opt.glossaryLibs.s11",
  "opt.glossaryLibs.s12",
  "opt.glossaryLibs.s13",
  "opt.glossaryLibs.s14",
  "opt.glossaryLibs.s15",
  "opt.glossaryLibs.s16",
  "opt.glossaryLibs.s17",
  "opt.glossaryLibs.s18",
  "opt.glossaryLibs.s19",
  "opt.glossaryLibs.s20",
  "opt.glossaryLibs.s21",
  "opt.glossaryLibs.s22",
  "opt.glossaryLibs.s23",
  "opt.glossaryLibs.s24",
  "opt.glossaryLibs.s25",
  "opt.glossaryLibs.s26",
  "opt.glossaryLibs.s27",
  "opt.glossaryLibs.s28",
  "opt.glossaryLibs.s29",
  "opt.glossaryLibs.s30",
  "opt.glossaryLibs.s31",
  "opt.glossaryLibs.s32",
  "opt.glossaryLibs.s33",
  "opt.glossaryLibs.s34",
  "opt.glossaryLibs.s35",
  "opt.glossaryLibs.s36",
  "opt.glossaryLibs.s37",
  "opt.glossaryLibs.s38",
  "opt.hotkeys.s1",
  "opt.hotkeys.s2",
  "opt.hotkeys.s3",
  "opt.hotkeys.s4",
  "opt.hotkeys.s5",
  "opt.hotkeys.s6",
  "opt.hotkeys.s7",
  "opt.hotkeys.s8",
  "opt.hotkeys.s9",
  "opt.hotkeys.s10",
  "opt.hotkeys.s11",
  "opt.hotkeys.s12",
  "opt.hotkeys.s13",
  "opt.hotkeys.s14",
  "opt.tts.s1",
  "opt.tts.s2",
  "opt.tts.s3",
  "opt.tts.s4",
  "opt.tts.s5",
  "opt.tts.s6",
  "opt.tts.s7",
  "opt.tts.s8",
  "opt.tts.s9",
  "opt.tts.s10",
  "opt.tts.s11",
  "opt.tts.s12",
  "opt.tts.s13",
  "opt.tts.s14",
  "opt.tts.s15",
  "opt.tts.s16",
  "opt.tts.s17",
  "opt.tts.s18",
  "opt.tts.s19",
  "opt.tts.s20",
  "opt.tts.s21",
  "opt.tts.s22",
  "opt.writing.s1",
  "opt.writing.s2",
  "opt.writing.s3",
  "opt.writing.s4",
  "opt.writing.s5",
  "opt.writing.s6",
  "opt.writing.s7",
  "opt.writing.s8",
  "opt.writing.s9",
  "opt.writing.s10",
  "opt.writing.s11",
  "opt.writing.s12",
  "opt.writing.s13",
  "opt.writing.s14",
  "opt.writing.s15",
  "opt.writing.s16",
  "opt.writing.s17",
  "opt.writing.s18",
  "opt.writing.s19",
  "opt.writing.s20",
  "opt.writing.s21",
  "opt.writing.s22",
  "opt.writing.s23",
  "opt.writing.s24",
  "opt.writing.s25",
  "opt.writing.s26",
  "opt.writing.s27",
  "opt.writing.s28",
  "opt.writing.s29",
  "pop.s1",
  "pop.s2",
  "pop.s3",
  "files.s1",
  "files.s2",
  "files.s3",
  "files.s4",
  "files.s5",
  "files.s6",
  "files.s7",
  "files.s8",
  "files.s9",
  "files.s10",
  "files.s11",
  "files.s12",
  "files.s13",
  "files.s14",
  "files.s15",
  "ob.s1",
  "ob.s2",
  "ob.s3",
  "ob.s4",
  "ob.s5",
  "ob.s6",
  "ob.s7",
  "ob.s8",
  "style.plain",
  "style.bold",
  "style.italic",
  "style.card",
  "style.rounded",
  "style.quote",
  "style.gradient",
  "style.frosted",
  "expert.general",
  "expert.tech",
  "expert.literary",
  "expert.academic",
  "expert.social",
  "save",
  "saved",
  "cancel",
  "delete",
  "edit",
  "add",
  "test",
  "testing",
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
  "nav.privacy",
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

  it("显式不支持语言 → 英语兜底（英语为项目兜底语言）", () => {
    expect(resolveUiLang("it")).toBe("en");
    expect(resolveUiLang("ru-RU")).toBe("en");
    expect(resolveUiLang("xx-YY")).toBe("en");
    expect(resolveUiLang("")).toBe("en");
    // zh 系变体归一（旧配置可能存裸 zh）
    expect(resolveUiLang("zh")).toBe("zh-CN");
    expect(resolveUiLang("zh-Hant")).toBe("zh-TW");
    expect(resolveUiLang("zh-HK")).toBe("zh-TW");
    // 地区变体归一到主语言
    expect(resolveUiLang("pt")).toBe("pt-BR");
    expect(resolveUiLang("pt-PT")).toBe("pt-BR");
    expect(resolveUiLang("en-US")).toBe("en");
    expect(resolveUiLang("de-AT")).toBe("de");
    expect(resolveUiLang("ja-JP")).toBe("ja");
  });

  it("t()：不支持语言或缺键时英语字典兜底（不再回退中文）", () => {
    // 不支持语言（模拟旧配置残留 uiLang=it）→ 取英语值
    expect(t("settings", "it", "设置")).toBe("Settings");
    expect(t("style.soft-gray", "it", "柔和灰")).toBe("Soft gray");
    // 键在某语言缺失（模拟）→ 英语值；英语也缺 → 中文原文
    expect(t("no.such.key", "de", "原文中文")).toBe("原文中文");
    expect(t("no.such.key", "it", "原文中文")).toBe("原文中文");
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
    const SENTINEL = "MISSING";
    for (const key of EXPECTED_KEYS) {
      expect(t(key, "en", SENTINEL)).not.toBe(SENTINEL);
    }
  });

  it.each(REGISTERED_DICTS)("%s：键集合与 EN 完全一致（无缺漏、无多馀键）", (_lang, dict) => {
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


// ===== 字典健全性（防重建污染回归：2026-10 字典灾后重建曾混入 76 个 pages 键与 374 处错位值）=====

describe("字典健全性（防重建污染回归）", () => {
  const ALL_DICTS: [string, Record<string, string>][] = [
    ["en", Object.fromEntries(EXPECTED_KEYS.map((k) => [k, t(k, "en", "")]))],
    ["de", DICT_DE],
    ["es", DICT_ES],
    ["fr", DICT_FR],
    ["pt-BR", DICT_PT_BR],
    ["ja", DICT_JA],
    ["zh-TW", DICT_ZH_TW],
    ["ko", DICT_KO],
  ];
  const PH = /\{(\w+)\}/g;

  it("字典归属：i18n-dicts 与 i18n-pages 键集合不相交（pages 键只允许出现在 i18n-pages）", () => {
    for (const [name, dict] of ALL_DICTS) {
      for (const key of Object.keys(dict)) {
        if (PAGE_DICTS.en && key in PAGE_DICTS.en) {
          throw new Error(`${name} 字典含 pages 专属键 ${key}（应只存在于 i18n-pages.ts）`);
        }
      }
    }
  });

  it("占位符一致性：每个键在全部 9 个字典中的 {占位符} 集合相同（防键值错位）", () => {
    for (const key of EXPECTED_KEYS) {
      const sets = ALL_DICTS.map(([name, dict]) => {
        const v = dict[key];
        return [name, (String(v ?? "").match(PH) || []).sort().join(",")] as const;
      });
      const ref = sets[0][1];
      for (const [name, ph] of sets) {
        expect(ph, `${name}.${key} 占位符集合`).toBe(ref);
      }
    }
  });

  it("值非空壳：占位符-only 值仅允许出现在拼接型键白名单（正文在内层 t()）", () => {
    const ALLOWLIST = new Set(["pop.s2", "pop.s3", "ob.s7", "ob.s8", "opt.glossaryLibs.s6", "opt.glossaryLibs.s12"]);
    for (const [name, dict] of ALL_DICTS) {
      for (const [key, v] of Object.entries(dict)) {
        if (ALLOWLIST.has(key)) continue;
        const text = String(v).replace(/\{p?\w+\}/g, "").trim();
        expect(text.length > 0, `${name}.${key} 值为纯占位符空壳`).toBe(true);
      }
    }
  });

  it("数据键存在性：样式/专家/引擎的 nameKey 与 descKey 在全部 9 字典中都有值（防连字符键被解析器丢弃）", () => {
    const dataKeys: string[] = [
      ...TRANSLATION_STYLES.map((s) => s.nameKey),
      ...BUILTIN_EXPERTS.map((e) => e.nameKey).filter((k): k is string => Boolean(k)),
      ...BUILTIN_ENGINES.flatMap((e) => [e.nameKey, e.descKey].filter((k): k is string => Boolean(k))),
    ];
    for (const key of dataKeys) {
      for (const [name, dict] of ALL_DICTS) {
        expect(typeof dict[key], `${name}.${key} 缺失（数据键必须存在于全部字典）`).toBe("string");
        expect(String(dict[key]).length, `${name}.${key} 空值`).toBeGreaterThan(0);
      }
    }
  });

});
