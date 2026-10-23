# 商店上架素材包 / Store Listing Pack

> 使用前：把 PRIVACY.md 部署到一个公开可访问的 URL（如 GitHub Pages），
> 替换下文中的 `https://YOUR-DOMAIN/transverse/privacy` 占位符。

## 基础信息

| 字段 | 值 |
|---|---|
| 名称 | Rtranslate - 开源双语翻译 |
| 副标题/短描述（≤132 字符） | 开源双语对照翻译：多引擎、本地脱敏、生词闪卡。无账号、无遥测。 |
| 分类 | 工具 / 效率（Productivity） |
| 语言 | 简体中文（默认）、English |
| 搜索关键词（≤7 个） | 翻译, 双语翻译, 网页翻译, 划词翻译, 翻译插件, 生词本, 沉浸式翻译开源替代 |
| 官网/支持 | https://www.aimao.today |
| 隐私政策 URL | https://YOUR-DOMAIN/transverse/privacy（部署 PRIVACY.md 后替换） |
| 年龄分级 | 非成人内容（无 13+ 限制项） |

## 详细描述（中文）

Rtranslate是一款完全开源（GPL-3.0）的浏览器双语翻译扩展，综合了多个优秀开源翻译项目的最佳实践。无账号、无遥测、无中间服务器。

**核心功能**

- 整页双语对照翻译：原文对照译文，滚动到可见区域才翻译，支持 12 种译文样式（柔和灰/高亮/卡片/引用/渐变/毛玻璃等）
- 多翻译引擎：谷歌/微软/MyMemory 免费引擎开箱即用（失败自动切换），也支持 DeepL、OpenAI 兼容接口（OpenAI/DeepSeek/任意兼容端点）、LibreTranslate（可自托管）与自定义接口
- 聚合翻译：AI 引擎自动合并多段文本一次请求，更快更省额度
- 隐私保护：可开启本地敏感信息脱敏——邮箱/电话/银行卡/身份证/API Key 在发送前本地打码，译文返回后还原，敏感原文永不出浏览器
- 划词翻译、悬停翻译、输入框翻译（Alt+Enter）
- AI 阅读辅助：释义、句型分析、用法讲解、练习生成
- 生词本 + FSRS 闪卡复习：收藏生词，按记忆曲线四键评分复习
- 术语表：自定义术语保证译法一致
- 悬浮球、Alt+T 快捷键、右键菜单

**隐私**

- 不收集浏览历史、无追踪、无广告
- 网页文本仅在你主动翻译时发送到你选择的翻译服务商
- 卸载即清除全部本地数据

详见隐私政策：https://YOUR-DOMAIN/transverse/privacy

## Detailed Description (English)

Rtranslate is a fully open-source (GPL-3.0) bilingual webpage translation extension, synthesizing the best practices of several excellent open-source translation projects. No account, no telemetry, no middle servers.

**Key features**

- Bilingual page translation with 12 display styles (soft gray, highlight, card, quote, gradient, frosted glass…)
- Multiple engines: Google/Microsoft/MyMemory free engines with automatic failover; DeepL, OpenAI-compatible endpoints (OpenAI/DeepSeek/any compatible endpoint), self-hostable LibreTranslate, and custom JSON endpoints
- Batched translation for AI engines (fewer requests, lower cost)
- Local sensitive-data masking (optional): emails, phones, bank cards, ID numbers and API keys are masked locally before translation and restored afterwards — sensitive text never leaves your browser
- Selection translation, hover translation, input-box translation (Alt+Enter)
- AI reading assistance: meaning, grammar analysis, usage, practice
- Wordbook with FSRS flashcard review
- Glossary for consistent terminology
- Floating ball, Alt+T shortcut, context menu

**Privacy**

- No browsing-history collection, no tracking, no ads
- Page text is sent to the translation provider you choose only when you request translation
- Uninstalling removes all local data

Privacy policy: https://YOUR-DOMAIN/transverse/privacy

## 截图清单（建议 3-5 张，1280x800 或 1920x1080）

1. 整页双语对照效果（已有 `scripts/e2e/screenshot-translated.png`，建议重截高清版）
2. 划词翻译气泡 + AI 解析
3. 设置页-翻译引擎配置（含 BYOK 与自托管说明）
4. 闪卡复习页
5. 12 种译文样式预览

## 审核测试说明（Notes for certification，Edge Partner Center 用）

- 默认使用谷歌免费引擎，无需登录即可测试全部翻译功能：打开任意英文网页 → 点击悬浮球或按 Alt+T
- 划词翻译：选中任意段落后弹出气泡自动翻译
- 输入框翻译：在任意输入框按 Alt+Enter（默认中→英）
- 脱敏测试：设置 → 隐私 → 开启敏感信息脱敏 → 翻译含邮箱的页面，邮箱在译文中保持原样
- 生词本/闪卡：划词气泡点"☆ 收藏"，popup 点"开始复习"
- BYOK 引擎（DeepL/OpenAI 兼容）为可选项，需审核员自有密钥方可测试；免费引擎不依赖任何账号
