# TransVerse 译境 —《浏览器全能双语翻译插件功能验收清单》自检报告

> 对照 6 大标杆项目（KISS / FluentRead / Read Frog / Interline / OpenImmersive / MTranBrowser+MTranServer）逐项源码级核查。
> 标记：`[x]` 已闭环（附源码位置）｜`[~]` 部分实现（附缺失点）｜`[ ]` 未实现｜`[-]` 架构取舍（附替代方案）
> 代码基线：当前工作区（288 单测全绿 + 六阶段 e2e 全过的版本）。

## 模块 1：网页双语对照渲染、DOM 智能解析与规则引擎

### 1.1 智能 DOM 识别、富文本保留与动态加载
- [x] **智能正文识别与非正文过滤**：`src/content/dom.ts` — `SKIP_SELECTOR`（script/style/code/pre/nav 等）+ `inChromelessRegion()`（逐层向上查 nav/header/footer/role，遇 article/main 停止）+ `isVisible()` + `isMeaningfulText()`/`isIdentifierLike()`（core/text.ts）+ 语义块优先、覆盖不足叶子兜底（`findCandidates`）。
- [~] **行内富文本标签无损保留**：`extractText()` 仅对 `CODE/KBD/TT/SAMP/VAR` 做 `{{n}}` 占位符保留（render.ts `buildTranslationHtml` 还原为 `<code>`）；**`<a>`/`<strong>`/`<em>` 被扁平化为纯文本，超链接丢失**。缺：KISS 式 `<a1>` 行内标签占位协议。
- [x] **视口懒加载 + SPA 动态监听**：`src/content/page.ts` — IntersectionObserver（rootMargin 1000px）+ MutationObserver（childList+subtree+characterData，自忽略写入、120ms 合批重扫）。
- [ ] **Shadow DOM 与 iframe 穿透**：未实现（manifest `all_frames:false`，未处理 shadowRoot）。

### 1.2 显示模式切换与译文样式
- [~] **三态切换**：双语/仅译文双模式（render.ts `injectTranslation`，仅译文模式原文移入 `<template class="tv-backup">`）+ 恢复原文（PageTranslator.deactivate）。**缺：模式切换只对新注入生效，已注入段落不实时重绘**。
- [~] **10+ 样式与自定义 CSS**：12 种内置样式（core/styles.ts + content.css）。**缺：模糊遮罩模式（语言学习自测悬停清晰）与用户自定义 CSS**。

### 1.3 三级网站规则引擎与可视化选择器
- [~] **三级规则**：仅个人级站点名单（autoTranslateSites/neverTranslateSites/autoTranslateLangs，popup 可点选当前站）。**缺：社区订阅规则、按站点的选择器规则（指定翻译/排除/保留原文选择器）、三级覆盖链**。
- [ ] **可视化元素选择器（Visual Rule Editor）**：未实现（无 DOM 点选/层级调整/匹配计数/高亮预览/Undo-Redo 草稿）。

## 模块 2：全场景交互翻译

### 2.1 划词工具栏与对比窗
- [~] **智能划词工具栏**：`src/content/selection.ts` — 气泡含翻译/AI 解析/AI 写作/收藏/朗读/复制，防视口溢出定位（buildPopup 越界翻上方）。**缺：可拖拽、流式渲染**。
- [ ] **多服务横向对比窗口（Alt+D）**：未实现。

### 2.2 悬停、输入框与剪贴板
- [x] **悬停段落翻译**：`src/content/hover.ts` — Alt/Ctrl/Shift/纯悬停四模式，mouseover 节流 120ms，块级定位。
- [x] **输入框即时翻译**：`src/content/input.ts` — Alt+Enter / 三连空格；原生 value setter + input 事件回填（KISS 三级降级的第 3 级）。**注：缺第 1 级合成 paste 事件与第 2 级 execCommand，对 Draft.js/ProseMirror 类编辑器的兼容性弱于 KISS**（见重灾区 #9）。
- [ ] **剪贴板自动监听翻译**：未实现。

### 2.3 快捷键与外部事件 API
- [~] **快捷键**：Alt+T 切换整页（manifest command + content 双保险）、Alt+Enter/三连空格输入框。**缺：Alt+D 对比窗、Alt+S 划词、Alt+O 设置、Alt+K 浮窗、快捷键自定义**。
- [ ] **外部脚本 CustomEvent 控制接口**：未实现。

