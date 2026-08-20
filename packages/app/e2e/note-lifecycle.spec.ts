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
    expect(pickedUp.noteCounts).toEqual({ open: 1, addressed: 0, resolved: 0 });
    expect(pickedUp.notes).toHaveLength(1);
    await agent.markAddressed(pickedUp.notes[0]!.id, "abc1234", "Removed the unnecessary branch");

    await review.fetchOrigin();
    await expect(note.getByRole("combobox", { name: "Status for note" })).toHaveValue("addressed");
    await expect(note.getByRole("region", { name: "Agent update" })).toContainText("Removed the unnecessary branch");
    await expect(note.getByRole("region", { name: "Agent update" })).toContainText("abc1234");

    await app.page.getByRole("button", { name: "Mark reviewed" }).click();
    await review.fetchOrigin();
    await expect(note.getByRole("combobox", { name: "Status for note" })).toHaveValue("resolved");

    const completed = await agent.notes(repository.repoId, "feature");
    expect(completed.noteCounts).toEqual({ open: 0, addressed: 0, resolved: 1 });
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

    await note.getByRole("combobox", { name: "Status for note" }).selectOption("resolved");
    await expect(note.getByRole("combobox", { name: "Status for note" })).toHaveValue("resolved");

    const saved = await agent.notes(repository.repoId, "feature");
    expect(saved.noteCounts).toEqual({ open: 0, addressed: 0, resolved: 1 });
    expect(saved.notes[0]).toMatchObject({ text: "Updated wording", state: "resolved" });
  } finally {
    await agent.close();
  }
});
