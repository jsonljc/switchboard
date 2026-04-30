import Fastify, { type FastifyInstance } from "fastify";
import type { ConversationStateStore, WorkTraceStore } from "@switchboard/core/platform";
import type { AgentNotifier } from "@switchboard/core";
import { conversationsRoutes } from "../conversations.js";
import { escalationsRoutes } from "../escalations.js";

export interface ConversationTestAppOptions {
  conversationStateStore?: ConversationStateStore | null;
  workTraceStore?: WorkTraceStore | null;
  agentNotifier?: AgentNotifier | null;
  prisma?: unknown;
  organizationId?: string;
  principalId?: string;
}

export async function buildConversationTestApp(
  opts: ConversationTestAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate("prisma", (opts.prisma ?? null) as never);
  app.decorate("conversationStateStore", opts.conversationStateStore ?? null);
  app.decorate("workTraceStore", opts.workTraceStore ?? null);
  app.decorate("agentNotifier", opts.agentNotifier ?? null);

  app.addHook("preHandler", async (request) => {
    if (opts.organizationId !== undefined) {
      request.organizationIdFromAuth = opts.organizationId;
    }
    if (opts.principalId !== undefined) {
      request.principalIdFromAuth = opts.principalId;
    }
  });

  await app.register(conversationsRoutes, { prefix: "/api/conversations" });
  await app.register(escalationsRoutes, { prefix: "/api/escalations" });

  return app;
}
