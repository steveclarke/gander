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
  await expect(toolbar.getByRole("button")).toHaveCount(3);
  await expect(app.page.locator(".files-section header").getByRole("toolbar", { name: "Review file display" })).toBeVisible();
  const progress = app.page.locator(".files-section header .review-progress");
  await expect(progress).toHaveText("6/6 unreviewed");
  await expect(progress).toHaveAttribute("title", "6 of 6 files unreviewed");

  await toolbar.getByRole("button", { name: "Collapse all folders" }).click();
  await expect(review.file("src/main.ts")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Expand all folders" }).click();
  await expect(review.file("src/main.ts")).toBeVisible();

  // A reviewed top-level file cannot be hidden by folding a parent folder. This is the
  // important behavior: Remaining filters files, rather than merely collapsing directories.
  await review.checkFile("a.rb");

  const remaining = toolbar.getByRole("button", { name: "Show unreviewed files only" });
  await remaining.click();
  await expect(remaining).toHaveAttribute("aria-pressed", "true");
  await expect(progress).toHaveText("5/6 unreviewed");
  await expect(review.file("a.rb")).toHaveCount(0);
  await expect(review.file("src/main.ts")).toBeVisible();

  await review.file("src/main.ts").getByRole("checkbox").click();
  await expect(review.file("src/main.ts")).toHaveCount(0);
  await expect(progress).toHaveText("4/6 unreviewed");

  await remaining.click();
  await expect(remaining).toHaveAttribute("aria-pressed", "false");
  await expect(review.file("a.rb")).toBeVisible();
  await expect(review.file("src/main.ts")).toBeVisible();
});

test("collapses folders whose files are fully reviewed", async ({ world }) => {
  const repository = await world.addRepository({
    repoId: "acme/collapse-reviewed-folders",
    baseFiles: {
      "docs/guide.md": "old guide\n",
      "src/main.ts": "old main\n",
    },
    featureFiles: {
      "docs/guide.md": "new guide\n",
      "src/main.ts": "new main\n",
    },
  });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);

  await review.open(repository.title);
  const collapseReviewed = app.page.getByRole("button", { name: "Collapse fully reviewed folders" });
  await expect(collapseReviewed).toBeDisabled();

  await review.file("docs").getByRole("checkbox").click();
  await expect(collapseReviewed).toBeEnabled();
  await collapseReviewed.click();

  await expect(review.file("docs")).toBeVisible();
  await expect(review.file("docs/guide.md")).toHaveCount(0);
  await expect(review.file("src/main.ts")).toBeVisible();
});
