# Rtranslate · 開源雙語翻譯擴充功能

汲取六個優秀開源翻譯專案的長處，重新打造而成的 Manifest V3 瀏覽器擴充功能。**無帳號、無遙測、無中介伺服器。**

[English](../README.md) | [简体中文](./zh_CN.md) | **繁體中文** | [日本語](./ja.md) | [한국어](./ko.md) | [Deutsch](./de.md) | [Español](./es.md) | [Français](./fr.md) | [Português (Brasil)](./pt_BR.md)

| 來源專案 | 吸收的能力 |
|---|---|
| KISS Translator | 佔位符富文本序列化（`{{n}}` 保留行內結構）、LLM 批次翻譯（編號 JSON 協定）、選取/滑鼠懸停/輸入框翻譯 |
| FluentRead | 分層架構（core 純邏輯、零瀏覽器 API）、AI 閱讀助理（釋義/文法/用法/練習） |
| Read Frog | 單字本 + 擴充功能內建 FSRS 字卡複習（ts-fsrs）、頁面單字高亮 |
| Interline | 免 Key 開箱即用的引擎、13 種譯文樣式、快取 key 依術語表簽祠自動失效 |
| OpenImmersive Translator | 本機 PII 遮罩（`__PII_*__` 佔位符 + 容錯還原）、免費引擎鏈 + 60 秒冷卻容錯移轉 |
| MTranBrowser | IntersectionObserver 檢視區驅動翻譯、計算樣式複製（譯文排版與原文一致）、懸停翻譯快速鍵、懸浮球 |

## 功能

- **整頁雙語對照翻譯**：原文與譯文並列顯示；檢視區驅動的延遲翻譯；13 種譯文樣式（柔和灰、高亮、卡片、引用、漸層、毛玻璃、模糊遮罩自測……）
- **文件翻譯**（12 種格式）：PDF、EPUB、DOCX、PPTX、XLSX、HTML、JSON、TXT、Markdown、SRT、VTT、ASS——拖放匯入，可匯出雙語對照版或僅譯文版，下載前可先編輯
- **影片與會議字幕**：YouTube 雙語字幕（json3/XML 解析、ASR 重新斷句、30 秒前瞻翻譯）；Google Meet / Teams / Zoom 即時字幕翻譯
- **多引擎**：Google/Microsoft/MyMemory 免費引擎鏈，自動容錯移轉；DeepL；OpenAI 相容端點（OpenAI/DeepSeek/任何相容 API）；Claude；Gemini；LibreTranslate（可自行架設）；自訂 JSON 協定；AI Mao（我們的代管服務）
- **AI 專家**：自訂 Prompt 翻譯策略，內建 5 種預設（通用/技術文件/文學/學術/社群媒體）
- **AI 術語庫**：內建 6 大領域術語庫（程式設計/Web3/Twitter/AO3/教育/遊戲，來自 immersive-translate/terms）+ 自訂術語庫 + AI 術語擷取
- **AI 寫作**：在選取氣泡中潤色/續寫/摘要/回覆/翻譯，語氣與長度皆可調整
- **批次翻譯**：AI 引擎將多段文字合併為單一請求——更快速、更省成本
- **隱私保護**：可選的本機 PII 遮罩——電子郵件/電話/銀行卡/身分證字號/API 金鑰在送出前於本機遮罩，翻譯後還原
- **選取翻譯、滑鼠懸停翻譯、輸入框翻譯**（Alt+Enter 或連按三次空白鍵）
- **AI 閱讀助理**：釋義、文法分析、用法講解、練習生成、多輪追問對話
- **單字本 + FSRS 字卡**：一鍵收藏單字，附句子語境與來源連結；間隔重複複習
- **術語表**：自訂術語，確保譯法一致
- **懸浮球、Alt+T 快速鍵、右鍵選單、Alt+D 多引擎比較視窗**
- **10 種介面語言**（自動跟隨瀏覽器或手動設定），首次安製時的新手引導精靈

## 安裝（開發人員模式）

```bash
npm install
npm run build        # 產出 dist/
```

Edge/Chrome → `edge://extensions` / `chrome://extensions` → 開啟**開發人員模式** → **載入未封裝的擴充功能** → 選擇 `dist/` 目錄。

## 開發

```bash
npm run test         # vitest（純邏輯 core + 引擎 mock + 翻譯管線，589 項測試）
npm run typecheck    # tsc --noEmit
npm run build        # 三路 vite 建置（pages/background + content IIFE + subtitles IIFE）
```

端對端測試（需要 Edge）：

```bash
node scripts/e2e/serve.mjs 8137 &                 # 靜態測試頁
# 以 --enable-unsafe-extensions-debugging 啟動瀏覽器後：
node scripts/e2e/load-unpacked.mjs <dist 絕對路徑>
node scripts/e2e/drive.mjs                        # 六階段：整頁/選取/輸入框/PII 還原/單字本 FSRS/複習
```

## 架構

詳見 [ARCHITECTURE.md](../ARCHITECTURE.md)。要點：

- `src/core/` — 純邏輯（mask/glossary/text/detect/langs/styles），零瀏覽器 API，單元測試完整覆蓋
- `src/background/` — 唯一翻譯管線：快取 → PII 遮罩 → 術語表 → 引擎路由（免費鏈/BYOK）→ 批次合併 → 逆序還原 → 回寫
- `src/content/` — content script（單檔 IIFE）：DOM 候選節點發現 → 佔位符序列化 → 檢視區驅動翻譯 → 樣式繼承注入
- 訊息協定見 `src/shared/protocol.ts`；單一設定物件，讀取時正規化（`normalizeConfig`）

## 隱私

- 所有 HTTP 請求僅由 background service worker 發起；content script 完全不接觸網路
- 無帳號、無任何形式的上報
- API 金鑰僅儲存於 `chrome.storage.local`
- 在設定中啟用遮罩後，敏感資料不出本機
- 完整隱私權政策：[PRIVACY.md](../PRIVACY.md)

## 商店送審（Chrome Web Store / Edge Add-ons）

已依兩家商店 2026 年政策完成合規作業：

- **權限最小化**：`permissions` 僅 `storage` + `contextMenus`；`host_permissions` 只列出翻譯引擎網域；自訂/自架端點使用 `optional_host_permissions`，於設定頁儲存時按需申請
- **無遠端程式碼**：所有邏輯皆隨套件發布；無 `eval`
- **可讀程式碼**：`npm run build:store` 產出未壓縮的送審包
- **隱私權政策**：[PRIVACY.md](../PRIVACY.md)（送審前部署至公開 URL）
- **商店資訊**：[store-assets/listing.md](../store-assets/listing.md) 與 [docs/store-listing/](./store-listing/)（zh_CN/en）
- **10 語言中繼資料**：`_locales/`，manifest 內使用 `__MSG_` 佔位符

## 路線圖（尚未實作）

- YouTube Shorts、Netflix 字幕（YouTube /watch 已完成）
- PDF 版面保留匯出（目前為雙語 HTML）、掃描版 PDF OCR
- 圖片翻譯
- Firefox 適配（manifest 差異極小）
- 同步（WebDAV/Gist）

## 授權條款

GPL-3.0（與 KISS Translator / FluentRead / Read Frog 一致）。
參考專案僅作架構研究之用，未直接複製任何程式碼。
