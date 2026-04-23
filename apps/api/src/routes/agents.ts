import type { FastifyPluginAsync } from "fastify";
import { deriveAgentStates } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";
import { checkReadiness } from "./readiness.js";

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

  // POST /api/agents/wizard-complete — saves wizard data and ingests as wizard knowledge
  app.post(
    "/wizard-complete",
    {
      schema: {
        description: "Save wizard data to org config and ingest as wizard knowledge.",
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
        businessName: string;
        vertical: string;
        services: string[];
        targetCustomer: string;
        pricingRange: string;
        bookingPlatform: string;
        bookingUrl: string;
        purchasedAgents: string[];
        tonePreset: string;
        language: string;
        agentTones?: Record<string, string>;
      };

      if (!body.businessName || !body.purchasedAgents?.length) {
        return reply
          .code(400)
          .send({ error: "businessName and purchasedAgents are required", statusCode: 400 });
      }

      // Merge runtimeConfig to preserve existing keys
      const existing = await app.prisma.organizationConfig.findUnique({ where: { id: orgId } });
      const existingRuntime = (existing?.runtimeConfig as Record<string, unknown>) ?? {};
      const wizardRuntime = {
        ...existingRuntime,
        vertical: body.vertical,
        bookingPlatform: body.bookingPlatform,
        bookingUrl: body.bookingUrl,
        tonePreset: body.tonePreset,
        language: body.language,
        services: body.services,
        targetCustomer: body.targetCustomer,
        pricingRange: body.pricingRange,
        agentTones: body.agentTones ?? {},
      };

      await app.prisma.organizationConfig.upsert({
        where: { id: orgId },
        create: {
          id: orgId,
          name: body.businessName,
          purchasedAgents: body.purchasedAgents,
          runtimeConfig: wizardRuntime,
          onboardingComplete: true,
        },
        update: {
          name: body.businessName,
          purchasedAgents: body.purchasedAgents,
          runtimeConfig: wizardRuntime,
          onboardingComplete: true,
        },
      });

      return reply.code(200).send({
        success: true,
        purchasedAgents: body.purchasedAgents,
        agentsRegistered: body.purchasedAgents.length,
      });
    },
  );

  // PUT /api/agents/go-live/:agentId — authoritative launch confirmation
  app.put(
    "/go-live/:agentId",
    {
      schema: {
        description:
          "Authoritative launch confirmation. Runs readiness checks, transitions channels to active, sets org config launch state, and creates audit entry.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { agentId } = request.params as { agentId: string };

      // Load readiness context in parallel
      const [managedChannels, connections, deployment, orgConfig] = await Promise.all([
        app.prisma.managedChannel.findMany({
          where: { organizationId: orgId },
          select: { id: true, channel: true, status: true, connectionId: true },
        }),
        app.prisma.connection.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            serviceId: true,
            credentials: true,
            status: true,
            lastHealthCheck: true,
          },
        }),
        app.prisma.agentDeployment.findFirst({
          where: { organizationId: orgId, skillSlug: "alex" },
          select: {
            id: true,
            status: true,
            skillSlug: true,
            organizationId: true,
            listingId: true,
          },
        }),
        app.prisma.organizationConfig.findUnique({
          where: { id: orgId },
          select: { onboardingPlaybook: true, runtimeConfig: true },
        }),
      ]);

      const deploymentConnections = deployment
        ? await app.prisma.deploymentConnection.findMany({
            where: { deploymentId: deployment.id },
            select: { id: true, deploymentId: true, type: true, status: true },
          })
        : [];

      const playbook = (orgConfig?.onboardingPlaybook as Record<string, unknown>) ?? {};
      const runtimeConfig = (orgConfig?.runtimeConfig as Record<string, unknown>) ?? {};
      const scenariosTestedCount =
        typeof runtimeConfig.scenariosTestedCount === "number"
          ? runtimeConfig.scenariosTestedCount
          : 0;

      const mappedConnections = connections.map((c) => ({
        ...c,
        credentials:
          c.credentials !== null && c.credentials !== undefined ? String(c.credentials) : null,
        credentials_exist: undefined as never,
      }));

      const report = checkReadiness({
        managedChannels,
        connections: mappedConnections,
        deployment,
        deploymentConnections,
        playbook,
        scenariosTestedCount,
      });

      if (!report.ready) {
        return reply
          .code(400)
          .send({ error: "Readiness checks failed", readiness: report, statusCode: 400 });
      }

      // Activate channels and update org config
      await app.prisma.managedChannel.updateMany({
        where: { organizationId: orgId },
        data: { status: "active" },
      });

      await app.prisma.organizationConfig.upsert({
        where: { id: orgId },
        update: {
          onboardingComplete: true,
          provisioningStatus: "active",
        },
        create: {
          id: orgId,
          name: orgId,
          onboardingComplete: true,
          provisioningStatus: "active",
        },
      });

      // Create audit entry for activation
      await app.auditLedger.record({
        eventType: "agent.activated",
        actorType: "user",
        actorId: orgId,
        entityType: "deployment",
        entityId: deployment?.id ?? agentId,
        riskCategory: "low",
        organizationId: orgId,
        summary: `Agent activated for organization ${orgId}`,
        snapshot: { readiness: report, agentId },
      });

      return reply.code(200).send({
        agentId,
        status: "active",
        orgConfig: {
          onboardingComplete: true,
          provisioningStatus: "active",
        },
      });
    },
  );
};
