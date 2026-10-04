/**
 * Chrome-less signal between a board drag and the app-level swipe navigator.
 *
 * A chip drag and a horizontal view swipe start with the same pointer, so the
 * swipe recognizer has to know whether the press turned into a move/resize.
 * The board sets the flag when its drag actually begins (after the touch
 * long-press gate) and clears it when the gesture ends.
 */

let dragging = false;

export function markChipDragActive(): void {
  dragging = true;
}

export function clearChipDrag(): void {
  dragging = false;
}

export function isChipDragActive(): boolean {
  return dragging;
}

/** Keep a held selection moving through time without requiring more pointer events. */
export function calendarEdgeScroll(scroller: HTMLElement | null, onScroll: () => void) {
  let frame = 0;
  let clientY = 0;
  let previousTime = 0;
  const tick = (time: number) => {
    frame = 0;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (!rect.height) return;
    const header = scroller.querySelector<HTMLElement>(".calendar-sticky-head")?.getBoundingClientRect();
    const top = Math.max(rect.top, header?.bottom ?? rect.top);
    const zone = Math.min(56, Math.max(20, (rect.bottom - top) / 4));
    const speed = clientY < top + zone ? -Math.min(1, (top + zone - clientY) / zone)
      : clientY > rect.bottom - zone ? Math.min(1, (clientY - rect.bottom + zone) / zone) : 0;
    const elapsed = previousTime ? Math.min(64, time - previousTime) : 16;
    previousTime = time;
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, before + speed * elapsed * .4));
    if (scroller.scrollTop !== before) onScroll();
    if (speed && scroller.scrollTop !== before) frame = requestAnimationFrame(tick);
  };
  return {
    update(y: number) {
      clientY = y;
      if (!frame) { previousTime = 0; frame = requestAnimationFrame(tick); }
    },
    stop() { cancelAnimationFrame(frame); frame = 0; },
  };
}
