# Rtranslate — Chrome Web Store 全要素完备度与合规审查报告

> 生成日期：2026-10-24 · 版本 v0.0.1 · 依据《浏览器扩展制作与 Chrome 应用商店上架全要素通用总规范》逐项实测。

## 1. ZIP 包与自动化打包脚本核查

| 检查项 | 结果 |
|---|---|
| 打包脚本 | `npm run zip`（build + `scripts/zip-dist.mjs`，JSZip 仅打包 `dist/` 内容）✅ |
| manifest.json 位置 | 压缩包根目录（脚本内置校验，缺失即报错退出）✅ |
| 产出 | `release/rtranslate-0.0.1.zip`（271 个文件）✅ |
| 纯净度 | 无 node_modules/ .git/ *.map/ *.ts 源码/ .DS_Store ✅ |
| JSON 合法性 | manifest.json 与全部 messages.json 由 JSON 解析器生成/校验，零注释零尾逗号 ✅ |

## 2. 多语言（i18n）全语种核查表（9 种，键集合全对齐 = 各 7 键）

| locale | extName 字符（≤45） | extShortName（≤12） | extDescription 字符（≤132） | 键数 |
|---|---|---|---|---|
| de | 38 ✅ | 10 ✅ | 116 ✅ | 7 |
| en | 34 ✅ | 10 ✅ | 121 ✅ | 7 |
| es | 32 ✅ | 10 ✅ | 126 ✅ | 7 |
| fr | 44 ✅ | 10 ✅ | 127 ✅ | 7 |
| ja | 28 ✅ | 10 ✅ | 60 ✅ | 7 |
| ko | 25 ✅ | 10 ✅ | 61 ✅ | 7 |
| pt_BR | 30 ✅ | 10 ✅ | 123 ✅ | 7 |
| zh_CN | 21 ✅ | 10 ✅ | 31 ✅ | 7 |
| zh_TW | 21 ✅ | 10 ✅ | 31 ✅ | 7 |

商店文案：`docs/store-listing/` 9 份（与 _locales 1:1），纯文本 Emoji 排版，无 Markdown 符号，Title/Summary 与 messages.json 逐字一致。

## 3. 包内图标与商店视觉素材实测表（sharp 实测）

| 素材 | 实测尺寸 | 格式/通道 | 结论 |
|---|---|---|---|
| icons/icon16.png | 16×16 | PNG RGBA | ✅ 包内 |
| icons/icon32.png | 32×32 | PNG RGBA | ✅ 包内（本轮补齐） |
| icons/icon48.png | 48×48 | PNG RGBA | ✅ 包内 |
| icons/icon128.png | 128×128 | PNG RGBA | ✅ 包内 + 商店图标复用 |
| screenshots/screenshot-1..5-*.png | 1280×800 ×5 | PNG 3 通道无透明 | ✅ 商店截图 |
| promo/promo-tile-440x280.png | 440×280 | PNG 3 通道无透明 | ✅ 小型宣传图（必填） |
| promo/promo-marquee-1400x560.png | 1400×560 | PNG 3 通道无透明 | ✅ 大型横幅（选填） |

## 4. 代码安全与政策红线扫描结果

| 红线（官方代号） | 结果 |
|---|---|
| 远程托管代码（Blue Argon） | ✅ 无 `<script src=http>`、无 eval/new Function；翻译 API 仅 fetch JSON 数据（不属远程代码） |
| 代码混淆（Red Titanium） | ✅ Vite 常规压缩（允许）；`npm run build:store` 可产未压缩送审包 |
| 过度申请权限（Purple Potassium） | ✅ permissions 仅 storage + contextMenus，全部有调用点；host_permissions 仅引擎域名 + optional 按需 |
| 违反单一用途（Red Magnesium） | ✅ 全部功能围绕"网页双语翻译与阅读学习"单一用途 |
| 功能报错/外链壳子（Yellow Magnesium） | ✅ 免费链冷却降级 + 错误 UI 提示；核心功能扩展内闭环 |
| 不安全数据传输（Purple Copper） | ✅ 引擎端点全 HTTPS；自托管端点为用户显式选择 |
| 违禁产品/隐蔽推广（Blue Zinc） | ✅ 无付费墙绕过、无 DRM 破解、无联盟链接 |

## 5. 遗留事项（开发者侧，非代码）

1. Chrome 开发者账号：$5 注册、邮箱验证、EEA 选 Non-trader
2. Official URL 徽章：需在 Google Search Console 验证 aimao.today 所有权后下拉选中
3. 提交后审核周期：含 host_permissions，预期 1-4 个工作日
