import { describe, expect, it, vi } from "vitest";
import { LifecycleWriter } from "../lifecycle-writer.js";
import type { ConversationLifecycleSnapshot } from "@switchboard/schemas";

function makeWriterWithSnapshot(existing: ConversationLifecycleSnapshot | null) {
  const snapshotStore = {
    read: vi.fn().mockResolvedValue(existing),
    readInTransaction: vi.fn().mockResolvedValue(existing),
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
    resolveCapabilities: async () => new Set(["mechanical", "qualification"] as const),
  });
  return { writer, snapshotStore, transitionStore };
}

const base: Omit<ConversationLifecycleSnapshot, "qualificationStatus"> = {
  conversationThreadId: "t",
  organizationId: "o",
  contactId: "c",
  currentState: "active",
  bookingStatus: "not_booked",
  dropoffReason: null,
  lastTransitionAt: new Date("2026-05-12T00:00:00Z"),
  lastEvaluatedAt: new Date("2026-05-12T00:00:00Z"),
  updatedAt: new Date("2026-05-12T00:00:00Z"),
};

describe("updateQualificationStatus — monotonic guards", () => {
  it("accepts unknown → qualified", async () => {
    const { writer, snapshotStore, transitionStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "unknown",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "qualified",
      trigger: "qualification_checklist_met",
      actor: "alex",
      evidence: {},
    });
    expect(transitionStore.appendInTransaction).toHaveBeenCalled();
    expect(snapshotStore.upsertInTransaction).toHaveBeenCalled();
  });

  it("silently no-ops qualified → unqualified (no transition, no upsert)", async () => {
    const { writer, snapshotStore, transitionStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "qualified",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "unqualified",
      trigger: "qualification_checklist_failed",
      actor: "alex",
      evidence: {},
    });
    expect(transitionStore.appendInTransaction).not.toHaveBeenCalled();
    expect(snapshotStore.upsertInTransaction).not.toHaveBeenCalled();
  });

  it("silently no-ops proposed_disqualified → qualified via sidecar", async () => {
    const { writer, transitionStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "proposed_disqualified",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "qualified",
      trigger: "qualification_checklist_met",
      actor: "alex",
      evidence: {},
    });
    expect(transitionStore.appendInTransaction).not.toHaveBeenCalled();
  });

  it("operator dismiss restores prior status from evidence", async () => {
    const { writer, snapshotStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "proposed_disqualified",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "qualified",
      trigger: "operator_dismissed_disqualification",
      actor: "operator",
      evidence: { priorQualificationStatus: "qualified" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upsertArg = snapshotStore.upsertInTransaction.mock.calls[0]?.[1] as any;
    expect(upsertArg.qualificationStatus).toBe("qualified");
  });

  it("system_proposed_disqualification on qualified thread writes proposed_disqualified", async () => {
    const { writer, snapshotStore } = makeWriterWithSnapshot({
      ...base,
      qualificationStatus: "qualified",
    });
    await writer.updateQualificationStatus({
      organizationId: "o",
      conversationThreadId: "t",
      contactId: "c",
      toQualificationStatus: "proposed_disqualified",
      trigger: "system_proposed_disqualification",
      actor: "alex",
      evidence: { candidateType: "out_of_area", evidenceQuote: "lives in NY" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upsertArg = snapshotStore.upsertInTransaction.mock.calls[0]?.[1] as any;
    expect(upsertArg.qualificationStatus).toBe("proposed_disqualified");
  });
});
