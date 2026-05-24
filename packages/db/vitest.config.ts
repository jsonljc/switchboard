import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 55,
        lines: 50,
      },
    },
  },
});
