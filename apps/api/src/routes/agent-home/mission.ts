import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AgentKeySchema } from "@switchboard/schemas";
import { getAgentTargets } from "@switchboard/core";
import { requireOrganizationScope } from "../../utils/require-org.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });

type RosterInput = {
  id: string;
  organizationId: string;
  agentRole: string;
  displayName: string;
  description: string;
  status: string;
  tier: string;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type OrgInput = { id: string; name: string };
type ConnectionInput = { serviceId: string; status: string };
type ManagedChannelInput = { channel: string; status: string };

export type MissionChannelKind = "meta-ads" | "whatsapp" | "telegram" | "slack" | "calendar";
export type MissionChannelStatus = "ok" | "warn" | "off";
export type MissionChannel = {
  kind: MissionChannelKind;
  label: string;
  status: MissionChannelStatus;
};

export type MissionRules = {
  priceApprovalThreshold: number;
  refundEscalationFloor: number;
} | null;

export type MissionTargets = {
  avgValueCents: number | null;
  targetCpbCents: number | null;
  roasSource: "deterministic" | "crm";
};

export type MissionSetupRow = {
  key: "meta" | "inbox" | "cal" | "rules";
  done: boolean;
  primary?: boolean;
};

export type MissionAggregatorResponse = {
  agentKey: "alex" | "riley";
  displayName: string;
  mission: {
    role: string;
    pipeline: string;
    brand: string;
    channels: MissionChannel[];
    rules: MissionRules;
  };
  composerPlaceholder: string;
  commands: never[];
  targets: MissionTargets;
  setup: MissionSetupRow[];
};

const ALEX_ROLE = "SDR · qualify inbound leads, book consultations";
const ALEX_PIPELINE = "Consultations pipeline · single funnel";
const ALEX_COMPOSER_PLACEHOLDER = "Tell Alex what to do — coming soon";

const RILEY_ROLE = "Ad optimizer · score, recommend, never act without your approval";
const RILEY_PIPELINE = "Ad sets · all campaigns";
const RILEY_COMPOSER_PLACEHOLDER = "Tell Riley what to do — coming soon";
const CRM_PROVIDER_SERVICE_ID = "crm-data-provider";

function mapConnectionStatus(status: string): MissionChannelStatus {
  if (status === "connected") return "ok";
  if (status === "degraded") return "warn";
  return "off";
}

function mapManagedChannelStatus(status: string): MissionChannelStatus {
  if (status === "active") return "ok";
  if (status === "error" || status === "provisioning") return "warn";
  return "off";
}

function readNumberKey(config: unknown, key: string): number | null {
  if (config === null || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inboxLabel(kind: MissionChannelKind): string {
  if (kind === "telegram") return "Telegram inbox";
  if (kind === "slack") return "Slack inbox";
  return "WhatsApp inbox";
}

export function buildAlexMissionResponse(inputs: {
  roster: RosterInput;
  org: OrgInput;
  connections: ConnectionInput[];
  managedChannels: ManagedChannelInput[];
}): MissionAggregatorResponse {
  const { roster, org, connections, managedChannels } = inputs;

  const metaConnection = connections.find((c) => c.serviceId === "meta-ads");
  const metaDone = !!metaConnection;
  const metaStatus: MissionChannelStatus = metaConnection
    ? mapConnectionStatus(metaConnection.status)
    : "off";

  // Pick the first ManagedChannel (any inbox kind) as the inbox surface for Alex.
  const inboxChannel = managedChannels[0];
  const inboxDone = !!inboxChannel;
  const inboxKind: MissionChannelKind =
    inboxChannel?.channel === "telegram"
      ? "telegram"
      : inboxChannel?.channel === "slack"
        ? "slack"
        : "whatsapp";
  const inboxStatus: MissionChannelStatus = inboxChannel
    ? mapManagedChannelStatus(inboxChannel.status)
    : "off";

  // Calendar: looks up a `google-calendar` Connection row for this org.
  // NOTE: as of this commit, no production writer creates Connection rows with
  // serviceId === "google-calendar" — the OAuth callback at
  // apps/api/src/routes/google-calendar-oauth.ts writes to DeploymentConnection
  // (a different table) instead. The cockpit-wiring punchlist Task 4 runbook
  // tracks the missing upstream writer; this read-side is intentionally correct
  // so it lights up automatically once the writer ships.
  // `calDone` requires status === "connected" — a non-connected Connection
  // (degraded/expired/revoked/etc.) keeps the setup row unticked. Status
  // mapping to "warn" vs "off" delegates to mapConnectionStatus. The metaDone
  // logic at mission.ts:109 is intentionally laxer (any row counts as done);
  // a future PR will align both reads to the strict semantic (tracked in the
  // cockpit-wiring runbook's follow-ups).
  const calConnection = connections.find((c) => c.serviceId === "google-calendar");
  const calDone = calConnection?.status === "connected";
  const calStatus: MissionChannelStatus = calConnection
    ? mapConnectionStatus(calConnection.status)
    : "off";

  const priceApprovalThreshold = readNumberKey(roster.config, "priceApprovalThreshold");
  const refundEscalationFloor = readNumberKey(roster.config, "refundEscalationFloor");
  const rules: MissionRules =
    priceApprovalThreshold !== null && refundEscalationFloor !== null
      ? { priceApprovalThreshold, refundEscalationFloor }
      : null;
  const rulesDone = rules !== null;

  const brandName = org.name.trim().length > 0 ? org.name : "(unnamed organization)";

  const setupRows: MissionSetupRow[] = [
    { key: "meta", done: metaDone },
    { key: "inbox", done: inboxDone },
    { key: "cal", done: calDone },
    { key: "rules", done: rulesDone },
  ];
  const firstUndone = setupRows.find((row) => !row.done);
  if (firstUndone) firstUndone.primary = true;

  return {
    agentKey: "alex",
    displayName: roster.displayName,
    mission: {
      role: ALEX_ROLE,
      pipeline: ALEX_PIPELINE,
      brand: `${brandName} · —`,
      channels: [
        { kind: "meta-ads", label: "Meta Ads", status: metaStatus },
        { kind: inboxKind, label: inboxLabel(inboxKind), status: inboxStatus },
        { kind: "calendar", label: "Consultation calendar", status: calStatus },
      ],
      rules,
    },
    composerPlaceholder: ALEX_COMPOSER_PLACEHOLDER,
    commands: [],
    targets: { ...getAgentTargets(roster), roasSource: "deterministic" },
    setup: setupRows,
  };
}

export function buildRileyMissionResponse(inputs: {
  roster: RosterInput;
  org: OrgInput;
  connections: ConnectionInput[];
}): MissionAggregatorResponse {
  const { roster, org, connections } = inputs;

  const metaConnection = connections.find((c) => c.serviceId === "meta-ads");
  const metaDone = !!metaConnection;
  const metaStatus: MissionChannelStatus = metaConnection
    ? mapConnectionStatus(metaConnection.status)
    : "off";

  const crmConnection = connections.find((c) => c.serviceId === CRM_PROVIDER_SERVICE_ID);
  const roasSource: "deterministic" | "crm" = crmConnection ? "crm" : "deterministic";

  const avgValueCents = readNumberKey(roster.config, "avgValueCents");
  const targetCpbCents = readNumberKey(roster.config, "targetCpbCents");
  const targetsDone = avgValueCents !== null && targetCpbCents !== null;

  const brandName = org.name.trim().length > 0 ? org.name : "(unnamed organization)";

  const setupRows: MissionSetupRow[] = [
    { key: "meta", done: metaDone },
    { key: "rules", done: targetsDone },
  ];
  const firstUndone = setupRows.find((row) => !row.done);
  if (firstUndone) firstUndone.primary = true;

  return {
    agentKey: "riley",
    displayName: roster.displayName,
    mission: {
      role: RILEY_ROLE,
      pipeline: RILEY_PIPELINE,
      brand: `${brandName} · —`,
      channels: [{ kind: "meta-ads", label: "Meta Ads", status: metaStatus }],
      rules: null,
    },
    composerPlaceholder: RILEY_COMPOSER_PLACEHOLDER,
    commands: [],
    targets: { avgValueCents, targetCpbCents, roasSource },
    setup: setupRows,
  };
}

const ALEX_RILEY_ONLY = ["alex", "riley"] as const;

export const missionRoute: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get("/agents/:agentId/mission", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });

    const { agentId } = params.data;
    if (!ALEX_RILEY_ONLY.includes(agentId as (typeof ALEX_RILEY_ONLY)[number])) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    if (!app.prisma) {
      return reply.code(503).send({ error: "Prisma unavailable" });
    }

    try {
      const rosterRole = agentId === "alex" ? "responder" : "optimizer";
      const [roster, org, connections, managedChannels] = await Promise.all([
        app.prisma.agentRoster.findFirst({
          where: { organizationId: orgId, agentRole: rosterRole },
        }),
        app.prisma.organizationConfig.findUnique({ where: { id: orgId } }),
        app.prisma.connection.findMany({
          where: { organizationId: orgId },
          select: { serviceId: true, status: true },
        }),
        agentId === "alex"
          ? app.prisma.managedChannel.findMany({
              where: { organizationId: orgId },
              select: { channel: true, status: true },
            })
          : Promise.resolve([] as Array<{ channel: string; status: string }>),
      ]);

      if (!roster) {
        const label = agentId === "alex" ? "Alex" : "Riley";
        return reply.code(404).send({ error: `${label} roster not provisioned for this org` });
      }

      const response =
        agentId === "alex"
          ? buildAlexMissionResponse({
              roster: roster as unknown as Parameters<typeof buildAlexMissionResponse>[0]["roster"],
              org: { id: orgId, name: org?.name ?? "" },
              connections,
              managedChannels,
            })
          : buildRileyMissionResponse({
              roster: roster as unknown as Parameters<
                typeof buildRileyMissionResponse
              >[0]["roster"],
              org: { id: orgId, name: org?.name ?? "" },
              connections,
            });
      return reply.code(200).send(response);
    } catch (err) {
      app.log.error({ err }, "mission aggregator failed");
      return reply.code(500).send({ error: "Mission aggregator failed" });
    }
  });
};
