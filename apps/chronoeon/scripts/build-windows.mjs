import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { windowsToolchain } from "./windows-toolchain.mjs";

if (process.platform !== "win32") throw new Error("Run windows:build on Windows. / 请在 Windows 上运行 windows:build。");
const result = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve("@tauri-apps/cli/tauri.js")), "build", ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: windowsToolchain(),
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
