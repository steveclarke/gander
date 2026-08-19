import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";

test("keeps cached reads, rejects offline writes, and refreshes authoritatively after recovery", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/service-recovery" });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);
  const status = app.page.locator("footer").getByRole("status");
  const error = app.page.locator(".error-banner");

  await review.open(repository.title);
  await review.checkFile("a.rb");
  await world.stopService();
  world.uncheckFileInService(repository, "a.rb");

  await review.fetchOrigin();
  await expect(status).toContainText("Service unreachable · showing cached review");
  await expect(review.file("a.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");

  await review.file("b.rb").getByRole("checkbox").click();
  await expect(error).toContainText("This change was not saved and will not be retried.");
  await expect(review.file("b.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "false");

  await world.startService();
  await review.file("b.rb").getByRole("checkbox").click();
  await expect(error).toContainText("showing cached service data");
  await expect(review.file("b.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "false");

  await review.fetchOrigin();
  await expect(status).toContainText("Service connected");
  await expect(error).toHaveCount(0);
  await expect(review.file("a.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  await expect(review.file("b.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "false");

  await review.file("b.rb").getByRole("checkbox").click();
  await expect(review.file("b.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
});
