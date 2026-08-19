import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
