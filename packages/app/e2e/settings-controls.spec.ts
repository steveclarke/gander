import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/test.js";
import { SettingsDriver } from "./drivers/settings.js";

const BOX_PROPERTIES = [
  "appearance", "background-color", "background-image", "border-top-style", "border-top-width",
  "border-top-color", "border-top-left-radius", "padding-top", "padding-left", "font-size", "height",
];

async function boxStyle(control: Locator): Promise<Record<string, string>> {
  return control.evaluate((element, properties) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]));
  }, BOX_PROPERTIES);
}

// One ring: the border takes the ring's colour and the outline sits flush against it, rather
// than a second outline floating outside an accent border.
async function expectOneFocusRing(control: Locator): Promise<void> {
  await control.focus();
  await expect.soft(control).toHaveCSS("outline-offset", "0px");
  const ring = await control.evaluate((element) => getComputedStyle(element).outlineColor);
  await expect.soft(control).toHaveCSS("border-top-color", ring);
}

test("settings dropdowns share one drawn look with one focus ring", async ({ world }) => {
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
  await settings.openWorkbenchCategory();

  // Chromium's own select is a square box on macOS whose text the native menu does not
  // cover, so the old value ghosts through the open list. Every settings select is drawn.
  const workbench = [
    app.page.locator('select[name="workbench.iconTheme"]'),
    app.page.locator('select[name="workbench.colorTheme"]'),
  ];
  const look = await boxStyle(workbench[0]!);
  expect(look.appearance).toBe("none");
  for (const select of workbench) {
    expect.soft(await boxStyle(select)).toEqual(look);
    await expectOneFocusRing(select);
  }
  await app.page.screenshot({ path: join(images, "workbench.png") });

  await settings.openConnectionCategory();
  await expectOneFocusRing(app.page.getByPlaceholder("acme"));
  const ruleServer = app.page.getByLabel("Review server", { exact: true });
  for (const select of [
    app.page.getByLabel(`Server for ${atlas.repoId}`),
    app.page.getByLabel(`Server for ${harbor.repoId}`),
    ruleServer,
  ]) {
    expect.soft(await boxStyle(select)).toEqual(look);
    await expectOneFocusRing(select);
  }
  await app.page.screenshot({ path: join(images, "connection.png") });
});
