import type { AppUpdater, UpdateDownloadedEvent, UpdateInfo } from "electron-updater";

interface UpdatePrompts {
  currentVersion(): string;
  showUpToDate(version: string): Promise<void>;
  confirmRestart(version: string): Promise<boolean>;
  showError(message: string): void;
}

type Updater = Pick<
  AppUpdater,
  "autoDownload" | "autoInstallOnAppQuit" | "checkForUpdates" | "on" | "quitAndInstall"
>;

export interface UpdateController {
  checkAtStartup(): void;
  checkManually(): void;
}

export function supportsInPlaceUpdates(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  appImagePath: string | undefined,
  updateConfigExists: boolean,
): boolean {
  if (!isPackaged || !updateConfigExists) return false;
  if (platform === "darwin") return true;
  // electron-updater can update the AppImage itself, but an unpacked Linux build
  // has no artifact to replace. APPIMAGE is set by the AppImage runtime.
  return platform === "linux" && Boolean(appImagePath);
}

export function createUpdateController(updater: Updater, prompts: UpdatePrompts): UpdateController {
  let manualCheck = false;
  const reportedErrors = new WeakSet<Error>();

  // Downloading does not alter the running app. Installation always remains an
  // explicit reviewer choice, including when the app later quits.
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;

  const reportError = (error: Error): void => {
    manualCheck = false;
    if (reportedErrors.has(error)) return;
    reportedErrors.add(error);
    prompts.showError(error.message);
  };

  updater.on("error", reportError);
  updater.on("update-not-available", (_info: UpdateInfo) => {
    if (!manualCheck) return;
    manualCheck = false;
    void prompts.showUpToDate(prompts.currentVersion()).catch(reportError);
  });
  updater.on("update-available", (_info: UpdateInfo) => {
    manualCheck = false;
  });
  updater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    void prompts.confirmRestart(info.version).then((restart) => {
      if (restart) updater.quitAndInstall();
    }).catch(reportError);
  });

  const check = (manual: boolean): void => {
    manualCheck ||= manual;
    void updater.checkForUpdates().catch((error: unknown) => {
      reportError(error instanceof Error ? error : new Error(String(error)));
    });
  };

  return {
    checkAtStartup: () => check(false),
    checkManually: () => check(true),
  };
}

export async function loadUpdateController(prompts: UpdatePrompts): Promise<UpdateController> {
  // electron-updater is CommonJS. Its documented ESM interop path is a default
  // import followed by destructuring rather than a named import.
  const electronUpdater = await import("electron-updater");
  const { autoUpdater } = electronUpdater.default;
  return createUpdateController(autoUpdater, prompts);
}
