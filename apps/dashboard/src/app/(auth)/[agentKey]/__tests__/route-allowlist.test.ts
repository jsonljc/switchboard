import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AUTH_ROOT = join(__dirname, "..", "..");

const KNOWN_TOP_LEVEL = [
  "reports",
  "decide",
  "settings",
  "console",
  "escalations",
  "tasks",
  "me",
  "my-agent",
  "modules",
  "conversations",
  "deployments",
  "onboarding",
  "dashboard",
];

describe("route allowlist — concrete top-level routes beat [agentKey]", () => {
  for (const segment of KNOWN_TOP_LEVEL) {
    it(`/${segment} resolves via concrete directory, not [agentKey]`, () => {
      const dir = join(AUTH_ROOT, segment);
      expect(existsSync(dir)).toBe(true);
    });
  }

  it("Owner Home `/` has its own page.tsx and is not the dynamic segment", () => {
    expect(existsSync(join(AUTH_ROOT, "page.tsx"))).toBe(true);
  });

  it("[agentKey] dynamic segment exists", () => {
    expect(existsSync(join(AUTH_ROOT, "[agentKey]"))).toBe(true);
  });
});
