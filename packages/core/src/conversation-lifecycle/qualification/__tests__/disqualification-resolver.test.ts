import { describe, expect, it, vi } from "vitest";
import type {
  ConversationLifecycleSnapshot,
  ConversationLifecycleTransition,
} from "@switchboard/schemas";
import { DisqualificationResolver } from "../disqualification-resolver.js";

function setup(
  snapshot: ConversationLifecycleSnapshot | null,
  proposedEvidence: { priorQualificationStatus?: "unknown" | "unqualified" | "qualified" } = {
    priorQualificationStatus: "unknown",
  },
) {
  const snapshotStore = { read: vi.fn().mockResolvedValue(snapshot) };
  const transitionStore = {
    listForThread: vi.fn().mockResolvedValue([
      {
        id: "tr_1",
        organizationId: "o",
        conversationThreadId: "t",
        contactId: "c",
        fromState: snapshot?.currentState ?? null,
        toState: snapshot?.currentState ?? "active",
        trigger: "system_proposed_disqualification",
        evidence: proposedEvidence,
        actor: "alex",
        workTraceId: null,
        occurredAt: new Date(),
      } as ConversationLifecycleTransition,
    ]),
  };
  const writer = {
    recordTransition: vi.fn().mockResolvedValue(undefined),
    updateQualificationStatus: vi.fn().mockResolvedValue(undefined),
  };
  const resolver = new DisqualificationResolver({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshotStore: snapshotStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transitionStore: transitionStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writer: writer as any,
  });
  return { resolver, snapshotStore, transitionStore, writer };
}

const baseSnapshot: ConversationLifecycleSnapshot = {
  conversationThreadId: "t",
  organizationId: "o",
  contactId: "c",
  currentState: "active",
  qualificationStatus: "proposed_disqualified",
  bookingStatus: "not_booked",
  dropoffReason: null,
  lastTransitionAt: new Date(),
  lastEvaluatedAt: new Date(),
  updatedAt: new Date(),
};

describe("DisqualificationResolver.confirm", () => {
  it("advances currentState to disqualified when proposal is pending", async () => {
    const { resolver, writer } = setup(baseSnapshot);
    const out = await resolver.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "confirmed" });
    expect(writer.recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "disqualified",
        trigger: "operator_confirmed_disqualification",
      }),
    );
  });

  it("returns already_applied (idempotent) when thread is already disqualified AND has proposal lineage", async () => {
    const { resolver, writer } = setup({ ...baseSnapshot, currentState: "disqualified" });
    const out = await resolver.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "already_applied" });
    expect(writer.recordTransition).not.toHaveBeenCalled();
  });

  it("returns conflict already_disqualified when thread is disqualified but no proposal lineage exists", async () => {
    const snapshotStore = {
      read: vi.fn().mockResolvedValue({ ...baseSnapshot, currentState: "disqualified" }),
    };
    const transitionStore = { listForThread: vi.fn().mockResolvedValue([]) };
    const writer = {
      recordTransition: vi.fn().mockResolvedValue(undefined),
      updateQualificationStatus: vi.fn().mockResolvedValue(undefined),
    };
    const resolver = new DisqualificationResolver({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotStore: snapshotStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transitionStore: transitionStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writer: writer as any,
    });

    const out = await resolver.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "conflict", reason: "already_disqualified" });
    expect(writer.recordTransition).not.toHaveBeenCalled();
  });

  it("returns conflict already_booked when thread is booked", async () => {
    const { resolver } = setup({ ...baseSnapshot, currentState: "booked" });
    const out = await resolver.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "conflict", reason: "already_booked" });
  });

  it("returns not_found when no snapshot exists", async () => {
    const { resolver } = setup(null);
    const out = await resolver.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "not_found" });
  });

  it("returns not_proposed when qualificationStatus is not proposed_disqualified", async () => {
    const { resolver } = setup({ ...baseSnapshot, qualificationStatus: "qualified" });
    const out = await resolver.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "conflict", reason: "not_proposed" });
  });

  it("allows confirm from escalated", async () => {
    const { resolver, writer } = setup({ ...baseSnapshot, currentState: "escalated" });
    const out = await resolver.confirm({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "confirmed" });
    expect(writer.recordTransition).toHaveBeenCalled();
  });
});

describe("DisqualificationResolver.dismiss", () => {
  it("restores prior qualificationStatus from latest proposed_disqualification evidence", async () => {
    const { resolver, writer } = setup(
      { ...baseSnapshot, qualificationStatus: "proposed_disqualified" },
      { priorQualificationStatus: "qualified" },
    );
    const out = await resolver.dismiss({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "dismissed", restoredStatus: "qualified" });
    expect(writer.updateQualificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        toQualificationStatus: "qualified",
        trigger: "operator_dismissed_disqualification",
      }),
    );
  });

  it("returns conflict not_proposed when no pending proposal", async () => {
    const { resolver } = setup({ ...baseSnapshot, qualificationStatus: "qualified" });
    const out = await resolver.dismiss({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "conflict", reason: "not_proposed" });
  });

  it("defaults restoredStatus to 'unknown' when evidence omits priorQualificationStatus", async () => {
    const { resolver, writer } = setup({ ...baseSnapshot }, {});
    const out = await resolver.dismiss({
      organizationId: "o",
      conversationThreadId: "t",
      operatorId: "op_1",
    });
    expect(out).toEqual({ result: "dismissed", restoredStatus: "unknown" });
    expect(writer.updateQualificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({ toQualificationStatus: "unknown" }),
    );
  });
});
