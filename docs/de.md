# Rtranslate · Open-Source-Zweisprachige Übersetzungserweiterung

Eine Browser-Erweiterung auf Basis von Manifest V3, neu aufgebaut aus dem Besten von sechs hervorragenden Open-Source-Übersetzungsprojekten. **Kein Konto, keine Telemetrie, keine Zwischenserver.**

[简体中文](./docs/zh_CN.md) | [繁體中文](./docs/zh_TW.md) | [日本語](./docs/ja.md) | [한국어](./docs/ko.md) | [Deutsch](./docs/de.md) | [Español](./docs/es.md) | [Français](./docs/fr.md) | [Português (Brasil)](./docs/pt_BR.md)

| Quellprojekt | Übernommene Funktionen |
|---|---|
| KISS Translator | Rich-Text-Serialisierung mit Platzhaltern (`{{n}}` erhält die Inline-Struktur), LLM-Stapelübersetzung (nummeriertes JSON-Protokoll), Übersetzung von Auswahl, Hover und Eingabefeld |
| FluentRead | Schichtenarchitektur (Kern aus reiner Logik, ganz ohne Browser-APIs), KI-Leseassistent (Bedeutung/Grammatik/Verwendung/Übungen) |
| Read Frog | Vokabelbuch + FSRS-Karteikarten-Wiederholung direkt in der Erweiterung (ts-fsrs), Hervorheben von Vokabeln auf der Seite |
| Interline | Out-of-the-box-Engines ohne API-Schlüssel, 13 Übersetzungsstile, Cache-Schlüssel werden per Glossar-Signatur automatisch invalidiert |
| OpenImmersive Translator | Lokale PII-Maskierung (`__PII_*__`-Platzhalter + fehlertolerante Wiederherstellung), Kette kostenloser Engines mit Failover und 60-Sekunden-Abklingzeit |
| MTranBrowser | Viewport-gesteuerte Übersetzung per IntersectionObserver, Kopieren der berechneten Stile (die Übersetzung übernimmt die Typografie des Originals), Hover-Hotkeys, schwebende Kugel |

## Funktionen

- **Zweisprachige Seitenübersetzung**: Original und Übersetzung nebeneinander; viewport-gesteuerte Lazy-Übersetzung; 13 Anzeigestile (sanftes Grau, Hervorhebung, Karte, Zitat, Farbverlauf, Milchglaseffekt, Selbsttest mit Blur-Maske…)
- **Dokumentübersetzung** (12 Formate): PDF, EPUB, DOCX, PPTX, XLSX, HTML, JSON, TXT, Markdown, SRT, VTT, ASS – Drag & Drop, Export zweisprachig oder nur als Übersetzung, Nachbearbeitung vor dem Download
- **Video- und Meeting-Untertitel**: zweisprachige YouTube-Untertitel (json3/XML-Parsing, ASR-Neu-Segmentierung, 30-Sekunden-Vorausschau); Übersetzung von Live-Untertiteln für Google Meet / Teams / Zoom
- **Mehrere Engines**: kostenlose Google/Microsoft/MyMemory-Kette mit automatischem Failover; DeepL; OpenAI-kompatible Endpunkte (OpenAI/DeepSeek/jede kompatible API); Claude; Gemini; LibreTranslate (selbst hostbar); benutzerdefiniertes JSON-Protokoll; AI Mao (unser gehosteter Dienst)
- **KI-Experten**: eigene Prompt-basierte Übersetzungsstrategien mit 5 integrierten Voreinstellungen (Allgemein/Technik/Literatur/Akademisch/Social Media)
- **KI-Terminologiebibliotheken**: 6 integrierte Fachglossare (Programmierung/Web3/Twitter/AO3/Bildung/Gaming, aus immersive-translate/terms) + eigene Bibliotheken + KI-Termextraktion
- **KI-Schreibassistent**: Polieren/Fortsetzen/Zusammenfassen/Antworten/Übersetzen in der Auswahlblase, mit Steuerung von Ton und Länge
- **Stapelübersetzung**: KI-Engines fassen mehrere Absätze zu einer einzigen Anfrage zusammen – schneller und günstiger
- **Schutz der Privatsphäre**: optionale lokale PII-Maskierung – E-Mails/Telefonnummern/Bankkarten/Ausweisnummern/API-Schlüssel werden vor dem Senden lokal maskiert und nach der Übersetzung wiederhergestellt
- **Übersetzung von Auswahl, Hover und Eingabefeld** (Alt+Enter oder Dreifach-Leertaste)
- **KI-Leseassistent**: Bedeutung, Grammatikanalyse, Anwendungshinweise, Übungsgenerierung sowie Follow-up-Chat über mehrere Runden
- **Vokabelbuch + FSRS-Karteikarten**: Wörter mit einem Klick speichern, inklusive Satzkontext und Quelllink; Wiederholung nach dem Spaced-Repetition-Prinzip
- **Glossar**: eigene Terminologie für konsistente Übersetzungen
- **Schwebende Kugel, Alt+T-Hotkey, Kontextmenü, Alt+D-Vergleichsfenster für mehrere Engines**
- **10 Sprachen für die Benutzeroberfläche** (folgen automatisch der Browsersprache oder manuell wählbar), Einrichtungsassistent bei der Erstinstallation

