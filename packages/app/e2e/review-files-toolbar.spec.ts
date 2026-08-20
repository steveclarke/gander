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
  await expect(toolbar.getByRole("button")).toHaveText(["Expand", "Collapse", "Remaining"]);
  await expect(app.page.locator(".files-section header")).toContainText("6/6 left");

  await toolbar.getByRole("button", { name: "Collapse all folders" }).click();
  await expect(review.file("src/main.ts")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Expand all folders" }).click();
  await expect(review.file("src/main.ts")).toBeVisible();

  // A reviewed top-level file cannot be hidden by folding a parent folder. This is the
  // important behavior: Remaining filters files, rather than merely collapsing directories.
  await review.checkFile("a.rb");

  const remaining = toolbar.getByRole("button", { name: "Show remaining files only" });
  await remaining.click();
  await expect(remaining).toHaveAttribute("aria-pressed", "true");
  await expect(app.page.locator(".files-section header")).toContainText("5/6 left");
  await expect(review.file("a.rb")).toHaveCount(0);
  await expect(review.file("src/main.ts")).toBeVisible();

  await review.file("src/main.ts").getByRole("checkbox").click();
  await expect(review.file("src/main.ts")).toHaveCount(0);
  await expect(app.page.locator(".files-section header")).toContainText("4/6 left");

  await remaining.click();
  await expect(remaining).toHaveAttribute("aria-pressed", "false");
  await expect(review.file("a.rb")).toBeVisible();
  await expect(review.file("src/main.ts")).toBeVisible();
});
