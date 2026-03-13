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
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/__tests__/**",
        "src/cartridge/providers/calendar/google-calendar.ts",
        "src/cartridge/providers/review/google-reviews.ts",
        "src/cartridge/providers/sms/twilio.ts",
      ],
      reporter: ["text", "json", "json-summary", "html"],
      thresholds: {
        // Target: 80/70/75/80 — current coverage: ~60/77/81/60
        statements: 60,
        branches: 60,
        functions: 70,
        lines: 60,
      },
    },
  },
});
