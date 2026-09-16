import { useLayoutEffect } from "react";

/** Keyboard avoidance follows the visual viewport, not guessed keyboard pixels.
 * Android's resized WebView and browsers which pan/resize only the visual
 * viewport both publish the same usable rectangle. No second inset subtraction. */
export function useVisualViewport() {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const style = document.documentElement.style;
    const properties = ["--visual-viewport-top", "--visual-viewport-left", "--visual-viewport-height", "--visual-viewport-width"];
    let frame = 0;
    const update = () => {
      frame = 0;
      style.setProperty(properties[0], `${viewport?.offsetTop ?? 0}px`);
      style.setProperty(properties[1], `${viewport?.offsetLeft ?? 0}px`);
      style.setProperty(properties[2], `${viewport?.height ?? window.innerHeight}px`);
      style.setProperty(properties[3], `${viewport?.width ?? window.innerWidth}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      properties.forEach(property => style.removeProperty(property));
    };
  }, []);
}
