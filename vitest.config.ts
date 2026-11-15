import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/canada-post/vitest.config.ts", "scripts/vitest.config.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      reporter: ["text", "lcov"],
    },
  },
});
