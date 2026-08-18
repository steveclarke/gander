import { contextBridge, ipcRenderer } from "electron";

const invoke = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(`gander:${ch}`, ...args);

contextBridge.exposeInMainWorld("gander", {
  listRepos: invoke("listRepos"),
  addRepo: invoke("addRepo"),
  listPrs: invoke("listPrs"),
  lastReview: invoke("lastReview"),
  serviceHealthy: invoke("serviceHealthy"),
  openPr: invoke("openPr"),
  setChecked: invoke("setChecked"),
  setCheckedMany: invoke("setCheckedMany"),
  refreshPr: invoke("refreshPr"),
  reviewedSnapshot: invoke("reviewedSnapshot"),
  addQuestion: invoke("addQuestion"),
  deleteQuestion: invoke("deleteQuestion"),
});
