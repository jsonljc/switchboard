import { describe, expect, it, vi } from "vitest";
import { loadSkill } from "../skill-loader.js";
import { interpolate } from "../template-engine.js";
import { miraBuilder } from "./mira.js";
import type { SkillStores } from "../parameter-builder.js";

// Integration render test (review finding on PR-1): proves the REAL skill body
// and the REAL builder output agree on parameter names. A renamed param on
// either side passes both unit suites but produces a literal {{TOKEN}} or an
// empty slot at runtime; this test reds instead.
const SKILLS_DIR = new URL("../../../../../skills", import.meta.url).pathname;

function makeStores(): SkillStores {
  return {
    opportunityStore: { findActiveByContact: vi.fn() },
    contactStore: { findById: vi.fn() },
    activityStore: { listByDeployment: vi.fn() },
    businessFactsStore: {
      get: vi.fn().mockResolvedValue({
        businessName: "Glow Clinic",
        timezone: "Asia/Singapore",
        locations: [{ name: "Orchard", address: "1 Orchard Rd" }],
        services: [{ name: "Botox", description: "Anti-wrinkle treatment" }],
        openingHours: {},
        bookingPolicies: {},
        additionalFaqs: [],
        escalationContact: { name: "Ops", channel: "whatsapp", address: "+65 0000 0000" },
      }),
    },
    deploymentMemoryReader: {
      listHighConfidence: vi.fn().mockResolvedValue([
        {
          id: "m1",
          category: "taste",
          canonicalKey: "taste:kept_polished_question",
          sourceCount: 5,
          confidence: 0.8,
        },
      ]),
    },
    miraReadModelReader: {
      read: vi.fn().mockResolvedValue({
        jobs: [],
        counts: {
          total: 0,
          shippedThisWeek: 0,
          shippedPrevWeek: 0,
          inFlight: 0,
          awaitingReview: 0,
          stopped: 0,
        },
      }),
    },
  } as unknown as SkillStores;
}

describe("mira skill body x miraBuilder integration render", () => {
  it("interpolates the real body with real builder output, no leftover tokens", async () => {
    const skill = loadSkill("mira", SKILLS_DIR);
    const result = await miraBuilder(
      {
        orgId: "org1",
        deploymentId: "dep1",
        request: { composeSource: "weekly_scan" },
        now: () => new Date("2026-06-05T10:00:00Z"),
      },
      makeStores(),
    );

    const rendered = interpolate(skill.body, result.parameters, skill.parameters);

    expect(rendered).toContain("Glow Clinic");
    expect(rendered).toContain("question hooks");
    expect(rendered).toContain("Weekly performance scan");
    expect(rendered).toContain("No published creatives with measured performance yet");
    expect(rendered).toContain("2026-06-05");
    // No unresolved template tokens survive.
    expect(rendered).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
