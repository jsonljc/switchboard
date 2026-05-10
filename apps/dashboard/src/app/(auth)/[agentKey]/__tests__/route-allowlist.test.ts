import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AUTH_ROOT = join(__dirname, "..", "..");
// Mercury surfaces live under a (mercury) route group; route groups don't
// affect URL resolution, so /contacts still beats [agentKey] even when its
// concrete dir is at (auth)/(mercury)/contacts.
const MERCURY_ROOT = join(AUTH_ROOT, "(mercury)");

// Concrete directories that beat [agentKey] in Next.js route resolution.
// Legacy routes (/decide, /escalations, /tasks, /me, /my-agent, /modules,
// /conversations, /deployments, /dashboard) were removed in D4.
const KNOWN_TOP_LEVEL = ["reports", "settings", "contacts", "operator", "onboarding"];

function hasRouteSegment(segment: string): boolean {
  return existsSync(join(AUTH_ROOT, segment)) || existsSync(join(MERCURY_ROOT, segment));
}

describe("route allowlist — concrete top-level routes beat [agentKey]", () => {
  for (const segment of KNOWN_TOP_LEVEL) {
    it(`/${segment} resolves via concrete directory, not [agentKey]`, () => {
      expect(hasRouteSegment(segment)).toBe(true);
    });
  }

  it("`/` is not claimed by `(auth)/page.tsx` (would collide with `(public)/page.tsx`)", () => {
    expect(existsSync(join(AUTH_ROOT, "page.tsx"))).toBe(false);
  });

  it("[agentKey] dynamic segment exists", () => {
    expect(existsSync(join(AUTH_ROOT, "[agentKey]"))).toBe(true);
  });
});
