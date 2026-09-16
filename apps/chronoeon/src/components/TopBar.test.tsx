// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { minimumTitlebarWidth } from "./TopBar";
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
