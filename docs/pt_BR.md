# Rtranslate · Extensão de tradução bilíngue de código aberto

Uma extensão de navegador Manifest V3, reconstruída a partir do que há de melhor em seis excelentes projetos de tradução em código aberto. **Sem conta, sem telemetria, sem servidores intermediários.**

[简体中文](./docs/zh_CN.md) | [繁體中文](./docs/zh_TW.md) | [日本語](./docs/ja.md) | [한국어](./docs/ko.md) | [Deutsch](./docs/de.md) | [Español](./docs/es.md) | [Français](./docs/fr.md) | [Português (Brasil)](./docs/pt_BR.md)

| Projeto de origem | Capacidades absorvidas |
|---|---|
| KISS Translator | Serialização de rich text com placeholders (`{{n}}` preserva a estrutura inline), tradução em lote via LLM (protocolo JSON numerado), tradução de seleção/hover/campo de entrada |
| FluentRead | Arquitetura em camadas (núcleo de lógica pura, sem nenhuma API de navegador), assistente de leitura com IA (significado/gramática/uso/prática) |
| Read Frog | Wordbook + revisão de flashcards FSRS na própria extensão (ts-fsrs), destaque de vocabulário na página |
| Interline | Motores gratuitos prontos para uso, sem necessidade de chaves, 13 estilos de tradução, chaves de cache invalidadas automaticamente pela assinatura do glossário |
| OpenImmersive Translator | Mascaramento local de PII (placeholders `__PII_*__` + restauração tolerante a falhas), cadeia de motores gratuitos com failover após cooldown de 60s |
| MTranBrowser | Tradução orientada pelo viewport com IntersectionObserver, cópia dos estilos computados (a tradução acompanha a tipografia do original), atalhos de teclado para hover, bola flutuante |

## Funcionalidades

- **Tradução bilíngue de páginas**: original + tradução lado a lado; tradução sob demanda conforme o viewport; 13 estilos de exibição (cinza suave, destaque, cartão, citação, gradiente, vidro fosco, autoteste com máscara de desfoque…)
- **Tradução de documentos** (12 formatos): PDF, EPUB, DOCX, PPTX, XLSX, HTML, JSON, TXT, Markdown, SRT, VTT, ASS — arraste e solte, exportação bilíngue ou apenas da tradução, pós-edição antes do download
- **Legendas de vídeos e reuniões**: legendas bilíngues do YouTube (parsing de json3/XML, resegmentação de ASR, antecipação de 30s); tradução de legendas ao vivo para Google Meet / Teams / Zoom
- **Vários motores**: cadeia gratuita Google/Microsoft/MyMemory com failover automático; DeepL; endpoints compatíveis com OpenAI (OpenAI/DeepSeek/qualquer API compatível); Claude; Gemini; LibreTranslate (auto-hospedável); protocolo JSON personalizado; AI Mao (nosso serviço hospedado)
- **Especialistas de IA**: estratégias de tradução com prompts personalizados, incluindo 5 predefinições integradas (geral/técnico/literário/acadêmico/redes sociais)
- **Bibliotecas de terminologia com IA**: 6 glossários de domínio já integrados (programação/Web3/Twitter/AO3/educação/jogos, provenientes de immersive-translate/terms) + bibliotecas personalizadas + extração de termos com IA
- **Escrita com IA**: polir/continuar/resumir/responder/traduzir na bolha de seleção, com controles de tom e tamanho
- **Tradução em lote**: os motores de IA agrupam vários parágrafos em uma única requisição — mais rápido e mais barato
- **Proteção da privacidade**: mascaramento local opcional de PII — e-mails, telefones, cartões bancários, números de documentos e chaves de API são mascarados localmente antes do envio e restaurados após a tradução
- **Tradução de seleção, hover e campo de entrada** (Alt+Enter ou três espaços)
- **Assistente de leitura com IA**: significado, análise gramatical, notas de uso, geração de exercícios e chat de acompanhamento com múltiplos turnos
- **Wordbook + flashcards FSRS**: salvamento de palavras em um clique, com o contexto da frase e o link da origem; revisão por repetição espaçada
- **Glossário**: terminologia personalizada para traduções consistentes
- **Bola flutuante, atalho Alt+T, menu de contexto, janela de comparação entre motores com Alt+D**
- **10 idiomas de interface** (acompanha automaticamente o idioma do navegador ou seleção manual), assistente de primeiros passos na primeira instalação

