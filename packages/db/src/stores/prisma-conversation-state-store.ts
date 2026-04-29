import { createHash, randomUUID } from "node:crypto";
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
import {
  ConversationStateNotFoundError,
  ConversationStateInvalidTransitionError,
} from "@switchboard/core/platform";
import type { PrismaWorkTraceStore } from "./prisma-work-trace-store.js";

function bodyHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function redactedPreview(text: string, max = 80): string {
  // Strip ASCII control chars (0x00-0x1F + 0x7F DEL); persisted message text is
  // unaltered — only the trace preview is sanitized. Built via RegExp(string, "g")
  // so the source file stays plain ASCII (file(1)/prettier/grep treat as text).
  // eslint-disable-next-line no-control-regex -- intentional: sanitizing user input
  const CONTROL_CHARS = new RegExp("[\\x00-\\x1F\\x7F]", "g");
  const stripped = text.replace(CONTROL_CHARS, "");
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped;
}

function safeMessages(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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

  async sendOperatorMessage(input: SendOperatorMessageInput): Promise<SendOperatorMessageResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversationState.findFirst({
        where: { threadId: input.threadId, organizationId: input.organizationId },
      });
      if (!existing) throw new ConversationStateNotFoundError(input.threadId);
      if (existing.status !== "human_override") {
        throw new ConversationStateInvalidTransitionError(
          `Conversation ${existing.id} must be in human_override to send operator messages (current: ${existing.status})`,
        );
      }

      const requestedAt = new Date();
      const ownerMessage = {
        role: "owner" as const,
        text: input.message.text,
        timestamp: requestedAt.toISOString(),
      };
      const nextMessages = [...safeMessages(existing.messages), ownerMessage];

      await tx.conversationState.update({
        where: { id: existing.id },
        data: {
          messages: nextMessages as unknown as Prisma.InputJsonValue,
          lastActivityAt: requestedAt,
        },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "conversation.message.send",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "api",
        parameters: {
          actionKind: "conversation.message.send",
          orgId: input.organizationId,
          conversationId: existing.id,
          before: { status: existing.status },
          after: { status: existing.status }, // status unchanged on send
          message: {
            channel: existing.channel,
            destination: existing.principalId,
            redactedPreview: redactedPreview(input.message.text),
            bodyHash: bodyHash(input.message.text),
            deliveryAttempted: false,
          },
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running",
        durationMs: 0,
        executionSummary: `operator ${input.operator.id} sent message on conversation ${existing.id}`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return {
        conversationId: existing.id,
        threadId: existing.threadId,
        channel: existing.channel,
        destinationPrincipalId: existing.principalId,
        workTraceId: workUnitId,
        appendedMessage: ownerMessage,
      };
    });
  }

  async releaseEscalationToAi(input: ReleaseEscalationInput): Promise<ReleaseEscalationResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversationState.findFirst({
        where: { threadId: input.threadId, organizationId: input.organizationId },
      });
      if (!existing) throw new ConversationStateNotFoundError(input.threadId);

      const requestedAt = new Date();
      const ownerReply = {
        role: "owner" as const,
        text: input.reply.text,
        timestamp: requestedAt.toISOString(),
      };
      const before = { status: existing.status };
      const after = { status: "active" };
      const nextMessages = [...safeMessages(existing.messages), ownerReply];

      await tx.conversationState.update({
        where: { id: existing.id },
        data: {
          status: "active",
          messages: nextMessages as unknown as Prisma.InputJsonValue,
          lastActivityAt: requestedAt,
        },
      });

      const workUnitId = randomUUID();
      const trace: WorkTrace = {
        workUnitId,
        traceId: workUnitId,
        intent: "escalation.reply.release_to_ai",
        mode: "operator_mutation",
        organizationId: input.organizationId,
        actor: input.operator,
        trigger: "api",
        parameters: {
          actionKind: "escalation.reply.release_to_ai",
          orgId: input.organizationId,
          conversationId: existing.id,
          escalationId: input.handoffId,
          before,
          after,
          message: {
            channel: existing.channel,
            destination: existing.principalId,
            redactedPreview: redactedPreview(input.reply.text),
            bodyHash: bodyHash(input.reply.text),
            deliveryAttempted: false,
          },
        },
        governanceOutcome: "execute",
        riskScore: 0,
        matchedPolicies: [],
        outcome: "running",
        durationMs: 0,
        executionSummary: `operator ${input.operator.id} released escalation ${input.handoffId} on conversation ${existing.id}`,
        modeMetrics: { governanceMode: "operator_auto_allow" },
        ingressPath: "store_recorded_operator_mutation",
        hashInputVersion: 2,
        requestedAt: requestedAt.toISOString(),
        governanceCompletedAt: requestedAt.toISOString(),
      };

      await this.workTraceStore.recordOperatorMutation(trace, {
        tx: tx as Prisma.TransactionClient,
      });

      return {
        conversationId: existing.id,
        threadId: existing.threadId,
        channel: existing.channel,
        destinationPrincipalId: existing.principalId,
        workTraceId: workUnitId,
        appendedReply: ownerReply,
      };
    });
  }
}
