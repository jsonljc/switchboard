import { describe, expect, it } from "vitest";
import { emitRecommendation } from "../emit.js";
import { createInMemoryStore } from "./in-memory-store.js";
import type { RecommendationInput } from "../types.js";

const baseInput = (overrides: Partial<RecommendationInput> = {}): RecommendationInput => ({
  orgId: "org-1",
  agentKey: "nova",
  intent: "recommendation.ad_set_pause",
  action: "pause",
  humanSummary: "Pause Whitening Ad Set B",
  confidence: 0.9,
  dollarsAtRisk: 25,
  riskLevel: "low",
  parameters: { foo: "bar" },
  presentation: {
    primaryLabel: "Pause",
    secondaryLabel: "Reduce 50%",
    dismissLabel: "Dismiss",
    dataLines: [],
  },
  targetEntities: { campaignId: "c-1" },
  ...overrides,
});

describe("emitRecommendation", () => {
  it("routes shadow input to shadow_action surface and writes a row", async () => {
    const store = createInMemoryStore();
    const result = await emitRecommendation(store, baseInput());
    expect(result.surface).toBe("shadow_action");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.surface).toBe("shadow_action");
    expect(store.rows[0]?.parameters).toMatchObject({
      foo: "bar",
      __recommendation: { action: "pause", presentation: expect.any(Object) },
    });
  });

  it("sets undoableUntil on shadow rows (createdAt + 24h)", async () => {
    const store = createInMemoryStore();
    await emitRecommendation(store, baseInput());
    const row = store.rows[0]!;
    expect(row.undoableUntil).not.toBeNull();
    const diff = row.undoableUntil!.getTime() - row.createdAt.getTime();
    expect(diff).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(diff).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
  });

  it("does NOT set undoableUntil on queue rows", async () => {
    const store = createInMemoryStore();
    await emitRecommendation(store, baseInput({ confidence: 0.6 }));
    expect(store.rows[0]?.undoableUntil).toBeNull();
  });

  it("defaults expiresAt to createdAt + 24h when not provided", async () => {
    const store = createInMemoryStore();
    await emitRecommendation(store, baseInput());
    const row = store.rows[0]!;
    const diff = row.expiresAt!.getTime() - row.createdAt.getTime();
    expect(diff).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
  });

  it("respects emitter-supplied expiresAt", async () => {
    const store = createInMemoryStore();
    const future = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await emitRecommendation(store, baseInput({ expiresAt: future }));
    expect(store.rows[0]?.expiresAt?.getTime()).toBe(future.getTime());
  });

  it("returns dropped without writing when router drops", async () => {
    const store = createInMemoryStore();
    const result = await emitRecommendation(store, baseInput({ confidence: 0.3 }));
    expect(result).toEqual({ surface: "dropped", id: null, idempotent: false });
    expect(store.rows).toHaveLength(0);
  });

  it("idempotency: re-emit with same target+intent+day returns existing row", async () => {
    const store = createInMemoryStore();
    const input = baseInput();
    const first = await emitRecommendation(store, input);
    const second = await emitRecommendation(store, input);
    expect(second.id).toBe(first.id);
    expect(second.idempotent).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it("rejects invalid input via Zod", async () => {
    const store = createInMemoryStore();
    await expect(
      emitRecommendation(store, { ...baseInput(), confidence: 5 } as RecommendationInput),
    ).rejects.toThrow();
  });
});
