import { test, expect } from "./fixtures/test.js";
import { ReviewDriver } from "./drivers/review.js";

test("routes review shortcuts from Monaco without stealing typed note text", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/keyboard-focus" });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);
  await review.open(repository.title);

  const editor = app.page.locator(".monaco-editor:visible").first();
  await editor.click();
  await app.page.keyboard.press("?");
  await expect(app.page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);

  await editor.click();
  await app.page.keyboard.press("n");
  const note = app.page.getByPlaceholder("What needs answering or changing here?");
  await expect(note).toBeFocused();
  await note.fill("Keep this letter: ");
  await note.press("m");
  await expect(note).toHaveValue("Keep this letter: m");
  await expect(review.file("a.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  await note.press("Escape");

  await editor.click();
  await app.page.keyboard.press("m");
  await expect(review.file("a.rb").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await app.page.keyboard.press("Shift+N");
  await expect(app.page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();

  // Change-to-change navigation is Monaco's own, reached through the review surface that
  // owns the diff. Broken, it moves nothing and says nothing — so read the line back off
  // the note the next keystroke captures.
  await editor.click();
  await app.page.keyboard.press("]");
  await app.page.keyboard.press("n");
  await expect(app.page.locator("#note-target")).toContainText("line 2");
});
