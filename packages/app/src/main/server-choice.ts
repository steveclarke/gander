import { randomUUID } from "node:crypto";
import type { BrowserWindow, IpcMain } from "electron";
import type { ServerClaim } from "./repository-claims.js";

/**
 * Asking the reviewer which server a repository's notes belong on, inside the window.
 *
 * Registration happens in the main process — from the folder picker or from `bin/gander`
 * handing over a checkout — but the question is drawn by the renderer, so it looks like the
 * rest of the app and can show what each server said. Main sends the question and waits for
 * the answer on its own channel; a window that closes first counts as cancelling.
 */

export interface ServerChoiceRequest {
  requestId: string;
  repoId: string;
  /** Why Gander is asking: no clear claimant, several, a server it could not ask, or the reviewer asked to change. */
  reason: "several" | "none" | "unavailable" | "change";
  claims: ServerClaim[];
  /** The server the repository uses today, when changing. */
  currentServerId?: string;
}

export type ServerChooser = (request: Omit<ServerChoiceRequest, "requestId">) => Promise<string | null>;

export function createServerChooser(ipc: Pick<IpcMain, "handle">, window: () => BrowserWindow | null): ServerChooser {
  const pending = new Map<string, (serverId: string | null) => void>();
  ipc.handle("gander:answerServerChoice", async (_event, requestId: string, serverId: string | null) => {
    const resolve = pending.get(requestId);
    if (!resolve) return;
    pending.delete(requestId);
    resolve(typeof serverId === "string" ? serverId : null);
  });
  return (question) => {
    const target = window();
    if (!target || target.isDestroyed()) {
      return Promise.reject(new Error(`Open the Gander window to choose where ${question.repoId}'s notes are kept.`));
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const finish = (serverId: string | null): void => {
        target.removeListener("closed", cancel);
        resolve(serverId);
      };
      const cancel = (): void => { if (pending.delete(requestId)) resolve(null); };
      pending.set(requestId, finish);
      target.once("closed", cancel);
      target.webContents.send("gander:chooseServer", { ...question, requestId } satisfies ServerChoiceRequest);
    });
  };
}