## Installation (Entwicklermodus)

```bash
npm install
npm run build        # outputs dist/
```

Edge/Chrome → `edge://extensions` / `chrome://extensions` → **Entwicklermodus** aktivieren → **Entpackte Erweiterung laden** → das Verzeichnis `dist/` auswählen.

## Entwicklung

```bash
npm run test         # vitest (pure-logic core + engine mocks + translation pipeline, 589 tests)
npm run typecheck    # tsc --noEmit
npm run build        # triple vite build (pages/background + content IIFE + subtitles IIFE)
```

End-to-End-Tests (erfordern Edge):

```bash
node scripts/e2e/serve.mjs 8137 &                 # static test page
# start the browser with --enable-unsafe-extensions-debugging, then:
node scripts/e2e/load-unpacked.mjs <absolute dist path>
node scripts/e2e/drive.mjs                        # six phases: page/selection/input/PII restore/wordbook FSRS/review
```

## Architektur

Siehe [ARCHITECTURE.md](./ARCHITECTURE.md). Kernpunkte:

- `src/core/` – reine Logik (mask/glossary/text/detect/langs/styles), ganz ohne Browser-APIs, vollständig durch Unit-Tests abgedeckt
- `src/background/` – eine einzige Übersetzungspipeline: Cache → PII-Maskierung → Glossar → Engine-Routing (kostenlose Kette / BYOK) → Batching → Wiederherstellung in umgekehrter Reihenfolge → Zurückschreiben
- `src/content/` – Content-Script (IIFE in einer einzigen Datei): Ermittlung der DOM-Kandidaten → Platzhalter-Serialisierung → viewport-gesteuerte Übersetzung → Injektion mit ererbten Stilen
- Nachrichtenprotokoll in `src/shared/protocol.ts`; ein einziges Konfigurationsobjekt mit Normalisierung beim Einlesen (`normalizeConfig`)

## Datenschutz

- Alle HTTP-Anfragen gehen ausschließlich vom Background-Service-Worker aus; Content-Scripts greifen niemals auf das Netzwerk zu
- Keine Konten, keinerlei Datenübermittlung
- API-Schlüssel werden ausschließlich in `chrome.storage.local` gespeichert
- Bei aktivierter Maskierung verlassen sensible Daten niemals Ihr Gerät
- Vollständige Datenschutzerklärung: [PRIVACY.md](./PRIVACY.md)

## Einreichung im Store (Chrome Web Store / Edge Add-ons)

Die Compliance-Arbeiten für die 2026er-Richtlinien beider Stores sind abgeschlossen:

- **Minimale Berechtigungen**: nur `storage` + `contextMenus`; `host_permissions` listet ausschließlich Engine-Domains; eigene oder selbst gehostete Endpunkte nutzen `optional_host_permissions`, die beim Speichern angefragt werden
- **Kein Remote-Code**: die gesamte Logik wird im Paket ausgeliefert; kein `eval`
- **Lesbarer Code**: `npm run build:store` erzeugt ein nicht minifiziertes Paket für die Store-Prüfung
- **Datenschutzerklärung**: [PRIVACY.md](./PRIVACY.md) (vor der Einreichung unter einer öffentlichen URL bereitstellen)
- **Store-Eintrag**: [store-assets/listing.md](./store-assets/listing.md) und [docs/store-listing/](./docs/store-listing/) (zh_CN/en)
- **Metadaten in 10 Sprachen**: `_locales/` mit `__MSG_`-Platzhaltern im Manifest

## Roadmap (noch nicht implementiert)

- YouTube Shorts, Netflix-Untertitel (YouTube /watch ist bereits umgesetzt)
- Layouttreuer PDF-Export (derzeit zweisprachiges HTML), OCR für gescannte PDFs
- Bildübersetzung
- Firefox-Anpassung (minimale Manifest-Unterschiede)
- Synchronisierung (WebDAV/Gist)

## Lizenz

GPL-3.0 (im Einklang mit KISS Translator / FluentRead / Read Frog).
Die Referenzprojekte wurden ausschließlich im Hinblick auf ihre Architektur untersucht; es wurde kein Code direkt kopiert.
