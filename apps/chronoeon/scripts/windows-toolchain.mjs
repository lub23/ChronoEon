import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Load the installed MSVC toolchain for ordinary PowerShell/cmd terminals.
export function windowsToolchain() {
  if (process.platform !== "win32") return { ...process.env };
  const locator = join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft Visual Studio/Installer/vswhere.exe");
  const found = spawnSync(locator, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" });
  const installation = found.stdout?.trim();
  if (!installation) throw new Error("Install MSVC C++ Build Tools and the Windows SDK. / 请安装 MSVC C++ Build Tools 和 Windows SDK。");
  const setup = join(installation, "VC/Auxiliary/Build/vcvars64.bat");
  const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${setup}" >nul && set"`], { encoding: "utf8", windowsVerbatimArguments: true });
  if (result.status !== 0) throw new Error(`MSVC setup failed: ${result.stderr}`);
  const env = { ...process.env };
  for (const line of result.stdout.split(/\r?\n/)) {
    const equals = line.indexOf("=");
    if (equals > 0) env[line.slice(0, equals)] = line.slice(equals + 1);
  }
  // Avoid duplicate case-insensitive PATH keys in child processes.
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
  const path = env[pathKey] ?? "";
  for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
  env.PATH = path;
  return env;
}

export function gitPerlDirectory() {
  if (process.platform !== "win32") return "";
  const result = spawnSync("where.exe", ["git.exe"], { encoding: "utf8" });
  for (const git of (result.stdout ?? "").trim().split(/\r?\n/)) {
    const bin = join(dirname(git), "../usr/bin");
    if (existsSync(join(bin, "perl.exe"))) return bin;
  }
  return "";
}
