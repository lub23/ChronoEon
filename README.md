# ChronoEon · 时元

> **Grace in time, worlds in years.**<br>
> 时秉元德，岁载玄黄。

A local-first home for **schedules, tasks, ideas and expenses**, for Windows,
Linux, macOS and Android. SQLite is the authoritative store.

The product code is `apps/chronoeon/` (`app.chronoeon.desktop`). `packages/*`
holds the UI-independent rules: `domain`, `storage`, `ports`.

## Run the browser demo

```bash
npm install
npm run dev          # http://localhost:1420   (?compact=1 previews the mini window)
```

The demo keeps everything in browser local storage. What it shows: the List /
Day / Week / Month / Ideas / Statistics views, the mini window, the Dock with
its quick-note button, natural-language capture, both
languages and both themes.

## Build and test

```bash
npm run build          # production frontend
npm run check          # production build + every package's tests and type checks
npm test               # tests only (domain, storage, app)
npm run test:app       # the primary app suite
npm run verify:windows # Windows metadata / native cross-check
```

## Desktop shell

The Tauri 2 shell lives in `apps/chronoeon/src-tauri`:

```bash
npm run tauri:dev      # dev server + native window on the fixed port 1420
npm run tauri:build    # packaged desktop installers
```

Dev mode always uses port `1420` because `devUrl` and Vite must agree. If a
previous interrupted run still holds the port, stop only that process:

```bash
lsof -nP -iTCP:1420 -sTCP:LISTEN   # macOS/Linux
kill <pid>
npm run tauri:dev
```

Ubuntu needs the WebKitGTK development packages from the official Tauri guide
(`libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev libssl-dev
libayatana-appindicator3-dev` plus build tools). Windows needs Node 20+, the
stable Rust toolchain and WebView2. The repository `.npmrc` overrides a
machine-level `npm global` setting that otherwise breaks the workspace scripts;
if this checkout was copied from another OS, run `npm run doctor:windows`
before `npm run tauri:build`.

## Android APK

```bash
npm install
npm run android:apk     # → .build/android/chronoeon-arm64-YYYYMMDD.apk
```

That command builds the frontend, the `aarch64-linux-android` Rust library,
the Gradle release variant, then aligns and signs the APK. What it needs:

| Requirement            | Notes                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JDK 17                 | `JAVA_HOME`                                                                                                                                                                                 |
| Windows host toolchain | MSVC C++ Build Tools + Windows SDK; use the x64 Native Tools prompt so `link.exe` is the MSVC linker, not Git/coreutils                                                                     |
| Android SDK + NDK      | `ANDROID_HOME` / `ANDROID_SDK_ROOT`; the newest NDK under it is picked automatically, or set `NDK_HOME`                                                                                     |
| Rust + target          | `rustup target add aarch64-linux-android`                                                                                                                                                   |
| `perl`                 | only for a **Rust** rebuild: `git2` vendors OpenSSL, whose Configure step is a Perl script. Install Strawberry Perl, or set `CHRONOEON_SKIP_CARGO=1` to repackage the library already built |

Signing uses `CHRONOEON_KEYSTORE` (+ `CHRONOEON_KEYSTORE_PASSWORD`,
`CHRONOEON_KEY_ALIAS`). Without them the script creates and uses a debug key, so
the result still installs on a phone; keep a real keystore in the project
(`src-tauri/certs/` is the intended home) or in CI secrets for anything you
distribute, and never commit it.

`npm run tauri android build --apk --target aarch64` then builds the
same APK. It needs **Windows Developer Mode** (Tauri symlinks the Rust library
into the Gradle jniLibs folder) and npm ≤ 10, because Gradle's rust task
re-enters `npm run … --release --target`, which npm 11+ rejects as unknown
config flags. `npm run android:apk` avoids both traps.

## Every platform from GitHub

Push a `v*` tag, or run **Release** manually with an existing tag. The workflow
in [`.github/workflows/release.yml`](.github/workflows/release.yml) builds and
uploads:

| Job     | Output                                 |
| ------- | -------------------------------------- |
| Windows | NSIS installer + MSI                   |
| Linux   | AppImage + deb                         |
| macOS   | universal (arm64 + x86_64) dmg         |
| Android | signed arm64 APK (`chronoeon-android`) |

Everything lands as workflow artifacts and on a **draft** release; publishing it
is a deliberate human step. `ANDROID_KEYSTORE_BASE64` (+ password/alias) secrets
switch the APK from the debug key to yours.

## Data and sync

- SQLite is authoritative. Migrations are append-only and versioned by
  `PRAGMA user_version`; the in-memory index is disposable.
- Settings and catalogs — languages, themes, calendars, categories, sync
  targets — live in the settings document, which the desktop app stores in its
  `sync_settings` row and applies on boot. The browser demo keeps the same
  document in local storage.
- Sync is a semantic journal: per-entity operations, deterministic conflicts
  with both versions preserved, seven-day snapshots and a Recycle Bin that
  survives until the next successful snapshot.
- AI capture and the advisor are provider-independent and opt-in. Endpoint URLs
  and keys stay local; the built-in dictionary-free capture parser works
  offline.

## Repository map

```text
apps/chronoeon/        PRIMARY APP — React/Vite UI + Tauri 2 shell (+ Android)
  src/                 product UI and local-first bridges
  src-tauri/           Rust commands, capabilities, Android project
  scripts/             build-android.mjs, icon sync, verification helpers
packages/              domain rules, SQLite storage, ports
.github/workflows/     release.yml (all platforms), windows.yml
```

## License

MIT. See [LICENSE](LICENSE).

## Support / 支持

If ChronoEon is useful to you, you can buy me a coffee with WeChat.
如果时元对你有帮助，欢迎通过微信请作者喝杯咖啡。

![WeChat payment QR code](./WechatPay.png)
