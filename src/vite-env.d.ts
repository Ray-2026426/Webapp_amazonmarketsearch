/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_AI_KEY?: string;
  readonly VITE_DEFAULT_AI_PROVIDER?: string;
  readonly VITE_DEFAULT_AI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
