import { describe, expect, it, vi } from "vitest";
import { LifecycleWriter } from "../lifecycle-writer.js";
import { LifecycleCapabilityDenied } from "../errors.js";

function makeWriter(caps: ReadonlySet<"mechanical" | "qualification">) {
  const snapshotStore = {
    read: vi.fn().mockResolvedValue(null),
    readInTransaction: vi.fn().mockResolvedValue(null),
    upsertInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const transitionStore = {
    appendInTransaction: vi.fn().mockResolvedValue(undefined),
    listForThread: vi.fn().mockResolvedValue([]),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runInTransaction = async (fn: any) => fn({});
  const writer = new LifecycleWriter({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshotStore: snapshotStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transitionStore: transitionStore as any,
    runInTransaction,
    resolveCapabilities: async () => caps,
  });
  return { writer, snapshotStore, transitionStore };
}

describe("LifecycleWriter — capability gating", () => {
  it("mechanical-only writer rejects qualified toState with LifecycleCapabilityDenied", async () => {
    const { writer } = makeWriter(new Set(["mechanical"] as const));
    await expect(
      writer.recordTransition({
        organizationId: "o",
        conversationThreadId: "t",
        contactId: "c",
        toState: "qualified",
        trigger: "qualification_checklist_met",
        actor: "alex",
        evidence: {},
      }),
    ).rejects.toBeInstanceOf(LifecycleCapabilityDenied);
  });

  it("union writer accepts qualified toState + qualification trigger", async () => {
    const { writer, snapshotStore } = makeWriter(new Set(["mechanical", "qualification"] as const));
    // Provide an existing snapshot so the transition from active → qualified is allowed by precedence
    snapshotStore.readInTransaction.mockResolvedValue({
      conversationThreadId: "t",
      organizationId: "o",
      contactId: "c",
      currentState: "active",
      qualificationStatus: "unknown",
      bookingStatus: "not_booked",
      dropoffReason: null,
      lastTransitionAt: new Date("2026-05-12T00:00:00Z"),
      lastEvaluatedAt: new Date("2026-05-12T00:00:00Z"),
      updatedAt: new Date("2026-05-12T00:00:00Z"),
    });
    await writer.recordTransition({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toState: "qualified",
      trigger: "qualification_checklist_met",
      actor: "alex",
      evidence: {},
    });
    expect(snapshotStore.upsertInTransaction).toHaveBeenCalled();
  });

  it("qualification-only writer rejects mechanical trigger like timer_24h_no_inbound", async () => {
    const { writer } = makeWriter(new Set(["qualification"] as const));
    await expect(
      writer.recordTransition({
        organizationId: "o",
        conversationThreadId: "t",
        contactId: "c",
        toState: "stalled",
        trigger: "timer_24h_no_inbound",
        actor: "system",
        evidence: {},
      }),
    ).rejects.toBeInstanceOf(LifecycleCapabilityDenied);
  });
});
