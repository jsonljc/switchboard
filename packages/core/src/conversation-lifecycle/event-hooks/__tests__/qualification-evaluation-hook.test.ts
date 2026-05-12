import { describe, expect, it, vi } from "vitest";
import type {
  QualificationSignals,
  ConversationLifecycleSnapshot,
  Playbook,
} from "@switchboard/schemas";
import { QualificationEvaluationHook } from "../qualification-evaluation-hook.js";

const validSignals: QualificationSignals = {
  treatmentInterest: "HIFU",
  preferredTimeWindow: null,
  serviceableMarket: "SG",
  buyingIntent: "soft",
  budgetAcknowledged: null,
  explicitDecline: false,
  disqualifierCandidates: [],
};

const baseSnapshot: ConversationLifecycleSnapshot = {
  conversationThreadId: "t",
  organizationId: "o",
  contactId: "c",
  currentState: "active",
  qualificationStatus: "unknown",
  bookingStatus: "not_booked",
  dropoffReason: null,
  lastTransitionAt: new Date(),
  lastEvaluatedAt: new Date(),
  updatedAt: new Date(),
};

function setup({
  snapshot,
  playbookServices = ["HIFU"],
  capabilities = new Set(["mechanical", "qualification"] as const),
}: {
  snapshot: ConversationLifecycleSnapshot | null;
  playbookServices?: string[];
  capabilities?: ReadonlySet<"mechanical" | "qualification">;
}) {
  const writer = {
    recordTransition: vi.fn().mockResolvedValue(undefined),
    updateQualificationStatus: vi.fn().mockResolvedValue(undefined),
  };
  const snapshotStore = { read: vi.fn().mockResolvedValue(snapshot) };
  const playbookReader = {
    readForOrganization: vi.fn().mockResolvedValue({
      services: playbookServices.map((name, i) => ({
        id: `svc_${i}`,
        name,
        bookingBehavior: "ask_first",
        status: "complete",
        source: "manual",
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as Playbook),
  };
  const configResolver = { resolveCapabilities: vi.fn().mockResolvedValue(capabilities) };

  const hook = new QualificationEvaluationHook({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writer: writer as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshotStore: snapshotStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    playbookReader: playbookReader as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configResolver: configResolver as any,
  });

  return { hook, writer, snapshotStore, playbookReader, configResolver };
}

describe("QualificationEvaluationHook", () => {
  it("no-ops entirely when qualification capability is off", async () => {
    const { hook, writer } = setup({
      snapshot: baseSnapshot,
      capabilities: new Set(["mechanical"] as const),
    });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: validSignals,
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).not.toHaveBeenCalled();
    expect(writer.updateQualificationStatus).not.toHaveBeenCalled();
  });

  it("writes qualified when rule passes", async () => {
    const { hook, writer } = setup({ snapshot: baseSnapshot });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: validSignals,
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "qualified",
        trigger: "qualification_checklist_met",
      }),
    );
  });

  it("writes proposed_disqualified with evidence including priorQualificationStatus", async () => {
    const { hook, writer } = setup({
      snapshot: { ...baseSnapshot, qualificationStatus: "qualified" },
    });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: {
        ...validSignals,
        disqualifierCandidates: [{ type: "out_of_area", evidence: "lives in NY" }],
      },
      workTraceId: "wt_1",
    });
    expect(writer.updateQualificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        toQualificationStatus: "proposed_disqualified",
        trigger: "system_proposed_disqualification",
        evidence: expect.objectContaining({ priorQualificationStatus: "qualified" }),
      }),
    );
  });

  it("does not qualify on unresolved treatmentInterest", async () => {
    const { hook, writer } = setup({ snapshot: baseSnapshot, playbookServices: [] });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: validSignals,
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).not.toHaveBeenCalled();
  });

  it("does not write a transition on a non-trivial-but-unqualified sidecar (no qualified, no proposed)", async () => {
    const { hook, writer } = setup({ snapshot: baseSnapshot });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: { ...validSignals, buyingIntent: "none" },
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).not.toHaveBeenCalled();
    expect(writer.updateQualificationStatus).not.toHaveBeenCalled();
  });

  it("no-ops when snapshot is missing", async () => {
    const { hook, writer } = setup({ snapshot: null });
    await hook.onSidecarEmitted({
      organizationId: "o",
      conversationThreadId: "t",
      signals: validSignals,
      workTraceId: "wt_1",
    });
    expect(writer.recordTransition).not.toHaveBeenCalled();
  });
});
