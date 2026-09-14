/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_AI_KEY?: string;
  readonly VITE_DEFAULT_AI_PROVIDER?: string;
  readonly VITE_DEFAULT_AI_MODEL?: string;
  /** 西柚洞察 MCP Token，首次加载可预填到设置 */
  readonly VITE_DEFAULT_XYDC_SECRET_KEY?: string;
  /** 卖家精灵 Secret Key，首次加载可预填到设置 */
  readonly VITE_DEFAULT_SELLERSPRITE_SECRET_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * 构建指纹（由 vite.config.ts 的 define 注入）。
 * 用途：用户说"我刷新了还是没变化"时，一眼看出他打开的是哪一次构建 ——
 * 这个项目已经为此来回猜过好几次（推送成功、但用户看的地址是旧部署/生产域名）。
 * 格式：`<短 commit 或 local> · <构建时间>`；Vercel 上会自动带上 VERCEL_GIT_COMMIT_SHA。
 */
declare const __BUILD_STAMP__: string;
