// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderChatMarkdown } from "./ChatMarkdown";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(content: string) {
  act(() => { root.render(<div>{renderChatMarkdown(content)}</div>); });
  return host;
}

describe("chat markdown", () => {
  it("renders tables, links, blockquotes, tasks and labelled code safely", () => {
    const node = render([
      "| Item | State |",
      "| --- | --- |",
      "[ChronoEon](https://example.com/chronoeon) | ready",
      "",
      "> Quote **fact**",
      "",
      "- [x] Done",
      "- [ ] Open",
      "",
      "```ts",
      "const answer = 42;",
      "```",
    ].join("\n"));

    expect(node.querySelector("th")?.textContent).toBe("Item");
    const link = node.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://example.com/chronoeon");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(node.querySelector("blockquote")?.textContent).toContain("fact");
    expect(node.querySelector("li.chat-task.is-done")?.textContent).toContain("Done");
    expect(node.querySelector("li.chat-task:not(.is-done)")?.textContent).toContain("Open");
    expect(node.querySelector("pre")?.getAttribute("data-language")).toBe("ts");
  });

  it("does not turn javascript links into anchors", () => {
    const node = render("[click](javascript:alert(1))");
    expect(node.querySelector("a")).toBeNull();
    expect(node.textContent).toContain("[click](javascript:alert(1))");
  });
});
