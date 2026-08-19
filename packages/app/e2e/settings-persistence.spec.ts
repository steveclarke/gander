import { test } from "./fixtures/test.js";
import { SettingsDriver } from "./drivers/settings.js";

test("persists workbench and editor settings across an app restart", async ({ world }) => {
  const app = await world.launch();
  let settings = new SettingsDriver(app.page);

  await settings.open();
  await settings.chooseTheme("Gander Dark");
  await settings.openEditorCategory();
  await settings.setEditorFont("Courier New", 19);
  await settings.expectEditorFont("Courier New", 19);

  await app.restart();
  settings = new SettingsDriver(app.page);
  await settings.open();
  await settings.expectTheme("Gander Dark");
  await settings.openEditorCategory();
  await settings.expectEditorFont("Courier New", 19);
});
