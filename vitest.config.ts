import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "apps/dashboard/**"],
    passWithNoTests: true,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      include: [
        "packages/*/src/**/*.ts",
        "apps/api/src/**/*.ts",
        "apps/chat/src/**/*.ts",
        "apps/mcp-server/src/**/*.ts",
        "cartridges/*/src/**/*.ts",
      ],
      exclude: ["**/__tests__/**", "**/*.test.ts", "**/dist/**", "**/node_modules/**"],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60,
      },
    },
  },
});
