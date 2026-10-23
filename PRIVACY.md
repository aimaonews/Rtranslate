# TransVerse 译境 隐私政策 / Privacy Policy

生效日期：2026-10-19 · 适用于 TransVerse 译境浏览器扩展（Chrome / Microsoft Edge）

---

## 中文

### 我们是谁

TransVerse 译境是一款开源的浏览器翻译扩展（GPL-3.0）。**本扩展没有服务器**：我们不运营任何后端服务，不收集统计数据，不打广告，没有账号体系。

### 扩展处理哪些数据

**1. 网页文本（用户主动发起翻译时）**
当且仅当你点击翻译（整页翻译、划词翻译、悬停翻译、输入框翻译）时，浏览器会把**你当前浏览的页面中需要翻译的文本**直接从你的浏览器发送到你**自行选择的翻译服务商**：

- 免费引擎：Google 翻译（非官方网页接口）、微软翻译（非官方网页接口）、MyMemory
- 自带密钥（BYOK）引擎：DeepL、OpenAI 兼容接口（OpenAI / DeepSeek / Ollama / 任何兼容端点）、LibreTranslate（可自托管）、自定义 JSON 接口

文本传输不经过任何中间服务器。各服务商按其自有隐私政策处理接收到的文本。

**2. 可选的敏感信息保护**
你可以在设置中开启"敏感信息脱敏"：邮箱、电话、银行卡号、身份证号、API Key 等会在**你的浏览器本地**被替换为占位符后再发送给翻译引擎，译文返回后在本地还原。敏感原文不会离开你的设备。

**3. API 密钥**
你填写的 DeepL / OpenAI 等密钥只保存在浏览器的 `chrome.storage.local` 中，仅用于向你配置的服务商发起身份验证请求，不会被发送到任何其他地方。

**4. 生词本**
你收藏的生词、闪卡复习记录只保存在浏览器本地存储中，不会上传。

### 我们不做什么

- 不收集浏览历史、不追踪浏览行为、无任何遥测/分析
- 不出售、共享或转让任何用户数据
- 不注入广告、不改浏览器设置
- 不执行任何远程代码（所有程序逻辑都在扩展包内）

### 你的控制权

- 随时切换翻译引擎；可选自托管引擎（LibreTranslate / 自定义接口），文本完全不离开你的网络
- 开启脱敏以保护敏感内容
- 清除数据：卸载扩展即删除全部本地数据；也可在设置页删除生词本与翻译缓存

### 联系

请通过项目仓库的 Issues 页面联系我们。

---

## English

### Who we are

TransVerse is an open-source browser translation extension (GPL-3.0). **This extension has no servers**: we operate no backend, collect no analytics, show no ads, and have no accounts.

### What data the extension handles

**1. Web page text (only when you initiate translation)**
When and only when you request a translation (page, selection, hover, or input translation), the text to be translated is sent **directly from your browser** to the **translation provider you choose**:

- Free engines: Google Translate (unofficial web endpoint), Microsoft Translator (unofficial web endpoint), MyMemory
- Bring-your-own-key engines: DeepL, OpenAI-compatible endpoints (OpenAI / DeepSeek / Ollama / any compatible endpoint), LibreTranslate (self-hostable), custom JSON endpoints

Text is never routed through servers we operate. Each provider processes the submitted text under its own privacy policy.

**2. Optional sensitive-data masking**
You can enable "Sensitive data masking" in settings: email addresses, phone numbers, bank card numbers, ID numbers, and API keys are replaced with placeholders **locally in your browser** before being sent for translation, and restored locally afterwards. Sensitive original text never leaves your device.

**3. API keys**
Keys you enter (DeepL / OpenAI, etc.) are stored only in `chrome.storage.local` and are used solely to authenticate requests to the provider you configured. They are never transmitted anywhere else.

**4. Wordbook**
Saved words and flashcard review records stay in local browser storage and are never uploaded.

### What we do NOT do

- No browsing-history collection, no behavior tracking, no telemetry or analytics
- No sale, sharing, or transfer of user data
- No ads, no browser-setting changes
- No remote code execution (all program logic ships inside the extension package)

### Your controls

- Switch translation engines anytime; choose self-hosted engines (LibreTranslate / custom endpoint) so text never leaves your network
- Enable masking to protect sensitive content
- Delete data: uninstalling the extension removes all local data; the wordbook and translation cache can also be cleared from the options page

### Contact

Reach us via the Issues page of the project repository.
