# Rtranslate · 开源双语翻译扩展

综合六个优秀开源翻译扩展之长重构而成的 Manifest V3 浏览器扩展。**无账号、无遥测、无中间服务器**。

| 来源项目 | 吸收的能力 |
|---|---|
| KISS Translator | 占位符富文本序列化（`{{n}}` 保留行内结构）、LLM 聚合翻译（编号 JSON 批协议）、划词/悬停/输入框翻译 |
| FluentRead 流畅阅读 | 分层架构（core 纯逻辑零浏览器依赖）、AI 阅读辅助（释义/句型/用法/练习四动作） |
| Read Frog 陪读蛙 | 生词本 + 端内 FSRS 闪卡复习（ts-fsrs）、生词页面高亮 |
| Interline 行间 | 免 Key 开箱即用、12 种译文样式、缓存 key 含术语表签名自动失效 |
| OpenImmersive Translator | 本地敏感信息脱敏（`__PII_*__` 占位符 + 容错还原）、免费引擎链 + 60s 冷却降级 |
| MTranBrowser | IntersectionObserver 可见才译、计算样式逐项复制（译文版式=原文）、悬停快捷键、悬浮球 |

## 功能

- **整页双语对照翻译**：原文对照译文，滚动到可见区域才翻译，支持 12 种译文样式（柔和灰/高亮/卡片/引用/渐变/毛玻璃等）
- **文档翻译**（10 种格式）：PDF、ePub、DOCX、HTML、JSON、TXT、Markdown、SRT、VTT、ASS；拖拽上传，双语对照或仅译文导出
- **视频与会议字幕**：YouTube 双语字幕（json3/XML 解析、ASR 断句、30s 前瞻翻译）；Google Meet / Teams / Zoom 会议实时字幕翻译面板
- **多引擎**：谷歌/微软/MyMemory 免费引擎（失败自动链式降级）、DeepL、OpenAI 兼容（OpenAI/DeepSeek/任何兼容端点）、LibreTranslate（可自托管）、自定义 JSON 协议
- **AI 专家**：自定义 Prompt 翻译策略，内置通用/技术文档/文学/学术/社交媒体 5 预设（仅 AI 引擎生效）
- **AI 术语库**：内置编程/Web3/推特/AO3/教育/游戏 6 大领域术语库（来自 immersive-translate/terms）+ 自定义库 + AI 智能提取术语（仅 AI 引擎生效）
- **AI 写作**：划词气泡内润色/续写/总结/回复/翻译，语气与篇幅可调
- **聚合翻译**：AI 引擎自动合并多段文本一次请求，更快更省额度
- **隐私保护**：可开启本地敏感信息脱敏——邮箱/电话/银行卡/身份证/API Key 在发送前本地打码，译文返回后还原
- **划词翻译、悬停翻译、输入框翻译**（Alt+Enter 或三连空格）
- **AI 阅读辅助**：释义、句型分析、用法讲解、练习生成
- **生词本 + FSRS 闪卡复习**：收藏生词，按记忆曲线四键评分复习
- **术语表**：自定义术语保证译法一致
- **悬浮球、Alt+T 快捷键、右键菜单**

## 安装（开发者模式）

```bash
npm install
npm run build        # 产出 dist/
```

Edge/Chrome → `edge://extensions` / `chrome://extensions` → 打开「开发人员模式」→ 「加载解压缩的扩展」→ 选择 `dist/` 目录。

## 开发

```bash
npm run test         # vitest（core 纯逻辑 + 引擎 mock + 翻译管线，231 例）
npm run typecheck    # tsc --noEmit
npm run build        # 双 vite 构建（页面/background + 内容脚本 IIFE）
```

端到端测试（需要 Edge）：

```bash
node scripts/e2e/serve.mjs 8137 &                 # 静态测试页
# 以 --enable-unsafe-extensions-debugging 启动浏览器后：
node scripts/e2e/load-unpacked.mjs <dist 绝对路径>
node scripts/e2e/drive.mjs                        # 六阶段：整页/划词/输入框/脱敏还原/生词本FSRS/复习页
```

## 架构

见 [ARCHITECTURE.md](./ARCHITECTURE.md)。要点：

- `src/core/` 纯逻辑（mask/glossary/text/detect/langs/styles），零浏览器 API，全部单测覆盖
- `src/background/` 唯一翻译入口管线：缓存 → 脱敏 → 术语 → 引擎路由（免费链/BYOK）→ 聚合 → 逆序还原 → 回写
- `src/content/` 内容脚本（IIFE 单文件）：DOM 候选发现 → 占位符序列化 → 可见即译 → 样式继承注入
- 消息协议见 `src/shared/protocol.ts`，配置单一对象 + 读时归一化（`normalizeConfig`）

## 隐私

- 所有 HTTP 仅在 background 发起；内容脚本不直接请求网络
- 无账号体系、无任何上报
- API Key 仅存 `chrome.storage.local`
- 脱敏开启时敏感信息不出本机
- 完整隐私政策见 [PRIVACY.md](./PRIVACY.md)

## 商店上架（Chrome Web Store / Edge Add-ons）

已按两个商店 2026 年政策完成合规整改：

- **权限最小化**：`permissions` 仅 `storage` + `contextMenus`；`host_permissions` 只列翻译引擎域名；
  自定义/自托管端点走 `optional_host_permissions`，在设置页保存时按需申请
- **无远程代码**：全部逻辑在包内；无 `eval`
- **可读代码**：`npm run build:store` 产出未压缩的送审包（Edge 1.1.7 禁混淆）
- **隐私政策**：[PRIVACY.md](./PRIVACY.md)（部署到公开 URL 后填入商店后台）
- **上架素材**：[store-assets/listing.md](./store-assets/listing.md)（名称/描述/关键词/截图清单/审核测试说明）

## 路线图中未实现

- YouTube Shorts、Netflix 字幕（YouTube /watch 已实现）
- PDF 版式保留导出（当前导出双语 HTML）、扫描件 OCR
- 图片翻译
- Firefox 适配（manifest 差异极小，见参考项目做法）
- 同步（WebDAV/Gist）

## 许可

GPL-3.0（与 KISS Translator / FluentRead / Read Frog 保持一致）。
参考项目代码仅作学习分析，未直接复制（`reference/` 目录为浅克隆的分析对象，不属于本扩展源码）。
