// packages/core/src/conversation-lifecycle/__tests__/integration.test.ts
import { describe, expect, it, vi } from "vitest";
import { LifecycleWriter } from "../lifecycle-writer.js";
import { ReEngagementAttributor } from "../re-engagement-attributor.js";
import { onGovernanceVerdictWritten } from "../event-hooks/governance-verdict-escalation-hook.js";
import { onBookingCreated } from "../event-hooks/booking-created-hook.js";
import { onInboundMessage } from "../event-hooks/inbound-message-hook.js";
import { onOperatorTakeover } from "../event-hooks/operator-takeover-hook.js";
import { runStalledSweep } from "../cron/stalled-sweep.js";

function makeInMemoryStores() {
  const snapshots = new Map<string, any>();
  const transitions: any[] = [];
  const snapshotStore = {
    read: async (id: string) => snapshots.get(id) ?? null,
    readInTransaction: async (_tx: unknown, id: string) => snapshots.get(id) ?? null,
    upsertInTransaction: async (_tx: unknown, snap: any) => {
      snapshots.set(snap.conversationThreadId, snap);
    },
  };
  const transitionStore = {
    appendInTransaction: async (_tx: unknown, t: any) => {
      transitions.push(t);
    },
    listForThread: async (id: string) => transitions.filter((t) => t.conversationThreadId === id),
  };
  const runInTransaction = async <T>(fn: (tx: unknown) => Promise<T>) => fn({});
  return { snapshotStore, transitionStore, runInTransaction, snapshots, transitions };
}

describe("end-to-end mechanical lifecycle", () => {
  it("active → escalated (governance) → booked (operator closes booking)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeInMemoryStores();
    const writer = new LifecycleWriter({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore: snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transitionStore: transitionStore as any,
      runInTransaction,
    });
    const readMode = async () => "on" as const;

    await onGovernanceVerdictWritten(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      verdictId: "v-1",
      action: "escalate",
      reasonCode: "regulated_claim_unsubstantiated",
    });
    expect(snapshots.get("t-1")?.currentState).toBe("escalated");

    await onBookingCreated(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      bookingId: "b-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(snapshots.get("t-1")?.currentState).toBe("booked");
    expect(snapshots.get("t-1")?.bookingStatus).toBe("booked");
    expect(transitions.map((t) => t.toState)).toEqual(["escalated", "booked"]);
  });

  it("active → stalled (cron) → active (re-engagement attribution) → booked", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots, transitions } =
      makeInMemoryStores();
    const writer = new LifecycleWriter({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore: snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transitionStore: transitionStore as any,
      runInTransaction,
    });
    const readMode = async () => "on" as const;
    const history = { read: vi.fn() };
    const verdicts = { findReEngagementVerdict: vi.fn() };

    snapshots.set("t-1", {
      conversationThreadId: "t-1",
      organizationId: "org-1",
      contactId: "c-1",
      currentState: "active",
      qualificationStatus: "unknown",
      bookingStatus: "not_booked",
      dropoffReason: null,
      lastTransitionAt: new Date("2026-05-10T09:00:00Z"),
      lastEvaluatedAt: new Date("2026-05-10T09:00:00Z"),
      updatedAt: new Date("2026-05-10T09:00:00Z"),
    });

    history.read.mockResolvedValue({
      lastOutboundAt: new Date("2026-05-10T09:05:00Z"),
      lastInboundAt: new Date("2026-05-10T09:00:00Z"),
    });
    await runStalledSweep({
      writer,
      listNonTerminalSnapshots: async () => [
        {
          conversationThreadId: "t-1",
          organizationId: "org-1",
          contactId: "c-1",
          currentState: "active",
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history: history as any,
      readMode,
      now: new Date("2026-05-12T12:00:00Z"),
    });
    expect(snapshots.get("t-1")?.currentState).toBe("stalled");

    verdicts.findReEngagementVerdict.mockResolvedValue({
      verdictId: "v-1",
      templateName: "re_engagement_offer_sg_v1",
      decidedAt: new Date("2026-05-12T08:00:00Z"),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attributor = new ReEngagementAttributor(verdicts as any);
    await onInboundMessage(
      writer,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore as any,
      attributor,
      readMode,
      {
        organizationId: "org-1",
        conversationThreadId: "t-1",
        contactId: "c-1",
        receivedAt: new Date("2026-05-12T16:00:00Z"),
      },
    );
    expect(snapshots.get("t-1")?.currentState).toBe("active");

    await onBookingCreated(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      bookingId: "b-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(snapshots.get("t-1")?.currentState).toBe("booked");

    expect(transitions.map((t) => t.toState)).toEqual(["stalled", "active", "booked"]);
    expect(transitions[1].trigger).toBe("inbound_after_re_engagement_template");
    expect(transitions[1].evidence.template_name).toBe("re_engagement_offer_sg_v1");
    expect(transitions[1].evidence.governance_verdict_id).toBe("v-1");
  });

  it("THREE_A_ALLOWED_STATES enforcement — no 3a hook ever produces disqualified", async () => {
    const { snapshotStore, transitionStore, runInTransaction, transitions } = makeInMemoryStores();
    const writer = new LifecycleWriter({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore: snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transitionStore: transitionStore as any,
      runInTransaction,
    });
    const readMode = async () => "on" as const;

    await onGovernanceVerdictWritten(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      verdictId: "v-1",
      action: "escalate",
      reasonCode: "anything",
    });
    await onBookingCreated(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      bookingId: "b-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });

    const forbiddenStates = new Set(["disqualified", "qualified"]);
    const forbiddenTriggers = new Set([
      "qualification_checklist_met",
      "qualification_checklist_failed",
      "system_proposed_disqualification",
      "operator_confirmed_disqualification",
      "operator_dismissed_disqualification",
    ]);
    for (const t of transitions) {
      expect(forbiddenStates.has(t.toState)).toBe(false);
      expect(forbiddenTriggers.has(t.trigger)).toBe(false);
    }
  });

  it("operator takeover → escalated, then booking closes → booked (attribution preserved)", async () => {
    const { snapshotStore, transitionStore, runInTransaction, snapshots } = makeInMemoryStores();
    const writer = new LifecycleWriter({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore: snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transitionStore: transitionStore as any,
      runInTransaction,
    });
    const readMode = async () => "on" as const;

    await onOperatorTakeover(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      operatorId: "op-1",
      takenAt: new Date(),
    });
    expect(snapshots.get("t-1")?.currentState).toBe("escalated");

    await onBookingCreated(writer, readMode, {
      organizationId: "org-1",
      conversationThreadId: "t-1",
      contactId: "c-1",
      bookingId: "b-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(snapshots.get("t-1")?.currentState).toBe("booked");
  });
});
