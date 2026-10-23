/**
 * @vitest-environment jsdom
 *
 * 翻译引擎标签页（统一卡片）集成测试：
 * - 引擎选择 → 配置区联动（aimao / deepl / custom:<id>）
 * - 选择器底部「＋ 添加自定义引擎」→ 新建表单（模板预填、保存后自动设为当前引擎）
 * - 高级设置（可选）默认收起，headersJson 保存进配置
 * - 「删除此引擎」在表单内完成，删除当前引擎后回退 AI猫
 *
 * main.ts 在 document 存在时自动 init()，因此每个用例先装 chrome stub 再动态 import。
 */
import { describe, it, expect, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { Config, CustomEngine } from "../../src/shared/config";

let stored: Config;

function installChromeStub(): void {
  const sendMessage = vi.fn(async (msg: { kind: string; patch?: Partial<Config> }) => {
    if (msg.kind === "getConfig") return { ok: true, data: stored };
    if (msg.kind === "setConfig") {
      // background store 为浅合并：patch 中的嵌套对象总是整对象传入
      stored = { ...stored, ...msg.patch };
      return { ok: true, data: stored };
    }
    if (msg.kind === "testEngine") {
      return {
        ok: true,
        data: { ok: true, text: "你好", engine: stored.engine.provider, elapsedMs: 12 },
      };
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

/** 全新模块 + DOM + chrome stub 启动设置页，并切到「翻译引擎」标签页 */
async function bootEngineTab(cfg: Config): Promise<void> {
  stored = cfg;
  installChromeStub();
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await import("../../src/options/main");
  await flush();
  qs<HTMLButtonElement>('[data-tab="engine"]').click();
  await flush();
}

function qs<T extends Element>(sel: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`未找到元素：${sel}`);
  return node;
}

function btnByText(text: string, root: ParentNode = document): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
  if (!btn) throw new Error(`未找到按钮：${text}`);
  return btn;
}

function cfgWithCustomEngine(): Config {
  const cfg = structuredClone(DEFAULT_CONFIG);
  const entry: CustomEngine = {
    id: "abc123",
    name: "我的引擎",
    endpoint: "https://api.example.com/v1",
    apiKey: "sk-x",
    model: "m1",
    headersJson: '{"X-A":"1"}',
  };
  cfg.engine.customEngines = [entry];
  cfg.engine.provider = "custom:abc123";
  return cfg;
}

describe("翻译引擎标签页（统一卡片）", () => {
  it("融合为一个统一板块：选择器、配置区、测试连接同卡片，无独立引擎/管理卡片", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.engine.provider = "aimao";
    await bootEngineTab(cfg);

    const cards = document.querySelectorAll(".content > .card");
    // 统一引擎卡片（请求超时已并入）+ 批量翻译，共 2 张（原先分散的引擎选择/AI猫配置/自定义引擎管理/测试连接/请求超时已融合）
    expect(cards.length).toBe(2);
    const engineCard = cards[0];
    expect(engineCard.querySelector(".engine-select")).toBeTruthy();
    expect(engineCard.querySelector(".engine-config")).toBeTruthy();
    expect(btnByText("测试连接", engineCard)).toBeTruthy();
    // AI猫配置字段在统一卡片内
    const area = qs<HTMLElement>(".engine-config", engineCard);
    expect(area.textContent).toContain("https://api.aimao.today/v1");
    expect(area.textContent).toContain("API Key");
    expect(qs<HTMLAnchorElement>(".apikey-link", area).textContent).toBe("获取API秘钥");
  });

  it("引擎选择联动配置区：切换到 DeepL 后显示 DeepL 密钥字段并写入 provider", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.engine.provider = "aimao";
    await bootEngineTab(cfg);

    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".engine-select-item"),
    ).find((b) => b.textContent?.includes("DeepL"));
    if (!item) throw new Error("未找到 DeepL 选项");
    item.click();
    await flush();

    expect(stored.engine.provider).toBe("deepl");
    const area = qs<HTMLElement>(".engine-config");
    expect(area.textContent).toContain("API Key");
    expect(area.textContent).toContain("密钥仅保存在本机浏览器中");
    // 切换后仍是同一张统一卡片承载
    expect(document.querySelectorAll(".content > .card").length).toBe(2);
  });

  it("选中 custom:<id> 时配置区直接显示该引擎编辑表单（含删除入口），高级区默认收起", async () => {
    await bootEngineTab(cfgWithCustomEngine());

    const area = qs<HTMLElement>(".engine-config");
    const form = qs<HTMLElement>(".custom-engine-form", area);
    expect(
      qs<HTMLInputElement>('input[placeholder="引擎名称"]', form).value,
    ).toBe("我的引擎");
    expect(
      qs<HTMLInputElement>('input[placeholder="https://api.example.com/v1"]', form)
        .value,
    ).toBe("https://api.example.com/v1");
    expect(btnByText("保存", form)).toBeTruthy();
    expect(btnByText("删除此引擎", form)).toBeTruthy();
    expect(btnByText("获取模型列表", form)).toBeTruthy();

    // 高级设置（可选）：<details> 默认收起，headersJson 收在其中
    const details = qs<HTMLDetailsElement>("details.engine-advanced", form);
    expect(details.open).toBe(false);
    expect(qs<HTMLElement>("summary", details).textContent).toBe("高级设置（可选）");
    expect(details.textContent).toContain("一般无需填写，仅当接口需要额外请求头时使用");
    expect(qs<HTMLTextAreaElement>("textarea", details).value).toBe('{"X-A":"1"}');
    // 请求头字段不再裸露在高级区之外
    expect(form.querySelector(":scope > .field-top")).toBeNull();
  });

  it("编辑自定义引擎：高级区内修改 headersJson 保存进配置", async () => {
    await bootEngineTab(cfgWithCustomEngine());

    const form = qs<HTMLElement>(".custom-engine-form");
    const details = qs<HTMLDetailsElement>("details.engine-advanced", form);
    details.open = true; // 用户展开高级区
    const textarea = qs<HTMLTextAreaElement>("textarea", details);
    textarea.value = '{"X-New":"abc"}';
    btnByText("保存", form).click();
    await flush();

    expect(stored.engine.customEngines.length).toBe(1);
    expect(stored.engine.customEngines[0].headersJson).toBe('{"X-New":"abc"}');
    expect(stored.engine.provider).toBe("custom:abc123");
  });

  it("headersJson 非法 JSON 时拦截保存并提示", async () => {
    await bootEngineTab(cfgWithCustomEngine());

    const form = qs<HTMLElement>(".custom-engine-form");
    const textarea = qs<HTMLTextAreaElement>("details.engine-advanced textarea", form);
    textarea.value = "not-json";
    btnByText("保存", form).click();
    await flush();

    expect(stored.engine.customEngines[0].headersJson).toBe('{"X-A":"1"}');
    const hints = Array.from(form.querySelectorAll(".hint")).map((h) => h.textContent);
    expect(hints).toContain("请求头 JSON 格式不正确");
  });

  it("选择器底部「＋ 添加自定义引擎」：展开新建表单（模板预填、高级区收起、默认 '{}'），保存后自动设为当前引擎", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.engine.provider = "aimao";
    await bootEngineTab(cfg);

    const addItem = qs<HTMLButtonElement>(".engine-select-add");
    expect(addItem.textContent).toBe("＋ 添加自定义引擎");
    addItem.click();
    await flush();

    // 伪选项不写入 provider
    expect(stored.engine.provider).toBe("aimao");
    const form = qs<HTMLElement>(".custom-engine-form");
    // 模板预填
    expect(qs<HTMLInputElement>('input[placeholder="引擎名称"]', form).value).toBe(
      "我的引擎",
    );
    const details = qs<HTMLDetailsElement>("details.engine-advanced", form);
    expect(details.open).toBe(false);
    expect(qs<HTMLTextAreaElement>("textarea", details).value).toBe("{}");

    // 填写名称 + Endpoint 后添加
    qs<HTMLInputElement>('input[placeholder="引擎名称"]', form).value = "测试引擎";
    qs<HTMLInputElement>(
      'input[placeholder="https://api.example.com/v1"]',
      form,
    ).value = "https://api.test.com/v1";
    btnByText("添加", form).click();
    await flush();

    expect(stored.engine.customEngines.length).toBe(1);
    const entry = stored.engine.customEngines[0];
    expect(entry).toMatchObject({
      name: "测试引擎",
      endpoint: "https://api.test.com/v1",
      headersJson: "{}",
    });
    // 保存后自动设为当前引擎，配置区联动为该引擎的编辑表单
    expect(stored.engine.provider).toBe(`custom:${entry.id}`);
    expect(qs<HTMLElement>(".custom-engine-form")).toBeTruthy();
    expect(btnByText("删除此引擎")).toBeTruthy();
  });

  it("新建表单可取消：取消后回到当前引擎配置，不产生新引擎", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.engine.provider = "aimao";
    await bootEngineTab(cfg);

    qs<HTMLButtonElement>(".engine-select-add").click();
    await flush();
    btnByText("取消", qs<HTMLElement>(".custom-engine-form")).click();
    await flush();

    expect(stored.engine.customEngines.length).toBe(0);
    expect(stored.engine.provider).toBe("aimao");
    expect(document.querySelector(".custom-engine-form")).toBeNull();
    expect(qs<HTMLElement>(".engine-config").textContent).toContain(
      "https://api.aimao.today/v1",
    );
  });

  it("「删除此引擎」：从表单内删除当前自定义引擎并回退到 AI猫", async () => {
    await bootEngineTab(cfgWithCustomEngine());

    btnByText("删除此引擎", qs<HTMLElement>(".custom-engine-form")).click();
    await flush();

    expect(stored.engine.customEngines.length).toBe(0);
    expect(stored.engine.provider).toBe("aimao");
    // 配置区联动回 AI猫
    expect(qs<HTMLElement>(".engine-config").textContent).toContain(
      "https://api.aimao.today/v1",
    );
  });

  it("免费引擎（google）配置区显示开箱即用提示", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.engine.provider = "google";
    await bootEngineTab(cfg);

    expect(qs<HTMLElement>(".engine-config").textContent).toContain(
      "该引擎开箱即用，无需配置。",
    );
  });

  it("测试连接按钮保留在统一卡片底部并回报结果", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.engine.provider = "aimao";
    await bootEngineTab(cfg);

    const engineCard = document.querySelectorAll(".content > .card")[0];
    btnByText("测试连接", engineCard).click();
    await flush();

    const result = qs<HTMLElement>(".hint", engineCard);
    expect(result.textContent).toContain("连接成功");
    expect(result.textContent).toContain("你好");
  });
});
