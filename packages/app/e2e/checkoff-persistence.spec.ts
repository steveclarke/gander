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
