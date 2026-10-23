# Rtranslate · オープンソース二か国語対訳翻訳拡張機能

6つの優れたオープンソース翻訳プロジェクトの長所を集めて再構築した、Manifest V3 対応のブラウザ拡張機能です。**アカウント不要、テレメトリなし、中継サーバーなし。**

[English](../README.md) | [简体中文](./zh_CN.md) | [繁體中文](./zh_TW.md) | [日本語](./ja.md) | [한국어](./ko.md) | [Deutsch](./de.md) | [Español](./es.md) | [Français](./fr.md) | [Português (Brasil)](./pt_BR.md)

| 参照元プロジェクト | 取り込んだ機能 |
|---|---|
| KISS Translator | プレースホルダによるリッチテキストのシリアライズ（`{{n}}` でインライン構造を保持）、LLMバッチ翻訳（番号付きJSONプロトコル）、選択範囲・ホバー・入力ボックス翻訳 |
| FluentRead | レイヤードアーキテクチャ（ブラウザAPIを一切使用しない純粋ロジックコア）、AIリーディングアシスタント（意味・文法・用法・練習問題） |
| Read Frog | 単語帳＋拡張機能内FSRSフラッシュカード復習（ts-fsrs）、ページ上の語彙ハイライト |
| Interline | APIキー不要で即利用できるエンジン、13種類の翻訳スタイル、用語集シグネチャによるキャッシュキーの自動無効化 |
| OpenImmersive Translator | ローカルPIIマスキング（`__PII_*__` プレースホルダ＋フォールトトレラントな復元）、60秒クールダウン付き無料エンジンチェーンのフェイルオーバー |
| MTranBrowser | IntersectionObserverによるビューポート駆動翻訳、計算済みスタイルのコピー（訳文が元テキストのタイポグラフィを再現）、ホバー翻訳用ホットキー、フローティングボール |

## 主な機能

- **二か国語対訳ページ翻訳**：原文と訳文を並べて表示。ビューポート駆動の遅延翻訳、13種類の表示スタイル（淡いグレー、ハイライト、カード、引用、グラデーション、すりガラス、ぼかしマスク自己テスト…）
- **ドキュメント翻訳**（12形式）：PDF、EPUB、DOCX、PPTX、XLSX、HTML、JSON、TXT、Markdown、SRT、VTT、ASS。ドラッグ＆ドロップで読み込み、対訳または訳文のみでエクスポートでき、ダウンロード前に訳文を編集することも可能です
- **動画・会議字幕**：YouTubeの二か国語字幕（json3/XMLパース、ASR再セグメント化、30秒先読み）、Google Meet / Teams / Zoom のライブキャプション翻訳
- **マルチエンジン**：自動フェイルオーバー付きの無料 Google/Microsoft/MyMemory チェーン、DeepL、OpenAI互換エンドポイント（OpenAI/DeepSeek/その他互換API）、Claude、Gemini、LibreTranslate（セルフホスト可）、カスタムJSONプロトコル、AI Mao（当プロジェクト運営のホストサービス）
- **AIエキスパート**：カスタムプロンプトによる翻訳ストラテジー。内蔵プリセット5種（汎用/技術/文学/学術/SNS）
- **AI用語ライブラリ**：分野別グロッサリー6種を内蔵（プログラミング/Web3/Twitter/AO3/教育/ゲーム、immersive-translate/terms 提供）＋カスタム用語集＋AI用語抽出
- **AIライティング**：選択バブルで推敲・続きの生成・要約・返信・翻訳が可能。トーンと長さも調整できます
- **バッチ翻訳**：AIエンジンが複数の段落を1つのリクエストに統合——より高速で低コスト
- **プライバシー保護**：オプションのローカルPIIマスキング——メールアドレス/電話番号/銀行カード番号/ID番号/APIキーは送信前にローカルでマスキングされ、翻訳後に復元されます
- **選択・ホバー・入力ボックス翻訳**（Alt+Enter またはスペース3回押し）
- **AIリーディングアシスタント**：意味の解説、文法解析、用法ノート、練習問題の生成、複数ターンのフォローアップ対話
- **単語帳＋FSRSフラッシュカード**：例文コンテキストと出典リンク付きでワンクリック保存、間隔反復による復習に対応
- **用語集**：訳語の一貫性を保つカスタム専門用語
- **フローティングボール、Alt+T ホットキー、コンテキストメニュー、Alt+D マルチエンジン比較ウィンドウ**
- **10言語のインターフェース**（ブラウザの言語設定に自動追従、または手動選択）、初回インストール時のオンボーディングウィザード

