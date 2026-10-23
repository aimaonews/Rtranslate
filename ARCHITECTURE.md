# TransVerse 译境 — 架构契约（v1）

> 综合 KISS Translator / FluentRead / Read Frog / Interline / OpenImmersive / MTranBrowser 六家之长，
> 重构的开源双语翻译浏览器扩展。本文档是**开发契约**：所有模块必须遵守本文定义的目录、接口、消息协议与命名。

## 1. 产品定位与功能合成

| 来源 | 吸收的能力 |
|---|---|
| KISS Translator | 占位符富文本序列化、BatchQueue 聚合翻译（编号 JSON 批协议）、划词/悬停/输入框翻译 |
| FluentRead | 分层架构（core 纯逻辑零浏览器依赖）、AI 阅读辅助（meaning/grammar/usage/practice 四动作） |
| Read Frog | 生词本 + 端内 FSRS 闪卡复习（ts-fsrs）、生词高亮 |
| Interline | 免 Key 开箱即用、~10 种译文样式、缓存 key 含 prompt/glossary 自动失效 |
| OpenImmersive | 本地敏感信息脱敏（`__PII_*__` 占位符 + 容错还原）、免费引擎链 + 冷却降级 |
| MTranBrowser | IntersectionObserver 可见才译、计算样式逐项复制、悬停快捷键精确集合匹配、悬浮球 |

**隐私立场**：无账号、无遥测、无中间服务器；所有 HTTP 只在 background 发；脱敏开关默认关、可开。

## 2. 技术选型

- Manifest V3，Chrome 优先（Firefox 后续适配）。
- 构建：Vite 7 + TypeScript（严格模式）。内容脚本构建为单文件 IIFE（无 import）；background 为 ES module SW；页面为 ES module。
- 依赖：`ts-fsrs`（FSRS 调度，唯一运行时依赖）。测试：vitest。
- UI：原生 TS + 手写 CSS（无框架，popup/options/review 三个页面）。

## 3. 目录结构与模块边界

```
src/
  core/                    # 纯逻辑：零浏览器 API，可 node 单测
    text.ts                # 文本工具
    detect.ts              # 语种/文字系统检测
    mask.ts                # 敏感信息脱敏+还原
    glossary.ts            # 术语表占位符注入/还原 + prompt 块
    styles.ts              # 译文样式定义（id/名称/模式）
    langs.ts               # 语言表（code↔名称，LLM prompt 用全名）
    types.ts               # core 共享类型
  shared/                  # 浏览器环境共享
    config.ts              # Config 类型 + DEFAULT_CONFIG + normalizeConfig
    protocol.ts            # 全部消息协议类型
    store.ts               # chrome.storage 封装：config CRUD + watch、wordbook CRUD、cache
    ids.ts                 # genId()
  background/
    index.ts               # 入口：消息总线、commands、contextMenus
    translate.ts           # translate() 唯一入口管线（见 §6）
    batch.ts               # LLM 聚合翻译队列（BatchQueue）
    cache.ts               # 翻译缓存（内存 LRU + storage 持久）
    engines/
      types.ts             # Engine 接口 + EngineContext
      google.ts            # Google gtx 免费端点
      bing.ts              # Edge 免费 JWT 端点
      mymemory.ts          # MyMemory 免费
      deepl.ts             # DeepL 官方 API（BYOK）
      libre.ts             # LibreTranslate（可自托管）
      openaiCompat.ts      # OpenAI 兼容（OpenAI/DeepSeek/任何兼容端点，含自定义）
      custom.ts            # 自定义 JSON 协议
      index.ts             # 注册表 + resolveEngine + 免费链顺序
  content/                 # 全部 IIFE 单文件打包，内容脚本
    index.ts               # 引导：消息监听、快捷键、悬浮球、配置热同步
    dom.ts                 # 候选发现/过滤/文本抽取（占位符序列化）
    render.ts              # 译文注入/样式/撤销
    page.ts                # PageTranslator：扫描/IO/并发队列/MutationObserver/开关
    lang.ts                # 块级"已是目标语言"跳过判定
    selection.ts           # 划词气泡（翻译/AI解析/收藏生词/朗读/复制）
    hover.ts               # 悬停翻译（修饰键精确集合匹配）
    input.ts               # 输入框翻译（Alt+Enter / 三连空格，三级回填）
    floatingBall.ts        # 悬浮球
    highlight.ts           # 已收藏生词页面高亮
    content.css(→public/)  # 所有注入样式，类前缀 tv-
  popup/  options/  review/  # 三个页面：index.html + main.ts + style.css
public/
  manifest.json  icons/  content.css
tests/                     # vitest，core/background 单测
```