## 模块 3：AI 阅读辅助、语言学习闭环与 FSRS

### 3.1 AI 阅读辅助卡片
- [~] **上下文感知长难句剖析**：`aiAssist` 四动作（meaning/grammar/usage/practice，background/translate.ts）。**缺：prompt 未注入选中词的上下文段落**（contextAroundSelection 只用于生词收藏，未进 aiAssist）。
- [ ] **随堂练习多轮追问（Follow-up Chat）**：未实现（单轮请求-响应）。
- [~] **智能词汇高亮**：`src/content/highlight.ts` 高亮**已收藏生词**（mark.tv-hl + 悬停释义）。**缺：意外度热力图（按用户水平识别生僻词主动高亮）**。

### 3.2 自定义 AI 动作与权威词典
- [~] **自定义 AI 动作**：有 AI 专家（prompt 策略，core/experts.ts + options tabExperts）与 AI 写作 5 动作（background/aiWrite.ts）。**缺：Read Frog 式"结构化输出字段 + 挂载到划词工具栏"的用户自定义动作构建器**。
- [ ] **内置权威词典与离线备灾**：未实现（无词典数据，无断网降级查词）。

### 3.3 生词笔记库与 FSRS
- [~] **一键生词收藏带语境**：saveWord 存 word/context/translation（shared/store.ts addWord）。**缺：来源网页 URL 与发音字段**（WordItem 无 pageUrl）。
- [x] **FSRS 闪卡**：真算法（ts-fsrs 5.4.2），四档评分（Again/Hard/Good/Easy），复习页间隔预览（review/main.ts），e2e 验证 state 0→1、due 更新。**缺：自定义卡片正反面模板**。
- [ ] **MCP Server/Client 笔记库接口**：未实现。

### 3.4 TTS 朗读
- [~] **多语种 TTS**：划词气泡朗读用浏览器 speechSynthesis（语种自动跟随）。**缺：70+ 语言/300+ 音色、语速/音调/音量调节、按句切分与下一句预加载**（见重灾区 #11）。

## 模块 4：多模态翻译

### 4.1 流媒体双语字幕与 ASR
- [~] **多平台播放器双语字幕**：YouTube 完整实现（src/subtitles/：json3/XML 解析、30s 前瞻翻译、Shadow DOM 双语面板、SPA 切换）；会议字幕（Meet/Teams/Zoom，meetings.ts）。**缺：Netflix、X；字幕字号/颜色/位置自定义**。
- [x] **碎片字幕智能合并**：ytFetch.ts 滚动 ASR 重组（标点/长度/间隙规则断句，5 个冒烟测试）。**AI 语义断句未接**（留了接口）。
- [ ] **无字幕视频 AI 语音转写（ASR）**：未实现。
- [~] **字幕交互学习与视频总结**：SRT/VTT/ASS 文件翻译导出 ✓（files 页）。**缺：字幕悬停查词存闪卡、侧边双语字幕列表、AI 视频总结**。

### 4.2 深度文档翻译
- [~] **多格式覆盖**：TXT/MD/HTML/JSON/SRT/VTT/ASS/SSA/EPUB/DOCX/PDF 共 11 种扩展名（src/files/parsers/）。**缺：PPTX、XLSX**。
- [ ] **PDF 保留排版**：[-] 刻意取舍（MVP 路线，ARCHITECTURE 已注明）：pdfjs 提取 → 双语 HTML 导出，不保原版式；无 OCR、无公式/表格分阶段解析。
- [~] **EPUB 双语制书**：JSZip 解包→章节翻译→重打包（mimetype 第一条 STORE）✓。**缺：按章节阅读器 UI、单章即时翻译**。
- [ ] **译文在线校订（Post-Editing）**：未实现。

### 4.3 图片翻译与圈选 OCR
- [ ] **网页图片 OCR 翻译**：未实现。
- [ ] **区域框选 OCR**：未实现。

## 模块 5：翻译引擎调度、批量聚合、上下文与开放生态

