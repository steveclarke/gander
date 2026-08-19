import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";

test("keeps identical files reviewed and unchecks content changed by a force-push", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/content-state" });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);

  await review.open(repository.title);
  await review.checkFile("a.rb");
  await review.checkFile("b.rb");
  await review.selectFile("a.rb");

  await world.rewritePullRequest(repository, {
    "a.rb": "class A\n  def go; puts :changed; end\nend\n",
  });
  await review.fetchOrigin();

  await expect(review.file("a.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  await expect(review.file("b.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await expect(app.page.getByText("Changed since your review — un-checked automatically.", { exact: false })).toBeVisible();
  await expect(app.page.getByRole("tab", { name: "Changes since your review" })).toBeVisible();
});
