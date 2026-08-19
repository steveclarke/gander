import { describe, expect, it } from "vitest";
import { describeNetworkError } from "./network-error.js";

describe("network error details", () => {
  it("includes the system cause hidden by Node fetch", () => {
    const error = new Error("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND gander.example.test"),
    });

    expect(describeNetworkError(error)).toBe(
      "fetch failed (getaddrinfo ENOTFOUND gander.example.test)",
    );
  });

  it("does not repeat an identical cause", () => {
    expect(describeNetworkError(new Error("offline", { cause: new Error("offline") }))).toBe("offline");
  });
});
