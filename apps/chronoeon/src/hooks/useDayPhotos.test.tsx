// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PhotoDisplayMode } from "@chronoeon/domain";
import type { Entry } from "../domain/entry";
import { useDayPhotos } from "./useDayPhotos";

let root: Root;
let host: HTMLDivElement;
const photo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
const entry: Entry = { id: "p", kind: "task", title: "p", date: "2026-08-07", allDay: true, category: "general", color: "#fff", images: [photo], createdAt: "2026-08-07T00:00:00Z" };

function Probe() {
  const photos = useDayPhotos({ "2026-08-07": [entry] });
  return <output>{photos["2026-08-07"]?.length ?? 0}</output>;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("day photo resolution", () => {
  it("resolves session images under React StrictMode", async () => {
    await act(async () => {
      root.render(<StrictMode><Probe /></StrictMode>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toBe("1");
  });
});

it("changes slideshow mode without requiring entries to change", async () => {
  const references = { "2026-08-07": [{ ...entry, images: [photo, photo.replace("%3Csvg", "%3Csvg width='2'")] }] };
  function ModeProbe({ mode }: { mode: PhotoDisplayMode }) {
    const photos = useDayPhotos(references, true, mode);
    return <output>{photos["2026-08-07"]?.length ?? 0}</output>;
  }
  await act(async () => root.render(<ModeProbe mode="first" />));
  expect(host.textContent).toBe("1");
  await act(async () => root.render(<ModeProbe mode="slideshow" />));
  expect(host.textContent).toBe("2");
  await act(async () => root.render(<ModeProbe mode="stable-random" />));
  expect(host.textContent).toBe("1");
});
