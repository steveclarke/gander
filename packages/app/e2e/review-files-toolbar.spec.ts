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
  await expect(toolbar.getByRole("button")).toHaveCount(2);
  await expect(app.page.locator(".files-section header").getByRole("toolbar", { name: "Review file display" })).toBeVisible();
  const progress = app.page.locator(".files-section header .review-progress");
  await expect(progress).toHaveText("6/6 unreviewed");
  await expect(progress).toHaveAttribute("title", "6 of 6 files unreviewed");

  const moreActions = toolbar.getByRole("button", { name: "More review file actions" });
  const actions = app.page.getByRole("group", { name: "More review file actions" });
  await moreActions.click();
  await actions.getByRole("button", { name: "Collapse all folders" }).click();
  await expect(review.file("src/main.ts")).toHaveCount(0);
  await moreActions.click();
  await actions.getByRole("button", { name: "Expand all folders" }).click();
  await expect(review.file("src/main.ts")).toBeVisible();

  // A reviewed top-level file cannot be hidden by folding a parent folder. This is the
  // important behavior: Remaining filters files, rather than merely collapsing directories.
  await review.checkFile("a.rb");
  await review.file("src/main.ts").getByRole("checkbox").click();
  const partialDirectory = review.file("src").getByRole("checkbox");
  await expect(partialDirectory).toHaveAttribute("aria-checked", "mixed");
  const warningColor = await app.page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--warning)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(await partialDirectory.evaluate((element) => getComputedStyle(element).color)).toBe(warningColor);

  const remaining = toolbar.getByRole("button", { name: "Show unreviewed files only" });
  await remaining.click();
  await expect(remaining).toHaveAttribute("aria-pressed", "true");
  await expect(progress).toHaveText("4/6 unreviewed");
  await expect(review.file("a.rb")).toHaveCount(0);
  await expect(review.file("src/main.ts")).toHaveCount(0);

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
  const toolbar = app.page.getByRole("toolbar", { name: "Review file display" });
  const moreActions = toolbar.getByRole("button", { name: "More review file actions" });
  await moreActions.click();
  const actions = app.page.getByRole("group", { name: "More review file actions" });
  const collapseReviewed = actions.getByRole("button", { name: "Collapse fully reviewed folders" });
  await expect(collapseReviewed).toBeDisabled();
  await app.page.keyboard.press("Escape");

  await review.file("docs").getByRole("checkbox").click();
  await moreActions.click();
  await expect(collapseReviewed).toBeEnabled();
  await collapseReviewed.click();

  await expect(review.file("docs")).toBeVisible();
  await expect(review.file("docs/guide.md")).toHaveCount(0);
  await expect(review.file("src/main.ts")).toBeVisible();
});

test("keeps review actions inside the minimum-width sidebar", async ({ world }) => {
  const repository = await world.addRepository({
    repoId: "acme/narrow-review-toolbar",
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
  const setTreeWidth = async (treeWidth: number): Promise<void> => {
    await app.page.evaluate((width) => {
      localStorage.setItem("gander.layout", JSON.stringify({
        notesDock: "right",
        treeWidth: width,
        notesWidth: 320,
        notesHeight: 260,
      }));
    }, treeWidth);
    await app.page.reload();
    await app.page.getByRole("button", { name: "Editor settings" }).waitFor();
  };
  const review = new ReviewDriver(app.page);

  await setTreeWidth(226);
  await review.open(repository.title);
  let header = app.page.locator(".files-section header");
  await expect(header.locator(".review-title-prefix")).toBeHidden();
  await expect(header.locator(".review-progress-label")).toBeVisible();
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await setTreeWidth(190);
  await review.open(repository.title);
  header = app.page.locator(".files-section header");
  const toolbar = header.getByRole("toolbar", { name: "Review file display" });
  await expect(toolbar.getByRole("button", { name: "Show unreviewed files only" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "More review file actions" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Collapse all folders" })).toBeHidden();
  await expect(header.locator(".review-title-prefix")).toBeHidden();
  await expect(header.locator(".review-progress-label")).toBeHidden();
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const sidebar = app.page.locator(".view-sidebar");
  for (const width of [190, 205, 206, 226, 250, 251, 264, 280, 281, 520]) {
    await sidebar.evaluate((element, value) => { element.style.width = `${value}px`; }, width);
    expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth), `${width}px`).toBe(true);
  }
  await sidebar.evaluate((element) => { element.style.width = "190px"; });

  await toolbar.getByRole("button", { name: "More review file actions" }).click();
  const menu = app.page.getByRole("group", { name: "More review file actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Collapse all folders" }).click();
  await expect(review.file("src/main.ts")).toHaveCount(0);

  await toolbar.getByRole("button", { name: "More review file actions" }).click();
  await menu.getByRole("button", { name: "Expand all folders" }).click();
  await expect(review.file("src/main.ts")).toBeVisible();
});
