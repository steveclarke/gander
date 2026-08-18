import { resolve } from "node:path";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; run the suite through pnpm test:e2e`);
  return value;
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [resolve(import.meta.dirname, "app.e2e.ts")],
  maxInstances: 1,
  capabilities: [{
    browserName: "electron",
    "wdio:chromedriverOptions": {
      binary: resolve(import.meta.dirname, "../node_modules/electron-chromedriver/bin/chromedriver"),
    },
  }],
  services: [["electron", {
    appEntryPoint: resolve(import.meta.dirname, "../out/main/index.js"),
    appArgs: [`--user-data-dir=${requiredEnv("GANDER_E2E_USER_DATA")}`],
  }]],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  mochaOpts: { timeout: 120_000 },
};
