// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryCatalogManager, type EditableCategory } from "./CategoryCatalogManager";

let host: HTMLDivElement;
let root: Root;
let next: EditableCategory[] | null;

const categories: EditableCategory[] = [
  { id: "income", name: "Income", color: "#fab27b", sub: ["Salary"] },
  { id: "food", name: "Food", color: "#8f4b2e", sub: [] },
];

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  next = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render() {
  function StatefulCatalog() {
    const [values, setValues] = useState(categories);
    return (
      <CategoryCatalogManager
        locale="en"
        label="Bill groups"
        mode="bill"
        categories={values}
        onChange={(value) => { next = value; setValues(value); }}
        onDelete={(id) => {
          const value = values.filter((category) => category.id !== id);
          next = value;
          setValues(value);
        }}
      />
    );
  }
  act(() => {
    root.render(<StatefulCatalog />);
  });
}

describe("CategoryCatalogManager", () => {
  it("adds a bill group and enters rename mode", () => {
    render();
    act(() => { host.querySelector<HTMLButtonElement>(".category-add")!.click(); });
    expect(document.querySelector<HTMLInputElement>(".category-editor .category-name-input")?.value).toBe("New category");
    expect(next).toBeNull();
    act(() => { document.querySelector<HTMLButtonElement>(".category-editor footer .primary-action")!.click(); });
    expect(next).toHaveLength(3);
    expect(next?.[2].sub).toEqual([]);
    expect(next?.[2].name).toBe("New category");
  });

  it("edits nested subcategories without changing their parent color", () => {
    render();
    act(() => { host.querySelectorAll<HTMLButtonElement>(".category-edit-button")[0]!.click(); });
    const input = document.querySelector<HTMLInputElement>(".category-editor .category-sub-row input")!;
    act(() => { setInputValue(input, "Bonus"); });
    expect(next).toBeNull();
    act(() => { document.querySelector<HTMLButtonElement>(".category-editor footer .primary-action")!.click(); });
    expect(next?.[0].sub).toEqual(["Bonus"]);
    expect(next?.[0].color).toBe("#fab27b");
  });

  it("reassigns to the other same-name category rather than selecting its own ID", async () => {
    const onReassignDelete = vi.fn(async () => undefined);
    const onDelete = vi.fn();
    act(() => root.render(<CategoryCatalogManager locale="en" label="Bill groups" mode="bill"
      categories={[{ id: "income", name: "Income", color: "#aaa", sub: ["Salary"] }, { id: "ledger-income", name: "Income", color: "#bbb", sub: ["Salary"] }]}
      entryCounts={{ income: 1 }}
      reassignOptions={[{ value: "income/Salary", label: "Salary" }, { value: "ledger-income/Salary", label: "Salary" }]}
      onChange={() => undefined} onDelete={onDelete} onReassignDelete={onReassignDelete} />));
    act(() => host.querySelectorAll<HTMLButtonElement>(".category-edit-button")[0].click());
    act(() => document.querySelector<HTMLButtonElement>(".category-editor footer .danger-button")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>(".category-editor footer .danger-button")!.click());
    expect(onReassignDelete).toHaveBeenCalledWith("income", "ledger-income/Salary");
    expect(onDelete).toHaveBeenCalledWith("income");
  });

  it("removes the requested group", () => {
    render();
    act(() => { host.querySelectorAll<HTMLButtonElement>(".category-edit-button")[1]!.click(); });
    const deleteFood = document.querySelector<HTMLButtonElement>(".category-editor footer .danger-button")!;
    act(() => { deleteFood.click(); });
    expect(document.querySelector(".category-editor")?.closest("[inert]")).not.toBeNull();
    expect(next?.map((category) => category.id)).toEqual(["income"]);
  });

  it("protects the default category without offering it a redundant action", () => {
    act(() => root.render(<CategoryCatalogManager locale="en" label="Bill groups" mode="bill"
      categories={categories} onChange={() => undefined} onDelete={() => undefined}
      defaultCategoryId="income" onSetDefault={() => undefined} />));
    act(() => { host.querySelectorAll<HTMLButtonElement>(".category-edit-button")[0]!.click(); });
    const footerButtons = [...document.querySelectorAll<HTMLButtonElement>(".category-editor footer button")];
    expect(footerButtons.find(button => button.textContent?.includes("Delete"))?.disabled).toBe(true);
    expect(footerButtons.some(button => button.textContent?.includes("Set default"))).toBe(false);
  });
});

it("offers built-in item icons, saves the choice and displays it beside the name", () => {
  const change = vi.fn();
  act(() => root.render(<CategoryCatalogManager locale="en" label="Assets" mode="item" categories={[{ id: "custom", name: "My books", color: "#777777", icon: "book" }]} onChange={change} onDelete={vi.fn()} />));
  expect(host.querySelector(".category-name svg")).toBeTruthy();
  act(() => host.querySelector<HTMLButtonElement>(".category-edit-button")!.click());
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Icon"]')!.click());
  const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options.length).toBeGreaterThanOrEqual(12);
  act(() => options.find(option => option.textContent?.includes("Cameras"))!.click());
  expect(change).not.toHaveBeenCalled();
  act(() => [...document.querySelectorAll<HTMLButtonElement>(".category-editor button")].find(button => button.textContent?.trim() === "Confirm")!.click());
  expect(change).toHaveBeenCalledWith([expect.objectContaining({ icon: "camera" })]);
});
