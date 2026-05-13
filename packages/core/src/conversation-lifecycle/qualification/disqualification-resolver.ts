import type { LifecycleQualificationStatus } from "@switchboard/schemas";
import type { LifecycleSnapshotStore, LifecycleTransitionStore } from "../types.js";
import type { LifecycleWriter } from "../lifecycle-writer.js";

export interface DisqualificationResolverDeps {
  snapshotStore: Pick<LifecycleSnapshotStore, "read">;
  transitionStore: Pick<LifecycleTransitionStore, "listForThread">;
  writer: Pick<LifecycleWriter, "recordTransition" | "updateQualificationStatus">;
}

export type ConfirmResult =
  | { result: "confirmed" }
  | { result: "already_applied" }
  | { result: "not_found" }
  | { result: "conflict"; reason: "already_booked" | "not_proposed" | "already_disqualified" };

export type DismissResult =
  | { result: "dismissed"; restoredStatus: LifecycleQualificationStatus }
  | { result: "not_found" }
  | { result: "conflict"; reason: "not_proposed" };

export interface ResolveInput {
  organizationId: string;
  conversationThreadId: string;
  operatorId: string;
  operatorNote?: string;
}

export class DisqualificationResolver {
  constructor(private readonly deps: DisqualificationResolverDeps) {}

  async confirm(input: ResolveInput): Promise<ConfirmResult> {
    const snapshot = await this.deps.snapshotStore.read(input.conversationThreadId);
    if (snapshot === null) return { result: "not_found" };

    if (snapshot.currentState === "disqualified") {
      const proposalLineageId = await this.findLatestProposalTransitionId(
        input.conversationThreadId,
      );
      if (proposalLineageId !== null) return { result: "already_applied" };
      return { result: "conflict", reason: "already_disqualified" };
    }

    if (snapshot.currentState === "booked") {
      return { result: "conflict", reason: "already_booked" };
    }
    if (snapshot.qualificationStatus !== "proposed_disqualified") {
      return { result: "conflict", reason: "not_proposed" };
    }

    const proposalTransitionId = await this.findLatestProposalTransitionId(
      input.conversationThreadId,
    );

    await this.deps.writer.recordTransition({
      organizationId: input.organizationId,
      conversationThreadId: input.conversationThreadId,
      contactId: snapshot.contactId,
      toState: "disqualified",
      trigger: "operator_confirmed_disqualification",
      actor: "operator",
      evidence: {
        operatorId: input.operatorId,
        confirmedAt: new Date().toISOString(),
        operatorNote: input.operatorNote ?? null,
        proposalTransitionId,
      },
    });

    return { result: "confirmed" };
  }

  async dismiss(input: ResolveInput): Promise<DismissResult> {
    const snapshot = await this.deps.snapshotStore.read(input.conversationThreadId);
    if (snapshot === null) return { result: "not_found" };
    if (snapshot.qualificationStatus !== "proposed_disqualified") {
      return { result: "conflict", reason: "not_proposed" };
    }

    const proposalEvidence = await this.findLatestProposalEvidence(input.conversationThreadId);
    const restoredStatus: LifecycleQualificationStatus = isLifecycleQualificationStatus(
      proposalEvidence?.priorQualificationStatus,
    )
      ? proposalEvidence.priorQualificationStatus
      : "unknown";

    await this.deps.writer.updateQualificationStatus({
      organizationId: input.organizationId,
      conversationThreadId: input.conversationThreadId,
      contactId: snapshot.contactId,
      toQualificationStatus: restoredStatus,
      trigger: "operator_dismissed_disqualification",
      actor: "operator",
      evidence: {
        operatorId: input.operatorId,
        dismissedAt: new Date().toISOString(),
        operatorNote: input.operatorNote ?? null,
      },
    });

    return { result: "dismissed", restoredStatus };
  }

  private async findLatestProposalTransitionId(threadId: string): Promise<string | null> {
    const transitions = await this.deps.transitionStore.listForThread(threadId);
    for (let i = transitions.length - 1; i >= 0; i -= 1) {
      const t = transitions[i];
      if (t !== undefined && t.trigger === "system_proposed_disqualification") return t.id;
    }
    return null;
  }

  private async findLatestProposalEvidence(
    threadId: string,
  ): Promise<{ priorQualificationStatus?: LifecycleQualificationStatus } | null> {
    const transitions = await this.deps.transitionStore.listForThread(threadId);
    for (let i = transitions.length - 1; i >= 0; i -= 1) {
      const t = transitions[i];
      if (t !== undefined && t.trigger === "system_proposed_disqualification") {
        return t.evidence as { priorQualificationStatus?: LifecycleQualificationStatus };
      }
    }
    return null;
  }
}

function isLifecycleQualificationStatus(v: unknown): v is LifecycleQualificationStatus {
  return (
    v === "unknown" || v === "unqualified" || v === "qualified" || v === "proposed_disqualified"
  );
}
