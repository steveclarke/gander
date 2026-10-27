import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";

// @gander/shared ships TypeScript source. Left external, the packaged main process would
// import it from app.asar/node_modules, where Node refuses to strip types, so it is
// bundled into the main output instead. Everything else stays external (electron-builder
// packs the production dependencies).
export default defineConfig({
  main: { build: { externalizeDeps: { exclude: ["@gander/shared"] } } },
  preload: { build: { externalizeDeps: { exclude: ["@gander/shared"] } } },
  renderer: { plugins: [vue()] },
});
