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

  async expectProgress(done: number, total: number): Promise<void> {
    await expect(this.page.locator(".context-toolbar .progress")).toHaveText(`${done}/${total} reviewed`);
  }
}