## インストール（開発者モード）

```bash
npm install
npm run build        # outputs dist/
```

Edge/Chrome → `edge://extensions` / `chrome://extensions` → **デベロッパーモード**を有効化 → **パッケージ化されていない拡張機能を読み込む** → `dist/` ディレクトリを選択してください。

## 開発

```bash
npm run test         # vitest (pure-logic core + engine mocks + translation pipeline, 589 tests)
npm run typecheck    # tsc --noEmit
npm run build        # triple vite build (pages/background + content IIFE + subtitles IIFE)
```

エンドツーエンドテスト（Edge が必要）：

```bash
node scripts/e2e/serve.mjs 8137 &                 # static test page
# start the browser with --enable-unsafe-extensions-debugging, then:
node scripts/e2e/load-unpacked.mjs <absolute dist path>
node scripts/e2e/drive.mjs                        # six phases: page/selection/input/PII restore/wordbook FSRS/review
```

## アーキテクチャ

詳細は [ARCHITECTURE.md](../ARCHITECTURE.md) を参照してください。要点：

- `src/core/` — 純粋ロジック（マスク/用語集/テキスト/検出/言語/スタイル）。ブラウザAPIを一切使用せず、ユニットテストで完全に検証
- `src/background/` — 単一の翻訳パイプライン：キャッシュ → PIIマスキング → 用語集 → エンジンルーティング（無料チェーン / BYOK）→ バッチ化 → 逆順復元 → 書き戻し
- `src/content/` — コンテンツスクリプト（単一ファイルIIFE）：DOM候補の検出 → プレースホルダのシリアライズ → ビューポート駆動翻訳 → スタイル継承の注入
- メッセージプロトコルは `src/shared/protocol.ts` に集約。設定は単一の設定オブジェクトで、読み込み時に正規化（`normalizeConfig`）

## プライバシー

- すべてのHTTPリクエストはバックグラウンドservice workerからのみ送信され、コンテンツスクリプトはネットワークに一切アクセスしません
- アカウント登録も、あらゆる種類のレポート送信も行いません
- APIキーは `chrome.storage.local` にのみ保存されます
- マスキングを有効にすれば、機密データがデバイスの外に出ることはありません
- 完全なプライバシーポリシー：[PRIVACY.md](../PRIVACY.md)

## ストア申請（Chrome Web Store / Edge Add-ons）

両ストアの2026年ポリシーへの対応は完了しています：

- **最小限の権限**：`storage` + `contextMenus` のみ。`host_permissions` にはエンジンのドメインのみを記載。カスタム/セルフホストのエンドポイントには `optional_host_permissions` を使用し、保存時に要求
- **リモートコードなし**：すべてのロジックをパッケージに同梱。`eval` 不使用
- **可読なコード**：`npm run build:store` で難読化していない審査用パッケージを生成
- **プライバシーポリシー**：[PRIVACY.md](../PRIVACY.md)（申請前に公開URLへデプロイ）
- **ストア掲載情報**：[store-assets/listing.md](../store-assets/listing.md) と [docs/store-listing/](./store-listing/)（zh_CN/en）
- **10言語のメタデータ**：`_locales/` とマニフェスト内の `__MSG_` プレースホルダ

## ロードマップ（未実装）

- YouTube Shorts、Netflix字幕（YouTube /watch は対応済み）
- PDFのレイアウト保持エクスポート（現状は二か国語HTML）、スキャンPDFのOCR
- 画像翻訳
- Firefox対応（マニフェストの差分はわずか）
- 同期（WebDAV/Gist）

## ライセンス

GPL-3.0（KISS Translator / FluentRead / Read Frog と同じライセンス）。
参照プロジェクトはアーキテクチャの参考として学習したのみで、コードを直接コピーした箇所はありません。
