import type { FastifyPluginAsync } from "fastify";
import { deriveAgentStates } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

const DEFAULT_ROSTER = [
  {
    agentRole: "primary_operator",
    displayName: "Ava",
    description: "Your AI growth operator — coordinates all tasks and communicates with your team.",
    status: "active",
    tier: "starter",
    config: { tone: "friendly", workingStyle: "Friendly & Warm" },
  },
  {
    agentRole: "monitor",
    displayName: "Monitor",
    description: "Watches your ad performance, alerts you to anomalies and pacing issues.",
    status: "active",
    tier: "starter",
    config: {},
  },
  {
    agentRole: "responder",
    displayName: "Responder",
    description: "Handles inbound leads, qualifies prospects, and manages conversations.",
    status: "active",
    tier: "starter",
    config: {},
  },
  {
    agentRole: "strategist",
    displayName: "Strategist",
    description: "Plans campaigns, allocates budgets, and develops growth strategies.",
    status: "locked",
    tier: "pro",
    config: {},
  },
  {
    agentRole: "optimizer",
    displayName: "Optimizer",
    description: "Fine-tunes bids, targeting, and creative rotation for better performance.",
    status: "locked",
    tier: "pro",
    config: {},
  },
  {
    agentRole: "booker",
    displayName: "Booker",
    description: "Manages appointments, scheduling, and calendar coordination.",
    status: "locked",
    tier: "business",
    config: {},
  },
  {
    agentRole: "guardian",
    displayName: "Guardian",
    description: "Enforces governance rules, spending limits, and compliance policies.",
    status: "locked",
    tier: "business",
    config: {},
  },
];

export const agentsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/agents/roster — returns roster for the requesting org
  app.get(
    "/roster",
    {
      schema: {
        description: "Get agent roster for the organization.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const roster = await app.prisma.agentRoster.findMany({
        where: { organizationId: orgId },
        include: { agentState: true },
        orderBy: { createdAt: "asc" },
      });

      return reply.code(200).send({ roster });
    },
  );

  // PUT /api/agents/roster/:id — update a roster entry
  app.put(
    "/roster/:id",
    {
      schema: {
        description: "Update an agent roster entry (name, status, config).",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { id } = request.params as { id: string };
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const existing = await app.prisma.agentRoster.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: "Agent not found", statusCode: 404 });
      }

      if (existing.organizationId !== orgId) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      const body = request.body as {
        displayName?: string;
        description?: string;
        status?: string;
        config?: Record<string, unknown>;
      };

      const updated = await app.prisma.agentRoster.update({
        where: { id },
        data: {
          ...(body.displayName !== undefined && { displayName: body.displayName }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.status !== undefined && { status: body.status }),
          ...(body.config !== undefined && { config: body.config as object }),
        },
        include: { agentState: true },
      });

      return reply.code(200).send({ agent: updated });
    },
  );

  // GET /api/agents/state — returns derived state for all agents
  app.get(
    "/state",
    {
      schema: {
        description: "Get derived activity state for all agents based on recent events.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      // Fetch recent audit entries (last 24h)
      const since = new Date();
      since.setHours(since.getHours() - 24);

      const entries = await app.prisma.auditEntry.findMany({
        where: {
          organizationId: orgId,
          timestamp: { gte: since },
        },
        select: {
          eventType: true,
          timestamp: true,
          summary: true,
        },
        orderBy: { timestamp: "asc" },
        take: 500,
      });

      const states = deriveAgentStates(entries);
      const stateArray = Array.from(states.values());

      return reply.code(200).send({ states: stateArray });
    },
  );

  // POST /api/agents/roster/initialize — creates default roster for an org
  app.post(
    "/roster/initialize",
    {
      schema: {
        description: "Initialize default agent roster for an organization.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const body = request.body as {
        operatorName?: string;
        operatorConfig?: Record<string, unknown>;
      } | null;

      // Check if roster already exists
      const existing = await app.prisma.agentRoster.findFirst({
        where: { organizationId: orgId },
      });

      if (existing) {
        const roster = await app.prisma.agentRoster.findMany({
          where: { organizationId: orgId },
          include: { agentState: true },
          orderBy: { createdAt: "asc" },
        });
        return reply.code(200).send({ roster, alreadyInitialized: true });
      }

      // Create all roster entries
      const roster = [];
      for (const entry of DEFAULT_ROSTER) {
        const displayName =
          entry.agentRole === "primary_operator" && body?.operatorName
            ? body.operatorName
            : entry.displayName;

        const config =
          entry.agentRole === "primary_operator" && body?.operatorConfig
            ? { ...entry.config, ...body.operatorConfig }
            : entry.config;

        const agent = await app.prisma.agentRoster.create({
          data: {
            organizationId: orgId,
            agentRole: entry.agentRole,
            displayName,
            description: entry.description,
            status: entry.status,
            tier: entry.tier,
            config: config as object,
          },
        });

        // Create initial agent state
        await app.prisma.agentState.create({
          data: {
            agentRosterId: agent.id,
            organizationId: orgId,
            activityStatus: "idle",
            metrics: { actionsToday: 0 } as object,
          },
        });

        roster.push(agent);
      }

      const fullRoster = await app.prisma.agentRoster.findMany({
        where: { organizationId: orgId },
        include: { agentState: true },
        orderBy: { createdAt: "asc" },
      });

      return reply.code(201).send({ roster: fullRoster });
    },
  );
};
