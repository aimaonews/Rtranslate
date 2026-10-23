# Chrome 开发者后台全字段复制粘贴单（Rtranslate）

> 按后台四大标签页（Package / Store Listing / Privacy Practices / Distribution & Account）逐项准备，直接复制粘贴即可。

## 一、Package（上传包）

- 上传文件：`release/rtranslate-0.1.0.zip`（由 `npm run zip` 生成，manifest.json 位于压缩包根目录）
- 版本号递增规则：每次上传递增 `manifest.json` 的 `version`（当前 0.1.0）

## 二、Store Listing（商品详情）

| 字段 | 值 |
|---|---|
| Primary Category | Productivity（或 Education，二选一，推荐 Productivity） |
| 语言分支 | 9 个（与 `_locales/` 对齐）：en / de / es / fr / pt_BR / ja / zh_CN / zh_TW / ko |
| 各语言 Title / Summary / Detailed description | 见 `docs/store-listing/<locale>.md`，逐份复制 |
| 商店图标 | `store-assets/` 外用 `public/icons/icon128.png`（128×128 PNG 带透明） |
| 截图（1-5 张，1280×800） | `store-assets/screenshots/screenshot-1..5-*.png`（24 位 RGB 无透明通道） |
| 小型宣传图块（440×280，全球共用） | `store-assets/promo/promo-tile-440x280.png` |
| 大型横幅图（1400×560，选填） | `store-assets/promo/promo-marquee-1400x560.png` |
| Official URL | https://www.aimao.today（需先在 Google Search Console 用同一 Google 账号验证该域名所有权后，才能在下拉框选中显示蓝勾徽章） |
| Homepage URL | https://github.com/aimaonews/Rtranslate |
| Support URL | https://github.com/aimaonews/Rtranslate/issues |
| 成人内容 | 无（No mature content） |

### 截图上传顺序建议

1. screenshot-1-bilingual.png（整页双语翻译）
2. screenshot-2-selection.png（划词气泡）
3. screenshot-3-engines.png（引擎设置）
4. screenshot-4-flashcards.png（闪卡复习）
5. screenshot-5-documents.png（文档翻译）

## 三、Privacy Practices（隐私实践）

### Single purpose description

> Rtranslate is a bilingual webpage translation extension. It translates web pages, selections, inputs, documents, and video/meeting subtitles into the user's chosen language, and helps language learning with a built-in wordbook and FSRS flashcards.
>
> Rtranslate 是一款双语网页翻译扩展：将网页、划词、输入框、文档与视频/会议字幕翻译为用户选择的语言，并内置生词本与 FSRS 闪卡辅助语言学习。

### Permission justifications（逐项申请理由）

| 权限 | 英文理由（复制用） |
|---|---|
| `storage` | Used to save and persist user preferences, engine configurations, glossary, wordbook and flashcard state locally in chrome.storage without uploading to external servers. |
| `contextMenus` | Used to add quick-action items ("Translate this page", "Rtranslate Settings") to the browser's right-click context menu so users can trigger page translation directly. |
| `host_permissions`（引擎域名） | Required to send translation requests directly from the browser to the translation services the user selects (Google Translate, Microsoft Translator, MyMemory, DeepL, OpenAI-compatible, Claude, Gemini, LibreTranslate, AI Mao). No intermediate servers are used. |
| `optional_host_permissions`（任意域名） | Requested at runtime only when the user configures a custom/self-hosted translation endpoint, so the extension can call the user's own API. |

### Remote code（远程代码）

- **选择：`No, I am not using remote code`**（不，我未使用远程代码）
- 说明：扩展通过 fetch 调用翻译 API 获取 JSON 文本数据，不属于远程代码；所有执行逻辑均在扩展包内，无 eval、无远程脚本。

### Data usage（数据收集）

- 勾选：**仅 `Website content`（网站内容）**
  - 说明（复制用）：Only when the user explicitly initiates translation, the text to be translated is sent directly to the translation provider the user chose (e.g. Google Translate or their own AI endpoint) solely for real-time translation. It is not stored, not shared with any other party, and never sent to our own servers. An optional local PII-masking feature replaces emails/phones/card numbers/IDs/API keys with placeholders on-device before sending.
- 其余 8 类（个人身份、位置、浏览历史、用户活动等）：**全部留空不勾选**
- 底部 3 项 Limited Use 承诺：**全部打勾**（不出售数据 / 不用于单一用途之外的目的 / 不用于信用评估或借贷）

### Privacy Policy URL

`https://github.com/aimaonews/Rtranslate/blob/main/PRIVACY.md`

### Reviewer Test Instructions（审核员测试说明，英文）

> No account or API key is required to test the core features.
> 1. Install the extension and open any English webpage (e.g. https://en.wikipedia.org/wiki/Browser_extension).
> 2. Click the extension icon and press "Translate this page" — paragraphs show bilingual original + translation using the built-in free Google engine.
> 3. Select any sentence on the page — a bubble appears with translation, AI analysis, and word-saving buttons.
> 4. Open the options page (right-click the icon → Options): the Engines tab lists free engines (Google/Microsoft/MyMemory) that work without keys; BYOK engines (DeepL/OpenAI/Claude/Gemini) require the reviewer's own keys and are optional.
> 5. Optional: enable "Sensitive data masking" in Settings → Privacy, then translate a page containing an email address — the email stays intact in the translation (masked on-device before sending, restored after).
> 6. Optional: open a YouTube video with subtitles to see bilingual subtitles.

## 四、Distribution & Account（分发与账号）

| 项 | 建议值 |
|---|---|
| Visibility | Public |
| 发布国家/地区 | 全部（All regions） |
| EEA Trader 身份 | **Non-trader（非交易者）**——项目免费开源无内购，选此项免商业实名认证，且不公开个人住址电话 |
| Publisher name | AIMAO（或你的发布者名称） |
| 联系邮箱 | 完成 Verify email 验证；务必勾选"接收开发者最新动态/邮件通知" |
| $5 注册费 | 国内双币卡账单地区选"中国香港"可顺利支付 |
| 新账号限额 | 新账号限额 2 个属正常风控，首个扩展过审后自动解除 |

### 提交前最终核对（防拒审）

- [ ] ZIP 内无 node_modules/.git/.map/.ts 源码（`npm run zip` 已只打包 dist）
- [ ] 9 个语言分支的 Title/Summary/Detailed description 全部填好（与 _locales 一致，防 Inconsistent metadata warning）
- [ ] 截图与宣传图均为 24 位 RGB 无透明 PNG
- [ ] Privacy Policy URL 可公开访问
- [ ] 测试说明已填（免费引擎开箱即用是最大卖点，审核员无需任何凭据）
