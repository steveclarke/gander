import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("renderer content security policy", () => {
  it("allows controlled image object URLs without allowing blob scripts", () => {
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

    expect(html).toContain("img-src 'self' data: blob:");
    expect(html).toContain("default-src 'self'");
    expect(html).not.toContain("script-src blob:");
  });
});
