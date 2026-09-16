import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addMonths, format } from "date-fns";
import type { AppView } from "../domain/entry";
import { isChipDragActive } from "../components/dragGesture";

export const VIEW_ORDER: AppView[] = ["agenda", "day", "week", "month", "ideas", "insights"];
const MOTION_MS = 200;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A scroller with room owns the WHOLE gesture. Reaching its edge never throws
 * away the calendar: the next outward swipe navigates. Vertical scroll is native. */
export function horizontalScrollOwner(target: Element, boundary: Element, dx: number): HTMLElement | null {
  // The day/all-day header is an always-available page-swipe area, even when
  // six day columns need horizontal scrolling in the timeline below it.
  const header = target.closest("[data-view-swipe]");
  if (header && boundary.contains(header)) return null;
  for (let node: Element | null = target; node && node !== boundary; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const max = node.scrollWidth - node.clientWidth;
    if (max > 2 && /auto|scroll/.test(getComputedStyle(node).overflowX)
      && (dx < 0 ? node.scrollLeft < max - 1 : node.scrollLeft > 1)) return node;
  }
  return null;
}

export function navigationPageKey(view: AppView, date: Date): string {
  return view === "month" ? `month:${format(date, "yyyy-MM")}` : view;
}

interface PagePreview { view: AppView; date: Date; side: number; axis: "x" | "y" }

interface Options {
  enabled: boolean;
  activeView: AppView;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  menuOpen: boolean;
  onViewChange: (view: AppView) => void;
  onMenuChange: (open: boolean) => void;
}

