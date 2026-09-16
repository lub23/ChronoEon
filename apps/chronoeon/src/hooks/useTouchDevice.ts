import { useEffect, useState } from "react";

/** A narrow desktop is not a phone; native window chrome follows the platform. */
export function isMobilePlatform(): boolean {
  return typeof navigator !== "undefined" && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
}

export function useTouchDevice(): boolean {
  const query = "(hover: none) and (pointer: coarse)";
  const [touch, setTouch] = useState(() => isMobilePlatform()
    || (typeof window.matchMedia === "function" && window.matchMedia(query).matches));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setTouch(isMobilePlatform() || media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return touch;
}
