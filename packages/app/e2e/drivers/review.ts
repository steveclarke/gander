import { expect, type Locator, type Page } from "@playwright/test";
import { WorkbenchDriver } from "./workbench.js";

export class ReviewDriver {
  readonly workbench: WorkbenchDriver;

  constructor(private readonly page: Page) {
    this.workbench = new WorkbenchDriver(page);
  }

  pullRequest(title: string): Locator {
    return this.page.getByRole("option").filter({ hasText: title });
  }

  file(path: string): Locator {
    const name = path.split("/").at(-1) ?? path;
    return this.page.locator(".tnode").filter({
      has: this.page.locator(`.fname:text-is("${name.replaceAll('"', '\\"')}")`),
    });
  }

  async open(title: string): Promise<void> {
    await this.workbench.openPullRequests();
    await this.pullRequest(title).click();
    await expect(this.page.locator(".context-toolbar").filter({ hasText: title })).toBeVisible();
  }

  async selectFile(path: string): Promise<void> {
    await this.file(path).click();
  }

  async checkFile(path: string): Promise<void> {
    const checkbox = this.file(path).getByRole("checkbox");
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
  }

  async fetchOrigin(): Promise<void> {
    await this.page.getByRole("button", { name: "Fetch origin" }).click();
  }

  async addNote(text: string): Promise<void> {
    await this.page.getByRole("button", { name: "Add note (N)" }).click();
    const input = this.page.getByPlaceholder("What needs answering or changing here?");
    await input.fill(text);
    await input.press("Enter");
    await expect(input).toHaveCount(0);
  }

  async openNotes(): Promise<void> {
    await this.page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(this.page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
  }

  async expectProgress(done: number, total: number): Promise<void> {
    await expect(this.page.locator(".context-toolbar .progress")).toHaveText(`${done}/${total} reviewed`);
  }
}
