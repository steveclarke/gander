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
  await world.addRepository({ repoId: "example/atlas", title: "QA example" });
  const config = JSON.parse(await readFile(world.configPath, "utf8"));
  config.settings.workbench.colorTheme = "Gander Light";
  await writeFile(world.configPath, JSON.stringify(config), { mode: 0o600 });

  const app = await world.launch();
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


  // Connection has no dropdowns: a repository's server changes through its Change button.
  await settings.openConnectionCategory();
  await expect(app.page.locator(".server-settings select")).toHaveCount(0);
});
