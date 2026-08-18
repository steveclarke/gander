import { contextBridge, ipcRenderer } from "electron";
import { createGanderApi } from "./api.js";

contextBridge.exposeInMainWorld("gander", createGanderApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, listener) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => listener(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
));
