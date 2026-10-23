# Rtranslate · Extension de traduction bilingue open source

Une extension de navigateur Manifest V3, reconstruite en reprenant le meilleur de six excellents projets de traduction open source. **Sans compte, sans télémétrie, sans serveur intermédiaire.**

[简体中文](./docs/zh_CN.md) | [繁體中文](./docs/zh_TW.md) | [日本語](./docs/ja.md) | [한국어](./docs/ko.md) | [Deutsch](./docs/de.md) | [Español](./docs/es.md) | [Français](./docs/fr.md) | [Português (Brasil)](./docs/pt_BR.md)

| Projet source | Fonctionnalités reprises |
|---|---|
| KISS Translator | Sérialisation du texte riche en placeholders (`{{n}}` préserve la structure en ligne), traduction par lots via LLM (protocole JSON numéroté), traduction de sélection, au survol et dans les champs de saisie |
| FluentRead | Architecture en couches (cœur de logique pure sans aucune API de navigateur), assistant de lecture IA (sens/grammaire/usage/exercices) |
| Read Frog | Carnet de mots + révision de cartes FSRS intégrée à l'extension (ts-fsrs), surlignage du vocabulaire dans la page |
| Interline | Moteurs prêts à l'emploi sans clé API, 13 styles de traduction, clés de cache auto-invalidées par la signature du glossaire |
| OpenImmersive Translator | Masquage local des PII (placeholders `__PII_*__` + restauration tolérante aux pannes), chaîne de moteurs gratuits avec basculement automatique (temporisation de 60 s) |
| MTranBrowser | Traduction pilotée par le viewport via IntersectionObserver, copie des styles calculés (la traduction reprend la typographie de l'original), raccourcis au survol, balle flottante |

## Fonctionnalités

- **Traduction bilingue des pages** : original et traduction côte à côte ; traduction différée pilotée par le viewport ; 13 styles d'affichage (gris doux, surlignage, carte, citation, dégradé, verre dépoli, auto-test par masque flouté…)
- **Traduction de documents** (12 formats) : PDF, EPUB, DOCX, PPTX, XLSX, HTML, JSON, TXT, Markdown, SRT, VTT, ASS — glisser-déposer, export bilingue ou en traduction seule, post-édition avant téléchargement
- **Sous-titres de vidéos et de réunions** : sous-titres YouTube bilingues (analyse json3/XML, re-segmentation ASR, anticipation de 30 s) ; traduction en direct des sous-titres pour Google Meet / Teams / Zoom
- **Multi-moteurs** : chaîne gratuite Google/Microsoft/MyMemory avec basculement automatique ; DeepL ; points de terminaison compatibles OpenAI (OpenAI/DeepSeek/n'importe quelle API compatible) ; Claude ; Gemini ; LibreTranslate (auto-hébergeable) ; protocole JSON personnalisé ; AI Mao (notre service hébergé)
- **Experts IA** : stratégies de traduction par prompts personnalisés, avec 5 préréglages intégrés (général/technique/littéraire/académique/réseaux sociaux)
- **Bibliothèques terminologiques IA** : 6 glossaires spécialisés intégrés (programmation/Web3/Twitter/AO3/éducation/jeux vidéo, issus d'immersive-translate/terms) + bibliothèques personnalisées + extraction de termes par IA
- **Rédaction IA** : polir/continuer/résumer/répondre/traduire depuis la bulle de sélection, avec contrôle du ton et de la longueur
- **Traduction par lots** : les moteurs IA regroupent plusieurs paragraphes en une seule requête — plus rapide et moins cher
- **Protection de la vie privée** : masquage local optionnel des PII — e-mails/numéros de téléphone/cartes bancaires/numéros de pièce d'identité/clés API sont masqués localement avant l'envoi et restaurés après la traduction
- **Traduction de sélection, au survol et dans les champs de saisie** (Alt+Entrée ou triple espace)
- **Assistant de lecture IA** : sens, analyse grammaticale, notes d'usage, génération d'exercices, conversation de suivi en plusieurs tours
- **Carnet de mots + cartes FSRS** : enregistrement d'un mot en un clic avec sa phrase de contexte et le lien vers la source ; révision par répétition espacée
- **Glossaire** : terminologie personnalisée pour des traductions cohérentes
- **Balle flottante, raccourci Alt+T, menu contextuel, fenêtre de comparaison multi-moteurs Alt+D**
- **10 langues d'interface** (suivi automatique de la langue du navigateur ou choix manuel), assistant de configuration au premier lancement

## Installation (mode développeur)

```bash
npm install
npm run build        # outputs dist/
```

Edge/Chrome → `edge://extensions` / `chrome://extensions` → activer le **Mode développeur** → **Charger l'extension non empaquetée** → sélectionner le répertoire `dist/`.

## Développement

```bash
npm run test         # vitest (pure-logic core + engine mocks + translation pipeline, 589 tests)
npm run typecheck    # tsc --noEmit
npm run build        # triple vite build (pages/background + content IIFE + subtitles IIFE)
```

Tests de bout en bout (Edge requis) :

```bash
node scripts/e2e/serve.mjs 8137 &                 # static test page
# start the browser with --enable-unsafe-extensions-debugging, then:
node scripts/e2e/load-unpacked.mjs <absolute dist path>
node scripts/e2e/drive.mjs                        # six phases: page/selection/input/PII restore/wordbook FSRS/review
```

## Architecture

Voir [ARCHITECTURE.md](./ARCHITECTURE.md). Points clés :

- `src/core/` — logique pure (masquage/glossaire/texte/détection/langues/styles), zéro API de navigateur, entièrement couverte par des tests unitaires
- `src/background/` — un seul pipeline de traduction : cache → masquage des PII → glossaire → routage des moteurs (chaîne gratuite / BYOK) → regroupement par lots → restauration inverse → réinjection
- `src/content/` — script de contenu (IIFE en fichier unique) : découverte des candidats dans le DOM → sérialisation en placeholders → traduction pilotée par le viewport → injection avec héritage des styles
- Protocole de messages dans `src/shared/protocol.ts` ; un seul objet de configuration, normalisé au moment de la lecture (`normalizeConfig`)

## Confidentialité

- Toutes les requêtes HTTP proviennent uniquement du service worker d'arrière-plan ; les scripts de contenu n'accèdent jamais au réseau
- Aucun compte, aucune remontée de données d'aucune sorte
- Les clés API sont stockées uniquement dans `chrome.storage.local`
- Avec le masquage activé, les données sensibles ne quittent jamais votre appareil
- Politique de confidentialité complète : [PRIVACY.md](./PRIVACY.md)

## Soumission aux boutiques (Chrome Web Store / Edge Add-ons)

La mise en conformité avec les politiques 2026 des deux boutiques est terminée :

- **Permissions minimales** : uniquement `storage` + `contextMenus` ; `host_permissions` ne liste que les domaines des moteurs ; les points de terminaison personnalisés ou auto-hébergés utilisent `optional_host_permissions`, demandé lors de l'enregistrement
- **Aucun code distant** : toute la logique est embarquée dans le paquet ; pas d'`eval`
- **Code lisible** : `npm run build:store` produit un paquet non minifié pour la revue
- **Politique de confidentialité** : [PRIVACY.md](./PRIVACY.md) (à déployer sur une URL publique avant la soumission)
- **Fiche de boutique** : [store-assets/listing.md](./store-assets/listing.md) et [docs/store-listing/](./docs/store-listing/) (zh_CN/en)
- **Métadonnées en 10 langues** : `_locales/` avec des placeholders `__MSG_` dans le manifeste

## Feuille de route (pas encore implémenté)

- YouTube Shorts, sous-titres Netflix (YouTube /watch est déjà pris en charge)
- Export PDF avec conservation de la mise en page (actuellement en HTML bilingue), OCR des PDF numérisés
- Traduction d'images
- Adaptation à Firefox (différences de manifeste minimales)
- Synchronisation (WebDAV/Gist)

## Licence

GPL-3.0 (en cohérence avec KISS Translator / FluentRead / Read Frog).
Les projets de référence n'ont été étudiés que pour leur architecture ; aucun code n'a été copié directement.
