import type { ModuleId, ModuleState, ModuleStatus } from "./module-types";
import { MODULE_IDS, MODULE_LABELS } from "./module-types";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface DeploymentInput {
  id: string;
  moduleType: string;
  status: string;
  inputConfig: Record<string, unknown>;
}

export interface ConnectionInput {
  deploymentId: string;
  type: string;
  status: string;
}

export interface BusinessHoursInput {
  timezone: string;
  days: Array<{ day: number; open: string; close: string }>;
}

export interface ResolverInput {
  deployments: DeploymentInput[];
  connections: ConnectionInput[];
  orgConfig: { businessHours: BusinessHoursInput | null };
  creativeJobCount: number;
  auditCount: number;
  platformConfig: { hasAnthropicKey: boolean };
}

// ---------------------------------------------------------------------------
// Internal resolver result
// ---------------------------------------------------------------------------

interface ResolvedState {
  state: ModuleState;
  subtext: string;
  isPlatformBlocking?: boolean;
  setupProgress?: { done: number; total: number };
}

// ---------------------------------------------------------------------------
// Per-module resolvers
// ---------------------------------------------------------------------------

function resolveLeadToBooking(input: ResolverInput): ResolvedState {
  const deployment = input.deployments.find((d) => d.moduleType === "lead-to-booking");
  if (!deployment) {
    return { state: "not_setup", subtext: "Turn leads into booked meetings automatically" };
  }

  const calendarConn = input.connections.find(
    (c) => c.deploymentId === deployment.id && c.type === "google_calendar",
  );

  // connection_broken always takes priority
  if (calendarConn && (calendarConn.status === "expired" || calendarConn.status === "revoked")) {
    return {
      state: "connection_broken",
      subtext: "Calendar connection lost — bookings paused",
    };
  }

  const hasCalendar = calendarConn?.status === "active";
  const hasBusinessHours = input.orgConfig.businessHours !== null;

  if (!hasCalendar) {
    return {
      state: "needs_connection",
      subtext: "Connect Google Calendar to start booking",
      setupProgress: { done: hasBusinessHours ? 1 : 0, total: 2 },
    };
  }

  if (!hasBusinessHours) {
    return {
      state: "partial_setup",
      subtext: "Set your business hours to go live",
      setupProgress: { done: 1, total: 2 },
    };
  }

  return { state: "live", subtext: "Qualifying and booking leads" };
}

function resolveCreative(input: ResolverInput): ResolvedState {
  const deployment = input.deployments.find((d) => d.moduleType === "creative");
  if (!deployment) {
    return { state: "not_setup", subtext: "Generate ad creative with AI" };
  }

  // Platform-level blocker
  if (!input.platformConfig.hasAnthropicKey) {
    return {
      state: "needs_connection",
      subtext: "Platform API key required",
      isPlatformBlocking: true,
    };
  }

  if (input.creativeJobCount === 0) {
    return {
      state: "partial_setup",
      subtext: "Submit your first creative brief",
      setupProgress: { done: 1, total: 2 },
    };
  }

  return { state: "live", subtext: "Generating creative assets" };
}

function resolveAdOptimizer(input: ResolverInput): ResolvedState {
  const deployment = input.deployments.find((d) => d.moduleType === "ad-optimizer");
  if (!deployment) {
    return { state: "not_setup", subtext: "Optimize ad spend with AI recommendations" };
  }

  const metaConn = input.connections.find(
    (c) => c.deploymentId === deployment.id && c.type === "meta_ads",
  );

  // connection_broken always takes priority
  if (metaConn && (metaConn.status === "expired" || metaConn.status === "revoked")) {
    return {
      state: "connection_broken",
      subtext: "Meta Ads connection lost — optimization paused",
    };
  }

  if (!metaConn || metaConn.status !== "active") {
    return {
      state: "needs_connection",
      subtext: "Connect Meta Ads to start optimizing",
    };
  }

  const config = deployment.inputConfig;
  const hasAccountId = Boolean(config.accountId);
  const hasTargets = Boolean(config.targetCPA) || Boolean(config.targetROAS);

  if (!hasAccountId || !hasTargets) {
    return {
      state: "partial_setup",
      subtext: "Configure ad account and targets",
      setupProgress: {
        done: (hasAccountId ? 1 : 0) + (hasTargets ? 1 : 0),
        total: 2,
      },
    };
  }

  return { state: "live", subtext: "Monitoring and optimizing ad spend" };
}

// ---------------------------------------------------------------------------
// CTA builder
// ---------------------------------------------------------------------------

function buildCta(moduleId: ModuleId, state: ModuleState): { label: string; href: string } {
  const base = `/modules/${moduleId}`;
  switch (state) {
    case "not_setup":
      return { label: "Enable", href: `${base}/setup` };
    case "needs_connection":
      return { label: "Connect", href: `${base}/setup` };
    case "partial_setup":
      return { label: "Continue", href: `${base}/setup` };
    case "connection_broken":
      return { label: "Fix", href: `${base}/setup` };
    case "live":
      return { label: "View", href: base };
  }
}

// ---------------------------------------------------------------------------
// Live metric
// ---------------------------------------------------------------------------

function getLiveMetric(moduleId: ModuleId, input: ResolverInput): string | undefined {
  switch (moduleId) {
    case "lead-to-booking":
      return "Booking active";
    case "creative":
      return `${input.creativeJobCount} job${input.creativeJobCount === 1 ? "" : "s"} run`;
    case "ad-optimizer":
      return `${input.auditCount} audit${input.auditCount === 1 ? "" : "s"} run`;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const RESOLVERS: Record<ModuleId, (input: ResolverInput) => ResolvedState> = {
  "lead-to-booking": resolveLeadToBooking,
  creative: resolveCreative,
  "ad-optimizer": resolveAdOptimizer,
};

export function resolveModuleStatuses(input: ResolverInput): ModuleStatus[] {
  return MODULE_IDS.map((id) => {
    const resolved = RESOLVERS[id](input);
    return {
      id,
      state: resolved.state,
      label: MODULE_LABELS[id],
      subtext: resolved.subtext,
      metric: resolved.state === "live" ? getLiveMetric(id, input) : undefined,
      cta: buildCta(id, resolved.state),
      ...(resolved.setupProgress ? { setupProgress: resolved.setupProgress } : {}),
      ...(resolved.isPlatformBlocking ? { isPlatformBlocking: resolved.isPlatformBlocking } : {}),
      lastUpdated: new Date().toISOString(),
    };
  });
}
