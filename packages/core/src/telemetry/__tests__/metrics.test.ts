import { describe, it, expect, vi } from "vitest";
import { createInMemoryMetrics } from "../metrics.js";

describe("outcomePattern metrics", () => {
  it("outcomePatternsExtracted accepts labeled increments", () => {
    const metrics = createInMemoryMetrics();
    const spy = vi.spyOn(metrics.outcomePatternsExtracted, "inc");

    metrics.outcomePatternsExtracted.inc({ deploymentId: "dep-1", attributionTier: "strong" });
    metrics.outcomePatternsExtracted.inc({ deploymentId: "dep-1", attributionTier: "fallback" });

    expect(spy).toHaveBeenCalledWith({ deploymentId: "dep-1", attributionTier: "strong" });
    expect(spy).toHaveBeenCalledWith({ deploymentId: "dep-1", attributionTier: "fallback" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("outcomePatternsMerged / Created / Surfaced accept deployment-scoped labels", () => {
    const metrics = createInMemoryMetrics();
    const mergedSpy = vi.spyOn(metrics.outcomePatternsMerged, "inc");
    const createdSpy = vi.spyOn(metrics.outcomePatternsCreated, "inc");
    const surfacedSpy = vi.spyOn(metrics.outcomePatternsSurfaced, "inc");

    metrics.outcomePatternsMerged.inc({ deploymentId: "dep-1" });
    metrics.outcomePatternsCreated.inc({ deploymentId: "dep-2" });
    metrics.outcomePatternsSurfaced.inc({ deploymentId: "dep-3" });

    expect(mergedSpy).toHaveBeenCalledWith({ deploymentId: "dep-1" });
    expect(createdSpy).toHaveBeenCalledWith({ deploymentId: "dep-2" });
    expect(surfacedSpy).toHaveBeenCalledWith({ deploymentId: "dep-3" });
  });

  it("outcomePatternsDecayed accepts {deploymentTier, canonicalCategory}", () => {
    const metrics = createInMemoryMetrics();
    const spy = vi.spyOn(metrics.outcomePatternsDecayed, "inc");

    metrics.outcomePatternsDecayed.inc(
      { deploymentTier: "aggregate", canonicalCategory: "all" },
      5,
    );

    expect(spy).toHaveBeenCalledWith({ deploymentTier: "aggregate", canonicalCategory: "all" }, 5);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("outcomePatternConfidence histogram records labeled observations", () => {
    const metrics = createInMemoryMetrics();
    const spy = vi.spyOn(metrics.outcomePatternConfidence, "observe");

    metrics.outcomePatternConfidence.observe({ deploymentId: "dep-1" }, 0.82);
    metrics.outcomePatternConfidence.observe({ deploymentId: "dep-1" }, 0.91);

    expect(spy).toHaveBeenCalledWith({ deploymentId: "dep-1" }, 0.82);
    expect(spy).toHaveBeenCalledWith({ deploymentId: "dep-1" }, 0.91);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("outcomePatternsRejected accepts {deploymentId, reason} increments", () => {
    const metrics = createInMemoryMetrics();
    const spy = vi.spyOn(metrics.outcomePatternsRejected, "inc");

    metrics.outcomePatternsRejected.inc({ deploymentId: "dep-1", reason: "invalid_canonical_key" });
    metrics.outcomePatternsRejected.inc({ deploymentId: "dep-1", reason: "unknown_canonical_key" });

    expect(spy).toHaveBeenCalledWith({ deploymentId: "dep-1", reason: "invalid_canonical_key" });
    expect(spy).toHaveBeenCalledWith({ deploymentId: "dep-1", reason: "unknown_canonical_key" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("outcomePatternsCrossKeyCollision accepts {deploymentId, currentKey, collidingKey}", () => {
    const metrics = createInMemoryMetrics();
    const spy = vi.spyOn(metrics.outcomePatternsCrossKeyCollision, "inc");

    metrics.outcomePatternsCrossKeyCollision.inc({
      deploymentId: "dep-1",
      currentKey: "objection:pain",
      collidingKey: "objection:price_value",
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
