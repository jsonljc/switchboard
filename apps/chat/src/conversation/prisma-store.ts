import type { PrismaClient } from "@switchboard/db";
import type { ConversationState, ConversationMessage } from "./state.js";
import type { ConversationStore } from "./store.js";
import type { ConversationStatus } from "@switchboard/schemas";

/**
 * Prisma-backed ConversationStore. All reads/writes are scoped by
 * `(threadId, organizationId)` for tenant isolation (TI-5/TI-6).
 *
 * `listActiveAcrossAllTenants()` is a recovery-only path (e.g. system-startup
 * orchestration) — request handlers MUST use the org-scoped `listActive`.
 */
export class PrismaConversationStore implements ConversationStore {
  constructor(private prisma: PrismaClient) {}

  async get(threadId: string, organizationId: string): Promise<ConversationState | undefined> {
    // findFirst (not findUnique) because we are scoping by (threadId, organizationId)
    // even though threadId is @unique — this prevents stale cross-tenant rows from
    // leaking when organizationId on the row is null or differs.
    const row = await this.prisma.conversationState.findFirst({
      where: { threadId, organizationId },
    });
    if (!row) return undefined;
    return toConversationStateData(row as PrismaConversationRow);
  }

  async save(state: ConversationState): Promise<void> {
    // Tenant isolation (audit #2): this store is org-scoped by contract (TI-5/TI-6)
    // and the write keys on the per-org compound unique (organizationId, threadId),
    // which cannot take a null org. Reject a null org rather than emit an unkeyable
    // write (Prisma rejects null in a compound-unique WHERE) or a duplicate inert
    // row. The `upsert as Function` cast below (needed for the pre-migration
    // lastInboundAt column) would otherwise hide this at compile time.
    if (state.organizationId === null) {
      throw new Error(
        "PrismaConversationStore.save requires a non-null organizationId (tenant isolation)",
      );
    }

    // Use raw upsert to handle lastInboundAt column which may not yet exist
    // in the generated Prisma client (added via migration).
    const data = {
      id: state.id,
      threadId: state.threadId,
      channel: state.channel,
      principalId: state.principalId,
      organizationId: state.organizationId,
      status: state.status,
      currentIntent: state.currentIntent,
      pendingProposalIds: state.pendingProposalIds,
      pendingApprovalIds: state.pendingApprovalIds,
      clarificationQuestion: state.clarificationQuestion,
      messages: JSON.stringify(state.messages),
      firstReplyAt: state.firstReplyAt,
      lastInboundAt: state.lastInboundAt,
      lastActivityAt: state.lastActivityAt,
      expiresAt: state.expiresAt,
    };

    // Sticky human_override guard: if the existing row has status="human_override"
    // and the incoming save carries a different status, preserve the override.
    // This prevents lifecycle code (e.g. status→"active" on next message) from
    // silently clobbering a safety gate escalation. An explicit save with
    // status="human_override" is always allowed (the guard passes through).
    // Org-scoped (audit #2): threadId is unique PER ORG, so the sticky-override
    // read must match this tenant's row — never another org's that shares the phone.
    const existing = await this.prisma.conversationState.findFirst({
      where: { threadId: state.threadId, organizationId: state.organizationId },
      select: { status: true },
    });
    const finalStatus =
      existing?.status === "human_override" && data.status !== "human_override"
        ? existing.status
        : data.status;

    // eslint-disable-next-line @typescript-eslint/ban-types -- Prisma types may not include lastInboundAt pre-migration
    await (this.prisma.conversationState.upsert as Function)({
      where: {
        organizationId_threadId: {
          organizationId: state.organizationId,
          threadId: state.threadId,
        },
      },
      create: data,
      update: {
        status: finalStatus,
        currentIntent: data.currentIntent,
        organizationId: data.organizationId,
        pendingProposalIds: data.pendingProposalIds,
        pendingApprovalIds: data.pendingApprovalIds,
        clarificationQuestion: data.clarificationQuestion,
        messages: data.messages,
        firstReplyAt: data.firstReplyAt,
        lastInboundAt: data.lastInboundAt,
        lastActivityAt: data.lastActivityAt,
        expiresAt: data.expiresAt,
      },
    });
  }

  async delete(threadId: string, organizationId: string): Promise<void> {
    await this.prisma.conversationState.deleteMany({
      where: { threadId, organizationId },
    });
  }

  async listActive(organizationId: string): Promise<ConversationState[]> {
    const rows = await this.prisma.conversationState.findMany({
      where: {
        organizationId,
        status: { notIn: ["completed", "expired"] },
      },
    });
    return (rows as PrismaConversationRow[]).map(toConversationStateData);
  }

  /**
   * Recovery-only: returns active conversations across ALL tenants. Intended for
   * system-startup orchestrators (e.g. resuming pending escalations after a restart).
   * Request-path code MUST NOT call this — use `listActive(organizationId)`.
   */
  async listActiveAcrossAllTenants(): Promise<ConversationState[]> {
    const rows = await this.prisma.conversationState.findMany({
      where: {
        status: { notIn: ["completed", "expired"] },
      },
    });
    return (rows as PrismaConversationRow[]).map(toConversationStateData);
  }
}

/** Raw Prisma row shape — includes lastInboundAt which may be absent pre-migration. */
interface PrismaConversationRow {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  organizationId: string | null;
  status: string;
  currentIntent: string | null;
  pendingProposalIds: string[];
  pendingApprovalIds: string[];
  clarificationQuestion: string | null;
  messages: unknown;
  firstReplyAt: Date | null;
  lastInboundAt?: Date | null;
  lastActivityAt: Date;
  expiresAt: Date;
}

function parseMessages(raw: unknown): ConversationMessage[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ConversationMessage[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ConversationMessage[];
    } catch {
      return [];
    }
  }
  return [];
}

function toConversationStateData(row: PrismaConversationRow): ConversationState {
  return {
    id: row.id,
    threadId: row.threadId,
    channel: row.channel,
    principalId: row.principalId,
    organizationId: row.organizationId,
    status: row.status as ConversationStatus,
    currentIntent: row.currentIntent,
    pendingProposalIds: row.pendingProposalIds,
    pendingApprovalIds: row.pendingApprovalIds,
    clarificationQuestion: row.clarificationQuestion,
    messages: parseMessages(row.messages),
    firstReplyAt: row.firstReplyAt,
    lastInboundAt: row.lastInboundAt ?? null,
    lastActivityAt: row.lastActivityAt,
    expiresAt: row.expiresAt,
    crmContactId: null,
    leadProfile: null,
    detectedLanguage: null,
    machineState: null,
  };
}
