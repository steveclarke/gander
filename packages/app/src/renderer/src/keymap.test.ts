import { describe, expect, it } from "vitest";
import { BINDINGS, GROUPS, bindingFor } from "./keymap.js";

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, ...modifiers }) as KeyboardEvent;

describe("keymap", () => {
  it("matches a plain letter", () => {
    expect(bindingFor(press("j"))?.command).toBe("next-file");
  });

  it("tells a shifted letter from its lower case", () => {
    expect(bindingFor(press("m"))?.command).toBe("toggle-checked");
    expect(bindingFor(press("j"))?.command).toBe("next-file");
    expect(bindingFor(press("J"))?.command).toBe("mark-and-advance");
    expect(bindingFor(press("K"))?.command).toBe("mark-and-retreat");
  });

  // ⌘B toggles the tree; a bare b would otherwise claim the same key.
  it("requires the modifier where one is specified, and refuses it where none is", () => {
    expect(bindingFor(press("b"))).toBeNull();
    expect(bindingFor(press("b", { metaKey: true }))?.command).toBe("toggle-tree");
    expect(bindingFor(press("j", { metaKey: true }))).toBeNull();
  });

  it("leaves Option combinations to the system", () => {
    expect(bindingFor(press("j", { altKey: true }))).toBeNull();
  });

  it("binds the arrow keys alongside hjkl, and o alongside expand", () => {
    expect(bindingFor(press("ArrowDown"))?.command).toBe("next-file");
    expect(bindingFor(press("ArrowLeft"))?.command).toBe("collapse");
    expect(bindingFor(press("o"))?.command).toBe("expand");
  });

  // The `?` sheet renders from this table, so a binding outside the printed groups would
  // work while going undocumented.
  it("puts every binding in a group the help sheet prints", () => {
    for (const binding of BINDINGS) expect(GROUPS).toContain(binding.group);
  });

  it("claims each key once", () => {
    const seen = BINDINGS.flatMap((b) => b.keys.map((k) => `${b.meta === true ? "meta+" : ""}${k}`));
    expect(new Set(seen).size).toBe(seen.length);
  });
});
