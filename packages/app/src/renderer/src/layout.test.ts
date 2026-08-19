import { describe, expect, it } from "vitest";
import { parseLayout } from "./layout.js";

describe("layout persistence", () => {
  const current = {
    notesDock: "right" as const,
    treeWidth: 264,
    notesWidth: 320,
    notesHeight: 260,
  };

  it("accepts only the complete current shape", () => {
    expect(parseLayout(current)).toEqual(current);
    expect(parseLayout({ notesDock: "right", treeWidth: 264 })).toBeNull();
    expect(parseLayout({ ...current, futurePanelSize: 400 })).toBeNull();
  });

  it("rejects invalid current values", () => {
    expect(parseLayout({ ...current, notesDock: "left" })).toBeNull();
    expect(parseLayout({ ...current, treeWidth: Number.NaN })).toBeNull();
  });
});
