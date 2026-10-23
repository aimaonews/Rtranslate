# Rtranslate · Extensión de traducción bilingüe de código abierto

Una extensión de navegador Manifest V3 reconstruida a partir de lo mejor de seis excelentes proyectos de traducción de código abierto. **Sin cuentas, sin telemetría y sin servidores intermedios.**

[简体中文](./docs/zh_CN.md) | [繁體中文](./docs/zh_TW.md) | [日本語](./docs/ja.md) | [한국어](./docs/ko.md) | [Deutsch](./docs/de.md) | [Español](./docs/es.md) | [Français](./docs/fr.md) | [Português (Brasil)](./docs/pt_BR.md)

| Proyecto de origen | Capacidades absorbidas |
|---|---|
| KISS Translator | Serialización de texto enriquecido mediante marcadores de posición (`{{n}}` conserva la estructura en línea), traducción por lotes con LLM (protocolo JSON numerado), traducción de selección, al pasar el cursor y en cuadros de entrada |
| FluentRead | Arquitectura por capas (núcleo de lógica pura sin ninguna API del navegador), asistente de lectura con IA (significado/gramática/uso/práctica) |
| Read Frog | Libro de palabras + repaso con tarjetas FSRS dentro de la extensión (ts-fsrs), resaltado de vocabulario en la página |
| Interline | Motores listos para usar sin necesidad de claves, 13 estilos de traducción, claves de caché invalidadas automáticamente según la firma del glosario |
| OpenImmersive Translator | Enmascaramiento local de PII (marcadores de posición `__PII_*__` + restauración tolerante a fallos), cadena de motores gratuitos con conmutación por error tras un periodo de espera de 60 s |
| MTranBrowser | Traducción dirigida por el viewport mediante IntersectionObserver, copia de los estilos calculados (la traducción respeta la tipografía del original), atajos de teclado al pasar el cursor, bola flotante |

## Funcionalidades

- **Traducción bilingüe de páginas**: original y traducción lado a lado; traducción diferida dirigida por el viewport; 13 estilos de visualización (gris suave, resaltado, tarjeta, cita, degradado, cristal esmerilado, autoevaluación con máscara de desenfoque…)
- **Traducción de documentos** (12 formatos): PDF, EPUB, DOCX, PPTX, XLSX, HTML, JSON, TXT, Markdown, SRT, VTT, ASS — arrastrar y soltar, exportación bilingüe o solo de la traducción, edición previa a la descarga
- **Subtítulos de vídeo y de reuniones**: subtítulos bilingües de YouTube (análisis de json3/XML, resegmentación por ASR, anticipación de 30 s); traducción de subtítulos en directo para Google Meet / Teams / Zoom
- **Multimotor**: cadena gratuita Google/Microsoft/MyMemory con conmutación automática por error; DeepL; endpoints compatibles con OpenAI (OpenAI/DeepSeek/cualquier API compatible); Claude; Gemini; LibreTranslate (autoalojable); protocolo JSON personalizado; AI Mao (nuestro servicio alojado)
- **Expertos de IA**: estrategias de traducción mediante prompts personalizados con 5 preajustes integrados (general/técnico/literario/académico/redes sociales)
- **Bibliotecas de terminología de IA**: 6 glosarios temáticos integrados (programación/Web3/Twitter/AO3/educación/videojuegos, procedentes de immersive-translate/terms) + bibliotecas personalizadas + extracción de términos con IA
- **Escritura con IA**: pulir/continuar/resumir/responder/traducir desde la burbuja de selección, con controles de tono y longitud
- **Traducción por lotes**: los motores de IA agrupan varios párrafos en una sola solicitud — más rápido y más económico
- **Protección de la privacidad**: enmascaramiento local opcional de PII — los correos electrónicos, teléfonos, tarjetas bancarias, números de identificación y claves de API se enmascaran localmente antes del envío y se restauran tras la traducción
- **Traducción de selección, al pasar el cursor y en cuadros de entrada** (Alt+Enter o triple espacio)
- **Asistente de lectura con IA**: significado, análisis gramatical, notas de uso, generación de ejercicios y chat de seguimiento en varios turnos
- **Libro de palabras + tarjetas FSRS**: guardado de palabras con un clic, con la frase de contexto y el enlace a la fuente; repaso con repetición espaciada
- **Glosario**: terminología personalizada para traducciones coherentes
- **Bola flotante, atajo Alt+T, menú contextual y ventana Alt+D de comparación entre motores**
- **10 idiomas de interfaz** (se ajustan automáticamente al idioma del navegador o de forma manual), asistente de bienvenida en la primera instalación

