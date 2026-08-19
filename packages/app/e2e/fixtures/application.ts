import { createRequire } from "node:module";
import { resolve } from "node:path";
import { _electron as electron, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron") as string;
const appRoot = resolve(import.meta.dirname, "../..");

export class GanderApplication {
  private electronApp: ElectronApplication | null = null;
  private currentPage: Page | null = null;
  private readonly output: string[] = [];

  constructor(
    private readonly environment: Record<string, string>,
    private readonly userDataPath: string,
    private readonly testInfo: TestInfo,
  ) {}

  get page(): Page {
    if (!this.currentPage) throw new Error("Gander has not been launched");
    return this.currentPage;
  }

  async launch(): Promise<this> {
    this.electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [appRoot, `--user-data-dir=${this.userDataPath}`],
      cwd: appRoot,
      env: this.environment,
      timeout: 30_000,
    });
    this.captureProcessOutput(this.electronApp);
    await this.electronApp.context().tracing.start({ screenshots: true, snapshots: true });
    this.currentPage = await this.electronApp.firstWindow();
    await this.currentPage.getByRole("button", { name: "Editor settings" }).waitFor();
    if (this.environment.GANDER_E2E === "1" && await this.isVisible()) {
      throw new Error("The E2E BrowserWindow became visible");
    }
    return this;
  }

  async isVisible(): Promise<boolean> {
    if (!this.electronApp) throw new Error("Gander has not been launched");
    return this.electronApp.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.isVisible() ?? false
    ));
  }

  async restart(): Promise<void> {
    await this.shutdown(false);
    await this.launch();
  }

  async close(failed: boolean): Promise<void> {
    await this.shutdown(failed);
  }

  private captureProcessOutput(app: ElectronApplication): void {
    const child = app.process();
    child.stdout?.on("data", (chunk: Buffer | string) => this.output.push(`[stdout] ${chunk.toString()}`));
    child.stderr?.on("data", (chunk: Buffer | string) => this.output.push(`[stderr] ${chunk.toString()}`));
  }

  private async shutdown(failed: boolean): Promise<void> {
    const app = this.electronApp;
    const page = this.currentPage;
    if (!app) return;
    this.electronApp = null;
    this.currentPage = null;

    if (failed) {
      if (page && !page.isClosed()) {
        await this.testInfo.attach("failure.png", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      }
      const tracePath = this.testInfo.outputPath("trace.zip");
      await app.context().tracing.stop({ path: tracePath });
      await this.testInfo.attach("trace.zip", {
        path: tracePath,
        contentType: "application/zip",
      });
      await this.testInfo.attach("electron-output.txt", {
        body: Buffer.from(this.output.join(""), "utf8"),
        contentType: "text/plain",
      });
    } else {
      await app.context().tracing.stop();
    }
    await app.close();
  }
}
