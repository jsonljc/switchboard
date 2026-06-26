import { describe, expect, it } from "vitest";
import { miraBuilder } from "@switchboard/core/skill-runtime";
import { SCENARIOS } from "../scenarios.js";

// The golden scenarios author their `params` strings in miraBuilder's render format
// (the harness feeds them straight to the executor, not through the builder). This
// suite drives the REAL miraBuilder over a representative world and pins the format
// markers the goldens rely on — so a renderer wording change (e.g. "Shipped this week"
// → "Published this week") REDS here, flagging the goldens as stale instead of letting
// the live judge silently score a drifted prompt. Mirrors alex-conversation's
// live-path-faithfulness gate (which drives the real builder seam, not frozen strings).

type Stores = Parameters<typeof miraBuilder>[1];

function makeStores(): Stores {
  return {
    deploymentMemoryReader: {
      listHighConfidence: async () => [
        {
          id: "r1",
          category: "revenue_proven",
          canonicalKey: "revenue_proven:polished_question",
          sourceCount: 5,
          confidence: 0.9,
        },
        {
          id: "t1",
          category: "taste",
          canonicalKey: "taste:kept_polished_question",
          sourceCount: 5,
          confidence: 0.8,
        },
      ],
    },
    miraReadModelReader: {
      read: async () => ({
        jobs: [
          {
            id: "j1",
            title: "Glow question hook",
            stage: "draft",
            status: "shipped",
            reviewAction: { canContinue: false, canStop: false, label: "none" },
            source: { engine: "legacy_creative_job", mode: "polished" },
            createdAt: "2026-06-20T00:00:00.000Z",
            updatedAt: "2026-06-20T00:00:00.000Z",
            reviewDecision: "kept",
            performance: {
              asOf: "2026-06-21",
              delivery: "measured",
              spend: 110,
              trueRoas: 3.8,
              bookedValueCents: 76000,
              bookedCount: 5,
              metaConversions: 5,
            },
          },
        ],
        counts: {
          total: 3,
          shippedThisWeek: 1,
          shippedPrevWeek: 1,
          inFlight: 1,
          awaitingReview: 1,
          stopped: 0,
          measuredCount: 1,
        },
      }),
    },
    businessFactsStore: {
      get: async () => ({
        businessName: "Lumière Aesthetics",
        timezone: "Asia/Singapore",
        locations: [],
        services: [],
        openingHours: {},
        bookingPolicies: {},
        additionalFaqs: [],
        escalationContact: { name: "Ops", channel: "whatsapp", address: "+65 0000 0000" },
      }),
    },
    bookingOutcomeLedgerReader: {
      listForOrg: async () => [
        { service: "HydraFacial", bookingStatus: "confirmed" },
        { service: "HydraFacial", bookingStatus: "confirmed" },
        { service: "anti-wrinkle injections", bookingStatus: "confirmed" },
      ],
    },
  } as unknown as Stores;
}

const NOW = (): Date => new Date("2026-06-22T10:00:00.000Z");

describe("builder faithfulness — golden param FORMAT matches the real miraBuilder", () => {
  it("renders the markers the weekly_scan goldens rely on", async () => {
    const { parameters } = await miraBuilder(
      { orgId: "o", deploymentId: "d", request: { composeSource: "weekly_scan" }, now: NOW },
      makeStores(),
    );
    const p = parameters as Record<string, string>;
    expect(p.TASTE_CONTEXT).toContain("Measured winner in polished mode:");
    expect(p.TASTE_CONTEXT).toContain("the operator consistently keeps");
    expect(p.PERFORMANCE_CONTEXT).toContain("Shipped this week:");
    expect(p.PERFORMANCE_CONTEXT).toContain("true ROAS");
    expect(p.PERFORMANCE_CONTEXT).toContain(" spend,");
    expect(p.PERFORMANCE_CONTEXT).toContain("booked from");
    expect(p.PERFORMANCE_CONTEXT).toContain("bookings");
    expect(p.FRONTLINE_CONVERSION_CONTEXT).toContain(
      "Treatments customers actually book, most to least:",
    );
    expect(p.PIPELINE_STATE).toContain("in flight (");
    expect(p.PIPELINE_STATE).toContain("awaiting review)");
    expect(p.TRIGGER_CONTEXT).toContain("Weekly performance scan");
  });

  it("renders the Riley-handoff trigger marker", async () => {
    const { parameters } = await miraBuilder(
      {
        orgId: "o",
        deploymentId: "d",
        request: {
          composeSource: "riley_handoff",
          recommendation: {
            actionType: "scale_budget",
            campaignId: "cmp_x",
            rationale: "converting well",
            evidence: { clicks: 1, conversions: 1, days: 1 },
          },
        },
        now: NOW,
      },
      makeStores(),
    );
    expect((parameters as Record<string, string>).TRIGGER_CONTEXT).toContain(
      "Riley (the ads agent) recommends",
    );
  });

  it("binds goldens↔builder: every pinned marker is actually used by a golden scenario", () => {
    // If a renderer change reds the pins above, these are exactly the strings the
    // goldens must re-sync to. Keeping the list here in lockstep prevents a silent
    // drift where the builder format moves but the goldens still pass their own tests.
    const markers = [
      "Measured winner in polished mode:",
      "the operator consistently keeps",
      "Shipped this week:",
      "true ROAS",
      "Treatments customers actually book, most to least:",
      "in flight (",
      "awaiting review)",
      "Weekly performance scan",
      "Riley (the ads agent) recommends",
    ];
    for (const m of markers) {
      const used = SCENARIOS.some((s) => Object.values(s.params).some((v) => v.includes(m)));
      expect(used, `no golden scenario uses the pinned format marker "${m}"`).toBe(true);
    }
  });
});
