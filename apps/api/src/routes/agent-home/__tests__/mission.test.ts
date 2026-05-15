import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { missionRoute } from "../mission.js";
import { buildAlexMissionResponse, buildRileyMissionResponse } from "../mission.js";

describe("buildAlexMissionResponse", () => {
  const baseInputs = {
    roster: {
      id: "ros-1",
      organizationId: "org-1",
      agentRole: "responder",
      displayName: "Alex",
      description: "",
      status: "active",
      tier: "starter",
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    org: { id: "org-1", name: "HotPod Yoga" },
    connections: [] as Array<{ serviceId: string; status: string }>,
    managedChannels: [] as Array<{ channel: string; status: string }>,
  };

  it("returns Alex display fields when nothing is connected", () => {
    const out = buildAlexMissionResponse(baseInputs);
    expect(out.agentKey).toBe("alex");
    expect(out.displayName).toBe("Alex");
    expect(out.mission.role).toBe("SDR · qualify inbound leads, book tours");
    expect(out.mission.pipeline).toBe("Tours pipeline · single funnel");
    expect(out.mission.brand).toBe("HotPod Yoga · —");
    expect(out.mission.channels.map((c) => c.kind)).toEqual(["meta-ads", "whatsapp", "calendar"]);
    expect(out.mission.channels.find((c) => c.kind === "meta-ads")?.status).toBe("off");
    expect(out.mission.rules).toBeNull();
    expect(out.targets).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
      roasSource: "deterministic",
    });
    expect(out.commands).toEqual([]);
    expect(out.setup.every((row) => row.done === false)).toBe(true);
    expect(out.setup.find((row) => row.key === "meta")?.primary).toBe(true);
  });

  it("marks meta done when a Meta Ads Connection exists", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "connected" }],
    });
    expect(out.mission.channels.find((c) => c.kind === "meta-ads")?.status).toBe("ok");
    expect(out.setup.find((row) => row.key === "meta")?.done).toBe(true);
    // primary shifts to inbox (next un-done row)
    expect(out.setup.find((row) => row.key === "inbox")?.primary).toBe(true);
  });

  it("marks Meta Ads status='warn' when Connection is degraded", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "degraded" }],
    });
    expect(out.mission.channels.find((c) => c.kind === "meta-ads")?.status).toBe("warn");
  });

  it("marks inbox done when any ManagedChannel exists; status='ok' if active", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      managedChannels: [{ channel: "whatsapp", status: "active" }],
    });
    expect(out.mission.channels.find((c) => c.kind === "whatsapp")?.status).toBe("ok");
    expect(out.setup.find((row) => row.key === "inbox")?.done).toBe(true);
  });

  it("marks inbox status='warn' when ManagedChannel error/provisioning", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      managedChannels: [{ channel: "whatsapp", status: "error" }],
    });
    expect(out.mission.channels.find((c) => c.kind === "whatsapp")?.status).toBe("warn");
  });

  it("emits targets from AgentRoster.config when avgValueCents and targetCpbCents are set", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { avgValueCents: 17900, targetCpbCents: 3000 },
      },
    });
    expect(out.targets).toEqual({
      avgValueCents: 17900,
      targetCpbCents: 3000,
      roasSource: "deterministic",
    });
  });

  it("emits null targets when AgentRoster.config has only avgValueCents", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { avgValueCents: 17900 },
      },
    });
    expect(out.targets).toEqual({
      avgValueCents: 17900,
      targetCpbCents: null,
      roasSource: "deterministic",
    });
  });

  it("emits rules when AgentRoster.config carries thresholds", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { priceApprovalThreshold: 120, refundEscalationFloor: 250 },
      },
    });
    expect(out.mission.rules).toEqual({
      priceApprovalThreshold: 120,
      refundEscalationFloor: 250,
    });
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(true);
  });

  it("falls back to '(unnamed organization)' when org.name missing", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      org: { id: "org-1", name: "" },
    });
    expect(out.mission.brand).toBe("(unnamed organization) · —");
  });

  it("composer placeholder is static A.2 copy", () => {
    const out = buildAlexMissionResponse(baseInputs);
    expect(out.composerPlaceholder).toBe("Tell Alex what to do — coming soon");
  });

  it("returns rules: null when config is a non-object primitive", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: "invalid" as unknown,
      },
    });
    expect(out.mission.rules).toBeNull();
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(false);
  });

  it("returns rules: null when only one threshold is present", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { priceApprovalThreshold: 120 },
      },
    });
    expect(out.mission.rules).toBeNull();
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(false);
  });

  it("returns rules: null when a threshold is NaN", () => {
    const out = buildAlexMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { priceApprovalThreshold: NaN, refundEscalationFloor: 200 },
      },
    });
    expect(out.mission.rules).toBeNull();
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(false);
  });
});

