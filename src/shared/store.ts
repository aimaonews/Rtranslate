import { createEmptyCard, type Card } from 'ts-fsrs'
import { DEFAULT_CONFIG, normalizeConfig, type Config } from './config'
import type { WordItem } from './protocol'
import { genId } from './ids'

const KEY_CONFIG = 'tv:config_v1'
const KEY_WORDS = 'tv:words_v1'

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key] as T | undefined))
  })
}

function storageSet(obj: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve))
}

// ===== config =====

export async function getConfig(): Promise<Config> {
  const raw = await storageGet<unknown>(KEY_CONFIG)
  return normalizeConfig(raw ?? DEFAULT_CONFIG)
}

export async function setConfig(patch: Partial<Config>): Promise<Config> {
  const current = await getConfig()
  const next: Config = { ...current, ...patch, version: 1 }
  await storageSet({ [KEY_CONFIG]: next })
  return next
}

/** 监听配置变化（popup/options 修改后 content 热同步） */
export function watchConfig(cb: (config: Config) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY_CONFIG]) {
      cb(normalizeConfig(changes[KEY_CONFIG].newValue))
    }
  })
}

// ===== wordbook =====

export async function getWords(): Promise<WordItem[]> {
  return (await storageGet<WordItem[]>(KEY_WORDS)) ?? []
}

async function saveWords(words: WordItem[]): Promise<void> {
  await storageSet({ [KEY_WORDS]: words })
}

export function toWordCard(card: Card): WordItem['card'] {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    learning_steps: card.learning_steps,
    last_review: card.last_review?.getTime(),
  }
}

export function toFsrsCard(c: WordItem['card']): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as Card['state'],
    learning_steps: c.learning_steps ?? 0,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  }
}

export async function addWord(input: {
  word: string
  context?: string
  translation?: string
  sourceLang?: string
  targetLang?: string
  note?: string
  pageUrl?: string
  pageTitle?: string
}): Promise<WordItem> {
  const words = await getWords()
  const existing = words.find((w) => w.word.toLowerCase() === input.word.toLowerCase())
  if (existing) {
    existing.seenCount += 1
    if (input.context && !existing.context) existing.context = input.context
    if (input.translation && !existing.translation) existing.translation = input.translation
    if (input.pageUrl && !existing.pageUrl) existing.pageUrl = input.pageUrl
    if (input.pageTitle && !existing.pageTitle) existing.pageTitle = input.pageTitle
    await saveWords(words)
    return existing
  }
  const item: WordItem = {
    id: genId(),
    word: input.word,
    context: input.context,
    translation: input.translation,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    note: input.note,
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    createdAt: Date.now(),
    seenCount: 1,
    card: toWordCard(createEmptyCard()),
  }
  words.push(item)
  await saveWords(words)
  return item
}

export async function deleteWord(id: string): Promise<void> {
  const words = await getWords()
  await saveWords(words.filter((w) => w.id !== id))
}

export async function updateWord(id: string, updater: (w: WordItem) => WordItem): Promise<void> {
  const words = await getWords()
  const idx = words.findIndex((w) => w.id === id)
  if (idx >= 0) {
    words[idx] = updater(words[idx])
    await saveWords(words)
  }
}
