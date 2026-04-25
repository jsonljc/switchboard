// ---------------------------------------------------------------------------
// Readiness endpoint — structured pre-launch readiness report
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ReadinessCheck {
  id: string;
  label: string;
  status: "pass" | "fail";
  message: string;
  blocking: boolean;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
}

export interface MetaAdsConnectionInfo {
  exists: boolean;
  expiresAt: Date | null;
}

export interface ReadinessContext {
  managedChannels: Array<{
    id: string;
    channel: string;
    status: string;
    connectionId: string;
  }>;
  connections: Array<{
    id: string;
    serviceId: string;
    credentials: string | null;
    status: string;
    lastHealthCheck: Date | null;
  }>;
  deployment: {
    id: string;
    status: string;
    skillSlug: string | null;
    organizationId: string;
    listingId: string;
  } | null;
  deploymentConnections: Array<{
    id: string;
    deploymentId: string;
    type: string;
    status: string;
    metadata?: Record<string, unknown> | null;
  }>;
  playbook: Record<string, unknown>;
  scenariosTestedCount: number;
  metaAdsConnection: MetaAdsConnectionInfo;
  emailVerified: boolean;
}

// ── PrismaLike — narrow type for readiness queries ─────────────────────────

export interface PrismaLike {
  managedChannel: {
    findMany(args: {
      where: { organizationId: string };
      select: { id: true; channel: true; status: true; connectionId: true };
    }): Promise<Array<{ id: string; channel: string; status: string; connectionId: string }>>;
  };
  connection: {
    findMany(args: {
      where: { organizationId: string };
      select: {
        id: true;
        serviceId: true;
        credentials: true;
        status: true;
        lastHealthCheck: true;
      };
    }): Promise<
      Array<{
        id: string;
        serviceId: string;
        credentials: unknown;
        status: string;
        lastHealthCheck: Date | null;
      }>
    >;
  };
  agentDeployment: {
    findFirst(args: {
      where: { organizationId: string; skillSlug: string };
      select: {
        id: true;
        status: true;
        skillSlug: true;
        organizationId: true;
        listingId: true;
      };
    }): Promise<{
      id: string;
      status: string;
      skillSlug: string | null;
      organizationId: string;
      listingId: string;
    } | null>;
  };
  organizationConfig: {
    findUnique(args: {
      where: { id: string };
      select: { onboardingPlaybook: true; runtimeConfig: true };
    }): Promise<{
      onboardingPlaybook: unknown;
      runtimeConfig: unknown;
    } | null>;
  };
  deploymentConnection: {
    findMany(args: {
      where: { deploymentId: string };
      select: { id: true; deploymentId: true; type: true; status: true; metadata: true };
    }): Promise<
      Array<{
        id: string;
        deploymentId: string;
        type: string;
        status: string;
        metadata: unknown;
      }>
    >;
  };
  dashboardUser: {
    findFirst(args: {
      where: { organizationId: string; emailVerified: { not: null } };
    }): Promise<{ id: string } | null>;
  };
}

// ── Shared helper — assembles ReadinessContext from Prisma ──────────────────

export async function buildReadinessContext(
  prisma: PrismaLike,
  orgId: string,
): Promise<ReadinessContext> {
  const [managedChannels, connections, deployment, orgConfig, verifiedUser] = await Promise.all([
    prisma.managedChannel.findMany({
      where: { organizationId: orgId },
      select: { id: true, channel: true, status: true, connectionId: true },
    }),
    prisma.connection.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        serviceId: true,
        credentials: true,
        status: true,
        lastHealthCheck: true,
      },
    }),
    prisma.agentDeployment.findFirst({
      where: { organizationId: orgId, skillSlug: "alex" },
      select: {
        id: true,
        status: true,
        skillSlug: true,
        organizationId: true,
        listingId: true,
      },
    }),
    prisma.organizationConfig.findUnique({
      where: { id: orgId },
      select: { onboardingPlaybook: true, runtimeConfig: true },
    }),
    prisma.dashboardUser.findFirst({
      where: { organizationId: orgId, emailVerified: { not: null } },
    }),
  ]);

  const deploymentConnections = deployment
    ? await prisma.deploymentConnection.findMany({
        where: { deploymentId: deployment.id },
        select: { id: true, deploymentId: true, type: true, status: true, metadata: true },
      })
    : [];

  const playbook = (orgConfig?.onboardingPlaybook as Record<string, unknown>) ?? {};
  const runtimeConfig = (orgConfig?.runtimeConfig as Record<string, unknown>) ?? {};
  const scenariosTestedCount =
    typeof runtimeConfig.scenariosTestedCount === "number" ? runtimeConfig.scenariosTestedCount : 0;

  const mappedConnections = connections.map((c) => ({
    ...c,
    credentials:
      c.credentials !== null && c.credentials !== undefined ? String(c.credentials) : null,
  }));

  const mappedDeploymentConnections = deploymentConnections.map((dc) => ({
    id: dc.id,
    deploymentId: dc.deploymentId,
    type: dc.type,
    status: dc.status,
    metadata: (dc.metadata as Record<string, unknown> | null) ?? null,
  }));

  // Derive meta-ads connection info from deployment connections
  const metaAdsDc = mappedDeploymentConnections.find(
    (dc) => dc.type === "meta-ads" && dc.status === "active",
  );
  const metaAdsExpiresAtRaw = metaAdsDc?.metadata?.expiresAt;
  const metaAdsConnection: MetaAdsConnectionInfo = {
    exists: !!metaAdsDc,
    expiresAt: typeof metaAdsExpiresAtRaw === "string" ? new Date(metaAdsExpiresAtRaw) : null,
  };

  return {
    managedChannels,
    connections: mappedConnections,
    deployment,
    deploymentConnections: mappedDeploymentConnections,
    playbook,
    scenariosTestedCount,
    metaAdsConnection,
    emailVerified: verifiedUser !== null,
  };
}

