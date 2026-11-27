import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { auditApiPlugin } from "./src/audit/vitePlugin.ts";
const host = process.env.TAURI_DEV_HOST;
// `npm run tauri:overhaul` serves on its own port (matching its devUrl), so it can run beside a plain `tauri dev`.
const port = Number(process.env.RAVEN_DEV_PORT ?? 1420);
if (!Number.isInteger(port) || port < 1024 || port > 65534) {
  throw new Error(`RAVEN_DEV_PORT must be a port from 1024 to 65534, got ${process.env.RAVEN_DEV_PORT}`);
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "audit" ? [auditApiPlugin()] : [])],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: port + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
