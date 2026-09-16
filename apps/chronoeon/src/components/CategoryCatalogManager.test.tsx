// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(next).toHaveLength(3);
    expect(next?.[2].sub).toEqual([]);
    expect(next?.[2].name).toBe("New category");
  });

  it("edits nested subcategories without changing their parent color", () => {
    render();
    act(() => { host.querySelectorAll<HTMLButtonElement>(".category-edit-button")[0]!.click(); });
    const input = document.querySelector<HTMLInputElement>(".category-editor .category-sub-row input")!;
    act(() => { setInputValue(input, "Bonus"); });
    expect(next?.[0].sub).toEqual(["Bonus"]);
    expect(next?.[0].color).toBe("#fab27b");
  });

  it("removes the requested group", () => {
    render();
    act(() => { host.querySelectorAll<HTMLButtonElement>(".category-edit-button")[1]!.click(); });
    const deleteFood = document.querySelector<HTMLButtonElement>(".category-editor footer .danger-button")!;
    act(() => { deleteFood.click(); });
    expect(document.querySelector(".category-editor")?.closest("[inert]")).not.toBeNull();
    expect(next?.map((category) => category.id)).toEqual(["income"]);
  });
});
