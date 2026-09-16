// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../domain/entry";
import { DEFAULT_CHRONOEON_SETTINGS } from "../domain/entry";
import { IdeasView } from "./IdeasView";

let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) { this.callback = callback; }
  observe(target: Element) {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRectReadOnly;
    this.callback([{ target, contentRect: rect } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}

function idea(id: string, title: string, note?: string): Entry {
  return {
    id,
    kind: "idea",
    title,
    date: "2026-08-10",
    allDay: true,
    category: "personal",
    color: "#77787b",
    createdAt: "2026-08-10T00:00:00Z",
    note,
  };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  Element.prototype.scrollTo = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("variable-height ideas", () => {
  it("keeps short boards in natural flow with the new-card action", async () => {
    const onConvert = vi.fn();
    act(() => {
      root.render(
        <IdeasView
          entries={[
            idea("00000000-0000-4000-8000-000000000001", "Learn Erlang", "A language that shapes how you think."),
            idea("00000000-0000-4000-8000-000000000002", "Photo essay on bridges"),
          ]}
          locale="en"
          settings={DEFAULT_CHRONOEON_SETTINGS}
          search=""
          today="2026-08-10"
          onEdit={() => undefined}
          onConvert={onConvert}
          onNew={() => undefined}
        />,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(host.textContent).toContain("Learn Erlang");
    expect(host.querySelector(".idea-card")).not.toBeNull();
    expect(host.querySelector(".idea-vine-bud")).not.toBeNull();
    expect(host.querySelectorAll(".idea-card-top .idea-card-action")).toHaveLength(4);
    expect(host.querySelector(".idea-category")).toBeNull();
    expect(host.querySelector(".idea-card footer")).toBeNull();
  });
});


it("virtualizes paired rows without flattening multiline diary text", async () => {
  const entries=Array.from({length:50},(_,index)=>idea(`idea-${index}`,`Diary ${index}`,index===0?"First line\nSecond line\n\nThird line":"Short note"));
  act(()=>root.render(<IdeasView entries={entries} locale="en" settings={DEFAULT_CHRONOEON_SETTINGS} search="" today="2026-08-10" onEdit={()=>{}} onConvert={()=>{}} onNew={()=>{}}/>));
  expect(host.querySelector(".ideas-scroll")).not.toBeNull();
  expect([...host.querySelectorAll(".idea-body p")].slice(0, 3).map((node) => node.textContent)).toEqual(["First line", "Second line", "Third line"]);
  expect(host.querySelector(".ideas-vine")?.querySelectorAll(".idea-card")).toHaveLength(2);
});

describe("idea card presentation", () => {
  const render = (entries: Entry[], locale: "zh" | "en" = "zh") => act(() => root.render(
    <IdeasView entries={entries} locale={locale} settings={DEFAULT_CHRONOEON_SETTINGS} search="" today="2026-08-10" onEdit={() => {}} onConvert={() => {}} onNew={() => {}} />,
  ));

  it("puts the editable title in the colored heading, not the note body", () => {
    render([idea("heading", "一个想法", "保留完整正文")]);
    expect(host.querySelector(".idea-card-top h3")?.textContent).toBe("一个想法");
    expect(host.querySelector(".idea-body h3")).toBeNull();
    expect(host.querySelector(".idea-body p")?.textContent).toBe("保留完整正文");
  });

  it("indents Chinese paragraphs and splits the note into paragraphs", () => {
    render([idea("p1", "读书", ["第一段", "第二段"].join("\n"))]);
    const body = host.querySelector(".idea-body");
    expect(body?.classList.contains("is-zh")).toBe(true);
    expect([...body!.querySelectorAll("p")].map((node) => node.textContent)).toEqual(["第一段", "第二段"]);
  });

  it("does not indent English notes", () => {
    render([idea("p1", "Read", ["One", "Two"].join("\n"))], "en");
    expect(host.querySelector(".idea-body")?.classList.contains("is-zh")).toBe(false);
  });

  it("stamps the calendar as a seal beside the signature", () => {
    render([idea("s1", "读书")]);
    const seal = host.querySelector<HTMLElement>(".idea-signature .idea-seal");
    expect(seal?.getAttribute("title")).toBe("默认");
    expect(seal?.textContent).toBe("默");
    expect(host.querySelector(".idea-card-top")).not.toBeNull();
  });

  it("shows a divider and a photo row when the idea carries images", () => {
    render([{ ...idea("g1", "照片"), images: ["attachments/a.webp", "attachments/b.webp"] }]);
    expect(host.querySelector(".idea-divider")).not.toBeNull();
    expect(host.querySelectorAll(".idea-gallery li")).toHaveLength(2);
    render([idea("g2", "无照片")]);
    expect(host.querySelector(".idea-divider")).toBeNull();
    expect(host.querySelector(".idea-gallery")).toBeNull();
  });
});
