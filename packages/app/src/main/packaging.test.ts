import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("packaged main process", () => {
  it("bundles @gander/shared, which ships TypeScript that Node will not load from node_modules", () => {
    const configPath = fileURLToPath(new URL("../../electron.vite.config.ts", import.meta.url));
    const config = readFileSync(configPath, "utf8");

    expect(config).toMatch(/main:.*externalizeDeps:.*exclude:\s*\["@gander\/shared"\]/);
  });
});

describe("macOS packaging", () => {
  it("declares why Gander connects to local review services", () => {
    const configPath = fileURLToPath(new URL("../../electron-builder.yml", import.meta.url));
    const config = readFileSync(configPath, "utf8");

    expect(config).toMatch(/NSLocalNetworkUsageDescription:\s*.+/);
  });
});
