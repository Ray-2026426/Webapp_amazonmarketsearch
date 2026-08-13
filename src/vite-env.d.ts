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
