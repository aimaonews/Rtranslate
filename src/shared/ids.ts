let counter = 0
/** 足够唯一的本地 id：时间戳 + 随机 + 递增 */
export function genId(): string {
  counter = (counter + 1) % 1296
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + counter.toString(36)
}