describe("buildRileyMissionResponse", () => {
  const baseInputs = {
    roster: {
      id: "ros-riley-1",
      organizationId: "org-1",
      agentRole: "optimizer",
      displayName: "Riley",
      description: "",
      status: "active",
      tier: "starter",
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    org: { id: "org-1", name: "HotPod Yoga" },
    connections: [] as Array<{ serviceId: string; status: string }>,
  };

  it("returns Riley display fields when nothing is connected", () => {
    const out = buildRileyMissionResponse(baseInputs);
    expect(out.agentKey).toBe("riley");
    expect(out.displayName).toBe("Riley");
    expect(out.mission.role).toBe(
      "Ad optimizer · score, recommend, never act without your approval",
    );
    expect(out.mission.pipeline).toBe("Ad sets · all campaigns");
    expect(out.mission.brand).toBe("HotPod Yoga · —");
    expect(out.mission.channels.map((c) => c.kind)).toEqual(["meta-ads"]);
    expect(out.mission.channels[0]).toEqual({
      kind: "meta-ads",
      label: "Meta Ads",
      status: "off",
    });
    expect(out.mission.rules).toBeNull();
    expect(out.targets).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
      roasSource: "deterministic",
    });
    expect(out.composerPlaceholder).toBe("Tell Riley what to do — coming soon");
    expect(out.commands).toEqual([]);
    // Riley setup array has 2 rows: meta and rules. No inbox/cal.
    expect(out.setup.map((r) => r.key)).toEqual(["meta", "rules"]);
    expect(out.setup.every((row) => row.done === false)).toBe(true);
    expect(out.setup.find((row) => row.key === "meta")?.primary).toBe(true);
  });

  it("marks meta done when a Meta Ads Connection exists; status='ok' when connected", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "connected" }],
    });
    expect(out.mission.channels[0]?.status).toBe("ok");
    expect(out.setup.find((row) => row.key === "meta")?.done).toBe(true);
    // primary shifts to rules (next un-done row)
    expect(out.setup.find((row) => row.key === "rules")?.primary).toBe(true);
  });

  it("marks Meta Ads status='warn' when Connection is degraded", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "degraded" }],
    });
    expect(out.mission.channels[0]?.status).toBe("warn");
  });

  it("sets roasSource='crm' when a crm-data-provider Connection exists", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      connections: [
        { serviceId: "meta-ads", status: "connected" },
        { serviceId: "crm-data-provider", status: "connected" },
      ],
    });
    expect(out.targets.roasSource).toBe("crm");
  });

  it("keeps roasSource='deterministic' when no crm-data-provider Connection exists", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      connections: [{ serviceId: "meta-ads", status: "connected" }],
    });
    expect(out.targets.roasSource).toBe("deterministic");
  });

  it("reads avgValueCents/targetCpbCents from roster.config", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { avgValueCents: 12000, targetCpbCents: 2500 },
      },
    });
    expect(out.targets.avgValueCents).toBe(12000);
    expect(out.targets.targetCpbCents).toBe(2500);
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(true);
  });

  it("returns null targets and rules-row undone when only one threshold is present", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      roster: {
        ...baseInputs.roster,
        config: { avgValueCents: 12000 },
      },
    });
    expect(out.targets.avgValueCents).toBe(12000);
    expect(out.targets.targetCpbCents).toBeNull();
    expect(out.setup.find((row) => row.key === "rules")?.done).toBe(false);
  });

  it("returns null targets when config is a non-object primitive", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      roster: { ...baseInputs.roster, config: "invalid" as unknown },
    });
    expect(out.targets.avgValueCents).toBeNull();
    expect(out.targets.targetCpbCents).toBeNull();
  });

  it("falls back to '(unnamed organization)' when org.name missing", () => {
    const out = buildRileyMissionResponse({
      ...baseInputs,
      org: { id: "org-1", name: "" },
    });
    expect(out.mission.brand).toBe("(unnamed organization) · —");
  });
});

