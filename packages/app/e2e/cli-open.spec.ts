import { test, expect } from "./fixtures/test.js";

test("opens a named repository and pull request through bin/gander", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/cli-open", title: "Opened from the CLI" });
  const app = await world.launch();

  await expect(world.runCli(repository)).resolves.toBe(`Opened ${repository.repoId}#${repository.number}`);
  await expect(app.page.locator(".context-toolbar").filter({ hasText: repository.title })).toBeVisible();
  await expect(app.page.locator(".context-toolbar")).toContainText(`#${repository.number}`);
  expect(await app.isVisible()).toBe(false);
});