// ── Pure function ───────────────────────────────────────────────────────────

export function checkReadiness(ctx: ReadinessContext): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  // 0. email-verified
  checks.push(checkEmailVerified(ctx));

  // 1. channel-connected
  checks.push(checkChannelConnected(ctx));

  // 2. deployment-exists
  checks.push(checkDeploymentExists(ctx));

  // 3. deployment-connection
  checks.push(checkDeploymentConnection(ctx));

  // 4. business-identity
  checks.push(checkBusinessIdentity(ctx));

  // 5. services-defined
  checks.push(checkServicesDefined(ctx));

  // 6. hours-set
  checks.push(checkHoursSet(ctx));

  // 7. test-scenarios-run (advisory)
  checks.push(checkTestScenariosRun(ctx));

  // 8. approval-mode-reviewed (advisory)
  checks.push(checkApprovalModeReviewed(ctx));

  // 9. meta-ads-token
  checks.push(checkMetaAdsToken(ctx));

  const ready = checks.filter((c) => c.blocking).every((c) => c.status === "pass");

  return { ready, checks };
}

// ── Individual checks ───────────────────────────────────────────────────────

function checkEmailVerified(ctx: ReadinessContext): ReadinessCheck {
  const id = "email-verified";
  const label = "Email verified";
  const blocking = true;

  return {
    id,
    label,
    blocking,
    status: ctx.emailVerified ? "pass" : "fail",
    message: ctx.emailVerified
      ? "Account email has been verified"
      : "Verify your email address before going live.",
  };
}

function checkChannelConnected(ctx: ReadinessContext): ReadinessCheck {
  const id = "channel-connected";
  const label = "Verified channel connected";
  const blocking = true;

  const connectionMap = new Map(ctx.connections.map((c) => [c.id, c]));

  const hasVerified = ctx.managedChannels.some((mc) => {
    if (mc.status !== "active" && mc.status !== "pending") return false;
    const conn = connectionMap.get(mc.connectionId);
    if (!conn || conn.credentials === null) return false;
    // WhatsApp requires test-connection proof
    if (mc.channel === "whatsapp" && conn.lastHealthCheck === null) return false;
    return true;
  });

  return {
    id,
    label,
    blocking,
    status: hasVerified ? "pass" : "fail",
    message: hasVerified
      ? "At least one verified channel is connected"
      : "No verified channel found. Connect and test a channel.",
  };
}

function checkDeploymentExists(ctx: ReadinessContext): ReadinessCheck {
  const id = "deployment-exists";
  const label = "Deployment created";
  const blocking = true;

  const ok =
    ctx.deployment !== null && ctx.deployment.status === "active" && !!ctx.deployment.skillSlug;

  return {
    id,
    label,
    blocking,
    status: ok ? "pass" : "fail",
    message: ok
      ? "Active deployment with skill slug found"
      : "No active deployment with a skill slug. Deploy an agent first.",
  };
}

function checkDeploymentConnection(ctx: ReadinessContext): ReadinessCheck {
  const id = "deployment-connection";
  const label = "Channel linked to deployment";
  const blocking = true;

  // Build set of channel types from active/pending managed channels that are connected
  const connectionMap = new Map(ctx.connections.map((c) => [c.id, c]));
  const activeChannelTypes = new Set<string>();
  for (const mc of ctx.managedChannels) {
    if (mc.status !== "active" && mc.status !== "pending") continue;
    const conn = connectionMap.get(mc.connectionId);
    if (!conn || conn.credentials === null) continue;
    activeChannelTypes.add(mc.channel);
  }

  const ok = ctx.deploymentConnections.some(
    (dc) => dc.status === "active" && activeChannelTypes.has(dc.type),
  );

  return {
    id,
    label,
    blocking,
    status: ok ? "pass" : "fail",
    message: ok
      ? "Deployment is linked to an active channel"
      : "No deployment connection matches an active channel. Link a channel to the deployment.",
  };
}

