import { expect, it } from "vitest";
import type { PutFileState } from "@gander/shared";
import { checkoffBatches, CHECKOFF_BODY_LIMIT } from "./checkoff-batches.js";
const file = (path: string, headContent = ""): PutFileState => ({ checked: true, path, baseHash: null, headHash: "h", baseContent: null, headContent, machine: "test" });
it("splits at 500 entries and keeps order", () => {
  const inputs = Array.from({ length: 1001 }, (_, i) => file(`${i}.ts`));
  const batches = checkoffBatches(inputs);
  expect(batches.map((batch) => batch.length)).toEqual([500, 500, 1]);
  expect(batches.flat()).toEqual(inputs);
  expect(checkoffBatches([])).toEqual([]);
});
it("counts UTF-8 and escaped JSON and includes envelope bytes", () => {
  const inputs = [file("a", "雪\n\"".repeat(1_300_000)), file("b", "雪\n\"".repeat(1_300_000))];
  const batches = checkoffBatches(inputs);
  expect(batches).toHaveLength(2);
  for (const batch of batches) expect(Buffer.byteLength(JSON.stringify({ files: batch }))).toBeLessThanOrEqual(CHECKOFF_BODY_LIMIT);
});
it("accepts an exact-limit body and refuses an oversized single entry before any writes", () => {
  const empty = file("big");
  const overhead = Buffer.byteLength(JSON.stringify({ files: [empty] }));
  const fits = file("big", "x".repeat(CHECKOFF_BODY_LIMIT - overhead));
  expect(checkoffBatches([fits])).toHaveLength(1);
  expect(() => checkoffBatches([file("small"), file("big", "x".repeat(CHECKOFF_BODY_LIMIT))])).toThrow(/big exceeds/);
});
