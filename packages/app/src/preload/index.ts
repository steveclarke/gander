import { contextBridge, ipcRenderer } from "electron";
import { createGanderApi } from "./api.js";

contextBridge.exposeInMainWorld("gander", createGanderApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
));
