import { StartupSplash } from "./components/StartupSplash";
import { hydrateNativePreferences, readPreferenceValue } from "./platform/preferences";
import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TimerOverlay } from "./components/TimerOverlay";
import "@fontsource/ma-shan-zheng/index.css";
import "@fontsource/great-vibes/index.css";
import "./styles.css";
import "./styles/agendaTimeline.css";

const QuickCaptureWindow = lazy(() => import("./components/QuickCaptureWindow").then((module) => ({ default: module.QuickCaptureWindow })));
const params = new URLSearchParams(window.location.search);

function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = readPreferenceValue(`chronoeon.preference.${key}`);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

/** Shared theming for the small auxiliary windows: they must never look like a different app. */
function applyAuxiliaryTheme(className: string) {
  document.documentElement.dataset.theme = readPreference<string>("theme", "light");
  document.documentElement.dataset.accent = readPreference<string>("accentTheme", "terracotta");
  document.documentElement.classList.add(className);
}

/**
 * `?timer=1` boots the always-on-top timer window: the same bundle, a tiny
 * tree. It borrows locale/theme from the main window's saved preferences so it
 * never shows a different language than the app that spawned it.
 */
function TimerWindowRoot() {
  const locale = readPreference<"zh" | "en">("locale", "zh");
  applyAuxiliaryTheme("is-timer-window");
  return <TimerOverlay locale={locale} />;
}

/** `?quick=1` boots the floating quick-capture window raised by the global shortcut. */
function QuickWindowRoot() {
  applyAuxiliaryTheme("is-quick-window");
  return <Suspense fallback={null}><QuickCaptureWindow /></Suspense>;
}

function PrimaryRoot() {
  const [ready, setReady] = useState(false);
  const [splash, setSplash] = useState(true);
  useEffect(() => {
    let active = true;
    const started = performance.now();
    let timer: number | undefined;
    void document.fonts?.load('30px "Ma Shan Zheng"').catch(() => undefined);
    void hydrateNativePreferences().catch(error => console.error("Could not load native preferences", error)).then(() => {
      if (!active) return;
      document.documentElement.dataset.theme = readPreference<string>("theme", "light");
      setReady(true);
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 200 : 1860;
      timer = window.setTimeout(() => setSplash(false), Math.max(0, duration - (performance.now() - started)));
    });
    return () => { active = false; window.clearTimeout(timer); };
  }, []);
  return <>{ready && <App />}{splash && <StartupSplash />}</>;
}

async function start() {
  const auxiliary = params.get("quick") === "1" || params.get("timer") === "1";
  if (auxiliary) await hydrateNativePreferences().catch(error => console.error("Could not load native preferences", error));
  createRoot(document.getElementById("root")!).render(<StrictMode>
    {params.get("quick") === "1" ? <QuickWindowRoot /> : params.get("timer") === "1" ? <TimerWindowRoot /> : <PrimaryRoot />}
  </StrictMode>);
}
void start();
