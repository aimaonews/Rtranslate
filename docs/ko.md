# Rtranslate · 오픈소스 이중언어 번역 확장 프로그램

여섯 가지 뛰어난 오픈소스 번역 프로젝트의 정수만을 모아 새로 구축한 Manifest V3 브라우저 확장 프로그램입니다. **계정도, 텔레메트리도, 중개 서버도 없습니다.**

[简体中文](./docs/zh_CN.md) | [繁體中文](./docs/zh_TW.md) | [日本語](./docs/ja.md) | [한국어](./docs/ko.md) | [Deutsch](./docs/de.md) | [Español](./docs/es.md) | [Français](./docs/fr.md) | [Português (Brasil)](./docs/pt_BR.md)

| 원본 프로젝트 | 계승한 기능 |
|---|---|
| KISS Translator | 플레이스홀더 기반 리치 텍스트 직렬화(`{{n}}`으로 인라인 구조 유지), LLM 일괄 번역(번호 기반 JSON 프로토콜), 선택/호버/입력창 번역 |
| FluentRead | 계층형 아키텍처(브라우저 API를 전혀 사용하지 않는 순수 로직 코어), AI 독서 어시스턴트(의미/문법/용법/연습) |
| Read Frog | 단어장 + 확장 프로그램 내 FSRS 플래시카드 복습(ts-fsrs), 페이지 내 어휘 하이라이트 |
| Interline | API 키 없이 바로 사용할 수 있는 엔진, 13가지 번역 스타일, 용어집 시그니처로 자동 무효화되는 캐시 키 |
| OpenImmersive Translator | 로컬 PII 마스킹(`__PII_*__` 플레이스홀더 + 내결함성 복원), 60초 쿨다운 페일오버를 갖춘 무료 엔진 체인 |
| MTranBrowser | IntersectionObserver를 활용한 뷰포트 기반 번역, computed-style 복사(번역문이 원본 타이포그래피를 그대로 따름), 호버 핫키, 플로팅 볼 |

## 주요 기능

- **이중언어 페이지 번역**: 원문과 번역문을 나란히 표시하고, 뷰포트 기반 지연 번역을 적용하며, 13가지 표시 스타일(연한 회색, 하이라이트, 카드, 인용, 그라데이션, frosted glass, 블러 마스크 셀프 테스트 등)을 제공합니다
- **문서 번역**(12가지 형식): PDF, EPUB, DOCX, PPTX, XLSX, HTML, JSON, TXT, Markdown, SRT, VTT, ASS — 드래그 앤 드롭으로 번역하고, 이중언어 또는 번역문만 내보낼 수 있으며, 다운로드 전에 번역문을 편집할 수 있습니다
- **영상 및 회의 자막**: 이중언어 YouTube 자막(json3/XML 파싱, ASR 재분할, 30초 미리 불러오기)과 Google Meet / Teams / Zoom 실시간 자막 번역을 지원합니다
- **다중 엔진**: 자동 페일오버를 갖춘 무료 Google/Microsoft/MyMemory 엔진 체인, DeepL, OpenAI 호환 엔드포인트(OpenAI/DeepSeek/호환되는 모든 API), Claude, Gemini, LibreTranslate(자체 호스팅 가능), 커스텀 JSON 프로토콜, AI Mao(저희가 직접 운영하는 서비스)를 지원합니다
- **AI 전문가**: 커스텀 프롬프트 번역 전략과 5가지 내장 프리셋(일반/기술/문학/학술/소셜 미디어)을 제공합니다
- **AI 용어 라이브러리**: 6가지 내장 분야 용어집(프로그래밍/Web3/Twitter/AO3/교육/게임, immersive-translate/terms 제공)과 커스텀 용어집, AI 용어 추출을 지원합니다
- **AI 라이팅**: 선택 버블에서 다듬기/이어쓰기/요약/답변/번역을 수행하며, 어조와 길이를 조절할 수 있습니다
- **일괄 번역**: AI 엔진이 여러 문단을 하나의 요청으로 병합해 더 빠르고 저렴하게 번역합니다
- **개인정보 보호**: 선택적 로컬 PII 마스킹 — 이메일/전화번호/은행카드 번호/ID 번호/API 키를 전송 전 로컬에서 마스킹하고 번역 후 복원합니다
- **선택·호버·입력창 번역**(Alt+Enter 또는 스페이스바 세 번 입력)
- **AI 독서 어시스턴트**: 의미 설명, 문법 분석, 용법 노트, 연습 문제 생성, 멀티턴 후속 대화를 제공합니다
- **단어장 + FSRS 플래시카드**: 문장 맥락과 출처 링크를 담아 한 번의 클릭으로 단어를 저장하고, 간격 반복 복습을 할 수 있습니다
- **용어집**: 일관된 번역을 위한 커스텀 용어를 지정할 수 있습니다
- **플로팅 볼, Alt+T 핫키, 컨텍스트 메뉴, Alt+D 다중 엔진 비교 창**
- **10가지 인터페이스 언어**(브라우저 언어 자동 따르기 또는 수동 선택), 첫 설치 시 온보딩 마법사가 제공됩니다

