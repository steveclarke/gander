import { describe, expect, it } from "vitest";
import { parseLayout } from "./layout.js";

describe("layout persistence", () => {
  const current = {
    questionsDock: "right" as const,
    treeWidth: 264,
    questionsWidth: 320,
    questionsHeight: 260,
  };

  it("accepts only the complete current shape", () => {
    expect(parseLayout(current)).toEqual(current);
    expect(parseLayout({ questionsDock: "right", treeWidth: 264 })).toBeNull();
    expect(parseLayout({ ...current, futurePanelSize: 400 })).toBeNull();
  });

  it("rejects invalid current values", () => {
    expect(parseLayout({ ...current, questionsDock: "left" })).toBeNull();
    expect(parseLayout({ ...current, treeWidth: Number.NaN })).toBeNull();
  });
});
