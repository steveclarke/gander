import { execFile } from "node:child_process";
import { connect } from "node:net";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { $, $$, browser, expect } from "@wdio/globals";
import "@wdio/electron-service";

const run = promisify(execFile);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; run the suite through pnpm test:e2e`);
  return value;
}

async function registerAndSelect(url: string, repoName: string): Promise<void> {
  const error = await browser.executeAsync((repoUrl, done) => {
    void (window as unknown as { gander: { addRepo(url: string): Promise<unknown> } }).gander.addRepo(repoUrl)
      .then(() => done(null))
      .catch((reason: unknown) => done(String(reason)));
  }, url);
  expect(error).toBeNull();
  await browser.refresh();
  await $("button[aria-controls='target-picker']").click();
  const repo = await $(`//button[contains(@class, 'picker-row')][contains(normalize-space(.), '${repoName}')]`);
  await repo.waitForDisplayed();
  await repo.click();
  await expect($("button[aria-controls='target-picker']")).toHaveText(expect.stringContaining(repoName));
}

async function openPullRequest(title: string, twice = false): Promise<void> {
  const option = await $(`//div[@role='option'][contains(normalize-space(.), '${title}')]`);
  await option.waitForDisplayed();
  if (twice) await option.doubleClick();
  else await option.click();
}

/** The round trip bin/gander makes: raw argv in, the app's answer out. */
function ganderCommand(argv: string[]): Promise<{ ok?: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(requiredEnv("GANDER_E2E_APP_SOCKET"), () => {
      socket.write(`${JSON.stringify({ argv })}\n`);
    });
    let out = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => { out += chunk; });
    socket.on("end", () => resolve(JSON.parse(out) as { ok?: boolean; error?: string }));
    socket.on("error", reject);
  });
}

function fileCheckbox(filename: string) {
  return $(`//div[contains(@class, 'tnode')][.//span[contains(@class, 'fname') and normalize-space()='${filename}']]//span[@role='checkbox']`);
}

function treeRow(name: string) {
  return $(`//div[contains(@class, 'tnode')][.//span[contains(@class, 'fname') and normalize-space()='${name}']]`);
}

