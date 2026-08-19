import { describe, expect, it } from "vitest";
import { BINDINGS, GROUPS, bindingFor, isPrefix } from "./keymap.js";

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

  it("binds the arrows alongside j and k, and o to the directory toggle", () => {
    expect(bindingFor(press("ArrowDown"))?.command).toBe("next-file");
    expect(bindingFor(press("ArrowUp"))?.command).toBe("previous-file");
    expect(bindingFor(press("o"))?.command).toBe("toggle-directory");
  });

  it("starts the visible-row jump with f", () => {
    expect(bindingFor(press("f"))?.command).toBe("jump-row");
  });

  // The `?` sheet renders from this table, so a binding outside the printed groups would
  // work while going undocumented.
  it("puts every binding in a group the help sheet prints", () => {
    for (const binding of BINDINGS) expect(GROUPS).toContain(binding.group);
  });

  // gg is vim's, and g does nothing on its own, so it can begin a chord without any other
  // binding having to know about it.
  it("reaches a chord only while its prefix is pending", () => {
    expect(bindingFor(press("g"))).toBeNull();
    expect(isPrefix(press("g"), null)).toBe("g");
    expect(bindingFor(press("g"), "g")?.command).toBe("first-file");
  });

  it("hides plain bindings while a prefix is pending", () => {
    expect(bindingFor(press("j"), "g")).toBeNull();
    expect(bindingFor(press("G"))?.command).toBe("last-file");
  });

  it("does not start a chord on a modified key, or while one is already pending", () => {
    expect(isPrefix(press("g", { metaKey: true }), null)).toBeNull();
    expect(isPrefix(press("g"), "g")).toBeNull();
  });

  it("claims each key once", () => {
    const seen = BINDINGS.flatMap((b) => b.keys.map((k) => `${b.prefix ?? ""}${b.meta === true ? "meta+" : ""}${k}`));
    expect(new Set(seen).size).toBe(seen.length);
  });
});
