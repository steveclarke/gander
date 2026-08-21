import { test, expect } from "./fixtures/test.js";
import { McpDriver } from "./drivers/mcp.js";
import { ReviewDriver } from "./drivers/review.js";

test("carries a reviewer note through MCP addressing and reviewer resolution", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/note-lifecycle" });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);
  const agent = await new McpDriver(world.serviceUrl, world.serviceToken).connect();

  try {
    await review.open(repository.title);
    await review.selectFile("a.rb");
    await review.addNote("Explain why this branch is necessary");
    await review.openNotes();

    const note = app.page.getByRole("listitem").filter({ hasText: "Explain why this branch is necessary" });
    await expect(note.getByRole("combobox", { name: "Status for note" })).toHaveValue("open");

    const pickedUp = await agent.notes(repository.repoId, "feature");
    expect(pickedUp.noteCounts).toEqual({ open: 1, in_progress: 0, addressed: 0, resolved: 0 });
    expect(pickedUp.notes).toHaveLength(1);
    expect(pickedUp.notes[0]!.sourceContext?.lines).toContain("class A");

    await agent.markInProgress(pickedUp.notes[0]!.id, "Need the reviewer to choose the intended behavior");
    await review.fetchOrigin();
    await expect(note.getByRole("combobox", { name: "Status for note" })).toHaveValue("in_progress");
    await expect(note.getByRole("region", { name: "Waiting on reviewer" })).toContainText("choose the intended behavior");
    expect((await agent.notes(repository.repoId, "feature", pickedUp.lastNoteId!)).notes).toEqual([]);

    await agent.markAddressed(pickedUp.notes[0]!.id, "The reviewer confirmed the branch is required");

    await review.fetchOrigin();
    await expect(note.getByRole("combobox", { name: "Status for note" })).toHaveValue("addressed");
    await expect(note.getByRole("region", { name: "Agent update" })).toContainText("The reviewer confirmed the branch is required");
    await expect(note.getByRole("region", { name: "Waiting on reviewer" })).toHaveCount(0);

    await app.page.getByRole("button", { name: "Mark reviewed" }).click();
    await review.fetchOrigin();
    await expect(note.getByRole("combobox", { name: "Status for note" })).toHaveValue("resolved");

    const completed = await agent.notes(repository.repoId, "feature");
    expect(completed.noteCounts).toEqual({ open: 0, in_progress: 0, addressed: 0, resolved: 1 });
  } finally {
    await agent.close();
  }
});

test("lets the reviewer edit a note and change its status", async ({ world }) => {
  const repository = await world.addRepository({ repoId: "acme/edit-note" });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);
  const agent = await new McpDriver(world.serviceUrl, world.serviceToken).connect();

  try {
    await review.open(repository.title);
    await review.selectFile("a.rb");
    await review.addNote("Original wording");
    await review.openNotes();

    const note = app.page.getByRole("list", { name: "Review notes" }).getByRole("listitem");
    await expect(note).toContainText("Original wording");
    await note.getByRole("button", { name: "Edit note" }).click();
    const editor = note.getByRole("textbox", { name: "Edit note" });
    await expect(editor).toBeFocused();
    await editor.fill("Updated wording");
    await note.getByRole("button", { name: "Save" }).click();
    await expect(note).toContainText("Updated wording");

    const status = note.getByRole("combobox", { name: "Status for note" });
    await status.focus();
    const statusStyle = await status.evaluate((control) => {
      const pill = control.closest("label");
      if (!pill) throw new Error("status control is missing its pill");
      const controlStyle = getComputedStyle(control);
      const pillStyle = getComputedStyle(pill);
      return {
        height: pill.getBoundingClientRect().height,
        controlOutline: controlStyle.outlineStyle,
        pillOutline: pillStyle.outlineStyle,
        textTransform: controlStyle.textTransform,
      };
    });
    expect(statusStyle).toMatchObject({ controlOutline: "none", pillOutline: "solid", textTransform: "none" });
    expect(statusStyle.height).toBeGreaterThanOrEqual(22);
    await status.selectOption("resolved");
    await expect(status).toHaveValue("resolved");

    const saved = await agent.notes(repository.repoId, "feature");
    expect(saved.noteCounts).toEqual({ open: 0, in_progress: 0, addressed: 0, resolved: 1 });
    expect(saved.notes[0]).toMatchObject({ text: "Updated wording", state: "resolved" });
  } finally {
    await agent.close();
  }
});

test("keeps note controls fixed and reveals a note's reviewed file in the tree", async ({ world }) => {
  const repository = await world.addRepository({
    repoId: "acme/note-navigation",
    baseFiles: { "src/nested.ts": "const value = 'old';\n" },
    featureFiles: { "src/nested.ts": "const value = 'new';\n" },
  });
  const app = await world.launch();
  const review = new ReviewDriver(app.page);

  await review.open(repository.title);
  await review.selectFile("src/nested.ts");
  await review.addNote("Keep this file easy to find");
  await review.checkFile("src/nested.ts");

  const fileDisplay = app.page.getByRole("toolbar", { name: "Review file display" });
  await fileDisplay.getByRole("button", { name: "Hide reviewed files" }).click();
  await expect(review.file("src/nested.ts")).toHaveCount(0);

  await review.openNotes();
  const drawer = app.page.getByRole("complementary", { name: "Notes" });
  const header = drawer.locator("header");
  const noteList = drawer.getByRole("list", { name: "Review notes" });
  await drawer.evaluate((element) => {
    element.style.height = "80px";
    element.style.alignSelf = "flex-start";
  });
  const headerTop = await header.evaluate((element) => element.getBoundingClientRect().top);
  await noteList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await noteList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await header.evaluate((element) => element.getBoundingClientRect().top)).toBe(headerTop);

  await drawer.getByRole("button", { name: "nested.ts" }).click();
  const revealed = review.file("src/nested.ts");
  await expect(fileDisplay.getByRole("button", { name: "Hide reviewed files" })).toHaveAttribute("aria-pressed", "false");
  await expect(revealed).toBeVisible();
  await expect(revealed).toHaveClass(/sel/);
  await expect(revealed).toHaveClass(/cur/);
});
