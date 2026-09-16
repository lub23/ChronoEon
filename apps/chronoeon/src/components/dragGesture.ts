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
