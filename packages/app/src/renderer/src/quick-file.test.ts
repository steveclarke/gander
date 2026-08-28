import { describe, expect, it } from "vitest";
import { matchQuickFile, quickFileMatches } from "./quick-file.js";

describe("quick file matching", () => {
  it("matches a case-insensitive fuzzy subsequence", () => {
    expect(matchQuickFile("packages/app/src/QuickFilePicker.vue", "qfp")?.matchIndices)
      .toEqual([17, 22, 26]);
    expect(matchQuickFile("packages/app/src/QuickFilePicker.vue", "missing")).toBeNull();
  });

  it("ranks a filename match above the same text in a directory", () => {
    expect(quickFileMatches([
      "review/picker/helpers.ts",
      "review/file-picker.ts",
      "picker/review.ts",
    ], "picker").map(({ path }) => path)).toEqual([
      "review/file-picker.ts",
      "picker/review.ts",
      "review/picker/helpers.ts",
    ]);
  });

  it("keeps pull-request order when the query is empty", () => {
    expect(quickFileMatches(["z.ts", "a.ts"], "").map(({ path }) => path)).toEqual(["z.ts", "a.ts"]);
  });
});
