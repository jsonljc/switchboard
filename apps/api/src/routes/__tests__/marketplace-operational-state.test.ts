import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const mockDeploymentStore = { findById: vi.fn() };
const mockOperationalStateStore = { getLatest: vi.fn(), recordConfirmation: vi.fn() };

vi.mock("@switchboard/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@switchboard/db")>()),
  PrismaDeploymentStore: vi.fn(() => mockDeploymentStore),
  PrismaOperationalStateStore: vi.fn(() => mockOperationalStateStore),
}));

import { marketplaceOperationalStateRoutes } from "../marketplace-operational-state.js";

const CONFIRMATION = {
  id: "osc_1",
  organizationId: "org-1",
  state: { staffing: "shortfall" },
  confirmedBy: "principal-7",
  confirmedAt: new Date("2026-06-05T02:00:00.000Z"),
  createdAt: new Date("2026-06-05T02:00:00.000Z"),
};

function buildApp(orgId: string | null, principalId?: string): FastifyInstance {
  const app = Fastify();
  app.decorate("prisma", {} as never);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth: string | null }).organizationIdFromAuth = orgId;
    if (principalId !== undefined) {
      (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = principalId;
    }
  });
  app.register(marketplaceOperationalStateRoutes);
  return app;
}

describe("POST /deployments/:id/operational-state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a confirmation keyed to the authed org with route-supplied confirmedAt and the auth principal", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue(CONFIRMATION);
    const app = buildApp("org-1", "principal-7");
    const before = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().confirmation.id).toBe("osc_1");
    const [orgArg, stateArg, optsArg] =
      mockOperationalStateStore.recordConfirmation.mock.calls[0] ?? [];
    expect(orgArg).toBe("org-1");
    expect(stateArg).toEqual({ staffing: "shortfall" });
    expect(optsArg.confirmedBy).toBe("principal-7");
    // confirmedAt is the route's own clock at handling time, never client input.
    expect(optsArg.confirmedAt).toBeInstanceOf(Date);
    expect(optsArg.confirmedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(optsArg.confirmedAt.getTime()).toBeLessThanOrEqual(Date.now());
    await app.close();
  });

  it("strips client-supplied confirmedAt/confirmedBy and never forwards them to the store", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue(CONFIRMATION);
    const app = buildApp("org-1", "principal-7");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall", confirmedAt: "2020-01-01T00:00:00.000Z" },
    });
    // OperationalStateSchema is a plain z.object (strips unknown keys), so the
    // stale timestamp never reaches the store; the parsed state carries only
    // operational dimensions. confirmedAt remains exclusively the route's own
    // clock (pinned in the first POST test).
    expect(res.statusCode).toBe(201);
    const [, stateArg] = mockOperationalStateStore.recordConfirmation.mock.calls[0] ?? [];
    expect(stateArg).toEqual({ staffing: "shortfall" });
    await app.close();
  });

  it("omits confirmedBy entirely when auth carries no principal (stores NULL, invents nothing)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue({
      ...CONFIRMATION,
      confirmedBy: null,
    });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall" },
    });
    expect(res.statusCode).toBe(201);
    const [, , optsArg] = mockOperationalStateStore.recordConfirmation.mock.calls[0] ?? [];
    expect(Object.prototype.hasOwnProperty.call(optsArg, "confirmedBy")).toBe(false);
    await app.close();
  });

  it("accepts explicit empty arrays (operator confirmed NONE, distinct from absent)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue({
      ...CONFIRMATION,
      state: { promoWindows: [], closures: [] },
    });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { promoWindows: [], closures: [] },
    });
    expect(res.statusCode).toBe(201);
    const [, stateArg] = mockOperationalStateStore.recordConfirmation.mock.calls[0] ?? [];
    expect(stateArg).toEqual({ promoWindows: [], closures: [] });
    await app.close();
  });

  it("each save is a fresh recordConfirmation call (append-only; no update API exists)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.recordConfirmation.mockResolvedValue(CONFIRMATION);
    const app = buildApp("org-1");
    const payload = { staffing: "shortfall" };
    await app.inject({ method: "POST", url: "/deployments/dep-1/operational-state", payload });
    await app.inject({ method: "POST", url: "/deployments/dep-1/operational-state", payload });
    expect(mockOperationalStateStore.recordConfirmation).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("rejects a note-only payload (400) and does NOT write (a note alone is not a confirmation)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { note: "all quiet" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toBeDefined();
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects an empty payload (400) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects unknown enum values (400) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { operatingStatus: "closed" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a cross-org deployment id (404, no existence leak) and does NOT write", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-OTHER" });
    const app = buildApp("org-1");
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall" },
    });
    expect(res.statusCode).toBe(404);
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when unauthenticated and does NOT write", async () => {
    const app = buildApp(null);
    const res = await app.inject({
      method: "POST",
      url: "/deployments/dep-1/operational-state",
      payload: { staffing: "shortfall" },
    });
    expect(res.statusCode).toBe(401);
    expect(mockOperationalStateStore.recordConfirmation).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("GET /deployments/:id/operational-state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the latest confirmation for the authed org", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.getLatest.mockResolvedValue(CONFIRMATION);
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/operational-state" });
    expect(res.statusCode).toBe(200);
    expect(mockOperationalStateStore.getLatest).toHaveBeenCalledWith("org-1");
    const body = res.json();
    expect(body.confirmation.state).toEqual({ staffing: "shortfall" });
    expect(body.confirmation.confirmedAt).toBe("2026-06-05T02:00:00.000Z");
    await app.close();
  });

  it("returns { confirmation: null } when the org has never confirmed (honest absence)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-1" });
    mockOperationalStateStore.getLatest.mockResolvedValue(null);
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/operational-state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ confirmation: null });
    await app.close();
  });

  it("rejects a cross-org deployment id with 404 (no existence leak)", async () => {
    mockDeploymentStore.findById.mockResolvedValue({ id: "dep-1", organizationId: "org-OTHER" });
    const app = buildApp("org-1");
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/operational-state" });
    expect(res.statusCode).toBe(404);
    expect(mockOperationalStateStore.getLatest).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp(null);
    const res = await app.inject({ method: "GET", url: "/deployments/dep-1/operational-state" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