export function useSwipeNavigation(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const pagerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [sidebarSide, setSidebarSide] = useState<"left" | "right">("left");
  const sideRef = useRef<"left" | "right">("left");
  const busy = useRef(false);
  const committing = useRef<PagePreview | null>(null);
  const committingSidebar = useRef<boolean | null>(null);
  const queued = useRef<AppView | null>(null);
  const transitionCleanup = useRef<(() => void) | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const selection = useRef<(view: AppView) => void>(() => {});
  const duration = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : MOTION_MS;
  const drainQueue = useCallback(() => {
    const next = queued.current;
    queued.current = null;
    if (next && next !== latest.current.activeView) frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      selection.current(next);
    });
  }, []);
  const resetPage = useCallback(() => {
    clearTimeout(timer.current);
    transitionCleanup.current?.();
    transitionCleanup.current = undefined;
    pagerRef.current?.classList.remove("is-settling", "is-swiping");
    pagerRef.current?.style.removeProperty("--page-offset");
    setPreview(null);
    busy.current = false;
    drainQueue();
  }, [drainQueue]);
  const settlePage = useCallback((target: PagePreview, commit: boolean) => {
    const pager = pagerRef.current;
    const extent = (target.axis === "y" ? pager?.clientHeight : pager?.clientWidth) ?? 0;
    busy.current = true;
    const done = () => {
      clearTimeout(timer.current);
      transitionCleanup.current?.();
      transitionCleanup.current = undefined;
      if (commit && navigationPageKey(target.view, target.date) !== navigationPageKey(latest.current.activeView, latest.current.selectedDate)) {
        // Keep the completed transform until React promotes the already-mounted
        // neighbor. Resetting here paints the outgoing view at x=0 for a frame.
        committing.current = target;
        if (target.axis === "y") latest.current.onDateChange(target.date);
        else latest.current.onViewChange(target.view);
      } else resetPage();
    };
    if (!pager || !extent || !duration()) { done(); return; }
    pager.classList.add("is-settling");
    pager.style.setProperty("--page-offset", commit ? (-target.side * extent) + "px" : "0px");
    const ended = (event: TransitionEvent) => {
      if (event.propertyName === "transform" && event.target instanceof Element && event.target.matches('[data-position="current"]')) done();
    };
    pager.addEventListener("transitionend", ended);
    transitionCleanup.current = () => pager.removeEventListener("transitionend", ended);
    timer.current = setTimeout(done, MOTION_MS + 40);
  }, [resetPage]);
  const selectView = useCallback((view: AppView) => {
    const current = latest.current;
    if (busy.current) { queued.current = view; return; }
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    current.onMenuChange(false);
    const pager = pagerRef.current;
    if (view === current.activeView || !pager?.clientWidth || !duration()) {
      current.onViewChange(view);
      return;
    }
    const side = VIEW_ORDER.indexOf(view) > VIEW_ORDER.indexOf(current.activeView) ? 1 : -1;
    busy.current = true;
    pager.classList.add("is-swiping");
    pager.style.setProperty("--page-offset", "0px");
    const target: PagePreview = { view, side, date: current.selectedDate, axis: "x" };
    setPreview(target);
    // Let the incoming surface paint in its offscreen position before settling.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => settlePage(target, true));
    });
  }, [settlePage]);
  selection.current = selectView;
  useLayoutEffect(() => {
    // React has committed the new page's data-position, but the browser has not
    // painted yet. One atomic hand-off preserves scroll and component state.
    const target = committing.current;
    if (!target || navigationPageKey(target.view, target.date) !== navigationPageKey(options.activeView, options.selectedDate)) return;
    committing.current = null;
    resetPage();
  }, [options.activeView, options.selectedDate, resetPage]);

  const resetSidebar = useCallback(() => {
    sidebarRef.current?.classList.remove("is-swiping");
    backdropRef.current?.classList.remove("is-swiping");
    sidebarRef.current?.style.removeProperty("transform");
    backdropRef.current?.style.removeProperty("opacity");
    busy.current = false;
    drainQueue();
  }, [drainQueue]);
  useLayoutEffect(() => {
    if (committingSidebar.current !== options.menuOpen) return;
    committingSidebar.current = null;
    resetSidebar();
  }, [options.menuOpen, resetSidebar]);

  const openSidebar = useCallback(() => {
    // The newest explicit action wins over an unfinished page transition.
    queued.current = null; committing.current = null; committingSidebar.current = null;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    resetPage(); resetSidebar();
    sideRef.current = "left";
    setSidebarSide("left");
    latest.current.onMenuChange(true);
  }, [resetPage, resetSidebar]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    transitionCleanup.current?.();
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    if (!options.enabled) return;
    type Gesture = { id: number; x: number; y: number; dx: number; startTime: number; target: Element;
      kind?: "page" | "scroll" | "sidebar" | "dismiss"; scroller?: HTMLElement; scrollLeft?: number;
      page?: PagePreview; side: number; width: number; axis: "x" | "y"; opening?: boolean; progress?: number };
    let gesture: Gesture | null = null;
    let suppressClickUntil = 0;
    // A day header/empty-cell button still accepts horizontal swipes. Inputs,
    // sliders and photo carousels own theirs; taps remain untouched until lock.
    const interactive = (target: Element) => Boolean(target.closest(
      "input, textarea, select, [role='slider'], [data-swipe-ignore], .month-peek, .view-dock, .photo-wall-frame, .image-preview-backdrop"
    ));
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || event.isPrimary === false || busy.current || !(event.target instanceof Element)) return;
      const target = event.target;
      if (interactive(target)) return;
      const modal = document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])');
      const atEdge = event.clientX <= 24 || event.clientX >= window.innerWidth - 24;
      if (modal && !atEdge) return;
      if (!modal && !pagerRef.current?.contains(target) && !sidebarRef.current?.contains(target) && target !== backdropRef.current) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, startTime: event.timeStamp, target,
        kind: modal ? "dismiss" : undefined, side: 1, axis: "x", width: pagerRef.current?.clientWidth || window.innerWidth };
    };
    const paintSidebar = (g: Gesture) => {
      const sign = sideRef.current === "left" ? 1 : -1;
      const width = sidebarRef.current?.clientWidth || 246;
      const progress = clamp((g.opening ? 0 : 1) + sign * g.dx / width, 0, 1);
      g.progress = progress;
      sidebarRef.current?.classList.add("is-swiping");
      sidebarRef.current?.style.setProperty("transform", "translate3d(" + sign * (progress - 1) * width + "px, 0, 0)");
      backdropRef.current?.classList.add("is-swiping");
      backdropRef.current?.style.setProperty("opacity", String(progress));
    };
    const move = (event: PointerEvent) => {
      const g = gesture;
      if (!g || g.id !== event.pointerId) return;
      const dx = event.clientX - g.x;
      const dy = event.clientY - g.y;
      if (isChipDragActive()) { gesture = null; return; }
      const lockPointer = () => {
        try { g.target.setPointerCapture?.(g.id); } catch {
          // WebView may refuse capture for a just-detached node; the document
          // listeners still handle the normal case.
        }
      };
      if (!g.kind) {
        const current = latest.current;
        const vertical = Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.15;
        if (vertical) {
          if (current.activeView !== "month" || current.menuOpen) { gesture = null; return; }
          g.axis = "y";
          g.side = dy < 0 ? 1 : -1;
          g.width = pagerRef.current?.clientHeight || window.innerHeight;
          g.page = { view: "month", date: addMonths(current.selectedDate, g.side), side: g.side, axis: "y" };
          g.kind = "page";
          lockPointer();
          pagerRef.current?.classList.add("is-swiping");
          setPreview(g.page);
        } else {
          if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
          g.side = dx < 0 ? 1 : -1;
          const view = VIEW_ORDER[VIEW_ORDER.indexOf(current.activeView) + g.side];
          if (current.menuOpen) { g.kind = "sidebar"; g.opening = false; }
          else {
            const scroller = horizontalScrollOwner(g.target, pagerRef.current!, dx);
            if (scroller) { g.kind = "scroll"; g.scroller = scroller; g.scrollLeft = scroller.scrollLeft; lockPointer(); }
            else if (!view || (g.x <= 24 && dx > 0)) {
              g.kind = "sidebar"; g.opening = true;
              sideRef.current = dx > 0 ? "left" : "right";
              lockPointer();
              setSidebarSide(sideRef.current);
            } else {
              g.kind = "page";
              g.page = { view, date: current.selectedDate, side: g.side, axis: "x" };
              lockPointer();
              pagerRef.current?.classList.add("is-swiping");
              setPreview(g.page);
            }
          }
        }
      }
      g.dx = g.axis === "y" ? dy : dx;
      if (g.kind === "dismiss") return;
      if (event.cancelable) event.preventDefault();
      suppressClickUntil = Date.now() + 350;
      if (g.kind === "scroll") g.scroller!.scrollLeft = clamp(g.scrollLeft! - dx, 0, g.scroller!.scrollWidth - g.scroller!.clientWidth);
      if (g.kind === "page") pagerRef.current?.style.setProperty("--page-offset", (-g.side * clamp(-g.side * g.dx, 0, g.width)) + "px");
      if (g.kind === "sidebar") paintSidebar(g);
    };
    const finish = (event: PointerEvent, cancelled: boolean) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) return;
      gesture = null;
      if (!g.kind || isChipDragActive()) { resetPage(); return; }
      if (g.kind === "dismiss") {
        const inward = g.x <= 24 ? event.clientX - g.x > 56 : event.clientX - g.x < -56;
        if (!cancelled && inward && Math.abs(event.clientY - g.y) < 48)
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        return;
      }
      // A held drag can outlive the suppression started by its last move.
      // Suppress the release click too, so paging never also selects a day.
      suppressClickUntil = Date.now() + 350;
      const distance = g.kind === "page" ? Math.max(0, -g.side * g.dx)
        : g.kind === "sidebar" ? Math.max(0, (g.opening ? 1 : -1) * (sideRef.current === "left" ? 1 : -1) * g.dx)
        : Math.abs(g.dx);
      const flick = distance > 28 && distance / Math.max(1, event.timeStamp - g.startTime) > .55;
      if (g.kind === "page") settlePage(g.page!, !cancelled && (distance > Math.max(44, g.width * .16) || flick));
      if (g.kind === "sidebar") {
        const open = cancelled ? !g.opening : flick ? g.opening! : (g.progress ?? 0) > .5;
        busy.current = true;
        sidebarRef.current?.classList.remove("is-swiping");
        backdropRef.current?.classList.remove("is-swiping");
        sidebarRef.current?.style.setProperty("transform", open ? "translate3d(0,0,0)" : "translate3d(" + (sideRef.current === "left" ? "-100%" : "100%") + ",0,0)");
        backdropRef.current?.style.setProperty("opacity", open ? "1" : "0");
        const done = () => {
          if (open !== latest.current.menuOpen) {
            committingSidebar.current = open;
            latest.current.onMenuChange(open);
          } else resetSidebar();
        };
        if (!pagerRef.current?.clientWidth || !duration()) done();
        else timer.current = setTimeout(done, MOTION_MS);
      }
    };
    const up = (event: PointerEvent) => finish(event, false);
    const cancel = (event: PointerEvent) => finish(event, true);
    // Android WebView can decide to scroll before the first pointermove lock.
    // These explicit per-surface values plus a locked-gesture touch gate stop
    // empty calendar areas from being swallowed by the browser's pan.
    const touchMove = (event: TouchEvent) => {
      if (!gesture) return;
      if (gesture.kind === "page" || gesture.kind === "scroll" || gesture.kind === "sidebar") {
        if (event.cancelable) event.preventDefault();
      }
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil && pagerRef.current?.contains(event.target as Node)) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    const reset = () => {
      gesture = null;
      committing.current = null;
      committingSidebar.current = null;
      queued.current = null;
      clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      resetPage();
      sidebarRef.current?.classList.remove("is-swiping");
      backdropRef.current?.classList.remove("is-swiping");
      sidebarRef.current?.style.removeProperty("transform");
      backdropRef.current?.style.removeProperty("opacity");
    };
    const visibility = () => { if (document.hidden) reset(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", reset);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, { capture: true, passive: false });
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("touchmove", touchMove, { capture: true, passive: false });
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", reset);
      reset();
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("touchmove", touchMove, true);
      document.removeEventListener("click", click, true);
    };
  }, [options.enabled, resetPage, resetSidebar, settlePage]);

  return { pagerRef, sidebarRef, backdropRef, preview, sidebarSide, selectView, openSidebar };
}