## Instalação (modo do desenvolvedor)

```bash
npm install
npm run build        # outputs dist/
```

Edge/Chrome → `edge://extensions` / `chrome://extensions` → ative o **Modo do desenvolvedor** → clique em **Carregar descompactado** → selecione o diretório `dist/`.

## Desenvolvimento

```bash
npm run test         # vitest (pure-logic core + engine mocks + translation pipeline, 589 tests)
npm run typecheck    # tsc --noEmit
npm run build        # triple vite build (pages/background + content IIFE + subtitles IIFE)
```

Testes de ponta a ponta (requerem o Edge):

```bash
node scripts/e2e/serve.mjs 8137 &                 # static test page
# start the browser with --enable-unsafe-extensions-debugging, then:
node scripts/e2e/load-unpacked.mjs <absolute dist path>
node scripts/e2e/drive.mjs                        # six phases: page/selection/input/PII restore/wordbook FSRS/review
```

## Arquitetura

Consulte o [ARCHITECTURE.md](./ARCHITECTURE.md). Destaques:

- `src/core/` — lógica pura (mask/glossary/text/detect/langs/styles), sem nenhuma API de navegador, totalmente coberta por testes de unidade
- `src/background/` — um único pipeline de tradução: cache → mascaramento de PII → glossário → roteamento de motores (cadeia gratuita / BYOK) → agrupamento em lote → restauração reversa → escrita de volta
- `src/content/` — content script (IIFE de arquivo único): descoberta de candidatos no DOM → serialização com placeholders → tradução orientada pelo viewport → injeção com herança de estilos
- Protocolo de mensagens em `src/shared/protocol.ts`; objeto de configuração único, com normalização no momento da leitura (`normalizeConfig`)

## Privacidade

- Todas as requisições HTTP partem apenas do service worker em segundo plano; os content scripts nunca acessam a rede
- Sem contas e sem qualquer tipo de relatório
- As chaves de API ficam armazenadas somente em `chrome.storage.local`
- Com o mascaramento ativado, os dados sensíveis nunca saem do seu dispositivo
- Política de privacidade completa: [PRIVACY.md](./PRIVACY.md)

## Envio para as lojas (Chrome Web Store / Edge Add-ons)

O trabalho de conformidade com as políticas de 2026 de ambas as lojas já está concluído:

- **Permissões mínimas**: apenas `storage` + `contextMenus`; `host_permissions` lista somente os domínios dos motores; endpoints personalizados ou auto-hospedados usam `optional_host_permissions`, solicitadas no momento de salvar
- **Sem código remoto**: toda a lógica vem no pacote; sem `eval`
- **Código legível**: `npm run build:store` gera um pacote de revisão não minificado
- **Política de privacidade**: [PRIVACY.md](./PRIVACY.md) (publique em uma URL pública antes de enviar)
- **Listagem na loja**: [store-assets/listing.md](./store-assets/listing.md) e [docs/store-listing/](./docs/store-listing/) (zh_CN/en)
- **Metadados em 10 idiomas**: `_locales/` com placeholders `__MSG_` no manifest

## Roadmap (ainda não implementado)

- YouTube Shorts, legendas da Netflix (o /watch do YouTube já está pronto)
- Exportação de PDF com preservação do layout (atualmente, HTML bilíngue), OCR de PDFs digitalizados
- Tradução de imagens
- Adaptação para o Firefox (diferenças mínimas no manifest)
- Sincronização (WebDAV/Gist)

## Licença

GPL-3.0 (coerente com KISS Translator / FluentRead / Read Frog).
Os projetos de referência foram estudados apenas pela arquitetura; nenhum código foi copiado diretamente.
