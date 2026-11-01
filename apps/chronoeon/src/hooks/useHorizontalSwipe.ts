import { useEffect, useRef, type RefObject } from "react";
import { horizontalScrollOwner } from "./useSwipeNavigation";

interface Options {
  enabled: boolean;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Minimum horizontal travel in CSS pixels. */
  threshold?: number;
}

/** A plain touch swipe for one surface. It never captures the pointer or
 *  previews anything, so vertical scrolling, taps and text selection stay
 *  native; a horizontal scroller with room keeps its own gesture. */
export function useHorizontalSwipe(ref: RefObject<HTMLElement | null>, { enabled, onSwipeLeft, onSwipeRight, threshold = 56 }: Options): void {
  const latest = useRef({ onSwipeLeft, onSwipeRight });
  latest.current = { onSwipeLeft, onSwipeRight };
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    let gesture: { id: number; x: number; y: number; target: Element; startedAt: number } | null = null;
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || event.isPrimary === false || !(event.target instanceof Element)) return;
      if (event.target.closest("input, textarea, select, [role='slider'], .glass-select-popup, .glass-picker-popup")) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target, startedAt: event.timeStamp };
    };
    const up = (event: PointerEvent) => {
      const current = gesture;
      if (!current || event.pointerId !== current.id) return;
      gesture = null;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (Math.abs(dx) < threshold || Math.abs(dy) > Math.max(48, Math.abs(dx) * 0.6)) return;
      if (event.timeStamp - current.startedAt > 900) return;
      if (horizontalScrollOwner(current.target, node, dx)) return;
      if (dx > 0) latest.current.onSwipeRight?.();
      else latest.current.onSwipeLeft?.();
    };
    const cancel = () => { gesture = null; };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
    };
  }, [ref, enabled, threshold]);
}
