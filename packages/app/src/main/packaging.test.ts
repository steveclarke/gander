import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("macOS packaging", () => {
  it("declares why Gander connects to local review services", () => {
    const configPath = fileURLToPath(new URL("../../electron-builder.yml", import.meta.url));
    const config = readFileSync(configPath, "utf8");

    expect(config).toMatch(/NSLocalNetworkUsageDescription:\s*.+/);
  });
});
