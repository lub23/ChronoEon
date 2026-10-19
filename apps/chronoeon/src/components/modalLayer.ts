import { useEffect, useRef, type RefObject } from "react";

type DismissHandler = (event: KeyboardEvent) => void;

/**
 * One global Escape listener for every modal in the app. Each dialog pushes its
 * own handler while mounted; the newest one owns the next Escape and the rest
 * wait, so stacked overlays (composer → discard confirm) close exactly one layer
 * per press instead of every listener firing at once.
 *
 * This module is the root fix for two reported defects:
 * 1. The discard-confirmation (`ConfirmDialog`, z-index 90) rendered *under* the
 *    composer backdrop (z-index 100) — blurred and unclickable — while the
 *    app-wide Escape handler below still saw the same keydown and force-closed
 *    the dirty composer, silently throwing away the user's edits and leaving
 *    the confirm's promise forever unsettled. With a single shared bus the
 *    confirm (pushed last) owns the Escape, and the app-level handler is a
 *    plain queue member that only runs once nothing above it took the key.
 * 2. Every dialog used to install its own window keydown listener with no way
 *    to coordinate; the order of React effects across unrelated components
 *    silently decided who got the key. Registration order is now explicit.
 */
const queue: DismissHandler[] = [];
let installed = false;

function dispatch(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    queue[i](event);
    if (event.defaultPrevented) break;
  }
}

let installedBack = false;
let historyDepth = 0;
/**
 * Every programmatic `history.back()` issued while unregistering produces one
 * asynchronous popstate. Several dialogs can unregister before the first of
 * those events arrives (a dialog closing while its successor opens, or a
 * re-render chain), so the pending count is tracked rather than a flag: with
 * a single boolean the second popstate looked like a real system back and
 * closed the dialog that had just opened.
 */
let suppressedPops = 0;

function dispatchBack() {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  dispatch(event);
}

/**
 * A handler may keep its surface open (a dirty composer asks first, and the
 * confirm registers on top). The entry the system back consumed is restored
 * after React has committed, so every surface still on the bus is again backed
 * by a history entry and the next back reaches the guard instead of leaving
 * the activity.
 */
function restoreConsumedEntries() {
  while (queue.length > historyDepth) {
    window.history.pushState({ chronoeonModal: Date.now() }, "");
    historyDepth += 1;
  }
}

function installBackBus() {
  if (installedBack) return;
  installedBack = true;
  window.addEventListener("popstate", () => {
    if (suppressedPops > 0) {
      suppressedPops -= 1;
      return;
    }
    if (historyDepth > 0) {
      historyDepth -= 1;
      dispatchBack();
      window.setTimeout(restoreConsumedEntries, 0);
    }
  });
}

/**
 * Register a modal's Escape/back handler. Android's back gesture enters the
 * same FIFO bus as Escape, so the newest overlay owns the next system back.
 */
export function registerModalDismiss(handler: DismissHandler): () => void {
  const usesBackNavigation = typeof window.history?.pushState === "function"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  if (usesBackNavigation) {
    installBackBus();
    window.history.pushState({ chronoeonModal: Date.now() }, "");
    historyDepth += 1;
  }
  queue.push(handler);
  if (!installed) {
    installed = true;
    window.addEventListener("keydown", dispatch, true);
  }
  return () => {
    const index = queue.lastIndexOf(handler);
    if (index >= 0) queue.splice(index, 1);
    if (historyDepth > 0 && typeof window.history?.back === "function") {
      historyDepth -= 1;
      suppressedPops += 1;
      window.history.back();
    }
    if (queue.length === 0 && installed) {
      installed = false;
      window.removeEventListener("keydown", dispatch, true);
    }
  };
}

/**
 * Register once per mount and always run the latest handler. Dialogs used to
 * list an inline `onClose` prop as an effect dependency, which re-registered
 * on every parent render; on Android each re-registration is a history
 * back/push pair, and a burst of them closed the surface that had just opened.
 */
export function useModalDismiss(handler: DismissHandler, active = true): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => active ? registerModalDismiss((event) => latest.current(event)) : undefined, [active]);
}

const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";
const traps: Array<{ container: HTMLElement; previous: HTMLElement | null }> = [];
let trapInstalled = false;

function focusableItems(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) =>
    !element.hasAttribute("disabled")
    && element.tabIndex >= 0
    && !element.closest("[hidden],[inert]")
    && element.getAttribute("aria-hidden") !== "true",
  );
}

function trapTab(event: KeyboardEvent) {
  if (event.key !== "Tab" || !traps.length) return;
  const trap = traps[traps.length - 1];
  const items = focusableItems(trap.container);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!active || !trap.container.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

/**
 * Keep keyboard focus inside the topmost dialog and return it to the control
 * that opened the dialog. The app used to rely on `aria-modal` alone, so Tab
 * could walk into the page behind an open composer or settings sheet.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const trap = { container, previous: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    traps.push(trap);
    if (!trapInstalled) {
      trapInstalled = true;
      document.addEventListener("keydown", trapTab, true);
    }
    if (!container.contains(document.activeElement)) {
      (focusableItems(container)[0] ?? container).focus({ preventScroll: true });
    }
    return () => {
      const wasTop = traps[traps.length - 1] === trap;
      const index = traps.lastIndexOf(trap);
      if (index >= 0) traps.splice(index, 1);
      if (!traps.length && trapInstalled) {
        trapInstalled = false;
        document.removeEventListener("keydown", trapTab, true);
      }
      if (wasTop && trap.previous?.isConnected) trap.previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}
