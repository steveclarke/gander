import { contextBridge, ipcRenderer } from "electron";
import type { OpenTarget } from "@gander/shared";

const invoke = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(`gander:${ch}`, ...args);

contextBridge.exposeInMainWorld("gander", {
  listRepos: invoke("listRepos"),
  addRepo: invoke("addRepo"),
  listPrs: invoke("listPrs"),
  lastReview: invoke("lastReview"),
  initialTarget: invoke("initialTarget"),
  // Push, not invoke: the target arrives whenever someone runs bin/gander, which is not
  // something the renderer can ask about. The callback is exposed rather than ipcRenderer
  // itself, so the renderer never gets a channel it could send anything on.
  onOpenTarget: (cb: (target: OpenTarget) => void) =>
    ipcRenderer.on("gander:openTarget", (_e, target: OpenTarget) => cb(target)),
  serviceHealthy: invoke("serviceHealthy"),
  openPr: invoke("openPr"),
  setChecked: invoke("setChecked"),
  setCheckedMany: invoke("setCheckedMany"),
  refreshPr: invoke("refreshPr"),
  reviewedSnapshot: invoke("reviewedSnapshot"),
  addQuestion: invoke("addQuestion"),
  deleteQuestion: invoke("deleteQuestion"),
});
