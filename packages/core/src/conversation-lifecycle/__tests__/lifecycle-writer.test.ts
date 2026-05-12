import { describe, expect, it, vi } from "vitest";
import { LifecycleWriter } from "../lifecycle-writer.js";
import type { LifecycleSnapshotStore, LifecycleTransitionStore } from "../types.js";

function makeStores() {
  const snapshots = new Map<string, any>();
  const transitions: any[] = [];
  const snapshotStore: LifecycleSnapshotStore = {
    read: vi.fn(async (id) => snapshots.get(id) ?? null),
    readInTransaction: vi.fn(async (_tx, id) => snapshots.get(id) ?? null),
    upsertInTransaction: vi.fn(async (_tx, snap) => {
      snapshots.set(snap.conversationThreadId, snap);
    }),
  };
  const transitionStore: LifecycleTransitionStore = {
    appendInTransaction: vi.fn(async (_tx, t) => {
      transitions.push({ ...t, id: `t-${transitions.length + 1}` });
    }),
    listForThread: vi.fn(async (id) => transitions.filter((t) => t.conversationThreadId === id)),
  };
  const runInTransaction = async <T>(fn: (tx: unknown) => Promise<T>) => fn({});
  return { snapshotStore, transitionStore, runInTransaction, snapshots, transitions };
}

describe("LifecycleWriter.recordTransition", () => {
  it("creates the initial snapshot when none exists (null → active seed)", async () => {
    // Plan said `null → stalled`, but Task-6 precedence forbids null → stalled
    // (thread-init seeds via onThreadFirstObservation → 'active' before the cron
    // can ever fire). Use an allowed null-init state instead.
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "active",
      trigger: "inbound_after_stalled",
      actor: "system",
      evidence: {},
    });
    expect(snapshots.get("thread-1")?.currentState).toBe("active");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromState).toBeNull();
    expect(transitions[0].toState).toBe("active");
  });

  it("precedence blocks null → stalled (cron cannot invent a stalled snapshot)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      actor: "system",
      evidence: { hours_since_outbound: 25 },
    });
    expect(snapshots.get("thread-1")).toBeUndefined();
    expect(transitions).toHaveLength(0);
  });

  it("respects precedence — does not overwrite booked with stalled", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeStores();
    const now = new Date();
    snapshots.set("thread-1", {
      conversationThreadId: "thread-1",
      organizationId: "org-1",
      contactId: "contact-1",
      currentState: "booked",
      qualificationStatus: "unknown",
      bookingStatus: "booked",
      dropoffReason: null,
      lastTransitionAt: now,
      lastEvaluatedAt: now,
      updatedAt: now,
    });
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      actor: "system",
      evidence: {},
    });
    expect(snapshots.get("thread-1")?.currentState).toBe("booked");
    expect(transitions).toHaveLength(0);
  });

  it("allows escalated → booked (operator closes booking)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeStores();
    const now = new Date();
    snapshots.set("thread-1", {
      conversationThreadId: "thread-1",
      organizationId: "org-1",
      contactId: "contact-1",
      currentState: "escalated",
      qualificationStatus: "unknown",
      bookingStatus: "not_booked",
      dropoffReason: null,
      lastTransitionAt: now,
      lastEvaluatedAt: now,
      updatedAt: now,
    });
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "booked",
      trigger: "booking_event_received",
      actor: "integration",
      evidence: { booking_id: "b-1" },
    });
    expect(snapshots.get("thread-1")?.currentState).toBe("booked");
    expect(snapshots.get("thread-1")?.bookingStatus).toBe("booked");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].fromState).toBe("escalated");
  });

  it("rejects 3b-only toState (disqualified) with a runtime error", async () => {
    const { snapshotStore, transitionStore, runInTransaction } = makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await expect(
      writer.recordTransition({
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toState: "disqualified" as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trigger: "operator_confirmed_disqualification" as any,
        actor: "operator",
        evidence: {},
      }),
    ).rejects.toThrow(/THREE_A_ALLOWED_STATES/);
  });

  it("rejects 3b-only trigger (qualification_checklist_met) with a runtime error", async () => {
    const { snapshotStore, transitionStore, runInTransaction } = makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await expect(
      writer.recordTransition({
        organizationId: "org-1",
        conversationThreadId: "thread-1",
        contactId: "contact-1",
        toState: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trigger: "qualification_checklist_met" as any,
        actor: "system",
        evidence: {},
      }),
    ).rejects.toThrow(/THREE_A_ALLOWED_TRIGGERS/);
  });

  it("rebuilds snapshot from transition log (round-trip)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots } = makeStores();
    const writer = new LifecycleWriter({ snapshotStore, transitionStore, runInTransaction });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      actor: "system",
      evidence: {},
    });
    await writer.recordTransition({
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      toState: "active",
      trigger: "inbound_after_stalled",
      actor: "system",
      evidence: {},
    });
    const liveCurrent = snapshots.get("thread-1")?.currentState;
    snapshots.delete("thread-1");
    const rebuilt = await writer.rebuildSnapshotFromTransitions("thread-1");
    expect(rebuilt?.currentState).toBe(liveCurrent);
  });
});
