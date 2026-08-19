import { SERVICE_VERSION } from "@gander/shared";
import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";
import { SettingsDriver } from "./drivers/settings.js";

test("shows an incompatible service version before a review is opened", async ({ world }) => {
  await world.restartService({ version: "0.0.0" });
  const app = await world.launch();

  const status = app.page.locator("footer").getByRole("status");
  await expect(status).toContainText(`Service 0.0.0 is too old · update to ${SERVICE_VERSION}`);
  await expect(status).toHaveAttribute("title", `Gander service 0.0.0 is too old for this app. Update the service to ${SERVICE_VERSION}.`);
});

test("warns while keeping a newer patch-level service usable", async ({ world }) => {
  const [major, minor, patch] = SERVICE_VERSION.split(".").map(Number) as [number, number, number];
  const newer = `${major}.${minor}.${patch + 1}`;
  const repository = await world.addRepository({ repoId: "acme/newer-service" });
  await world.restartService({ version: newer });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);

  await review.open(repository.title);
  await expect(app.page.locator("footer").getByRole("status"))
    .toContainText(`Service ${newer} is newer · app supports ${SERVICE_VERSION}`);
  await review.checkFile("a.rb");
  await review.expectProgress(1, 2);
});

test("reports a bad saved token in connection settings", async ({ world }) => {
  await world.restartService({ token: "a-different-service-token" });
  const app = await world.launch({ connectionFromEnvironment: false });
  const settings = new SettingsDriver(app.page);

  await settings.open();
  await settings.openConnectionCategory();
  await app.page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(app.page.locator(".connection-settings").getByRole("status"))
    .toHaveText("The service rejected that token.");
});