async function selectColorTheme(value: "Catppuccin Mocha" | "Gander Dark"): Promise<void> {
  await browser.execute((colorTheme) => {
    const select = document.querySelector<HTMLSelectElement>("select[name='workbench.colorTheme']");
    if (!select) throw new Error("workbench.colorTheme select is missing");
    select.value = colorTheme;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function selectIconTheme(value: "catppuccin-mocha"): Promise<void> {
  await browser.execute((iconTheme) => {
    const select = document.querySelector<HTMLSelectElement>("select[name='workbench.iconTheme']");
    if (!select) throw new Error("workbench.iconTheme select is missing");
    select.value = iconTheme;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

describe("Gander end to end", () => {
  it("opens the built application with the Gander title", async () => {
    await expect(browser).toHaveTitle("Gander");
    await expect($(".welcome h1")).toHaveText("Open a repository from disk");

    const nativeWindow = await browser.electron.execute((electron) => {
      const window = electron.BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("Gander BrowserWindow is missing");
      return {
        background: window.getBackgroundColor().toLowerCase(),
        closable: window.isClosable(),
        minimizable: window.isMinimizable(),
        maximizable: window.isMaximizable(),
        fullscreenable: window.isFullScreenable(),
      };
    });
    expect(nativeWindow).toMatchObject({
      background: expect.stringContaining("#1e1e2e"),
      closable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true,
    });
    expect(await browser.execute(() => document.documentElement.dataset.colorTheme)).toBe("Catppuccin Mocha");

    if (process.platform === "darwin") {
      await expect($(".target-bar")).toHaveElementClass(expect.stringContaining("draggable"));
      expect(await browser.execute(() => {
        const region = (selector: string): string =>
          getComputedStyle(document.querySelector<HTMLElement>(selector)!).getPropertyValue("-webkit-app-region");
        return {
          topbar: region(".target-bar"),
          target: region(".target-trigger"),
          settings: region("button[aria-label='Editor settings']"),
        };
      })).toEqual({ topbar: "drag", target: "no-drag", settings: "none" });
    }
  });

  it("changes the visible workbench zoom from the status-bar toolbar", async () => {
    const trigger = await $("button[aria-label^='Zoom:']");
    await expect(trigger).toHaveText("100%");
    await trigger.click();

    const zoomIn = await $("button[aria-label='Zoom in']");
    await zoomIn.waitForDisplayed();
    expect(await browser.execute(() => {
      const toolbar = document.querySelector<HTMLElement>(".zoom-toolbar");
      return toolbar ? getComputedStyle(toolbar).overflowY : null;
    })).toBe("visible");
    await zoomIn.click();
    await browser.waitUntil(async () => (await trigger.getText()) === "110%");
    expect(await browser.electron.execute((electron) =>
      electron.BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel(),
    )).toBeCloseTo(0.5);

    const reset = await $("button[aria-label='Reset zoom to 100%']");
    await reset.click();
    await browser.waitUntil(async () => (await trigger.getText()) === "100%");
    expect(await browser.electron.execute((electron) =>
      electron.BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel(),
    )).toBeCloseTo(0);
  });

  it("changes workbench and editor settings live and keeps them after restart", async () => {
    await $("button[aria-label='Editor settings']").click();
    await expect($(".settings-pane h1")).toHaveText("Settings");
    const theme = await $("select[name='workbench.colorTheme']");
    const iconTheme = await $("select[name='workbench.iconTheme']");
    await expect(theme).toHaveValue("Catppuccin Mocha");
    await expect(iconTheme).toHaveValue("catppuccin-mocha");
    const treeFamily = await $("input[name='workbench.tree.fontFamily']");
    const treeSize = await $("input[name='workbench.tree.fontSize']");
    const zoomLevel = await $("input[name='window.zoomLevel']");
    const inheritEditorTypography = await $("input[name='workbench.tree.inheritEditorTypography']");
    await expect(zoomLevel).toHaveValue("0");
    await expect(treeFamily).toHaveValue('-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    await expect(treeSize).toHaveValue("13");
    await expect(inheritEditorTypography).not.toBeChecked();
    await treeFamily.clearValue();
    await treeFamily.setValue("Arial, sans-serif");
    await browser.keys("Tab");
    await treeSize.click();
    await treeSize.clearValue();
    await treeSize.setValue("14.5");
    await browser.keys("Tab");
    await browser.waitUntil(async () => await browser.execute(() =>
      document.querySelector(".settings-pane [role='status']")?.textContent === "Saved automatically",
    ));
    await selectColorTheme("Gander Dark");
    await browser.waitUntil(async () => await browser.execute(() =>
      document.querySelector(".settings-pane [role='status']")?.textContent === "Saved automatically",
    ));
    expect(await browser.execute(() => ({
      selected: document.querySelector<HTMLSelectElement>("select[name='workbench.colorTheme']")?.value,
      theme: document.documentElement.dataset.colorTheme,
      background: document.documentElement.style.getPropertyValue("--workbench-background"),
      status: document.querySelector(".settings-pane [role='status']")?.textContent,
    }))).toEqual({ selected: "Gander Dark", theme: "Gander Dark", background: "#16181d", status: "Saved automatically" });
    if (process.platform === "darwin") {
      const nativeBackground = await browser.electron.execute((electron) =>
        electron.BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase(),
      );
      expect(nativeBackground).toContain("#16181d");
    }
    await $("//button[contains(@class, 'category') and normalize-space()='Editor']").click();
    const family = await $("input[name='editor.fontFamily']");
    const size = await $("input[name='editor.fontSize']");
    await expect($("#editor-preview-label")).toHaveText("Preview");
    await family.clearValue();
    await family.setValue("'Courier New', monospace");
    await browser.keys("Tab");
    await browser.waitUntil(async () => (await browser.execute(() =>
      document.documentElement.style.getPropertyValue("--editor-font-family"),
    )).includes("Courier New"));
    await size.click();
    await size.clearValue();
    await size.setValue("18.5");
    await browser.keys("Tab");
    await browser.waitUntil(async () => await browser.execute(() =>
      document.documentElement.style.getPropertyValue("--editor-font-size") === "18.5px",
    ));
    await expect($(".settings-pane [role='status']")).toHaveText("Saved automatically");

    await $("//button[@role='tab' and normalize-space()='JSON']").click();
    await $(".settings-json-editor .monaco-editor").waitForDisplayed();
    const jsonSource = (await browser.execute(() =>
      document.querySelector(".settings-json-editor .view-lines")?.textContent ?? "",
    )).replaceAll("\u00a0", " ");
    expect(jsonSource).toContain("editor.fontFamily");
    expect(jsonSource).toContain("editor.fontSize");
    expect(jsonSource).toContain("window.zoomLevel");
    expect(jsonSource).toContain("workbench.colorTheme");
    expect(jsonSource).toContain("workbench.iconTheme");
    expect(jsonSource).toContain("workbench.tree.fontFamily");
    expect(jsonSource).toContain("workbench.tree.fontSize");
    expect(jsonSource).toContain("workbench.tree.inheritEditorTypography");
    expect(jsonSource).toContain("Gander Dark");
    await $("button[aria-label='Close settings']").click();
    await expect($(".settings-pane")).not.toBeDisplayed();

    await browser.electron.execute((electron) => {
      electron.Menu.getApplicationMenu()?.getMenuItemById("settings")?.click();
    });
    await expect($(".settings-pane h1")).toHaveText("Settings");
    await $("button[aria-label='Close settings']").click();

    await browser.reloadSession();

    await $("button[aria-label='Editor settings']").click();
    await expect($("select[name='workbench.colorTheme']")).toHaveValue("Gander Dark");
    expect(await browser.execute(() => document.documentElement.dataset.colorTheme)).toBe("Gander Dark");
    expect(await browser.execute(() =>
      (window as unknown as { gander: { initialWindowState: { colorTheme: string } } })
        .gander.initialWindowState.colorTheme,
    )).toBe("Gander Dark");
    await expect($("select[name='workbench.iconTheme']")).toHaveValue("catppuccin-mocha");
    await expect($("input[name='window.zoomLevel']")).toHaveValue("0");
    await expect($("input[name='workbench.tree.fontFamily']")).toHaveValue("Arial, sans-serif");
    await expect($("input[name='workbench.tree.fontSize']")).toHaveValue("14.5");
    await expect($("input[name='workbench.tree.inheritEditorTypography']")).not.toBeChecked();
    await $("//button[contains(@class, 'category') and normalize-space()='Editor']").click();
    await expect($("input[name='editor.fontFamily']")).toHaveValue("'Courier New', monospace");
    await expect($("input[name='editor.fontSize']")).toHaveValue("18.5");
    await $("button[aria-label='Close settings']").click();
  });

  it("registers a repository and keeps a reviewed file checked after restart", async () => {
    await registerAndSelect(requiredEnv("GANDER_E2E_PERSISTENCE_URL"), "persistence");
    await expect($(".stack-group")).toBeDisplayed();
    expect(await browser.execute(() => [...document.querySelectorAll(".stack-group .stack-member")]
      .map((member) => ({
        position: member.querySelector(".member-stack-position")?.textContent,
        number: member.querySelector(".num")?.textContent,
        title: member.querySelector(".nm")?.textContent,
      })))).toEqual([
        { position: "1/2", number: "#2", title: "Prepare review state" },
        { position: "2/2", number: "#1", title: "Persist reviewed files" },
      ]);
    await expect($(".standalone-item")).toHaveText(expect.stringContaining("Independent cleanup"));
    await $(`//div[@role='option'][contains(normalize-space(.), 'Persist reviewed files')]`).click();
    await expect($(".header-stack-position")).toHaveText("2/2");
    await expect($(".header-stack-position")).toHaveAttribute("aria-label", "Stack position 2 of 2");

    const fileTreeTypography = async () => browser.execute(() => {
      const tree = document.querySelector<HTMLElement>(".tree.root");
      if (!tree) return null;
      const style = getComputedStyle(tree);
      return { fontFamily: style.fontFamily, fontSize: style.fontSize };
    });
    const fileTreeRowStyles = async () => browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".tnode .fname")].map((label) => {
        const style = getComputedStyle(label);
        return {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          rowHeight: label.closest<HTMLElement>(".tnode")?.getBoundingClientRect().height,
        };
      }),
    );
    await $(".tree.root").waitForDisplayed();
    await expect(fileTreeTypography()).resolves.toMatchObject({ fontSize: "14.5px" });
    expect((await fileTreeTypography())?.fontFamily).toContain("Arial");
    expect(await fileTreeRowStyles()).toEqual(expect.arrayContaining([
      expect.objectContaining({ fontFamily: "Arial, sans-serif", fontSize: "14.5px", rowHeight: 22 }),
    ]));
    expect(new Set((await fileTreeRowStyles()).map((style) => JSON.stringify(style))).size).toBe(1);

    const typography = async () => browser.execute(() => {
      const line = document.querySelector<HTMLElement>(".monaco-editor .view-line span");
      if (!line) return null;
      const style = getComputedStyle(line);
      return { fontFamily: style.fontFamily, fontSize: style.fontSize };
    });
    await $(".monaco-editor .view-line span").waitForDisplayed();
    await expect(typography()).resolves.toMatchObject({ fontSize: "18.5px" });
    expect((await typography())?.fontFamily).toContain("Courier New");

    await $("button[aria-label='Full file']").click();
    await $(".monaco-editor .view-line span").waitForDisplayed();
    await expect(typography()).resolves.toMatchObject({ fontSize: "18.5px" });

    await browser.execute(() => {
      const editor = document.querySelector<HTMLElement>(".diff .monaco-editor");
      if (editor) editor.dataset.mountMarker = "preserved";
    });
    await $("button[aria-label='Editor settings']").click();
    await expect($(".settings-pane")).toBeDisplayed();
    await $("input[name='workbench.tree.inheritEditorTypography']").click();
    await browser.waitUntil(async () => await browser.execute(() =>
      document.querySelector(".settings-pane [role='status']")?.textContent === "Saved automatically",
    ));
    await expect($("input[name='workbench.tree.fontFamily']")).toBeDisabled();
    await selectIconTheme("catppuccin-mocha");
    await browser.waitUntil(async () => await browser.execute(() =>
      document.querySelector(".settings-pane [role='status']")?.textContent === "Saved automatically",
    ));
    await selectColorTheme("Catppuccin Mocha");
    await browser.waitUntil(async () => await browser.execute(() =>
      document.documentElement.dataset.colorTheme === "Catppuccin Mocha"
      && document.documentElement.style.getPropertyValue("--workbench-background") === "#1e1e2e",
    ));
    await $("button[aria-label='Close settings']").click();
    await expect($(".diff .monaco-editor[data-mount-marker='preserved']")).toBeDisplayed();
    await expect(fileTreeTypography()).resolves.toMatchObject({ fontSize: "18.5px" });
    expect((await fileTreeTypography())?.fontFamily).toContain("Courier New");
    expect((await fileTreeRowStyles()).every((style) =>
      style.fontFamily.includes("Courier New") && style.fontSize === "18.5px" && style.rowHeight === 22,
    )).toBe(true);

    const persistentAdd = await $("button[aria-label='Add question (N)']");
    await expect(persistentAdd).toBeDisplayed();
    await expect(persistentAdd).toHaveAttribute("title", "Add question (N)");

    const lineAdd = await $(".gander-line-question");
    await lineAdd.waitForDisplayed();
    const lineLabel = await lineAdd.getAttribute("aria-label");
    const anchoredLine = lineLabel?.match(/line (\d+)/)?.[1];
    expect(anchoredLine).toBeDefined();
    await lineAdd.click();
    await expect($("#question-target")).toHaveText(expect.stringContaining(`a.rb · line ${anchoredLine}`));
    const anchoredQuestion = await $("textarea[placeholder='What needs answering or changing here?']");
    await anchoredQuestion.setValue("Keep this on the first line.");
    await browser.keys("Enter");
    await $("button[aria-label='Questions']").click();
    const firstThread = await $(".drawer [data-question-id]:first-child");
    await expect(firstThread.$(".question-message .message-text")).toHaveText("Keep this on the first line.");
    await expect(firstThread.$("button[data-question-location]")).toHaveText(`a.rb:${anchoredLine}`);
    const copyThread = await firstThread.$("button[aria-label^='Copy question']");
    await copyThread.click();
    await expect(copyThread).toHaveText("Copied");
    const firstDisclosure = await firstThread.$("button[aria-expanded='true']");
    await firstDisclosure.click();
    await expect(firstDisclosure).toHaveAttribute("aria-expanded", "false");
    await expect(firstThread.$("[data-question-body]")).not.toBeDisplayed();
    await expect(firstThread.$(".preview")).toHaveText("Keep this on the first line.");
    await firstDisclosure.click();
    await expect(firstThread.$("[data-question-body]")).toBeDisplayed();

    await $("button[aria-label='Dock questions below the diff']").click();
    await expect($(".workspace.bottom .drawer")).toBeDisplayed();
    expect(await browser.execute(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace.bottom");
      const drawer = workspace?.querySelector<HTMLElement>(".drawer");
      if (!workspace || !drawer) return null;
      return Math.abs(workspace.getBoundingClientRect().width - drawer.getBoundingClientRect().width);
    })).toBeLessThan(2);
    await $("button[aria-label='Dock questions beside the diff']").click();
    await expect($(".workspace.right .drawer")).toBeDisplayed();
    await expect($(".drawer button[aria-label='Add question (N)']")).toBeDisplayed();
    await $("button[aria-label='Close questions']").click();

    await browser.keys("n");
    const question = await $("textarea[placeholder='What needs answering or changing here?']");
    await question.waitForDisplayed();
    const questionSize = await question.getSize();
    expect(questionSize.width).toBeGreaterThanOrEqual(900);
    expect(questionSize.height).toBeGreaterThanOrEqual(350);
    await question.setValue("Why does this need to happen here?");
    await browser.keys("Enter");
    await $("button[aria-label='Questions']").click();
    await expect($(".drawer [data-question-id]:last-child .question-message .message-text")).toHaveText("Why does this need to happen here?");

    const reply = await $(".drawer [data-question-id]:last-child .reply-form input");
    await reply.setValue("Because both callers share this path.");
    await browser.keys("Enter");
    await expect($(".reply .author")).toHaveText("REVIEWER");
    await expect($(".reply .message-text")).toHaveText("Because both callers share this path.");

    const checkbox = await fileCheckbox("a.rb");
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await expect($(".progress")).toHaveText("1/2 reviewed");
    await $(".seg-review").click();
    const currentReviewRow = await $(`//div[@role='option'][contains(normalize-space(.), 'Persist reviewed files')]`);
    await expect(currentReviewRow.$(".review-progress")).toHaveText("1/2 reviewed");
    await browser.keys("Escape");

    await browser.reloadSession();

    await expect(browser).toHaveTitle("Gander");
    await expect($(".progress")).toHaveText("1/2 reviewed");
    await expect(await fileCheckbox("a.rb")).toHaveAttribute("aria-checked", "true");
    await expect(fileTreeTypography()).resolves.toMatchObject({ fontSize: "18.5px" });
    expect((await fileTreeTypography())?.fontFamily).toContain("Courier New");
    expect((await fileTreeRowStyles()).every((style) =>
      style.fontFamily.includes("Courier New") && style.fontSize === "18.5px" && style.rowHeight === 22,
    )).toBe(true);
    await $("button[aria-label='Questions']").click();
    await expect($(".reply .message-text")).toHaveText("Because both callers share this path.");
  });

  it("renders both sides of a changed image from bounded blob URLs", async () => {
    await registerAndSelect(requiredEnv("GANDER_E2E_IMAGES_URL"), "images");
    await openPullRequest("Preview changed images");
    await treeRow("logo.png").click();

    await $(".image-diff").waitForDisplayed();
    await browser.waitUntil(async () => browser.execute(() => {
      const images = [...document.querySelectorAll<HTMLImageElement>(".image-diff img")];
      return images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0);
    }), { timeoutMsg: "both base and head image blobs did not decode" });

    expect(await $$(".image-diff img")).toHaveLength(2);
    expect(await browser.execute(() => [...document.querySelectorAll<HTMLImageElement>(".image-diff img")]
      .map((image) => ({ src: image.src, width: image.naturalWidth, height: image.naturalHeight }))
    )).toEqual([
      expect.objectContaining({ src: expect.stringMatching(/^blob:/), width: expect.any(Number), height: expect.any(Number) }),
      expect.objectContaining({ src: expect.stringMatching(/^blob:/), width: expect.any(Number), height: expect.any(Number) }),
    ]);
    await expect($("button=Actual size")).toHaveAttribute("aria-pressed", "false");
    await $("button=Actual size").click();
    await expect($("button=Actual size")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a live stateless local worktree without review controls", async () => {
    await $("button[aria-controls='target-picker']").click();
    const repo = await $("//button[contains(@class, 'picker-row')][contains(normalize-space(.), 'local-viewer')]");
    await repo.click();
    await $("button[aria-controls='target-picker']").click();
    const worktree = await $("//button[contains(@class, 'worktree-row')][contains(normalize-space(.), 'feature')]");
    await worktree.waitForDisplayed();
    await worktree.click();

    await expect($(".context-toolbar")).toHaveText(expect.stringContaining("feature"));
    await expect($(".local-progress")).toHaveText("3 changed");
    expect(await $$('[role="checkbox"]')).toHaveLength(0);
    await expect($("button[aria-label='Add question (N)']")).not.toBeDisplayed();
    await expect($("button[aria-label='Questions']")).not.toBeDisplayed();
    await expect($(".filehead .check")).not.toBeDisplayed();
    await expect($("button[aria-label='Current Diff']")).toBeDisplayed();
    await expect(treeRow("ignored.txt")).toBeDisplayed();

    writeFileSync(join(requiredEnv("GANDER_E2E_LOCAL_WORKTREE"), "watched.ts"), "export const watched = true;\n");
    await treeRow("watched.ts").waitForDisplayed({ timeout: 5_000 });
    await expect($(".local-progress")).toHaveText("4 changed");
    await expect($(".error-banner")).not.toBeDisplayed();
    await $("button[aria-label='Pull Requests']").click();
    await expect($(".pull-sidebar h1")).toHaveText("Pull Requests");
    await $("button[aria-label='Explorer']").click();
    await treeRow("watched.ts").waitForDisplayed();
    await $("button[aria-label='Current Diff']").click();
    await expect(treeRow("ignored.txt")).not.toBeDisplayed();
    await expect($("button[aria-label='Full file']")).toBeDisplayed();
    await expect($("button[aria-label='Changes against main']")).toBeDisplayed();
  });

  it("shows the overflowing file-tree scrollbar only while the tree is hovered", async () => {
    await registerAndSelect(requiredEnv("GANDER_E2E_SCROLLBAR_URL"), "scrollbar");
    await openPullRequest("Scroll a long file tree");

    const tree = await $(".view-sidebar .tree.root");
    await tree.waitForDisplayed();
    const treeMetrics = async () => browser.execute(() => {
      const panel = document.querySelector<HTMLElement>(".view-sidebar .tree.root");
      const row = panel?.querySelector<HTMLElement>(".tnode");
      if (!panel || !row) return null;
      return {
        clientHeight: panel.clientHeight,
        rowWidth: row.getBoundingClientRect().width,
        scrollHeight: panel.scrollHeight,
        scrollbarColor: getComputedStyle(panel).scrollbarColor,
        scrollbarWidth: getComputedStyle(panel).scrollbarWidth,
      };
    });

    const resting = await treeMetrics();
    expect(resting).not.toBeNull();
    expect(resting!.scrollHeight).toBeGreaterThan(resting!.clientHeight);
    expect(resting!.scrollbarColor).toBe("rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
    expect(resting!.scrollbarWidth).toBe("thin");

    await tree.moveTo();
    await browser.waitUntil(async () => (await treeMetrics())?.scrollbarColor
      === "color(srgb 0.576471 0.6 0.698039 / 0.45) rgba(0, 0, 0, 0)");
    const hovered = await treeMetrics();
    expect(hovered!.rowWidth).toBe(resting!.rowWidth);
  });

  it("opens a pull request twice quickly with one valid clone", async () => {
    await registerAndSelect(requiredEnv("GANDER_E2E_RACE_URL"), "race");
    await openPullRequest("Open without corrupting the clone", true);
    await expect($(".progress")).toHaveText("0/2 reviewed");
    await expect($(".error-banner")).not.toBeDisplayed();

    expect(existsSync(requiredEnv("GANDER_E2E_RACE_MARKER"))).toBe(true);
    const clonesRoot = join(requiredEnv("GANDER_E2E_USER_DATA"), "clones");
    const matchingClones = readdirSync(clonesRoot).filter((entry) => entry.startsWith("acme__race.git"));
    expect(matchingClones).toEqual(["acme__race.git"]);
    await run("git", ["-C", join(clonesRoot, "acme__race.git"), "fsck", "--full", "--no-dangling"]);
  });

  it("opens a pull request named on the command line", async () => {
    const repoId = requiredEnv("GANDER_E2E_LAUNCHER_REPO");
    // The repository has never been registered in the app — naming it is enough.
    const reply = await ganderCommand(["--repo", repoId, "--pr", "1"]);
    expect(reply).toEqual({ ok: true, target: { repoId, prNumber: 1 } });

    await expect($(".context-toolbar")).toHaveText(expect.stringContaining("Open from the command line"));
    await expect($(".progress")).toHaveText("0/2 reviewed");
    await expect($(".error-banner")).not.toBeDisplayed();
  });

  it("renders Catppuccin icons without disturbing file-tree interaction or status alignment", async () => {
    await registerAndSelect(requiredEnv("GANDER_E2E_ICONS_URL"), "icons");
    await openPullRequest("Render file icons");

    const expectedIcons: Record<string, string> = {
      Gemfile: "ruby-gem",
      "README.md": "readme",
      "App.vue": "vue",
      "main.ts": "typescript",
      "index.d.ts": "typescript-def",
      "settings.json": "json",
      "file.mystery": "_file",
    };
    for (const [file, icon] of Object.entries(expectedIcons)) {
      const image = treeRow(file).$(".file-icon");
      await expect(image).toHaveAttribute("data-icon-id", icon);
      await browser.waitUntil(async () => await image.getProperty("naturalWidth") === 16);
    }

    const src = treeRow("src");
    await expect(src.$(".chev")).toBeDisplayed();
    await expect(src.$(".file-icon")).toHaveAttribute("data-icon-id", "folder_src_open");
    await treeRow("App.vue").click();
    await expect(treeRow("App.vue")).toHaveElementClass(expect.stringContaining("sel"));
    await src.click();
    await expect(treeRow("src").$(".file-icon")).toHaveAttribute("data-icon-id", "folder_src");
    await expect(treeRow("App.vue")).not.toBeDisplayed();
    await treeRow("src").click();
    await expect(treeRow("App.vue")).toHaveElementClass(expect.stringContaining("sel"));

    const statusRightEdges = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".tnode:not(.isdir) .st")]
        .map((status) => Math.round(status.getBoundingClientRect().right)),
    );
    expect(new Set(statusRightEdges).size).toBe(1);
  });

  it("answers a command that names nothing openable", async () => {
    const reply = await ganderCommand(["--repo", "notarepoid"]);
    expect(reply.error).toContain("owner/name");
  });
});
