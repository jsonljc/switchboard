import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AUTH_ROOT = join(__dirname, "..", "..");

// Concrete directories that beat [agentKey] in Next.js route resolution.
// Legacy routes (/decide, /escalations, /tasks, /me, /my-agent, /modules,
// /conversations, /deployments, /dashboard) were removed in D4.
const KNOWN_TOP_LEVEL = ["reports", "settings", "contacts", "operator", "onboarding"];

describe("route allowlist — concrete top-level routes beat [agentKey]", () => {
  for (const segment of KNOWN_TOP_LEVEL) {
    it(`/${segment} resolves via concrete directory, not [agentKey]`, () => {
      const dir = join(AUTH_ROOT, segment);
      expect(existsSync(dir)).toBe(true);
    });
  }

  it("`/` is not claimed by `(auth)/page.tsx` (would collide with `(public)/page.tsx`)", () => {
    expect(existsSync(join(AUTH_ROOT, "page.tsx"))).toBe(false);
  });

  it("[agentKey] dynamic segment exists", () => {
    expect(existsSync(join(AUTH_ROOT, "[agentKey]"))).toBe(true);
  });
});
