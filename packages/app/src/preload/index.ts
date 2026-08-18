import { contextBridge, ipcRenderer } from "electron";
import { createGanderApi } from "./api.js";

contextBridge.exposeInMainWorld("gander", createGanderApi((channel, ...args) => ipcRenderer.invoke(channel, ...args)));
