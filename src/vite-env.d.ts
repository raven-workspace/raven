/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" renders the workspace shell (`npm run tauri:overhaul`, src/lib/shell.ts). */
  readonly VITE_RAVEN_WORKSPACE?: string;
}
