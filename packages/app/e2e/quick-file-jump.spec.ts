import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";

test("finds and reveals a pull-request file with Cmd+P", async ({ world }) => {
  const target = "packages/app/src/components/QuickFilePicker.vue";
  const repository = await world.addRepository({
    repoId: "acme/quick-file-jump",
    featureFiles: {
      [target]: "export const picker = true;\n",
      "packages/service/src/server.ts": "export const server = true;\n",
      "docs/quick-open.md": "# Quick Open\n",
    },
  });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);
  await review.open(repository.title);

  await app.page.locator(".tnode.isdir").filter({ hasText: "packages" }).click();
  await expect(review.file(target)).toHaveCount(0);
  await expect(review.file("a.rb")).toHaveClass(/sel/);

  const shortcut = process.platform === "darwin" ? "Meta+p" : "Control+p";
  await app.page.keyboard.press(shortcut);
  const picker = app.page.getByRole("dialog", { name: "Quick file jump" });
  const search = app.page.getByRole("combobox", { name: "Search files in this pull request" });
  await expect(picker).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill("qfp");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await search.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(review.file("a.rb")).toHaveClass(/sel/);

  await app.page.keyboard.press(shortcut);
  await search.fill("qfp");
  await search.press("Enter");

  await expect(picker).toHaveCount(0);
  await expect(review.file(target)).toBeVisible();
  await expect(review.file(target)).toHaveClass(/sel/);
  await expect(review.file(target)).toHaveClass(/cur/);

  await app.page.keyboard.press("?");
  const shortcutLabel = process.platform === "darwin" ? "⌘P" : "Ctrl+P";
  await expect(app.page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText(shortcutLabel);
  await expect(app.page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Open a file in this pull request");
});
