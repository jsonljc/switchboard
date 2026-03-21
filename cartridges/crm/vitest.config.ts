import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["**/__tests__/**", "**/*.test.ts", "**/dist/**"],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 55,
        lines: 50,
      },
    },
  },
});
