/**
 * @vitest-environment jsdom
 *
 * 通用标签页 + 界面语言（uiLang）测试：
 * - 通用页无「源语言」卡片，新增「界面语言」下拉（简体中文/English，写 config.uiLang）
 * - zh-CN 时导航标签与现状完全一致；切换 en 后导航标签/页标题/通用页标签即时变英文
 * - 引擎标签页只有 2 张卡片（引擎选择、批量翻译），超时输入在引擎大卡片内、测试连接按钮上方
 *
 * main.ts 在 document 存在时自动 init()，因此每个用例先装 chrome stub 再动态 import。
 */
import { describe, it, expect, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { Config } from "../../src/shared/config";

let stored: Config;

function installChromeStub(): void {
  const sendMessage = vi.fn(async (msg: { kind: string; patch?: Partial<Config> }) => {
    if (msg.kind === "getConfig") return { ok: true, data: stored };
    if (msg.kind === "setConfig") {
      // background store 为浅合并：patch 中的嵌套对象总是整对象传入
      stored = { ...stored, ...msg.patch };
      return { ok: true, data: stored };
    }
    return { ok: true, data: null };
  });
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

/** 全新模块 + DOM + chrome stub 启动设置页（默认落在「通用」标签页） */
async function boot(cfg: Config): Promise<void> {
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

function cardTitles(): string[] {
  return Array.from(
    document.querySelectorAll(".content > .card > .card-title"),
  ).map((h) => h.textContent ?? "");
}

function navLabels(): string[] {
  return Array.from(document.querySelectorAll(".nav-btn")).map(
    (b) => b.textContent ?? "",
  );
}

/** 按卡片标题找卡片 */
function cardByTitle(title: string): HTMLElement {
  const card = Array.from(
    document.querySelectorAll<HTMLElement>(".content > .card"),
  ).find((c) => c.querySelector(".card-title")?.textContent === title);
  if (!card) throw new Error(`未找到卡片：${title}`);
  return card;
}

describe("通用标签页", () => {
  it("渲染：无源语言卡片，有界面语言下拉（10 项，当前 zh-CN）", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN';
    await boot(cfg);

    const titles = cardTitles();
    expect(titles).not.toContain("源语言");
    expect(titles).toContain("界面语言");
    expect(document.body.textContent).not.toContain("自动检测（auto）");

    const uiCard = cardByTitle("界面语言");
    expect(uiCard.textContent).toContain(
      "界面语言影响扩展自身的显示语言，与翻译的目标语言无关",
    );
    const sel = qs<HTMLSelectElement>("select.control", uiCard);
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
    expect(sel.value).toBe("zh-CN");
  });

  it("zh-CN 时导航标签与页标题和现状完全一致", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN';
    await boot(cfg);

    expect(navLabels()).toEqual([
      "通用",
      "翻译引擎",
      "AI 专家",
      "译文样式",
      "隐私",
      "术语表",
      "AI 术语库",
      "AI 写作",
      "语音朗读",
      "生词本",
      "交互",
      "快捷键",
    ]);
    expect(qs<HTMLElement>(".page-title").textContent).toBe("通用");
    expect(qs<HTMLElement>(".page-desc").textContent).toBe(
      "语言、显示模式与网站 / 语言名单",
    );
    // 通用页各行标签保持中文
    expect(cardTitles()).toEqual([
      "目标语言",
      "界面语言",
      "显示模式",
      "总是翻译此网站",
      "总是翻译该语言",
      "永不翻译网站",
    ]);
  });

  it("切换界面语言为 English：写入 config.uiLang 并即时重渲染，导航/页标题/通用页标签变英文", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN';
    await boot(cfg);

    const sel = qs<HTMLSelectElement>(
      "select.control",
      cardByTitle("界面语言"),
    );
    sel.value = "en";
    sel.dispatchEvent(new Event("change"));
    await flush();

    expect(stored.uiLang).toBe("en");
    // 导航标签变英文
    expect(navLabels()[0]).toBe("General");
    expect(navLabels()[1]).toBe("Engines");
    // 页标题/说明变英文
    expect(qs<HTMLElement>(".page-title").textContent).toBe("General");
    expect(qs<HTMLElement>(".page-desc").textContent).toBe(
      "Language, display mode, and site/language lists",
    );
    // 通用页卡片标题变英文
    expect(cardTitles()).toEqual([
      "Target language",
      "Interface language",
      "Display mode",
      "Always translate these sites",
      "Always translate these languages",
      "Never translate these sites",
    ]);
    // 重渲染后下拉保持 English 选中
    expect(
      qs<HTMLSelectElement>("select.control", cardByTitle("Interface language"))
        .value,
    ).toBe("en");
  });

  it("引擎标签页只有 2 张卡片（引擎选择、批量翻译），超时输入在引擎卡片内、测试连接按钮上方", async () => {
    await boot(structuredClone(DEFAULT_CONFIG));
    qs<HTMLButtonElement>('[data-tab="engine"]').click();
    await flush();

    const cards = document.querySelectorAll(".content > .card");
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector(".card-title")?.textContent).toBe("引擎选择");
    expect(cards[1].querySelector(".card-title")?.textContent).toBe("批量翻译");
    expect(cardTitles()).not.toContain("请求超时");

    // 超时输入在引擎大卡片内
    const engineCard = cards[0];
    const timeoutRow = Array.from(
      engineCard.querySelectorAll(".field"),
    ).find((r) => r.querySelector(".field-label")?.textContent === "超时（毫秒）");
    if (!timeoutRow) throw new Error("引擎卡片内未找到超时行");
    const timeoutInput = qs<HTMLInputElement>(
      'input[type="number"]',
      timeoutRow,
    );
    expect(Number(timeoutInput.value)).toBe(stored.engine.timeoutMs);

    // 超时行在「测试连接」按钮上方，且上方有分隔线
    const testBtn = Array.from(
      engineCard.querySelectorAll("button"),
    ).find((b) => b.textContent === "测试连接");
    if (!testBtn) throw new Error("未找到测试连接按钮");
    expect(
      timeoutRow.compareDocumentPosition(testBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(engineCard.querySelector("hr.engine-divider")).toBeTruthy();

    // 修改超时写入 config.engine.timeoutMs
    timeoutInput.value = "30000";
    timeoutInput.dispatchEvent(new Event("change"));
    await flush();
    expect(stored.engine.timeoutMs).toBe(30000);
  });
});