### 5.1 全谱系引擎与按能力路由
- [x] **开箱即用免费引擎**：谷歌/微软/MyMemory 免费链 + 60s 冷却降级（translate.ts translateFreeChain），e2e 实测谷歌被墙时自动落 MyMemory。
- [~] **20+ 引擎**：8 个原生（google/bing/mymemory/deepl/openai 兼容/deepseek/libretranslate/custom JSON）。OpenAI 兼容实际可覆盖 OpenAI/DeepSeek/Ollama/硅基流动等任意兼容端点。**缺：Anthropic Claude 与 Gemini 原生协议、百度/腾讯/火山、Chrome 内置 AI**。
- [ ] **按任务能力独立绑定模型**：未实现（全局单引擎，无"网页翻译/查词/字幕断句/OCR/TTS 分别绑定"）。

### 5.2 批量聚合与容错
- [x] **请求批量聚合**：background/batch.ts BatchQueue（时间窗 + maxTexts/maxChars 双阈值 + 并发槽 + 按 key 复用）+ 编号 JSON 批协议 + id 对齐容错（engines/openaiCompat.ts）。
- [x] **失败自动拆解回退**：批失败逐条单发兜底（fallbackSingles）；免费链冷却降级。**注：单条请求级指数退避重试未做（只有链式降级与冷却）**。

### 5.3 上下文感知与术语风格
- [ ] **全页摘要上下文感知翻译**：未实现（prompt 不含页面标题/摘要）。
- [x] **术语表与风格模板**：双层术语（占位符保护 + prompt 注入，core/glossary.ts）+ 内置 6 领域术语库 343 条 + AI 智能提取（background/glossaryLibs.ts）+ AI 专家 5 预设（core/experts.ts）。

### 5.4 开放插件体系与本地 AI
- [~] **开放接口插件**：自定义 JSON 协议引擎（engines/custom.ts，{{text}}/{{from}}/{{to}} 模板 + 自定义头）。**缺：ZIP/仓库插件包导入、声明式规则、权限审批**。
- [ ] **浏览器端侧本地 AI（WebGPU/WASM）**：未实现。
- [~] **MTranServer 对接**：[-] 替代方案——custom 引擎可对接 MTranServer 的 `/kiss`、`/deepl` 兼容端点（其原生支持多协议网关），无专门适配层。

## 模块 6：隐私脱敏与工程体验

### 6.1 本地敏感信息脱敏
- [x] **发送前识别替换**：core/mask.ts 五类检测器（KEY/EMAIL/IDCARD/PHONE/CARD）+ Luhn/mod-11 校验 + 优先级抢占 + "宁可漏检不误伤"，28 例单测。
- [x] **译后精准还原**：占位符文本即 key 的容错正则还原（六容错形态），e2e 实测邮箱/电话在译文中完整还原。**缺：用户自定义正则补充规则**。
- [x] **LLM 保护句**：检测到 `__PII_` 时 system prompt 追加保护句（openaiCompat.ts）。

### 6.2 零遥测与多端同步
- [x] **零遥测直连**：无账号无追踪，密钥仅 chrome.storage.local，内容脚本不发 HTTP。
- [~] **多通道同步**：生词本 JSON 导入/导出 ✓（options 生词本页）。**缺：WebDAV/Cloudflare Worker/Google Drive 同步**。

### 6.3 设置界面信息架构与跨端
- [~] **设置中心**：10 标签清晰导航 + 每页说明文案（克服 KISS 混乱痛点）。**缺：全局配置搜索框、引擎连通性一键测试按钮**。
- [~] **按需加载与跨端**：[-] 部分取舍——pdfjs/cmaps 打包进 dist（4.8MB，未做动态懒加载）；仅 Chrome/Edge（MV3），无 Firefox/移动端/油猴版本。

## 四、 12 大重灾区逐项举证

