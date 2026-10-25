import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures/test.js";
import { SettingsDriver } from "./drivers/settings.js";

const BOX_PROPERTIES = [
  "appearance", "background-color", "border-top-style", "border-top-width", "border-top-color",
  "border-top-left-radius", "padding-top", "padding-left",
];

// A select keeps the platform's own control (the Aqua pop-up button on macOS) only while the
// page leaves its box alone. Styling its border or background swaps in Chromium's drawn
// fallback, whose text no longer lines up under the native menu, so the old value shows
// through the translucent list. Comparing against a bare select catches any such styling.
async function boxStyle(page: Page, select?: Locator): Promise<Record<string, string>> {
  const element = select ? await select.elementHandle() : null;
  return page.evaluate(({ element, properties }) => {
    const target = element ?? document.body.appendChild(document.createElement("select"));
    const style = getComputedStyle(target);
    const values = Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]));
    if (!element) target.remove();
    return values;
  }, { element, properties: BOX_PROPERTIES });
}

async function expectNativeSelect(page: Page, select: Locator): Promise<void> {
  expect.soft(await boxStyle(page, select)).toEqual(await boxStyle(page));
  await select.focus();
  await expect.soft(select).toHaveCSS("outline-style", "auto");
}

test("settings dropdowns are the platform's own control with one focus ring", async ({ world }) => {
  const atlas = await world.addRepository({ repoId: "example/atlas", title: "QA example" });
  const harbor = await world.addRepository({ repoId: "acme/harbor", title: "QA example" });
  const config = JSON.parse(await readFile(world.configPath, "utf8"));
  delete config.serviceUrl; delete config.serviceToken;
  config.servers = [
    { id: "qa-personal", name: "QA Personal", url: world.serviceUrl, token: world.serviceToken },
    { id: "qa-team", name: "QA Team", url: world.serviceUrl, token: world.serviceToken },
  ];
  config.ownerServers = [{ owner: "acme", serverId: "qa-team" }];
  config.repos[0].serverId = "qa-personal"; config.repos[1].serverId = "qa-team";
  config.settings.workbench.colorTheme = "Gander Light";
  await writeFile(world.configPath, JSON.stringify(config), { mode: 0o600 });

  const app = await world.launch({ connectionFromEnvironment: false });
  await app.page.setViewportSize({ width: 1180, height: 860 });
  const images = resolve(import.meta.dirname, "../../../docs/qa/settings-controls");
  await mkdir(images, { recursive: true });
  const settings = new SettingsDriver(app.page);
  await settings.open();
  await settings.openConnectionCategory();

  // One ring: the border takes the ring's colour and the outline sits flush against it,
  // rather than a second outline floating outside an accent border.
  const owner = app.page.getByPlaceholder("acme");
  await owner.focus();
  await expect.soft(owner).toHaveCSS("outline-offset", "0px");
  const ring = await owner.evaluate((element) => getComputedStyle(element).outlineColor);
  await expect.soft(owner).toHaveCSS("border-top-color", ring);

  const ruleServer = app.page.getByLabel("Review server", { exact: true });
  for (const select of [
    app.page.getByLabel(`Server for ${atlas.repoId}`),
    app.page.getByLabel(`Server for ${harbor.repoId}`),
    ruleServer,
  ]) await expectNativeSelect(app.page, select);
  await app.page.screenshot({ path: join(images, "connection.png") });

  await app.page.getByRole("button", { name: "Workbench", exact: true }).click();
  for (const name of ["workbench.iconTheme", "workbench.colorTheme"]) {
    await expectNativeSelect(app.page, app.page.locator(`select[name="${name}"]`));
  }
  await app.page.screenshot({ path: join(images, "workbench.png") });
});
