import { describe, expect, it } from "vitest";
import { imageMediaType } from "./image-preview.js";

describe("image media detection", () => {
  it("uses blob signatures instead of filenames", () => {
    expect(imageMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(imageMediaType(new TextEncoder().encode("not an image.png"))).toBeNull();
  });

  it("does not mistake arbitrary text beginning with BM for a bitmap", () => {
    expect(imageMediaType(new TextEncoder().encode("BM is ordinary text"))).toBeNull();
  });
});
