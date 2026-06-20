import { describe, it, expect, vi } from "vitest";
import {
  createInMemoryMetrics,
  setMetrics,
  recordLlmCacheEffectiveness,
  recordSkillContextFill,
} from "../metrics.js";

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

describe("booking lifecycle counters", () => {
  it("exposes the 6 booking counters and they increment", () => {
    const m = createInMemoryMetrics();
    for (const c of [
      m.bookingConfirmed,
      m.bookingFailed,
      m.bookingStageAdvanced,
      m.bookingSlotConflict,
      m.bookingReschedule,
      m.bookingCancel,
    ]) {
      expect(c).toBeDefined();
      c.inc({ orgId: "o" });
    }
  });
});

describe("whatsappProactiveSendSkipped", () => {
  it("accepts {intent, reason} increments", () => {
    const m = createInMemoryMetrics();
    const spy = vi.spyOn(m.whatsappProactiveSendSkipped, "inc");

    m.whatsappProactiveSendSkipped.inc({
      intent: "conversation.reminder.send",
      reason: "config_missing",
    });

    expect(spy).toHaveBeenCalledWith({
      intent: "conversation.reminder.send",
      reason: "config_missing",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("recordLlmCacheEffectiveness", () => {
  it("classifies a cache read as a hit and records {model, outcome:hit} with no warn", () => {
    const m = createInMemoryMetrics();
    setMetrics(m);
    const inc = vi.spyOn(m.llmCacheCallsTotal, "inc");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = recordLlmCacheEffectiveness({
      model: "claude-opus-4-6",
      cacheReadTokens: 800,
      cacheCreationTokens: 0,
    });

    expect(outcome).toBe("hit");
    expect(inc).toHaveBeenCalledWith({ model: "claude-opus-4-6", outcome: "hit" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("classifies a first-touch (creation only, zero read) as populate with no warn", () => {
    const m = createInMemoryMetrics();
    setMetrics(m);
    const inc = vi.spyOn(m.llmCacheCallsTotal, "inc");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = recordLlmCacheEffectiveness({
      model: "claude-sonnet-4-6",
      cacheReadTokens: 0,
      cacheCreationTokens: 1200,
    });

    expect(outcome).toBe("populate");
    expect(inc).toHaveBeenCalledWith({ model: "claude-sonnet-4-6", outcome: "populate" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("classifies zero read AND zero creation as a miss and warns (silent-invalidation signal)", () => {
    const m = createInMemoryMetrics();
    setMetrics(m);
    const inc = vi.spyOn(m.llmCacheCallsTotal, "inc");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = recordLlmCacheEffectiveness({
      model: "claude-haiku-4-5-20251001",
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });

    expect(outcome).toBe("miss");
    expect(inc).toHaveBeenCalledWith({ model: "claude-haiku-4-5-20251001", outcome: "miss" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("zero-read");
    warn.mockRestore();
  });
});

describe("recordSkillContextFill", () => {
  it("observes the fill ratio (billable/max) on the histogram and returns it", () => {
    const m = createInMemoryMetrics();
    setMetrics(m);
    const obs = vi.spyOn(m.skillContextFillRatio, "observe");
    const ratio = recordSkillContextFill({
      model: "claude-haiku-4-5-20251001",
      billableTokens: 32_000,
      maxTokens: 64_000,
    });
    expect(ratio).toBeCloseTo(0.5);
    expect(obs).toHaveBeenCalledWith({ model: "claude-haiku-4-5-20251001" }, 0.5);
  });

  it("returns 0 and does not observe on a non-positive or non-finite maxTokens (NaN-safe)", () => {
    const m = createInMemoryMetrics();
    setMetrics(m);
    const obs = vi.spyOn(m.skillContextFillRatio, "observe");
    expect(recordSkillContextFill({ model: "x", billableTokens: 100, maxTokens: 0 })).toBe(0);
    expect(recordSkillContextFill({ model: "x", billableTokens: 100, maxTokens: Number.NaN })).toBe(
      0,
    );
    expect(obs).not.toHaveBeenCalled();
  });
});
