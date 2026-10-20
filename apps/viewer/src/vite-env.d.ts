/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time screen transport: `auto` (default), `websocket` or `sse`. See `readTransport`. */
  readonly VITE_VIEWER_TRANSPORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
