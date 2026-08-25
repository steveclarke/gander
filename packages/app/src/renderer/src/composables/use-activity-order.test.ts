// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { moveActivity, parseActivityOrder, reorderActivity } from "./use-activity-order.js";

describe("activity order", () => {
  it("accepts each activity exactly once", () => {
    expect(parseActivityOrder(["changes", "pulls", "explorer"])).toEqual(["changes", "pulls", "explorer"]);
    expect(parseActivityOrder(["pulls", "pulls", "changes"])).toBeNull();
    expect(parseActivityOrder(["pulls", "explorer", "unknown"])).toBeNull();
  });

  it("places a dragged activity on the requested edge", () => {
    expect(reorderActivity(["pulls", "explorer", "changes"], "pulls", "explorer", "after")).toEqual([
      "explorer",
      "pulls",
      "changes",
    ]);
    expect(reorderActivity(["pulls", "explorer", "changes"], "changes", "pulls", "before")).toEqual([
      "changes",
      "pulls",
      "explorer",
    ]);
  });

  it("keeps keyboard moves inside the rail", () => {
    expect(moveActivity(["pulls", "explorer", "changes"], "pulls", -1)).toEqual(["pulls", "explorer", "changes"]);
    expect(moveActivity(["pulls", "explorer", "changes"], "explorer", 1)).toEqual(["pulls", "changes", "explorer"]);
  });
});