type PrismaStub = {
  agentRoster: { findFirst: ReturnType<typeof vi.fn> };
  organizationConfig: { findUnique: ReturnType<typeof vi.fn> };
  connection: { findMany: ReturnType<typeof vi.fn> };
  managedChannel: { findMany: ReturnType<typeof vi.fn> };
};

function buildPrismaStub(opts: {
  roster?: unknown;
  org?: unknown;
  connections?: unknown[];
  managedChannels?: unknown[];
}): PrismaStub {
  return {
    agentRoster: { findFirst: vi.fn().mockResolvedValue(opts.roster ?? null) },
    organizationConfig: { findUnique: vi.fn().mockResolvedValue(opts.org ?? null) },
    connection: { findMany: vi.fn().mockResolvedValue(opts.connections ?? []) },
    managedChannel: { findMany: vi.fn().mockResolvedValue(opts.managedChannels ?? []) },
  };
}

async function buildApp(prisma: PrismaStub | null) {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true);
  app.decorate("organizationIdFromAuth", undefined as string | undefined);
  app.decorate("principalIdFromAuth", undefined as string | undefined);
  app.decorate("prisma", prisma as unknown as never);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = undefined;
    (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = undefined;
  });
  await app.register(missionRoute, { prefix: "/api/dashboard" });
  return app;
}

describe("mission route", () => {
  it("200 returns Riley aggregator on /agents/riley/mission", async () => {
    const prisma = buildPrismaStub({
      roster: {
        id: "ros-riley-1",
        organizationId: "org-1",
        agentRole: "optimizer",
        displayName: "Riley",
        description: "",
        status: "active",
        tier: "starter",
        config: { avgValueCents: 12000, targetCpbCents: 2500 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      org: { id: "org-1", name: "HotPod Yoga" },
      connections: [
        { serviceId: "meta-ads", status: "connected" },
        { serviceId: "crm-data-provider", status: "connected" },
      ],
    });
    const app = await buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agentKey: string;
      mission: { role: string; brand: string; channels: Array<{ kind: string }> };
      targets: { roasSource: string };
    };
    expect(body.agentKey).toBe("riley");
    expect(body.mission.role).toBe(
      "Ad optimizer · score, recommend, never act without your approval",
    );
    expect(body.mission.brand).toBe("HotPod Yoga · —");
    expect(body.mission.channels.map((c) => c.kind)).toEqual(["meta-ads"]);
    expect(body.targets.roasSource).toBe("crm");
    // Riley aggregator does NOT call managedChannel.findMany.
    expect(prisma.managedChannel.findMany).not.toHaveBeenCalled();
  });

  it("404 for agents that are not Alex or Riley (e.g. Mira)", async () => {
    const app = await buildApp(buildPrismaStub({}));
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 on unknown agentId", async () => {
    const app = await buildApp(buildPrismaStub({}));
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/zzz/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("503 when prisma is unavailable", async () => {
    const app = await buildApp(null);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("404 when the AgentRoster row does not exist", async () => {
    const prisma = buildPrismaStub({ roster: null, org: { id: "org-1", name: "Acme" } });
    const app = await buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 returns the aggregator shape on the happy path", async () => {
    const prisma = buildPrismaStub({
      roster: {
        id: "ros-1",
        organizationId: "org-1",
        agentRole: "responder",
        displayName: "Alex",
        description: "",
        status: "active",
        tier: "starter",
        config: { priceApprovalThreshold: 89, refundEscalationFloor: 200 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      org: { id: "org-1", name: "HotPod Yoga" },
      connections: [{ serviceId: "meta-ads", status: "connected" }],
      managedChannels: [{ channel: "whatsapp", status: "active" }],
    });
    const app = await buildApp(prisma);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/mission",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { mission: { brand: string; rules: unknown } };
    expect(body.mission.brand).toBe("HotPod Yoga · —");
    expect(body.mission.rules).toEqual({ priceApprovalThreshold: 89, refundEscalationFloor: 200 });
    expect(prisma.agentRoster.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentRole: "responder" },
    });
    expect(prisma.connection.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { serviceId: true, status: true },
    });
    expect(prisma.managedChannel.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { channel: true, status: true },
    });
  });
});
