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
let suppressNextPop = false;

function dispatchBack() {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  dispatch(event);
}

function installBackBus() {
  if (installedBack) return;
  installedBack = true;
  window.addEventListener("popstate", () => {
    if (suppressNextPop) {
      suppressNextPop = false;
      return;
    }
    if (historyDepth > 0) {
      historyDepth -= 1;
      dispatchBack();
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
      suppressNextPop = true;
      window.history.back();
    }
    if (queue.length === 0 && installed) {
      installed = false;
      window.removeEventListener("keydown", dispatch, true);
    }
  };
}