红线：
- `core/` 不 import 任何 `chrome.*`/`browser.*`。
- content 脚本**不直接发 HTTP**，一切翻译走 background 消息。
- background 不碰 DOM。
- 扩展自身 UI/译文节点一律带 `data-tv-owned` + `translate="no"`，DOM 过滤必须排除。

## 4. 命名与 DOM 标记约定

- 译文 wrapper 自定义元素：`<tv-translation>`，class `tv-tr`；原文备份 `<template class="tv-backup">`。
- 属性：`data-tv-paragraph`（候选单元）、`data-tv-translated="1"`（已译）、`data-tv-id`（撤销用 id）、`data-tv-owned="1"`（扩展 UI）、`data-tv-loading`、`data-tv-error`。
- 占位符：`{{n}}`（块内行内元素占位，n 从 1 递增）、`__GLOSSARY_N__`（术语）、`__PII_<TYPE>_<N>__`（敏感信息）。
- CSS 类前缀 `tv-`，颜色等用 CSS 变量 `--tv-*` 便于换肤。
- 存储键：`tv:config_v1`、`tv:words_v1`、`tv:cache_v1`。

## 5. Config 契约（shared/config.ts）

```ts
export interface Config {
  version: 1;
  general: {
    targetLang: string;            // 默认 'zh-CN'
    sourceLang: string;            // 'auto'
    displayMode: 'bilingual' | 'translationOnly';
    autoTranslateSites: string[];  // 域名名单
    autoTranslateLangs: string[];  // 总是翻译的语言
    neverTranslateSites: string[];
  };
  engine: {
    provider: 'google' | 'bing' | 'mymemory' | 'deepl' | 'openai' | 'libretranslate' | 'custom';
    keys: { deepl: string; openai: string; libreUrl: string; customHeadersJson: string };
    openai: { endpoint: string; model: string };   // endpoint 默认 https://api.openai.com/v1
    deepseek: { endpoint: string; model: string }; // 走 openaiCompat，endpoint https://api.deepseek.com/v1
    custom: { url: string; bodyJson: string };     // 自定义 JSON 协议 {text,from,to}
    timeoutMs: number;             // 默认 20000
  };
  batch: {                         // LLM 聚合翻译
    enabled: boolean;              // 默认 true
    maxTexts: number;              // 默认 8
    maxChars: number;              // 默认 1200
    intervalMs: number;            // 默认 120
    concurrency: number;           // 默认 3
  };
  style: { styleId: string };      // 默认 'soft-gray'
  selection: { enabled: boolean; mode: 'bilingual' | 'translationOnly'; maxChars: number };
  hover: { enabled: boolean; key: 'alt' | 'ctrl' | 'shift' | 'none' };   // none=直接悬停
  input: { enabled: boolean; trigger: 'altEnter' | 'tripleSpace'; targetLang: string };
  mask: { enabled: boolean };      // 敏感信息脱敏，默认 false
  glossary: Array<{ src: string; dst: string }>;
  learning: { enabled: boolean; highlightOnPage: boolean };
  floatingBall: { enabled: boolean };
  stats: { translatedChars: number };
}
export const DEFAULT_CONFIG: Config = { /* 按上述默认值 */ };
export function normalizeConfig(raw: unknown): Config;  // 白名单逐 key 拷贝，脏 key 丢弃、新 key 补默认
```

## 6. 消息协议（shared/protocol.ts）

content/popup → background（chrome.runtime.sendMessage，异步必须 return true）：

```ts
export type BgRequest =
  | { kind: 'translate'; text: string; targetLang: string; sourceLang?: string }
  | { kind: 'translateBatch'; texts: string[]; targetLang: string; sourceLang?: string }
  | { kind: 'detectLang'; text: string }
  | { kind: 'aiAssist'; action: 'meaning' | 'grammar' | 'usage' | 'practice'; text: string; targetLang: string }
  | { kind: 'getConfig' } | { kind: 'setConfig'; patch: Partial<Config> }
  | { kind: 'saveWord'; word: string; context?: string; translation?: string }
  | { kind: 'deleteWord'; id: string }
  | { kind: 'getWords' }
  | { kind: 'reviewGrade'; wordId: string; rating: 1 | 2 | 3 | 4 }   // again/hard/good/easy
  | { kind: 'getStats' }          // { dueCount, totalWords, translatedChars }
  | { kind: 'command'; cmd: 'togglePage' | 'openOptions' | 'openReview' };
export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
```

background/popup → content（tabs.sendMessage / runtime.onMessage）：

```ts
export type ContentRequest =
  | { kind: 'togglePage' }
  | { kind: 'pageState' }                      // content 回 { active, translatedCount }
  | { kind: 'configChanged'; config: Config }; // 热同步
```

**translate 失败用 `{ok:false,error}` resolve 返回，绝不 reject**（调用方靠它区分"同文"与"真失败"）。

