import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tauriRoot = join(appRoot, "src-tauri");
const manifest = join(tauriRoot, "Cargo.toml");
const config = JSON.parse(readFileSync(join(tauriRoot, "tauri.conf.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
const capabilityPath = join(tauriRoot, "capabilities", "default.json");
const capability = existsSync(capabilityPath) ? JSON.parse(readFileSync(capabilityPath, "utf8")) : null;
const requiredWindowPermissions = [
  "core:window:allow-minimize",
  "core:window:allow-toggle-maximize",
  "core:window:allow-unmaximize",
  "core:window:allow-close",
  "core:window:allow-start-dragging",
  "core:window:allow-start-resize-dragging",
  "core:window:allow-set-always-on-top",
  "dialog:allow-open",
  "dialog:allow-save",
];
const requiredIcons = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico"];
const failures = [];

if (config.productName !== "ChronoEon") failures.push("Tauri productName is not ChronoEon");
if (config.identifier !== "app.chronoeon.desktop") failures.push("Tauri identifier changed unexpectedly");
if (config.app?.windows?.[0]?.decorations !== false) failures.push("main window must remain frameless (decorations=false)");
if (!packageJson.scripts.build || !packageJson.scripts.tauri) failures.push("primary app build/tauri scripts are missing");
for (const icon of requiredIcons) {
  if (!existsSync(join(tauriRoot, "icons", icon))) failures.push(`missing Windows bundle icon: ${icon}`);
}
if (!capability) failures.push("missing Tauri capability file");
for (const permission of requiredWindowPermissions) {
  if (!capability?.permissions?.includes(permission)) failures.push(`missing required desktop permission: ${permission}`);
}
if (!existsSync(join(tauriRoot, "Cargo.lock"))) failures.push("missing Cargo.lock (reproducible native dependency resolution)");
if (process.platform === "win32") {
  // These optional packages are platform-specific. A repository copied from
  // Ubuntu can otherwise pass TypeScript and fail only when Vite/Vitest starts.
  const workspaceRoot = join(appRoot, "..", "..");
  const esbuildBinaryCandidates = [
    join(workspaceRoot, "node_modules", "@esbuild", "win32-x64", "esbuild.exe"),
    // npm can keep the optional platform binary nested under Vite.
    join(workspaceRoot, "node_modules", "vite", "node_modules", "@esbuild", "win32-x64", "esbuild.exe"),
  ];
  if (!esbuildBinaryCandidates.some(existsSync)) {
    failures.push("missing @esbuild/win32-x64; run npm install --include=optional --global=false");
  }
  const rolldownBinding = join(workspaceRoot, "node_modules", "@rolldown", "binding-win32-x64-msvc");
  if (!existsSync(rolldownBinding)) failures.push("missing @rolldown/binding-win32-x64-msvc; reinstall optional dependencies");
}

if (failures.length) {
  console.error("Windows readiness check failed:");
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log("[1/3] Building the production frontend?");
if (process.platform === "win32") {
  // `spawnSync("npm.cmd")` returns EINVAL in some Node 22 installations;
  // invoke the normal command shell explicitly so npm works from PowerShell,
  // CI and a direct `node verify-windows.mjs` call alike.
  execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run build"], { cwd: appRoot, stdio: "inherit" });
} else {
  execFileSync("npm", ["run", "build"], { cwd: appRoot, stdio: "inherit" });
}

let nativeEvidence = "metadata only (run on Windows CI for native evidence)";
if (process.platform === "win32") {
  console.log("[2/3] Checking the native Tauri shell on Windows…");
  execFileSync("cargo", ["check", "--locked", "--manifest-path", manifest], { cwd: appRoot, stdio: "inherit" });
  nativeEvidence = "native Windows cargo check passed";
} else {
  const target = "x86_64-pc-windows-gnu";
  let installedTargets = "";
  try {
    installedTargets = execFileSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
  } catch {
    // Rust is optional for the metadata-only form of this verifier.
  }
  const localMingw = join(homedir(), ".local", "mingw", "bin");
  const crossEnv = { ...process.env, PATH: `${localMingw}${delimiter}${process.env.PATH ?? ""}` };
  const crossCompiler = join(localMingw, "x86_64-w64-mingw32-gcc");
  const crossResourceCompiler = join(localMingw, "x86_64-w64-mingw32-windres");
  if (installedTargets.includes(target) && existsSync(crossCompiler) && existsSync(crossResourceCompiler)) {
    console.log("[2/3] Cross-checking and linking the native Windows executable from Linux…");
    execFileSync("cargo", ["check", "--locked", "--manifest-path", manifest, "--target", target], { cwd: appRoot, env: crossEnv, stdio: "inherit" });
    execFileSync("cargo", ["build", "--locked", "--manifest-path", manifest, "--target", target, "--bin", "chronoeon-app"], { cwd: appRoot, env: crossEnv, stdio: "inherit" });
    nativeEvidence = "Windows GNU cargo check + PE32+ executable link passed";
  } else {
    console.log("[2/3] Cross toolchain not present; native compilation is delegated to .github/workflows/windows.yml.");
  }
}

console.log("[3/3] ChronoEon Windows readiness: PASS");
console.log(`  product: ${config.productName} (${config.identifier})`);
console.log("  frontend: production build passed");
console.log(`  native: ${nativeEvidence}`);
console.log("  icons: Windows ICO and PNG bundle assets present");
console.log("  capabilities: dialog + window controls are explicitly declared");
