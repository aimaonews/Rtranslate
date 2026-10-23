// 可注入 fetch：所有引擎的网络访问统一走 getFetch()，测试用 setFetchImpl 替换，
// 避免真实 HTTP。默认取 globalThis.fetch（background service worker 环境）。
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

let injected: FetchLike | null = null

export function getFetch(): FetchLike {
  if (injected) return injected
  const f = globalThis.fetch
  if (!f) throw new Error('engines/fetch: global fetch is not available')
  return f.bind(globalThis) as FetchLike
}

/** 传 null 恢复默认 fetch。 */
export function setFetchImpl(fn: FetchLike | null): void {
  injected = fn
}

/** 非 2xx 统一抛错，挂 statusCode 供管线重试分类器快速失败（interline mt.ts 的约定）。 */
export function httpError(prefix: string, res: Response): Error & { statusCode: number } {
  return Object.assign(new Error(`${prefix}: HTTP ${res.status} ${res.statusText}`), { statusCode: res.status })
}