## 7. 翻译管线（background/translate.ts）

```
translate(text, targetLang, sourceLang):
  1. cache.get(key) 命中 → return {text:cached, detectedLang}
  2. mask.enabled → maskSensitive(text) 得 masked + entities
  3. glossary 非空 → 注入 __GLOSSARY_N__（同时对 LLM 追加 glossary prompt 块）
  4. 引擎路由：BYOK 引擎按 config.engine.provider；免费引擎失败链 [google→bing→mymemory]，单个失败
     冷却 60s 沉底重试下一个；BYOK 不进链（配置错误不该被静默掩盖）
  5. LLM 引擎且 batch.enabled 且 supportsBatch → 走 BatchQueue（编号 JSON 协议：system 要求输出
     {"translations":[{"id":1,"text":"..."}]}，解析后按 id 对齐，缺条回退单发）
  6. restore glossary → restore PII（容错正则，占位符文本即 key）
  7. 写缓存（key 含 provider/langpair/textHash/promptSig/glossarySig），stats.translatedChars += len
```

LLM system prompt 四要素：translator 角色、目标语言**全名**（langs.ts NAME 表）、只输出译文、
检测到 `__PII_` 时追加占位符保护句。temperature 0.1。

## 8. 内容脚本管线（content/）

```
PageTranslator:
  scan(root) → 候选单元（TreeWalker，acceptNode 过滤；直接块标签集 h1-h6/p/li/dd/td/th/blockquote/figcaption；
  行内 run 聚合成组）；跳过：skipTags(script/style/code/pre/svg/math/nav/header/footer 首次除外/form 控件/
  .notranslate/.sr-only/[data-tv-owned]/扩展自身/视觉隐藏/纯数字/标识符 URL 邮箱/超长短文本)
  → IntersectionObserver(rootMargin 1000px) 可见才译，离屏入队
  → 并发队列（默认 4 worker，45s 超时，失败插 .tv-error 可点击重试）
  → 单块流程：extractText（占位符序列化 {{n}} 保行内结构）→ 已是目标语言跳过（lang.ts 文字占比启发）
     → sendMessage translate → sameText 归一化比对防双份 → injectTranslation
  → MutationObserver(childList+subtree+characterData) 自忽略写入、idle 100ms 合批重扫新增节点
```

注入（render.ts）：
- bilingual：`<tv-translation class="tv-tr tv-tr-block|inline">`，计算样式复制（fontFamily/fontSize/
  fontWeight/fontStyle/lineHeight/letterSpacing/textAlign/color + `unicode-bidi:plaintext`），
  短文本（≤12 字符）行内、长文本块级；父容器 grid/flex/table 时插元素**内部**。
- translationOnly：原文移入 wrapper 内 `<template class="tv-backup">`，译文置前。
- 样式：styles.ts 定义的 styleId → CSS 类（content.css），跟随 config.style.styleId。
- 撤销：按 data-tv-* 标记完全逆操作，DOM 还原。

## 9. 生词本与 FSRS（shared/store.ts + review 页）

```ts
export interface WordItem {
  id: string; word: string; context?: string; translation?: string;
  sourceLang?: string; targetLang?: string; note?: string; createdAt: number;
  card: { due: number; stability: number; difficulty: number; elapsed_days: number;
          scheduled_days: number; reps: number; lapses: number; state: number; last_review?: number };
  seenCount: number;
}
```
- 保存入口：划词气泡"收藏"按钮；存 context（所在句）与 translation。
- 调度：ts-fsrs `createEmptyCard` 初始；复习评分 `fsrs.repeat(card, now)[rating].card`。
- review 页：到期卡队列（due<=now 或 state==0 新卡），四键评分，显示下一间隔预览。
- 生词高亮（content/highlight.ts）：开启后扫描文本节点匹配词表，包 `<mark class="tv-hl">`，悬停弹释义。

## 10. 构建

- `vite.config.ts`：多入口 background/popup/options/review，format es，chunks 共享；`public/` 拷贝 manifest+icons+content.css。
- `vite.content.config.ts`：lib 模式 IIFE 单文件 `dist/content.js`（`build.lib.cssFileName:'content'` 不依赖，css 走 public 静态文件）。
- `npm run build` = 两步串联；`npm run test` = vitest run；`npm run typecheck` = tsc --noEmit。

## 11. 测试策略

- vitest 单测：core/text、core/mask（OpenImmersive 17 例移植+新增）、core/glossary、core/detect、
  background/engines（注入 fetch mock）、batch 对齐、fsrs 调度、normalizeConfig。
- 浏览器实测：control-browser 加载 dist/，在本地测试页 + 英文站点验证整页翻译/划词/悬停/输入框/脱敏/闪卡。
