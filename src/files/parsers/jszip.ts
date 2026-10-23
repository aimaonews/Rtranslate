/**
 * jszip CJS 互操作解包。
 * jszip 的 d.ts 是 `export = JSZip`（无 esModuleInterop 的项目里只能 `import * as`），
 * 但 ESM 打包器（vite/esbuild/rollup/vitest SSR）会把真正的类挂到 namespace.default 上，
 * 经典 TS 运行时则直接给类本身。这里统一解包成"既可 new 又有 loadAsync 的类"。
 */
import * as JSZipImport from 'jszip'

/** 解包后的 JSZip 类（类型沿用官方 d.ts 的 export= 实体） */
export const JSZip = (
  (JSZipImport as unknown as { default?: unknown }).default ?? JSZipImport
) as unknown as typeof JSZipImport

/** JSZip 实例类型 */
export type JSZipInstance = InstanceType<typeof JSZipImport>
