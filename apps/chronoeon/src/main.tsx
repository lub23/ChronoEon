import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TimerOverlay } from "./components/TimerOverlay";
import "@fontsource/ma-shan-zheng/chinese-simplified.css";
import "./styles.css";
import "./styles/agendaTimeline.css";

const params = new URLSearchParams(window.location.search);

function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`chronoeon.preference.${key}`);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

/**
 * `?timer=1` boots the always-on-top timer window: the same bundle, a tiny
 * tree. It borrows locale/theme from the main window's saved preferences so it
 * never shows a different language than the app that spawned it.
 */
function TimerWindowRoot() {
  const locale = readPreference<"zh" | "en">("locale", "zh");
  document.documentElement.dataset.theme = readPreference<string>("theme", "light");
  document.documentElement.dataset.accent = readPreference<string>("accentTheme", "terracotta");
  document.documentElement.classList.add("is-timer-window");
  return <TimerOverlay locale={locale} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {params.get("timer") === "1" ? <TimerWindowRoot /> : <App />}
  </StrictMode>
);
