import { createContext, useContext, useEffect, useRef, useState, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MotionState = createContext<"open" | "closing">("open");
const EXIT_MS = 160;

/** Retain only the closing surface, briefly. No animation library, snapshots,
 * layout animation, perpetual RAF or permanent will-change layers. */
export function MotionPresence({ children }: { children: ReactNode }) {
  const retained = useRef<ReactNode>(null);
  const [, redraw] = useState(0);
  const visible = children !== null && children !== undefined && children !== false;
  if (visible) retained.current = children;
  useEffect(() => {
    if (visible || retained.current === null) return;
    const timer = window.setTimeout(() => { retained.current = null; redraw((n) => n + 1); },
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);
  const content = visible ? children : retained.current;
  if (!content) return null;
  return <MotionState.Provider value={visible ? "open" : "closing"}>
    <div className="motion-presence" data-motion-state={visible ? "open" : "closing"} inert={!visible} aria-hidden={!visible || undefined}>{content}</div>
  </MotionState.Provider>;
}

function MotionSurface({ children }: { children: ReactNode }) {
  const state = useContext(MotionState);
  if (!isValidElement(children)) return <>{children}</>;
  return cloneElement(children as ReactElement<Record<string, unknown>>, {
    "data-motion-surface": true,
    "data-motion-state": state,
    ...(state === "closing" ? { inert: true, "aria-hidden": true } : {}),
  });
}

/** Same portal API, with presence context carried across the document boundary. */
export function createMotionPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null) {
  return createPortal(<MotionSurface>{children}</MotionSurface>, container, key);
}
