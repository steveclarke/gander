import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";

test("persists a file checkoff across an app restart", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/checkoffs" });
  const app = await world.launch();
  let review = new ReviewDriver(app.page);

  await review.open(repository.title);
  await review.expectProgress(0, 2);
  await review.checkFile("a.rb");
  await review.expectProgress(1, 2);

  await app.restart();
  review = new ReviewDriver(app.page);
  await review.open(repository.title);
  await expect(review.file("a.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await review.expectProgress(1, 2);
});

test("updates the local checkoff immediately and mirrors it to GitHub in the background", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/viewed-mirror" });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);
  await review.open(repository.title);

  const paused = world.github.pauseViewedMutations();
  try {
    await app.page.getByRole("button", { name: "Mark reviewed" }).click();
    await paused.entered;
    await expect(app.page.getByRole("button", { name: "Reviewed", exact: true })).toBeVisible();
    expect(world.github.isViewed(repository.repoId, "a.rb")).toBe(false);
  } finally {
    paused.release();
  }
  await expect.poll(() => world.github.isViewed(repository.repoId, "a.rb")).toBe(true);

  await app.page.getByRole("button", { name: "Reviewed", exact: true }).click();
  await expect.poll(() => world.github.isViewed(repository.repoId, "a.rb")).toBe(false);
});
