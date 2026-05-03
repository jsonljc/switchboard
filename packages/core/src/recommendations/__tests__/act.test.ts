import { describe, expect, it } from "vitest";
import { actOnRecommendation } from "../act.js";
import { createInMemoryStore } from "./in-memory-store.js";
import { emitRecommendation } from "../emit.js";

const seedQueue = async (store = createInMemoryStore()) => {
  await emitRecommendation(store, {
    orgId: "org-1",
    agentKey: "nova",
    intent: "recommendation.kill",
    action: "kill",
    humanSummary: "Kill it",
    confidence: 0.9,
    dollarsAtRisk: 0,
    riskLevel: "high",
    parameters: {},
    presentation: {
      primaryLabel: "Kill",
      secondaryLabel: "Pause",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
  });
  return store;
};

const seedShadow = async (store = createInMemoryStore()) => {
  await emitRecommendation(store, {
    orgId: "org-1",
    agentKey: "nova",
    intent: "recommendation.ad_set_pause",
    action: "pause",
    humanSummary: "Pause it",
    confidence: 0.9,
    dollarsAtRisk: 10,
    riskLevel: "low",
    parameters: {},
    presentation: {
      primaryLabel: "Pause",
      secondaryLabel: "Reduce 50%",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
  });
  return store;
};

const actor = { principalId: "user-1", type: "operator" as const };

describe("actOnRecommendation — queue surface", () => {
  it("primary transitions to acted", async () => {
    const store = await seedQueue();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "primary",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("acted");
  });

  it("secondary transitions to acted", async () => {
    const store = await seedQueue();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "secondary",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("acted");
  });

  it("dismiss transitions to dismissed", async () => {
    const store = await seedQueue();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "dismiss",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("dismissed");
  });

  it("rejects confirm/undo on queue surface", async () => {
    const store = await seedQueue();
    await expect(
      actOnRecommendation(store, {
        recommendationId: store.rows[0]!.id,
        orgId: "org-1",
        actor,
        action: "confirm",
      }),
    ).rejects.toThrow(/queue surface accepts/i);
  });

  it("returns already_terminal on second act", async () => {
    const store = await seedQueue();
    await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "primary",
    });
    const second = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "dismiss",
    });
    expect(second.status).toBe("already_terminal");
  });
});

describe("actOnRecommendation — shadow surface", () => {
  it("confirm transitions to confirmed", async () => {
    const store = await seedShadow();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "confirm",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("confirmed");
  });

  it("undo transitions to dismissed_by_undo", async () => {
    const store = await seedShadow();
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "undo",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.row.status).toBe("dismissed_by_undo");
  });

  it("rejects primary/secondary/dismiss on shadow surface", async () => {
    const store = await seedShadow();
    await expect(
      actOnRecommendation(store, {
        recommendationId: store.rows[0]!.id,
        orgId: "org-1",
        actor,
        action: "primary",
      }),
    ).rejects.toThrow(/shadow surface accepts/i);
  });

  it("undo after undoableUntil returns undo_window_closed", async () => {
    const store = await seedShadow();
    const row = store.rows[0]!;
    row.undoableUntil = new Date(Date.now() - 1000);
    const result = await actOnRecommendation(store, {
      recommendationId: row.id,
      orgId: "org-1",
      actor,
      action: "undo",
    });
    expect(result.status).toBe("undo_window_closed");
  });
});

describe("actOnRecommendation — boundary checks", () => {
  it("404 (returns null-ish) for missing id", async () => {
    const store = createInMemoryStore();
    await expect(
      actOnRecommendation(store, {
        recommendationId: "nope",
        orgId: "org-1",
        actor,
        action: "primary",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("403-equivalent on org mismatch", async () => {
    const store = await seedQueue();
    await expect(
      actOnRecommendation(store, {
        recommendationId: store.rows[0]!.id,
        orgId: "org-other",
        actor,
        action: "primary",
      }),
    ).rejects.toThrow(/org mismatch/i);
  });

  it("lazy expiry transitions to expired and returns expired status", async () => {
    const store = await seedQueue();
    store.rows[0]!.expiresAt = new Date(Date.now() - 1000);
    const result = await actOnRecommendation(store, {
      recommendationId: store.rows[0]!.id,
      orgId: "org-1",
      actor,
      action: "primary",
    });
    expect(result.status).toBe("expired");
    expect(store.rows[0]?.status).toBe("expired");
  });
});
