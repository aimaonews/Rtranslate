// 隐私政策页：内置页面，不跳转外部站点。仅英文（商店审核语言）。

interface PrivacySection {
  title: string
  body?: string[]
  list?: string[]
}

interface PrivacyContent {
  updated: string
  sections: PrivacySection[]
}

const EN: PrivacyContent = {
  updated: '2026-10-23',
  sections: [
    {
      title: 'Who we are',
      body: ['Rtranslate is an open-source browser translation extension (GPL-3.0). This extension has no servers: we operate no backend, collect no analytics, show no ads, and have no accounts.'],
    },
    {
      title: 'What data the extension handles',
      body: ['When and only when you request a translation, the text to be translated is sent directly from your browser to the translation provider you choose. Text is never routed through servers we operate.'],
      list: [
        'Free engines: Google Translate, Microsoft Translator, MyMemory',
        'Bring-your-own-key engines: DeepL, OpenAI-compatible endpoints (OpenAI / DeepSeek / any compatible endpoint), Claude, Gemini, self-hostable LibreTranslate, AI Mao',
      ],
    },
    {
      title: 'Optional sensitive-data masking',
      body: ['You can enable "Sensitive data masking" in settings: email addresses, phone numbers, bank card numbers, ID numbers, and API keys are replaced with placeholders locally in your browser before being sent for translation, and restored locally afterwards. Sensitive original text never leaves your device.'],
    },
    {
      title: 'API keys',
      body: ['Keys you enter (DeepL / OpenAI, etc.) are stored only in chrome.storage.local and are used solely to authenticate requests to the provider you configured. They are never transmitted anywhere else.'],
    },
    {
      title: 'Wordbook',
      body: ['Saved words and flashcard review records stay in local browser storage and are never uploaded.'],
    },
    {
      title: 'What we do NOT do',
      list: [
        'No browsing-history collection, no behavior tracking, no telemetry or analytics',
        'No sale, sharing, or transfer of user data',
        'No ads, no browser-setting changes',
        'No remote code execution (all program logic ships inside the extension package)',
      ],
    },
    {
      title: 'Your controls',
      list: [
        'Switch translation engines anytime; choose self-hosted engines so text never leaves your network',
        'Enable masking to protect sensitive content',
        'Delete data: uninstalling the extension removes all local data; the wordbook and translation cache can also be cleared from the options page',
      ],
    },
  ],
}

const app = document.getElementById('app')!
if (app) {
  app.className = 'wrap'

  const brand = document.createElement('div')
  brand.className = 'brand'
  const logo = document.createElement('img')
  logo.src = chrome.runtime.getURL('icons/icon128.png')
  logo.alt = 'Rtranslate'
  const name = document.createElement('span')
  name.className = 'brand-name'
  name.textContent = 'Rtranslate'
  brand.append(logo, name)
  app.appendChild(brand)

  const updated = document.createElement('p')
  updated.className = 'updated'
  updated.textContent = `Effective date: ${EN.updated}`
  app.appendChild(updated)

  for (const sec of EN.sections) {
    const h = document.createElement('h2')
    h.textContent = sec.title
    app.appendChild(h)
    for (const p of sec.body ?? []) {
      const el = document.createElement('p')
      el.textContent = p
      app.appendChild(el)
    }
    if (sec.list) {
      const ul = document.createElement('ul')
      for (const item of sec.list) {
        const li = document.createElement('li')
        li.textContent = item
        ul.appendChild(li)
      }
      app.appendChild(ul)
    }
  }
}
