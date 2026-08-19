interface RevealableWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/** E2E renders a real BrowserWindow for Playwright, but it must not take over the desktop. */
export function windowIsHidden(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.GANDER_E2E === "1";
}

/** Bring a product window forward; hidden E2E windows still receive IPC without revealing it. */
export function revealWindow(window: RevealableWindow, environment: NodeJS.ProcessEnv = process.env): void {
  if (windowIsHidden(environment)) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
