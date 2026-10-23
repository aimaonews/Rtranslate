# Rtranslate · Open-Source Bilingual Translation Extension

A Manifest V3 browser extension rebuilt from the best of six excellent open-source translation projects. **No account, no telemetry, no middle servers.**

[简体中文](./docs/zh_CN.md) | [繁體中文](./docs/zh_TW.md) | [日本語](./docs/ja.md) | [한국어](./docs/ko.md) | [Deutsch](./docs/de.md) | [Español](./docs/es.md) | [Français](./docs/fr.md) | [Português (Brasil)](./docs/pt_BR.md)

| Source project | Capabilities absorbed |
|---|---|
| KISS Translator | Placeholder rich-text serialization (`{{n}}` preserves inline structure), LLM batch translation (numbered JSON protocol), selection/hover/input-box translation |
| FluentRead | Layered architecture (pure-logic core with zero browser APIs), AI reading assistant (meaning/grammar/usage/practice) |
| Read Frog | Wordbook + in-extension FSRS flashcard review (ts-fsrs), on-page vocabulary highlighting |
| Interline | Key-free out-of-the-box engines, 13 translation styles, cache keys auto-invalidated by glossary signature |
| OpenImmersive Translator | Local PII masking (`__PII_*__` placeholders + fault-tolerant restore), free-engine chain with 60s cooldown failover |
| MTranBrowser | IntersectionObserver viewport-driven translation, computed-style copying (translation matches original typography), hover hotkeys, floating ball |

## Features

- **Bilingual page translation**: original + translation side by side; viewport-driven lazy translation; 13 display styles (soft gray, highlight, card, quote, gradient, frosted glass, blur-mask self-test…)
- **Document translation** (12 formats): PDF, EPUB, DOCX, PPTX, XLSX, HTML, JSON, TXT, Markdown, SRT, VTT, ASS — drag & drop, bilingual or translation-only export, post-editing before download
- **Video & meeting subtitles**: bilingual YouTube subtitles (json3/XML parsing, ASR re-segmentation, 30s lookahead); live caption translation for Google Meet / Teams / Zoom
- **Multi-engine**: free Google/Microsoft/MyMemory chain with automatic failover; DeepL; OpenAI-compatible endpoints (OpenAI/DeepSeek/any compatible API); Claude; Gemini; LibreTranslate (self-hostable); custom JSON protocol; AI Mao (our hosted service)
- **AI Experts**: custom prompt translation strategies with 5 built-in presets (general/technical/literary/academic/social media)
- **AI terminology libraries**: 6 built-in domain glossaries (programming/Web3/Twitter/AO3/education/gaming, from immersive-translate/terms) + custom libraries + AI term extraction
- **AI writing**: polish/continue/summarize/reply/translate in the selection bubble, with tone and length controls
- **Batch translation**: AI engines merge multiple paragraphs into one request — faster and cheaper
- **Privacy protection**: optional local PII masking — emails/phones/bank cards/ID numbers/API keys are masked locally before sending and restored after translation
- **Selection, hover, and input-box translation** (Alt+Enter or triple space)
- **AI reading assistant**: meaning, grammar analysis, usage notes, practice generation, multi-turn follow-up chat
- **Wordbook + FSRS flashcards**: one-click word saving with sentence context and source link; spaced-repetition review
- **Glossary**: custom terminology for consistent translations
- **Floating ball, Alt+T hotkey, context menu, Alt+D multi-engine comparison window**
- **10 interface languages** (auto-follow browser or manual), onboarding wizard on first install

## Install (developer mode)

```bash
npm install
npm run build        # outputs dist/
```

Edge/Chrome → `edge://extensions` / `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `dist/` directory.

## Development

```bash
npm run test         # vitest (pure-logic core + engine mocks + translation pipeline, 589 tests)
npm run typecheck    # tsc --noEmit
npm run build        # triple vite build (pages/background + content IIFE + subtitles IIFE)
```

End-to-end tests (requires Edge):

```bash
node scripts/e2e/serve.mjs 8137 &                 # static test page
# start the browser with --enable-unsafe-extensions-debugging, then:
node scripts/e2e/load-unpacked.mjs <absolute dist path>
node scripts/e2e/drive.mjs                        # six phases: page/selection/input/PII restore/wordbook FSRS/review
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md). Highlights:

- `src/core/` — pure logic (mask/glossary/text/detect/langs/styles), zero browser APIs, fully unit-tested
- `src/background/` — single translation pipeline: cache → PII masking → glossary → engine routing (free chain / BYOK) → batching → reverse restore → write-back
- `src/content/` — content script (single-file IIFE): DOM candidate discovery → placeholder serialization → viewport-driven translation → style-inherited injection
- Message protocol in `src/shared/protocol.ts`; single config object with read-time normalization (`normalizeConfig`)

## Privacy

- All HTTP requests originate only in the background service worker; content scripts never touch the network
- No accounts, no reporting of any kind
- API keys are stored only in `chrome.storage.local`
- With masking enabled, sensitive data never leaves your device
- Full privacy policy: [PRIVACY.md](./PRIVACY.md)

## Store submission (Chrome Web Store / Edge Add-ons)

Compliance work for both stores' 2026 policies is done:

- **Minimal permissions**: only `storage` + `contextMenus`; `host_permissions` lists engine domains only; custom/self-hosted endpoints use `optional_host_permissions` requested on save
- **No remote code**: all logic ships in the package; no `eval`
- **Readable code**: `npm run build:store` produces an unminified review package
- **Privacy policy**: [PRIVACY.md](./PRIVACY.md) (deploy to a public URL before submitting)
- **Store listing**: [store-assets/listing.md](./store-assets/listing.md) and [docs/store-listing/](./docs/store-listing/) (zh_CN/en)
- **10-language metadata**: `_locales/` with `__MSG_` placeholders in the manifest

## Roadmap (not yet implemented)

- YouTube Shorts, Netflix subtitles (YouTube /watch is done)
- PDF layout-preserving export (currently bilingual HTML), scanned-PDF OCR
- Image translation
- Firefox adaptation (minimal manifest differences)
- Sync (WebDAV/Gist)

## License

GPL-3.0 (consistent with KISS Translator / FluentRead / Read Frog).
Reference projects were studied for architecture only; no code was copied directly.
