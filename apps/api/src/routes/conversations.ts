import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MessageEntry {
  role: string;
  text: string;
  timestamp: string;
}

interface ConversationRow {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  organizationId: string | null;
  status: string;
  currentIntent: string | null;
  messages: unknown;
  firstReplyAt: Date | null;
  lastActivityAt: Date;
}

export interface ConversationSummary {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  organizationId: string | null;
  status: string;
  currentIntent: string | null;
  messageCount: number;
  lastMessage: string | null;
  firstReplyAt: string | null;
  lastActivityAt: string;
}

export interface ConversationDetail {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  organizationId: string | null;
  status: string;
  currentIntent: string | null;
  firstReplyAt: string | null;
  lastActivityAt: string;
  messages: MessageEntry[];
}

export interface ConversationListResult {
  conversations: ConversationSummary[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function safeParseMessages(raw: unknown): MessageEntry[] {
  if (Array.isArray(raw)) return raw as MessageEntry[];
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MessageEntry[]) : [];
  } catch {
    return [];
  }
}

function lastMessagePreview(messages: MessageEntry[]): string | null {
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1];
  return last ? (last.text ?? null) : null;
}

// ---------------------------------------------------------------------------
// Testable business-logic functions
// ---------------------------------------------------------------------------

interface PrismaLike {
  conversationState: {
    findMany: (args: Record<string, unknown>) => Promise<ConversationRow[]>;
    count: (args: Record<string, unknown>) => Promise<number>;
    findFirst: (args: Record<string, unknown>) => Promise<ConversationRow | null>;
    findUnique: (args: Record<string, unknown>) => Promise<ConversationRow | null>;
    update: (args: Record<string, unknown>) => Promise<ConversationRow>;
  };
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  status?: string;
  channel?: string;
  principalId?: string;
}

export async function buildConversationList(
  prisma: PrismaLike,
  orgId: string,
  opts: ListOptions = {},
): Promise<ConversationListResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (opts.status) where["status"] = opts.status;
  if (opts.channel) where["channel"] = opts.channel;
  if (opts.principalId) where["principalId"] = opts.principalId;

  const [rows, total] = await Promise.all([
    prisma.conversationState.findMany({
      where,
      orderBy: { lastActivityAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.conversationState.count({ where }),
  ]);

  const conversations: ConversationSummary[] = rows.map((row) => {
    const msgs = safeParseMessages(row.messages);
    return {
      id: row.id,
      threadId: row.threadId,
      channel: row.channel,
      principalId: row.principalId,
      organizationId: row.organizationId ?? null,
      status: row.status,
      currentIntent: row.currentIntent,
      messageCount: msgs.length,
      lastMessage: lastMessagePreview(msgs),
      firstReplyAt: row.firstReplyAt?.toISOString() ?? null,
      lastActivityAt: row.lastActivityAt.toISOString(),
    };
  });

  return { conversations, total, limit, offset };
}

export async function buildConversationDetail(
  prisma: PrismaLike,
  orgId: string,
  threadId: string,
): Promise<ConversationDetail | null> {
  const row = await prisma.conversationState.findFirst({
    where: { threadId, organizationId: orgId },
  });

  if (!row) return null;

  return {
    id: row.id,
    threadId: row.threadId,
    channel: row.channel,
    principalId: row.principalId,
    organizationId: row.organizationId ?? null,
    status: row.status,
    currentIntent: row.currentIntent,
    firstReplyAt: row.firstReplyAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt.toISOString(),
    messages: safeParseMessages(row.messages),
  };
}

// ---------------------------------------------------------------------------
// Fastify query schema
// ---------------------------------------------------------------------------

const conversationsQuerySchema = z.object({
  status: z.string().optional(),
  channel: z.string().optional(),
  principalId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const conversationsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/conversations — list conversations with filters
  app.get(
    "/",
    {
      schema: {
        description: "List conversations with optional status/channel filters.",
        tags: ["Conversations"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable", statusCode: 503 });

      const parsed = conversationsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid query", details: parsed.error.format(), statusCode: 400 });
      }

      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.code(403).send({ error: "Organization scope required", statusCode: 403 });
      }

      const result = await buildConversationList(prisma as unknown as PrismaLike, orgId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        status: parsed.data.status,
        channel: parsed.data.channel,
        principalId: parsed.data.principalId,
      });

      return reply.send(result);
    },
  );

  // GET /api/conversations/:threadId — single conversation with messages
  app.get(
    "/:threadId",
    {
      schema: {
        description: "Get a single conversation by threadId.",
        tags: ["Conversations"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable", statusCode: 503 });

      const { threadId } = request.params as { threadId: string };
      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.code(403).send({ error: "Organization scope required", statusCode: 403 });
      }

      const detail = await buildConversationDetail(
        prisma as unknown as PrismaLike,
        orgId,
        threadId,
      );
      if (!detail) {
        return reply.code(404).send({ error: "Conversation not found", statusCode: 404 });
      }

      return reply.send(detail);
    },
  );

  // PATCH /api/conversations/:threadId/override — toggle human override
  app.patch(
    "/:threadId/override",
    {
      schema: {
        description: "Toggle human override for a conversation.",
        tags: ["Conversations"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable", statusCode: 503 });

      const { threadId } = request.params as { threadId: string };
      const body = request.body as { override?: boolean };
      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.code(403).send({ error: "Organization scope required", statusCode: 403 });
      }

      const existing = await (prisma as unknown as PrismaLike).conversationState.findFirst({
        where: { threadId, organizationId: orgId },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Conversation not found", statusCode: 404 });
      }

      const status = body.override === false ? "active" : "human_override";
      const updated = await (prisma as unknown as PrismaLike).conversationState.update({
        where: { id: existing.id },
        data: { status, lastActivityAt: new Date() },
      });

      return reply.send({ id: updated.id, threadId: updated.threadId, status: updated.status });
    },
  );
};
