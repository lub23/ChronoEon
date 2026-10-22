// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { headingFor, minimumTitlebarWidth } from "./TopBar";
afterEach(() => vi.useRealTimers());

it("disambiguates cross-year and historical dates in both languages", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 22));
  expect(headingFor("week", new Date(2026, 11, 31), "en", 1)).toBe("Dec 28, 2026 – Jan 3, 2027");
  expect(headingFor("week", new Date(2026, 11, 31), "zh", 1)).toBe("2026年12月28日 – 2027年1月3日");
  expect(headingFor("day", new Date(2025, 11, 31), "en", 1, 2)).toBe("Dec 31, 2025 – Jan 1, 2026");
  expect(headingFor("day", new Date(2025, 9, 22), "zh", 1)).toContain("2025年10月22日");
  expect(headingFor("day", new Date(2025, 9, 22), "en", 1)).toContain("2025");
  expect(headingFor("day", new Date(2026, 9, 22), "en", 1)).toBe("Thu, Oct 22");
});
it("includes the drawer margin and gaps in the desktop minimum width",()=>{
  const bar=document.createElement("header");bar.style.cssText="padding:4px 10px;column-gap:2px";
  bar.innerHTML='<div class="topbar-mobile-brand" style="margin-right:13px"><button style="width:23px"></button></div><div class="date-navigation"></div><div class="topbar-actions"></div>';
  document.body.append(bar);
  for(const [selector,width] of [[".topbar-mobile-brand",23],[".date-navigation",158.765625],[".topbar-actions",148]] as const){
    vi.spyOn(bar.querySelector(selector)!,"getBoundingClientRect").mockReturnValue({width} as DOMRect);
  }
  expect(minimumTitlebarWidth(bar)).toBe(367);bar.remove();
});

it("measures a mini titlebar with no drawer button instead of throwing", () => {
  const bar = document.createElement("header");
  bar.style.cssText = "padding:4px 7px;column-gap:2px";
  bar.innerHTML = '<div class="date-navigation"></div><div class="topbar-actions"></div>';
  document.body.append(bar);
  vi.spyOn(bar.querySelector(".date-navigation")!, "getBoundingClientRect").mockReturnValue({ width: 140 } as DOMRect);
  vi.spyOn(bar.querySelector(".topbar-actions")!, "getBoundingClientRect").mockReturnValue({ width: 96 } as DOMRect);
  // 140 + 96 + gap/padding (2*2 + 2*7).
  expect(minimumTitlebarWidth(bar)).toBe(254);
  bar.remove();
});
