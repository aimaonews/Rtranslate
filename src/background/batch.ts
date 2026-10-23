/**
 * background/batch.ts — LLM 聚合翻译队列（BatchQueue，契约 §7 第 5 步）。
 *
 * 时间窗攒批：首个任务入队启动 intervalMs 定时器，窗口内按 key 聚合；
 * 双阈值截断 —— 任务数达到 maxTexts 立即发批，累计字符达到 maxChars 立即发批，
 * 单条自身超 maxChars 时独占一批。同 key 并发槽（concurrency）限制在飞的批数，
 * 超出的批排队等待空槽。
 *
 * 一批失败时逐条 fallback：优先用调用方提供的 fallbackSingles(text)（管线层传入
 * 逐条 engine.translate），缺省时用 taskFn([t]) 单条重试；仍失败的条目单独 reject，
 * 不拖垮同批其它条目。
 */

export interface BatchQueueOptions {
  intervalMs: number
  maxTexts: number
  maxChars: number
  concurrency: number
}

export interface BatchQueueExtra {
  /** 批失败后的逐条兜底（管线层传 engine.translate 单发）。 */
  fallbackSingles?: (text: string) => Promise<string>
}

export interface BatchQueue {
  addTask(text: string): Promise<string>
}

interface PendingTask {
  text: string
  resolve: (value: string) => void
  reject: (reason?: unknown) => void
}

class KeyBatchQueue implements BatchQueue {
  private pending: PendingTask[] = []
  private pendingChars = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = 0
  private waiting: PendingTask[][] = []

  constructor(
    private readonly taskFn: (texts: string[]) => Promise<string[]>,
    private readonly opts: BatchQueueOptions,
    private readonly extra: BatchQueueExtra = {},
  ) {}

  addTask(text: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // 双阈值截断：本条加入会超出 maxChars 且缓冲非空 → 先发当前批，本条开新批
      if (this.pending.length > 0 && this.pendingChars + text.length > this.opts.maxChars) {
        this.flush()
      }
      this.pending.push({ text, resolve, reject })
      this.pendingChars += text.length
      if (this.pending.length === 1) this.armTimer()
      if (this.pending.length >= this.opts.maxTexts || this.pendingChars >= this.opts.maxChars) {
        this.flush()
      }
    })
  }

  private armTimer(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.opts.intervalMs)
  }

  /** 把当前缓冲打包入队等待并发槽。 */
  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    this.pendingChars = 0
    this.waiting.push(batch)
    this.pump()
  }

  /** 同 key 并发槽：inFlight 上限 concurrency，空槽时派发等待中的批。 */
  private pump(): void {
    while (this.inFlight < this.opts.concurrency && this.waiting.length > 0) {
      const batch = this.waiting.shift() as PendingTask[]
      this.inFlight++
      void this.dispatch(batch).finally(() => {
        this.inFlight--
        this.pump()
      })
    }
  }

  private async dispatch(batch: PendingTask[]): Promise<void> {
    const texts = batch.map((t) => t.text)
    try {
      const results = await this.taskFn(texts)
      batch.forEach((task, i) => task.resolve(results[i] ?? task.text))
      return
    } catch {
      // 整批失败 → 逐条兜底，单条失败只 reject 该条
    }
    await Promise.all(
      batch.map(async (task) => {
        try {
          const single = this.extra.fallbackSingles
            ? await this.extra.fallbackSingles(task.text)
            : ((await this.taskFn([task.text]))[0] ?? task.text)
          task.resolve(single)
        } catch (err) {
          task.reject(err)
        }
      }),
    )
  }
}

const queues = new Map<string, BatchQueue>()

/** 按 key 复用队列（同 key 共享节流窗口与并发槽）。 */
export function getBatchQueue(
  key: string,
  taskFn: (texts: string[]) => Promise<string[]>,
  opts: BatchQueueOptions,
  extra?: BatchQueueExtra,
): BatchQueue {
  let q = queues.get(key)
  if (!q) {
    q = new KeyBatchQueue(taskFn, opts, extra)
    queues.set(key, q)
  }
  return q
}

/** 清空全部队列（测试隔离用）。 */
export function resetBatchQueues(): void {
  queues.clear()
}
