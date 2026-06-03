import { describe, it, expect, vi } from "vitest";
import { createSubstantiationResolver } from "../substantiation-resolver.js";
import { createInMemoryLRU } from "../substantiation-cache.js";
import type {
  ApprovedComplianceClaimRecord,
  ApprovedComplianceClaimStore,
} from "@switchboard/core";
import type { RegulatoryPublicSourceEntry } from "../regulatory-sources/index.js";

const NOW = new Date("2026-05-11T12:00:00.000Z");
const STALE_DATE = new Date("2025-10-01T00:00:00.000Z").toISOString(); // > 180 days ago
const FRESH_DATE = new Date("2026-04-15T00:00:00.000Z").toISOString(); // < 180 days ago

function makeStore(rows: ApprovedComplianceClaimRecord[]): ApprovedComplianceClaimStore {
  return { list: vi.fn().mockResolvedValue(rows) };
}

function freshClaim(
  overrides: Partial<ApprovedComplianceClaimRecord> = {},
): ApprovedComplianceClaimRecord {
  return {
    id: "clm_1",
    deploymentId: "dep_1",
    jurisdiction: "SG",
    claimType: "efficacy",
    claimText: "visible slimming",
    reviewedBy: "Dr Lim",
    reviewedAt: FRESH_DATE,
    validUntil: null,
    notes: null,
    createdAt: FRESH_DATE,
    updatedAt: FRESH_DATE,
    ...overrides,
  };
}

describe("createSubstantiationResolver", () => {
  it("returns matched when an approved_compliance_claim substring-hits the sentence", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim()]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "Most clients see visible slimming after one session.",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("matched");
    expect(res.sourceType).toBe("approved_compliance_claim");
    expect(res.sourceId).toBe("clm_1");
    expect(res.matchedText).toContain("visible slimming");
  });

  it("returns stale when the approved claim is older than 180 days", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim({ reviewedAt: STALE_DATE })]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "visible slimming results",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("stale");
  });

  it("returns stale when validUntil is past", async () => {
    const past = new Date("2026-05-01T00:00:00.000Z").toISOString();
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim({ validUntil: past })]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "visible slimming",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("stale");
  });

  it("returns missing when no source matches", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "anything goes",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing");
  });

  it("falls through tiers for safety-claim: approved → regulatory", async () => {
    const regEntry: RegulatoryPublicSourceEntry = {
      id: "sg_hsa_thermage_flx",
      category: "approved_device",
      patterns: ["Thermage FLX"],
      jurisdiction: "SG",
      authority: "HSA",
      sources: [],
    };
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([]),
      regulatoryLoader: () => [regEntry],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "Our Thermage FLX programme is safe for most skin types.",
      claimType: "safety-claim",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("matched");
    expect(res.sourceType).toBe("regulatory_public_source");
    expect(res.sourceId).toBe("sg_hsa_thermage_flx");
  });

  it("credentials only dispatches to regulatory_public_source", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim({ claimType: "credentials" })]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "Dr Jane is SMC-registered.",
      claimType: "credentials",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing"); // no regulatory match, approved-claim path skipped
  });

  it("testimonial / medical-advice / diagnosis dispatch to no tiers", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim()]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    for (const ct of ["testimonial", "medical-advice", "diagnosis"] as const) {
      const res = await resolver.resolve({
        sentence: "anything",
        claimType: ct,
        jurisdiction: "SG",
        deploymentId: "dep_1",
      });
      expect(res.status).toBe("missing");
    }
  });

  it("caches matched resolutions but not stale/missing", async () => {
    const cache = createInMemoryLRU();
    const list = vi.fn().mockResolvedValue([freshClaim()]);
    const resolver = createSubstantiationResolver({
      approvedClaimStore: { list },
      regulatoryLoader: () => [],
      cache,
      clock: () => NOW,
    });
    await resolver.resolve({
      sentence: "visible slimming",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    await resolver.resolve({
      sentence: "visible slimming",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(list).toHaveBeenCalledTimes(1); // second call short-circuited via cache
  });

  it("treats approvedClaimStore.list throw as missing (defensive)", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: { list: vi.fn().mockRejectedValue(new Error("db down")) },
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "x",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing");
  });

  it("matches a reordered/padded paraphrase of an approved claim (no exact substring)", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim()]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      // contains both "slimming" and "visible" but not the substring "visible slimming"
      sentence: "The slimming effect is clearly visible after one session.",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("matched");
    expect(res.sourceType).toBe("approved_compliance_claim");
  });

  it("does NOT match when a key claim term is absent (containment < 1)", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim()]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      sentence: "Results are clearly visible after one session.", // missing "slimming"
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing");
  });

  it("does NOT match a negated paraphrase", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim()]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      // all tokens present, but negated, and not the exact substring
      sentence: "The slimming is not really visible yet.",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing");
  });

  it("does NOT paraphrase-match a claim that reduces to a single significant token", async () => {
    const resolver = createSubstantiationResolver({
      approvedClaimStore: makeStore([freshClaim({ claimText: "works for you" })]),
      regulatoryLoader: () => [],
      cache: createInMemoryLRU(),
      clock: () => NOW,
    });
    const res = await resolver.resolve({
      // contains "works" but is not the approved claim; the >=2-token floor stops
      // the single content word "works" from trivially substantiating the claim.
      sentence: "Our approach works in many different ways.",
      claimType: "efficacy",
      jurisdiction: "SG",
      deploymentId: "dep_1",
    });
    expect(res.status).toBe("missing");
  });
});
