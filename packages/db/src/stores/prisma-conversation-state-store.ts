import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  ConversationStateStore,
  SetOverrideInput,
  SetOverrideResult,
  SendOperatorMessageInput,
  SendOperatorMessageResult,
  ReleaseEscalationInput,
  ReleaseEscalationResult,
  WorkTrace,
} from "@switchboard/core/platform";
import { ConversationStateNotFoundError } from "@switchboard/core/platform";
import type { PrismaWorkTraceStore } from "./prisma-work-trace-store.js";

export class PrismaConversationStateStore implements ConversationStateStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workTraceStore: PrismaWorkTraceStore,
  ) {}

  async setOverride(input: SetOverrideInput): Promise<SetOverrideResult> {
    // Per spec §4.7.1: persist the initial trace as outcome="running" inside the
    // outer tx (atomic with the conversation mutation), then finalize via
    // workTraceStore.update AFTER the tx commits. The finalize update is what
    // stamps lockedAt and seals the row.
    const requestedAt = new Date();
    const executionStartedAt = new Date();

    const txResult = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversationState.findFirst({
        where: { threadId: input.threadId, organizationId: input.organizationId },
      });
      if (!existing) throw new ConversationStateNotFoundError(input.threadId);

      const before = { status: existing.status };
      const nextStatus = input.override ? "human_override" : "active";
      const after = { status: nextStatus };

      const updated = await tx.conversationState.update({
        where: { id: existing.id },
        data: { status: nextStatus, lastActivityAt: requestedAt },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "conversation.override.set",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "api",
        parameters: {
          actionKind: "conversation.override.set",
          orgId: input.organizationId,
          conversationId: existing.id,
          before,
          after,
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running", // non-terminal at persist; finalized below
        durationMs: 0, // finalized below
        executionSummary: `operator ${input.operator.id} set override=${input.override} on conversation ${existing.id}`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
        // executionStartedAt + completedAt left undefined; set on finalize.
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return { workUnitId, updated };
    });

    // Finalize: separate transaction. If this fails, the trace row exists as
    // "running" permanently — the conversation mutation already happened, which
    // is the audit-critical invariant. See spec §4.7.1 / §10.2.
    const completedAt = new Date();
    const finalizeResult = await this.workTraceStore.update(
      txResult.workUnitId,
      {
        outcome: "completed",
        executionStartedAt: executionStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - executionStartedAt.getTime()),
      },
      { caller: "ConversationStateStore.setOverride" },
    );
    if (!finalizeResult.ok) {
      console.warn(
        `[conversation-state-store] setOverride finalize rejected for ${txResult.workUnitId}: ${finalizeResult.reason}`,
      );
    }

    return {
      conversationId: txResult.updated.id,
      threadId: txResult.updated.threadId,
      status: txResult.updated.status,
      workTraceId: txResult.workUnitId,
    };
  }

  sendOperatorMessage(_input: SendOperatorMessageInput): Promise<SendOperatorMessageResult> {
    throw new Error("not implemented (Task 10)");
  }

  releaseEscalationToAi(_input: ReleaseEscalationInput): Promise<ReleaseEscalationResult> {
    throw new Error("not implemented (Task 11)");
  }
}
