// ---------------------------------------------------------------------------
// Tests for buildEnrichment (extracted enrichContext logic)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildEnrichment } from "../enrich-context.js";
import { createSessionState } from "../context/session.js";

describe("buildEnrichment", () => {
  it("resolves funnel and benchmarks for funnel.diagnose", async () => {
    const session = createSessionState();
    const result = await buildEnrichment(
      "digital-ads.funnel.diagnose",
      { platform: "meta", vertical: "commerce" },
      session,
      null,
    );
    expect(result.resolvedFunnel).toBeDefined();
    expect(result.resolvedBenchmarks).toBeDefined();
  });

  it("resolves platform configs for portfolio.diagnose", async () => {
    const session = createSessionState();
    const result = await buildEnrichment(
      "digital-ads.portfolio.diagnose",
      {
        vertical: "commerce",
        platforms: [
          { platform: "meta", entityId: "act_1" },
          { platform: "google", entityId: "g_1" },
        ],
      },
      session,
      null,
    );
    const resolved = result.resolvedPlatforms as Array<{ platform: string }>;
    expect(resolved).toBeDefined();
    expect(resolved.length).toBe(2);
  });

  it("sets validationError when timeRange.since is after until", async () => {
    const session = createSessionState();
    const result = await buildEnrichment(
      "digital-ads.snapshot.fetch",
      { timeRange: { since: "2024-02-01", until: "2024-01-01" } },
      session,
      null,
    );
    expect(result.validationError).toContain("before");
  });

  it("sets validationError when timeRange is missing since or until", async () => {
    const session = createSessionState();
    const result = await buildEnrichment(
      "digital-ads.snapshot.fetch",
      { timeRange: { since: "2024-01-01" } },
      session,
      null,
    );
    expect(result.validationError).toContain("requires both");
  });

  it("sets validationError when credential platform mismatches", async () => {
    const session = createSessionState();
    const result = await buildEnrichment(
      "digital-ads.platform.connect",
      { platform: "meta", credentials: { platform: "google" } },
      session,
      null,
    );
    expect(result.validationError).toContain("doesn't match");
  });

  it("sets validationError when Meta connection required but missing", async () => {
    const session = createSessionState();
    const result = await buildEnrichment(
      "digital-ads.report.performance",
      { adAccountId: "act_123" },
      session,
      null,
    );
    expect(result.validationError).toContain("No Meta connection");
  });

  it("returns empty enrichment for local-computation actions", async () => {
    const session = createSessionState();
    const result = await buildEnrichment(
      "digital-ads.strategy.recommend",
      { businessGoal: "sales" },
      session,
      null,
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("skips enrichment for invalid platform in funnel.diagnose", async () => {
    const session = createSessionState();
    const result = await buildEnrichment(
      "digital-ads.funnel.diagnose",
      { platform: "invalid_platform", vertical: "commerce" },
      session,
      null,
    );
    expect(result.resolvedFunnel).toBeUndefined();
  });
});
