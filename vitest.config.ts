import { configDefaults, defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    setupFiles: ["./test/setup-git-env.ts"],
    exclude: [...configDefaults.exclude, "packages/app/e2e/**"],
  },
});
