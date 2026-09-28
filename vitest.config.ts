import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, "**/.worktrees/**", ".kilo/**", "e2e/**", "output/**"],
  },
});
