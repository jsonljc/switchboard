import { describe, it, expect, vi } from "vitest";
import type {
  MetaInsightsProvider,
  OrgBookedStatsReader,
  RunRileyOutcomeAttributionInput,
} from "@switchboard/core";

// Partial passthrough mock: spy on the orchestrator so the bind layer's
// dependency threading is observable without running real attribution.
const { runSpy } = vi.hoisted(() => ({
  runSpy: vi.fn((_input: unknown) =>
    Promise.resolve({
      orgId: "org-1",
      candidatesScanned: 0,
      skippedExisting: 0,
      outcomesWritten: 0,
      renderable: 0,
      corroborated: 0,
      hidden: 0,
      hiddenByFlag: {
        meta_data_missing: 0,
        zero_pre_baseline: 0,
        below_noise_floor: 0,
        same_campaign_overlap: 0,
      },
    }),
  ),
}));

vi.mock("@switchboard/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@switchboard/core")>();
  return { ...actual, runRileyOutcomeAttribution: runSpy };
});

import { bindRileyOutcomeOrchestrator } from "../services/cron/riley-outcome-attribution.js";

function makeDeps() {
  const insightsProvider: MetaInsightsProvider = {
    getWindowMetrics: vi.fn(async () => null),
  };
  return {
    recommendationStore: {
      findAttributableCandidates: vi.fn(async () => []),
      findOverlapsForCampaign: vi.fn(async () => []),
    },
    createInsightsProvider: vi.fn(() => insightsProvider),
    outcomeStore: {
      insert: vi.fn(async () => undefined),
      existsByRecommendationId: vi.fn(async () => false),
    },
  };
}

describe("bindRileyOutcomeOrchestrator (riley v3 slice 4d)", () => {
  it("threads the org-booked-stats reader into the orchestrator", async () => {
    const reader: OrgBookedStatsReader = {
      getBookedStatsForOrgWindow: vi.fn(async () => ({ bookedValueCents: 0, bookedCount: 0 })),
    };
    const run = bindRileyOutcomeOrchestrator({ ...makeDeps(), orgBookedStatsReader: reader });

    await run({ orgId: "org-1", now: new Date("2026-06-06T07:00:00Z") });

    const input = runSpy.mock.calls[0]?.[0] as RunRileyOutcomeAttributionInput;
    expect(input.orgBookedStatsReader).toBe(reader);
  });

  it("omits the reader when not provided (back-compat: rows stay byte-identical)", async () => {
    const run = bindRileyOutcomeOrchestrator(makeDeps());

    await run({ orgId: "org-1", now: new Date("2026-06-06T07:00:00Z") });

    const input = runSpy.mock.calls.at(-1)?.[0] as RunRileyOutcomeAttributionInput;
    expect("orgBookedStatsReader" in input).toBe(false);
  });
});
