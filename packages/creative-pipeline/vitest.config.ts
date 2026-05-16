import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 90,
        lines: 85,
      },
    },
  },
});