function checkBusinessIdentity(ctx: ReadinessContext): ReadinessCheck {
  const id = "business-identity";
  const label = "Business identity complete";
  const blocking = true;

  const identity = ctx.playbook.businessIdentity as { status?: string } | undefined;
  const ok = identity?.status === "ready";

  return {
    id,
    label,
    blocking,
    status: ok ? "pass" : "fail",
    message: ok
      ? "Business identity is complete"
      : "Business identity is incomplete. Fill in your business details in the playbook.",
  };
}

function checkServicesDefined(ctx: ReadinessContext): ReadinessCheck {
  const id = "services-defined";
  const label = "Services defined";
  const blocking = true;

  const services = ctx.playbook.services as { status?: string; items?: unknown[] } | undefined;
  const ok =
    services?.status === "ready" || (Array.isArray(services?.items) && services.items.length > 0);

  return {
    id,
    label,
    blocking,
    status: ok ? "pass" : "fail",
    message: ok
      ? "Services are defined"
      : "No services defined. Add at least one service to your playbook.",
  };
}

function checkHoursSet(ctx: ReadinessContext): ReadinessCheck {
  const id = "hours-set";
  const label = "Operating hours set";
  const blocking = true;

  const hours = ctx.playbook.hours as { status?: string } | undefined;
  const ok = hours?.status === "ready";

  return {
    id,
    label,
    blocking,
    status: ok ? "pass" : "fail",
    message: ok
      ? "Operating hours are configured"
      : "Operating hours not set. Configure your business hours in the playbook.",
  };
}

function checkTestScenariosRun(ctx: ReadinessContext): ReadinessCheck {
  const id = "test-scenarios-run";
  const label = "Test conversations run";
  const blocking = false;

  const ok = ctx.scenariosTestedCount >= 2;

  return {
    id,
    label,
    blocking,
    status: ok ? "pass" : "fail",
    message: ok
      ? `${ctx.scenariosTestedCount} test scenarios completed`
      : `Only ${ctx.scenariosTestedCount} test scenario(s) run. Run at least 2.`,
  };
}

function checkApprovalModeReviewed(ctx: ReadinessContext): ReadinessCheck {
  const id = "approval-mode-reviewed";
  const label = "Approval mode reviewed";
  const blocking = false;

  const approvalMode = ctx.playbook.approvalMode as { status?: string } | undefined;
  const ok = approvalMode?.status === "ready";

  return {
    id,
    label,
    blocking,
    status: ok ? "pass" : "fail",
    message: ok
      ? "Approval mode has been reviewed"
      : "Approval mode not reviewed. Review your approval settings.",
  };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function checkMetaAdsToken(ctx: ReadinessContext): ReadinessCheck {
  const id = "meta-ads-token";
  const label = "Meta Ads token valid";
  const blocking = false;

  if (!ctx.metaAdsConnection.exists) {
    return { id, label, blocking, status: "fail", message: "Meta Ads not connected" };
  }

  if (!ctx.metaAdsConnection.expiresAt) {
    // Connection exists but no expiry info — assume valid
    return { id, label, blocking, status: "pass", message: "Meta Ads connected" };
  }

  const msUntilExpiry = ctx.metaAdsConnection.expiresAt.getTime() - Date.now();

  if (msUntilExpiry <= 0) {
    return {
      id,
      label,
      blocking,
      status: "fail",
      message: "Meta Ads token expired — reconnect in Settings",
    };
  }

  if (msUntilExpiry <= SEVEN_DAYS_MS) {
    const daysLeft = Math.ceil(msUntilExpiry / (24 * 60 * 60 * 1000));
    return {
      id,
      label,
      blocking: false,
      status: "pass",
      message: `Meta Ads token expires in ${daysLeft} day(s) — consider reconnecting soon`,
    };
  }

  return { id, label, blocking, status: "pass", message: "Meta Ads token is valid" };
}

// ── Fastify route ───────────────────────────────────────────────────────────

export const readinessRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/:agentId/readiness",
    {
      schema: {
        description: "Get structured readiness report for an agent.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const ctx = await buildReadinessContext(app.prisma, orgId);
      const report = checkReadiness(ctx);

      return reply.code(200).send(report);
    },
  );
};