## Instalación (modo de desarrollador)

```bash
npm install
npm run build        # outputs dist/
```

En Edge/Chrome, abre `edge://extensions` / `chrome://extensions` → activa el **modo de desarrollador** → **Cargar descomprimida** → selecciona el directorio `dist/`.

## Desarrollo

```bash
npm run test         # vitest (pure-logic core + engine mocks + translation pipeline, 589 tests)
npm run typecheck    # tsc --noEmit
npm run build        # triple vite build (pages/background + content IIFE + subtitles IIFE)
```

Pruebas de extremo a extremo (requieren Edge):

```bash
node scripts/e2e/serve.mjs 8137 &                 # static test page
# start the browser with --enable-unsafe-extensions-debugging, then:
node scripts/e2e/load-unpacked.mjs <absolute dist path>
node scripts/e2e/drive.mjs                        # six phases: page/selection/input/PII restore/wordbook FSRS/review
```

## Arquitectura

Consulta [ARCHITECTURE.md](./ARCHITECTURE.md). Aspectos destacados:

- `src/core/` — lógica pura (enmascaramiento/glosario/texto/detección/idiomas/estilos), sin ninguna API del navegador, con cobertura completa de pruebas unitarias
- `src/background/` — un único pipeline de traducción: caché → enmascaramiento de PII → glosario → enrutamiento de motores (cadena gratuita / BYOK) → procesado por lotes → restauración inversa → escritura de vuelta
- `src/content/` — script de contenido (IIFE de un solo archivo): detección de candidatos en el DOM → serialización con marcadores de posición → traducción dirigida por el viewport → inyección con herencia de estilos
- Protocolo de mensajes en `src/shared/protocol.ts`; un único objeto de configuración con normalización en el momento de la lectura (`normalizeConfig`)

## Privacidad

- Todas las solicitudes HTTP se originan únicamente en el service worker en segundo plano; los scripts de contenido nunca acceden a la red
- Sin cuentas y sin informes de ningún tipo
- Las claves de API se almacenan únicamente en `chrome.storage.local`
- Con el enmascaramiento activado, los datos sensibles nunca salen de tu dispositivo
- Política de privacidad completa: [PRIVACY.md](./PRIVACY.md)

## Envío a las tiendas (Chrome Web Store / Edge Add-ons)

El trabajo de cumplimiento de las políticas de 2026 de ambas tiendas ya está completado:

- **Permisos mínimos**: solo `storage` + `contextMenus`; `host_permissions` incluye únicamente los dominios de los motores; los endpoints personalizados o autoalojados usan `optional_host_permissions`, que se solicitan al guardar
- **Sin código remoto**: toda la lógica se incluye en el paquete; sin `eval`
- **Código legible**: `npm run build:store` genera un paquete de revisión sin minificar
- **Política de privacidad**: [PRIVACY.md](./PRIVACY.md) (publícala en una URL pública antes del envío)
- **Ficha de la tienda**: [store-assets/listing.md](./store-assets/listing.md) y [docs/store-listing/](./docs/store-listing/) (zh_CN/en)
- **Metadatos en 10 idiomas**: `_locales/` con marcadores de posición `__MSG_` en el manifest

## Hoja de ruta (aún no implementado)

- Subtítulos de YouTube Shorts y Netflix (YouTube /watch ya está implementado)
- Exportación de PDF conservando el diseño (actualmente HTML bilingüe), OCR para PDF escaneados
- Traducción de imágenes
- Adaptación a Firefox (diferencias mínimas en el manifest)
- Sincronización (WebDAV/Gist)

## Licencia

GPL-3.0 (coherente con KISS Translator / FluentRead / Read Frog).
Los proyectos de referencia se estudiaron únicamente por su arquitectura; no se copió código directamente.
