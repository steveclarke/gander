import { contextBridge, ipcRenderer } from "electron";

const invoke = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(`gander:${ch}`, ...args);

contextBridge.exposeInMainWorld("gander", {
  listRepos: invoke("listRepos"),
  addRepo: invoke("addRepo"),
  listPrs: invoke("listPrs"),
  lastReview: invoke("lastReview"),
  openPr: invoke("openPr"),
  setChecked: invoke("setChecked"),
  setCheckedMany: invoke("setCheckedMany"),
  refreshPr: invoke("refreshPr"),
});
