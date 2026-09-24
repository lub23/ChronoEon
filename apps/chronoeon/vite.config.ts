import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;
// The shell's own version (tauri.conf.json mirrors it), surfaced in Settings.
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "0.0.0.0",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // src-tauri is Rust (not Vite source); .audit holds CDP probe scripts and
    // screenshots written *while the dev server runs* — its ephemeral .tmp
    // files make the recursive watcher crash with EBUSY, so never watch it.
    watch: { ignored: ["**/src-tauri/**", "**/.audit/**"] }
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG)
  }
});
