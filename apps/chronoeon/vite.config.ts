import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
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
