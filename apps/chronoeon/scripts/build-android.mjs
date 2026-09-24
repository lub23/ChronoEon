#!/usr/bin/env node
/**
 * Build an installable arm64 Android APK.
 *
 * Tauri's own `tauri android build` drives Gradle, and Gradle's rust task
 * re-enters npm with `--release --target`, which npm 11+ rejects as unknown
 * config flags. This script runs the same three steps directly and stops before
 * signing unless a keystore is given:
 *
 *   1. build the frontend            (vite, embedded into the Rust library)
 *   2. build the Rust library        (cargo, aarch64-linux-android, custom protocol)
 *   3. assemble + align + sign       (Gradle, then apksigner)
 *
 * Environment (all optional when the SDK sits in a standard place):
 *   ANDROID_HOME / ANDROID_SDK_ROOT  SDK root            (default D:\Android\Sdk)
 *   NDK_HOME                         NDK version folder
 *   JAVA_HOME                        JDK 17 for Gradle
 *   CHRONOEON_KEYSTORE               .jks/.keystore; without it the APK is
 *                                    signed with the debug key so it installs
 *   CHRONOEON_KEYSTORE_PASSWORD      store + key password   (default: android)
 *   CHRONOEON_KEY_ALIAS              key alias              (default: androiddebugkey)
 *   CHRONOEON_SKIP_CARGO=1           reuse the existing Rust library. Needed when
 *                                    `perl` is absent: git2 vendors OpenSSL, whose
 *                                    Configure step is a Perl script.
 *
 * Usage: npm run android:apk
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriRoot = join(appRoot, "src-tauri");
const androidRoot = join(tauriRoot, "gen", "android");
const projectRoot = androidRoot;
const tauriConfig = JSON.parse(readFileSync(join(tauriRoot, "tauri.conf.json"), "utf8"));
const androidIdentifier = tauriConfig.identifier;
const androidLibrary = "chronoeon_lib";
const kotlinOutputDir = join(projectRoot, "app", "src", "main", "java", ...androidIdentifier.split("."), "generated");
const buildRoot = join(appRoot, "..", "..", ".build", "android");
const distRoot = join(appRoot, "dist");
const frontendRoots = [
  join(appRoot, "index.html"),
  join(appRoot, "src"),
  join(appRoot, "public"),
].filter(existsSync);

const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "D:\\Android\\Sdk";
const javaHome = process.env.JAVA_HOME ?? "";
const ndkRoot = process.env.NDK_HOME ?? newestDirectory(join(sdkRoot, "ndk"));
if (!ndkRoot) fail(`No NDK found under ${join(sdkRoot, "ndk")}; set NDK_HOME`);

const target = "aarch64-linux-android";
const abi = "arm64-v8a";
const toolchain = join(ndkRoot, "toolchains", "llvm", "prebuilt", platformFolder(), "bin");
const clangWrapper = join(toolchain, `aarch64-linux-android24-clang${process.platform === "win32" ? ".cmd" : ""}`);
// On Windows, OpenSSL's Makefile runs through sh and cannot execute the .cmd
// wrapper's embedded backslashed path. Callers can therefore point CC at
// clang.exe directly; the linker keeps the target-aware wrapper.
const posixPath = (value) => value.replace(/\\/g, "/");
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const clangBinary = posixPath(join(toolchain, "clang" + exeSuffix));
const clang = process.env[`CC_${target}`] ?? (process.platform === "win32" ? clangBinary : clangWrapper);
if (!existsSync(clang)) fail(`No NDK clang at ${clang}`);

const env = {
  ...process.env,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
  NDK_HOME: ndkRoot,
  ...(javaHome ? { JAVA_HOME: javaHome, PATH: `${join(javaHome, "bin")}${delimiter()}${process.env.PATH ?? ""}` } : {}),
  [`CC_${target}`]: clang,
  [`CXX_${target}`]: process.env[`CXX_${target}`] ?? clangBinary,
  [`AR_${target}`]: process.env[`AR_${target}`] ?? posixPath(join(toolchain, "llvm-ar" + exeSuffix)),
  [`RANLIB_${target}`]: process.env[`RANLIB_${target}`] ?? posixPath(join(toolchain, "llvm-ranlib" + exeSuffix)),
  [`CARGO_TARGET_${target.replace(/-/g, "_").toUpperCase()}_LINKER`]: clangWrapper,
  TAURI_ANDROID_PROJECT_PATH: projectRoot,
  TAURI_ANDROID_PACKAGE_UNESCAPED: androidIdentifier,
  WRY_ANDROID_PACKAGE: androidIdentifier,
  WRY_ANDROID_LIBRARY: androidLibrary,
  WRY_ANDROID_KOTLIN_FILES_OUT_DIR: kotlinOutputDir,
};
if (process.env.CHRONOEON_PERL) env.PATH = `${process.env.CHRONOEON_PERL}${delimiter()}${env.PATH}`;

mkdirSync(kotlinOutputDir, { recursive: true });
writeTauriProperties();

step("Frontend build", "npm", ["run", "build"], appRoot);
const library = join(tauriRoot, "target", target, "release", `libchronoeon_lib.so`);
if (process.env.CHRONOEON_SKIP_CARGO === "1") {
  if (!existsSync(library) || statSync(library).mtimeMs < Math.max(...frontendRoots.map(newestMtime))) {
    fail("`CHRONOEON_SKIP_CARGO=1` cannot reuse a Rust library older than frontendDist; " +
      "Tauri release embeds the frontend in that library.");
  }
  console.log("\n▸ Rust library\n  skipped (CHRONOEON_SKIP_CARGO=1): reusing the built library");
} else if (!process.env.CHRONOEON_PERL && !hasCommand("perl")) {
  fail("`perl` is not on PATH. The Rust library vendors OpenSSL (git2), whose Configure step is a Perl script.\n"
    + "  Install Strawberry Perl, set CHRONOEON_PERL to its bin folder, or set CHRONOEON_SKIP_CARGO=1 to repackage the existing library.");
} else {
  // cargo does not track Android-only build-script environment. On a fresh
  // release checkout, tauri.settings.gradle is absent, so force Tauri to
  // regenerate it and the proguard file.
  if (!existsSync(join(projectRoot, "tauri.settings.gradle"))) {
    run("cargo", ["clean", "-p", "tauri"], tauriRoot);
  }
  // The custom-protocol feature tells Tauri to load embedded assets. Without it,
  // a direct cargo release build still tries the development URL at runtime.
  step("Rust library", "cargo", ["build", "--release", "--target", target, "--features", "custom-protocol"], tauriRoot);
}

console.log("\n▸ Android assets");
syncAndroidAssets();

if (!existsSync(library)) fail(`Missing ${library}`);
const jniFolder = join(projectRoot, "app", "src", "main", "jniLibs", abi);
mkdirSync(jniFolder, { recursive: true });
copyFileSync(library, join(jniFolder, "libchronoeon_lib.so"));

step("Gradle assemble", gradleWrapper(), ["app:assembleArm64Release", "-x", "rustBuildArm64Release", "--no-daemon"], projectRoot);

const unsigned = join(projectRoot, "app", "build", "outputs", "apk", "arm64", "release", "app-arm64-release-unsigned.apk");
if (!existsSync(unsigned)) fail(`Missing ${unsigned}`);
mkdirSync(buildRoot, { recursive: true });

const buildTools = newestDirectory(join(sdkRoot, "build-tools"));
const aligned = join(buildRoot, "aligned.apk");
run(join(buildTools, "zipalign" + exeSuffix), ["-P", "16", "-f", "4", unsigned, aligned], androidRoot);

const keystore = process.env.CHRONOEON_KEYSTORE ?? join(homedir(), ".android", "debug.keystore");
const alias = process.env.CHRONOEON_KEY_ALIAS ?? "androiddebugkey";
const password = process.env.CHRONOEON_KEYSTORE_PASSWORD ?? "android";
if (!existsSync(keystore)) {
  // A missing keystore only means "no release identity yet"; a debug key still
  // produces an installable package, which is what a local or CI build needs.
  console.log(`\n▸ Keystore\n  creating ${keystore}`);
  mkdirSync(dirname(keystore), { recursive: true });
  run(javaHome ? join(javaHome, "bin", "keytool" + exeSuffix) : "keytool", [
    "-genkeypair", "-v", "-keystore", keystore, "-alias", alias,
    "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
    "-storepass", password, "-keypass", password, "-dname", "CN=ChronoEon, OU=Local, O=ChronoEon, C=CN",
  ], androidRoot);
}
const output = process.env.CHRONOEON_APK_OUTPUT ?? join(buildRoot, `chronoeon-arm64-${stamp()}.apk`);
run(join(buildTools, process.platform === "win32" ? "apksigner.bat" : "apksigner"), [
  "sign", "--ks", keystore, "--ks-pass", `pass:${password}`, "--key-pass", `pass:${password}`,
  "--ks-key-alias", alias, "--out", output, aligned,
], androidRoot);

console.log(`\nAPK ready: ${output} (${(statSync(output).size / 1024 / 1024).toFixed(1)} MB)`);

function platformFolder() {
  if (process.platform === "win32") return "windows-x86_64";
  if (process.platform === "darwin") return "darwin-x86_64";
  return "linux-x86_64";
}
function delimiter() {
  return process.platform === "win32" ? ";" : ":";
}
function gradleWrapper() {
  const wrapper = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  const generated = join(projectRoot, wrapper);
  return existsSync(generated) ? generated : join(androidRoot, wrapper);
}
function newestDirectory(root) {
  if (!existsSync(root)) return "";
  const versions = readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory()).sort();
  return versions.length ? join(root, versions[versions.length - 1]) : "";
}
function hasCommand(name) {
  const result = spawnSync(name, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return result.status === 0;
}
function newestMtime(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  const pending = [path];
  while (pending.length) {
    const folder = pending.pop();
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}
function stamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}
function syncAndroidAssets() {
  if (!existsSync(join(distRoot, "index.html"))) fail("Missing frontend build output; run the frontend build first.");
  // Tauri's Android shell serves this folder directly. Replace it wholesale so
  // hashed bundles from older builds can never remain beside a stale index.
  const assetsRoot = join(projectRoot, "app", "src", "main", "assets");
  mkdirSync(assetsRoot, { recursive: true });
  for (const entry of readdirSync(assetsRoot)) {
    if (entry === "tauri.conf.json") continue;
    const target = resolve(assetsRoot, entry);
    if (!target.startsWith(resolve(assetsRoot) + (process.platform === "win32" ? "\\" : "/"))) fail("Unsafe asset cleanup target: " + target);
    rmSync(target, { recursive: true, force: true });
  }
  cpSync(distRoot, assetsRoot, { recursive: true });
}
function writeTauriProperties() {
  const version = tauriConfig.version;
  const android = tauriConfig.bundle?.android ?? {};
  if (android.autoIncrementVersionCode) {
    fail("Android auto-incremented version codes require the Tauri build command; "
      + "the direct APK script intentionally builds with a deterministic code.");
  }
  const versionCode = android.versionCode ?? version
    .split(".")
    .map(Number)
    .reduce((code, part, index) => code + part * [1000000, 1000, 1][index], 0);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) {
    fail(`Invalid Android version code ${versionCode} for version ${version}.`);
  }
  const properties = "// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n"
    + `tauri.android.versionName=${version}\n`
    + `tauri.android.versionCode=${versionCode}\n`;
  const output = join(projectRoot, "app", "tauri.properties");
  if (!existsSync(output) || readFileSync(output, "utf8") !== properties) {
    writeFileSync(output, properties);
  }
}
function step(label, command, args, cwd) {
  console.log(`\n▸ ${label}`);
  run(command, args, cwd);
}
function run(command, args, cwd) {
  // `.cmd`/`.bat` wrappers (gradlew, apksigner) need cmd.exe; npm and cargo do not.
  const wrapper = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = wrapper
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args], { cwd, env, stdio: "inherit" })
    : spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
}
function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}
