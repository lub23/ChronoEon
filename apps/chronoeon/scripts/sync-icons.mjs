import { copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icons = path.join(root, "src-tauri", "icons");
await copyFile(path.join(icons, "32x32.png"), path.join(root, "public", "favicon.png"));
await copyFile(path.join(icons, "128x128.png"), path.join(root, "public", "icon-128.png"));
const androidBackground = path.join(root, "src-tauri", "gen", "android", "app", "src", "main", "res", "values", "ic_launcher_background.xml");
try {
  await writeFile(androidBackground, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#00000000</color>\n</resources>\n');
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
