import { expect, type Page } from "@playwright/test";
import { WorkbenchDriver } from "./workbench.js";

export class LocalViewerDriver {
  readonly workbench: WorkbenchDriver;

  constructor(private readonly page: Page) {
    this.workbench = new WorkbenchDriver(page);
  }

  async openWorktree(branch: string, changes: number): Promise<void> {
    await this.workbench.selectWorktree(branch);
    await this.page.getByRole("button", { name: "Current Diff" }).click();
    await this.expectChanges(changes);
  }

  async expectChanges(changes: number): Promise<void> {
    await expect(this.page.locator(".local-progress")).toHaveText(`${changes} changed`);
  }

  async expectReadOnlyReviewSurface(): Promise<void> {
    await expect(this.page.locator('.local-sidebar [role="checkbox"]')).toHaveCount(0);
    await expect(this.page.getByRole("button", { name: "Add note (N)" })).toHaveCount(0);
    await expect(this.page.getByRole("button", { name: "Notes", exact: true })).toHaveCount(0);
  }
}
