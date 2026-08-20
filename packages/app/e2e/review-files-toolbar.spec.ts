import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";

test("review file toolbar controls folder disclosure and remaining files", async ({ world }) => {
  const repository = await world.addRepository({
    repoId: "acme/review-toolbar",
    baseFiles: {
      "docs/guide.md": "old guide\n",
      "src/nested/worker.ts": "old worker\n",
      "src/main.ts": "old main\n",
      "README.md": "old readme\n",
    },
    featureFiles: {
      "docs/guide.md": "new guide\n",
      "src/nested/worker.ts": "new worker\n",
      "src/main.ts": "new main\n",
      "README.md": "new readme\n",
    },
  });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);

  await review.open(repository.title);
  const toolbar = app.page.getByRole("toolbar", { name: "Review file display" });
  await expect(toolbar).toContainText("6 of 6 remaining");

  await toolbar.getByRole("button", { name: "Collapse all folders" }).click();
  await expect(review.file("src/main.ts")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Expand all folders" }).click();
  await expect(review.file("src/main.ts")).toBeVisible();

  await review.checkFile("docs/guide.md");
  await toolbar.getByRole("button", { name: "Collapse reviewed folders" }).click();
  await expect(review.file("docs/guide.md")).toHaveCount(0);
  await expect(review.file("src/main.ts")).toBeVisible();

  const remaining = toolbar.getByRole("button", { name: "Show remaining files only" });
  await remaining.click();
  await expect(remaining).toHaveAttribute("aria-pressed", "true");
  await expect(toolbar).toContainText("5 of 6 remaining");
  await expect(app.page.locator(".tnode.isdir").filter({ hasText: "docs" })).toHaveCount(0);
  await expect(review.file("src/main.ts")).toBeVisible();

});