## 설치(개발자 모드)

```bash
npm install
npm run build        # outputs dist/
```

Edge/Chrome에서 `edge://extensions` / `chrome://extensions` 페이지를 연 뒤 **개발자 모드**를 켜고, **압축해제된 확장 프로그램 로드**로 `dist/` 디렉터리를 선택하세요.

## 개발

```bash
npm run test         # vitest (pure-logic core + engine mocks + translation pipeline, 589 tests)
npm run typecheck    # tsc --noEmit
npm run build        # triple vite build (pages/background + content IIFE + subtitles IIFE)
```

엔드투엔드 테스트(Edge 필요):

```bash
node scripts/e2e/serve.mjs 8137 &                 # static test page
# start the browser with --enable-unsafe-extensions-debugging, then:
node scripts/e2e/load-unpacked.mjs <absolute dist path>
node scripts/e2e/drive.mjs                        # six phases: page/selection/input/PII restore/wordbook FSRS/review
```

## 아키텍처

자세한 내용은 [ARCHITECTURE.md](./ARCHITECTURE.md)를 참고하세요. 핵심 사항:

- `src/core/` — 순수 로직(mask/glossary/text/detect/langs/styles), 브라우저 API를 전혀 사용하지 않으며 모두 유닛 테스트로 검증됩니다
- `src/background/` — 단일 번역 파이프라인: 캐시 → PII 마스킹 → 용어집 → 엔진 라우팅(무료 체인 / BYOK) → 일괄 처리 → 역방향 복원 → 결과 기록
- `src/content/` — 콘텐츠 스크립트(단일 파일 IIFE): DOM 후보 탐색 → 플레이스홀더 직렬화 → 뷰포트 기반 번역 → 스타일 상속 주입
- 메시지 프로토콜은 `src/shared/protocol.ts`에 정의되어 있으며, 읽기 시점 정규화(`normalizeConfig`)가 적용된 단일 설정 객체를 사용합니다

## 프라이버시

- 모든 HTTP 요청은 백그라운드 서비스 워커에서만 발생하며, 콘텐츠 스크립트는 네트워크에 접근하지 않습니다
- 계정이 없으며, 어떠한 종류의 리포트도 없습니다
- API 키는 `chrome.storage.local`에만 저장됩니다
- 마스킹을 활성화하면 민감한 데이터는 기기를 벗어나지 않습니다
- 전체 개인정보 처리방침: [PRIVACY.md](./PRIVACY.md)

## 스토어 제출(Chrome Web Store / Edge Add-ons)

두 스토어의 2026년 정책에 맞춘 컴플라이언스 작업이 완료되어 있습니다:

- **최소 권한**: `storage` + `contextMenus`만 사용하며, `host_permissions`에는 엔진 도메인만 나열됩니다. 커스텀/자체 호스팅 엔드포인트는 저장 시점에 요청되는 `optional_host_permissions`를 사용합니다
- **원격 코드 없음**: 모든 로직이 패키지에 포함되어 배포되며, `eval`을 사용하지 않습니다
- **읽기 쉬운 코드**: `npm run build:store`는 minify하지 않은 검토용 패키지를 생성합니다
- **개인정보 처리방침**: [PRIVACY.md](./PRIVACY.md) (제출 전 공개 URL에 배포하세요)
- **스토어 등록 정보**: [store-assets/listing.md](./store-assets/listing.md) 및 [docs/store-listing/](./docs/store-listing/) (zh_CN/en)
- **10개 언어 메타데이터**: manifest의 `__MSG_` 플레이스홀더와 `_locales/` 디렉터리

## 로드맵(미구현)

- YouTube Shorts, Netflix 자막(YouTube /watch는 이미 구현됨)
- PDF 레이아웃 보존 내보내기(현재는 이중언어 HTML), 스캔 PDF OCR
- 이미지 번역
- Firefox 대응(manifest 차이는 최소)
- 동기화(WebDAV/Gist)

## 라이선스

GPL-3.0 (KISS Translator / FluentRead / Read Frog와 동일).
참고한 프로젝트는 아키텍처 학습 목적으로만 살펴보았으며, 코드를 직접 복사하지 않았습니다.
