import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: __dirname,
    include: [
      "claim-classifier/__tests__/**/*.test.ts",
      "alex-conversation/__tests__/**/*.test.ts",
      "governance-decision/__tests__/**/*.test.ts",
      "riley-recommendation/__tests__/**/*.test.ts",
      "trajectory-grading/__tests__/**/*.test.ts",
      "adversarial-injection/__tests__/**/*.test.ts",
      "claim-boundary/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
});