| # | 重灾区 | 状态 | 证据 |
|---|---|---|---|
| 1 | PII 双向映射还原闭环 | ✅ 真实现 | core/mask.ts `maskSensitive`/`restoreSensitive`（占位符文本即 key + 容错正则 + serial 降序防误吞）；e2e Phase D 实测还原 |
| 2 | 批量聚合 + 失败拆解 | ✅ 真实现 | background/batch.ts `getBatchQueue`（双阈值截断 + fallbackSingles 逐条回退）；translate.test.ts 15 例覆盖 |
| 3 | 行内富文本标签保留 | ⚠️ 半实现 | 仅 code 类标签占位保留（dom.ts extractText）；**链接/加粗/斜体被扁平化**，缺 KISS `<a1>` 协议 |
| 4 | FSRS 真算法 | ✅ 真实现 | ts-fsrs 5.4.2（store.ts toFsrsCard/toWordCard，background/index.ts reviewGrade 用 fsrs.repeat） |
| 5 | 上下文阅读卡片多轮追问 | ❌ 未实现 | aiAssist 单轮、无上下文注入、无对话状态 |
| 6 | 可视化规则选择器 | ❌ 未实现 | 无相关代码 |
| 7 | 三平台字幕 + 碎片合并 + 悬停查词 | ⚠️ 部分 | YouTube ✓（ASR 规则合并）；Netflix/X ✗；字幕悬停查词 ✗ |
| 8 | think 标签剥离 + 流式防抖 | ❌ 未实现 | openaiCompat.ts 无 think 处理、无流式（stream:false） |
| 9 | 输入框富文本兼容 | ⚠️ 部分 | input.ts 仅原生 setter + input 事件（KISS 第 3 级），缺 paste 事件与 execCommand 两级 |
| 10 | PDF/EPUB 真排版 | ⚠️ 部分 | EPUB 重打包 ✓；PDF 为文本提取→双语 HTML（不保排版，刻意取舍已注明） |
| 11 | TTS 按句切分预加载 | ❌ 未实现 | selection.ts 一次性 speechSynthesis.speak |
| 12 | 缓存与模式切换免重复请求 | ✅ 真实现 | background/cache.ts（LRU 500 + storage 持久 + promptSig 失效）；切换显示模式不重发请求（缓存命中） |

## 五、 缺失与半成品功能补全优先级路线图

### P0（核心体验短板，建议最先补）
1. **行内富文本标签保留**（重灾区 #3）：实现 KISS 式 `<a1>` 行内标签占位协议，保住链接/加粗/斜体
2. **think 标签剥离**（重灾区 #8）：openaiCompat 响应解析加 `<think>...</think>` 剥离（一行正则 + 测试）
3. **AI 阅读卡片上下文注入 + 多轮追问**（重灾区 #5）：aiAssist 带上下文段落；卡片加追问输入框（对话历史数组）
4. **输入框三级回填**（重灾区 #9）：补 paste 事件 → execCommand → 原生 setter 三级降级
5. **引擎连通性测试按钮**（模块 6.3）：options 引擎页加"测试连接"（发一次短文本翻译）
6. **生词收藏补来源 URL**（模块 3.3）：WordItem 加 pageUrl/pageTitle

### P1（重要能力扩展）
7. **Netflix/X 字幕**（重灾区 #7）+ 字幕悬停查词存闪卡 + 侧边字幕列表
8. **模糊遮罩译文样式 + 自定义 CSS**（模块 1.2）
9. **多服务对比窗口 Alt+D**（模块 2.1）+ 快捷键全套自定义（模块 2.3）
10. **Claude/Gemini 原生协议引擎**（模块 5.1）
11. **TTS 按句切分 + 预加载 + 语速控制**（重灾区 #11）
12. **PPTX/XLSX 文档格式**（模块 4.2）+ 文档译文在线校订
13. **全页摘要上下文感知翻译**（模块 5.3）
14. **WebDAV 同步**（模块 6.2）
15. **剪贴板监听翻译**（模块 2.2）

### P2（生态与重型能力）
16. **可视化规则选择器**（重灾区 #6）+ 三级规则引擎与社区订阅（模块 1.3）
17. **图片 OCR 翻译 + 区域圈选 OCR**（模块 4.3）
18. **无字幕视频 ASR 转写**（模块 4.1）
19. **PDF 保留排版**（模块 4.2，OpenImmersive 路线）
20. **自定义 AI 动作构建器（结构化输出字段）**（模块 3.2）
21. **开放插件包体系（ZIP 导入 + 权限审批）**（模块 5.4）
22. **本地边缘 AI（WebGPU/WASM 模型中心）**（模块 5.4）
23. **MCP 笔记库接口**（模块 3.3）
24. **Firefox/移动端适配 + 油猴版本 + 按需加载瘦身**（模块 6.3）
