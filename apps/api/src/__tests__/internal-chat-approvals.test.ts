import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalLifecycleService,
  InMemoryLifecycleStore,
  createInMemoryStorage,
  createApprovalState,
} from "@switchboard/core";
import type { OperatorChannelBindingStore } from "@switchboard/core";
import { internalChatApprovalsRoutes } from "../routes/internal-chat-approvals.js";

const SECRET = "test-internal-secret";
const ORG = "org-bridge";
const OPERATOR = "principal-op-1";
const ROUTE = "/api/internal/chat-approvals/respond";

function bindingStoreFor(principalId: string | null): OperatorChannelBindingStore {
  return {
    findActiveBinding: vi.fn(
      async (q: { organizationId: string; channel: string; channelIdentifier: string }) =>
        principalId && q.organizationId === ORG && q.channel === "whatsapp"
          ? ({ principalId } as never)
          : null,
    ),
  };
}

async function buildApp(opts?: {
  bindingStore?: OperatorChannelBindingStore;
  prisma?: unknown;
  lifecycle?: boolean;
}) {
  const app = Fastify({ logger: false });
  const storage = createInMemoryStorage();
  await storage.identity.savePrincipal({
    id: OPERATOR,
    type: "user",
    name: "Op",
    organizationId: ORG,
    roles: ["operator"],
  });
  const lifecycleService = opts?.lifecycle
    ? new ApprovalLifecycleService({ store: new InMemoryLifecycleStore() })
    : null;
  const okExec = {
    success: true,
    summary: "ran",
    externalRefs: {},
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 1,
    undoRecipe: null,
  };
  const executeApproved = vi.fn(async () => okExec);
  const respondToApprovalSpy = vi.fn(async (_params: Record<string, unknown>) => ({
    envelope: { id: "env_1" },
    approvalState: { status: "approved" },
    executionResult: okExec,
  }));
  // Trace stub: shapes mirror makeLifecycleWorld in core's
  // approval-response-fixtures.ts so the four-eyes guard and the parked
  // dispatch leg have a trace to read/update.
  let trace: Record<string, unknown> = {
    workUnitId: "env_lc",
    requestedAt: new Date().toISOString(),
    organizationId: ORG,
    actor: { id: "user-orig", type: "user" },
    intent: "test.action",
    parameters: { campaignId: "c1" },
    mode: "skill",
    traceId: "trace-1",
    trigger: "api",
    governanceConstraints: {},
  };
  app.decorate("prisma", (opts?.prisma === undefined ? {} : opts.prisma) as never);
  app.decorate("storageContext", storage as never);
  app.decorate("workTraceStore", {
    getByWorkUnitId: vi.fn(async () => ({ trace, integrity: { status: "ok" } })),
    update: vi.fn(async (_id: string, fields: Record<string, unknown>) => {
      trace = { ...trace, ...fields };
      return { ok: true, trace };
    }),
  } as never);
  app.decorate("lifecycleService", lifecycleService as never);
  app.decorate("platformLifecycle", {
    respondToApproval: respondToApprovalSpy,
    executeApproved,
  } as never);
  app.decorate("sessionManager", null);
  app.decorate("auditLedger", { record: vi.fn(async () => undefined) } as never);
  await app.register(internalChatApprovalsRoutes, {
    prefix: "/api/internal/chat-approvals",
    bindingStore: opts?.bindingStore,
  });
  await app.ready();
  return { app, storage, lifecycleService, executeApproved, respondToApprovalSpy };
}

function inject(
  app: FastifyInstance,
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
) {
  return app.inject({ method: "POST", url: ROUTE, headers, payload: body });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    approvalId: "appr_1",
    action: "approve",
    bindingHash: "hash123",
    channel: "whatsapp",
    channelIdentifier: "+6591234567",
    organizationId: ORG,
    ...overrides,
  };
}

async function seedLegacyApproval(
  storage: ReturnType<typeof createInMemoryStorage>,
  overrides: { organizationId?: string } = {},
) {
  await storage.approvals.save({
    request: { id: "appr_1", bindingHash: "hash123" } as never,
    state: createApprovalState(new Date(Date.now() + 3_600_000), null),
    envelopeId: "env_1",
    organizationId: overrides.organizationId ?? ORG,
  });
}

function parkLifecycle(
  lifecycleService: ApprovalLifecycleService,
  opts: { envelopeId: string; bindingHash: string; expiresAt?: Date },
) {
  return lifecycleService.createGatedLifecycle({
    actionEnvelopeId: opts.envelopeId,
    organizationId: ORG,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: { campaignId: "c1" },
      approvalScopeSnapshot: {},
      bindingHash: opts.bindingHash,
      createdBy: "user-orig",
    },
  });
}

describe("auth and shape", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("503 bridge_not_configured when INTERNAL_API_SECRET is unset", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const { app } = await buildApp({ bindingStore: bindingStoreFor(OPERATOR) });
    const res = await inject(app, validBody());
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("bridge_not_configured");
  });

  it("401 when the Authorization header is missing, wrong, or Bearer-less", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app } = await buildApp({ bindingStore: bindingStoreFor(OPERATOR) });
    expect((await inject(app, validBody(), {})).statusCode).toBe(401);
    expect((await inject(app, validBody(), { authorization: "Bearer wrong" })).statusCode).toBe(
      401,
    );
    expect((await inject(app, validBody(), { authorization: SECRET })).statusCode).toBe(401);
  });

  it("400 on missing fields; engine untouched", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, respondToApprovalSpy } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
    });
    expect((await inject(app, { approvalId: "appr_1" })).statusCode).toBe(400);
    expect(respondToApprovalSpy).not.toHaveBeenCalled();
  });

  it.each(["respondedBy", "principalId", "operatorId", "userId", "roles"])(
    "400s smuggled identity key %s (strict schema)",
    async (key) => {
      vi.stubEnv("INTERNAL_API_SECRET", SECRET);
      const { app, respondToApprovalSpy } = await buildApp({
        bindingStore: bindingStoreFor(OPERATOR),
      });
      const res = await inject(app, validBody({ [key]: "evil" }));
      expect(res.statusCode).toBe(400);
      expect(respondToApprovalSpy).not.toHaveBeenCalled();
    },
  );

  it("503 when no binding store can be built (prisma null, no override)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app } = await buildApp({ prisma: null });
    const res = await inject(app, validBody());
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("bridge_not_configured");
  });
});

describe("server-side identity derivation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("derives respondedBy from the binding, never from the wire", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, storage, respondToApprovalSpy } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
    });
    await seedLegacyApproval(storage);
    const res = await inject(app, validBody());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: "responded", action: "approve", executionSuccess: true });
    expect(respondToApprovalSpy).toHaveBeenCalledTimes(1);
    expect(respondToApprovalSpy.mock.calls[0]![0]).toMatchObject({ respondedBy: OPERATOR });
  });

  it("refuses not_authorized when no binding exists; engine untouched", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, storage, respondToApprovalSpy } = await buildApp({
      bindingStore: bindingStoreFor(null),
    });
    await seedLegacyApproval(storage);
    const res = await inject(app, validBody());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: "refused", code: "not_authorized" });
    expect(respondToApprovalSpy).not.toHaveBeenCalled();
  });

  it("wrong channel for a real principal refuses not_authorized", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, storage } = await buildApp({ bindingStore: bindingStoreFor(OPERATOR) });
    await seedLegacyApproval(storage);
    const res = await inject(app, validBody({ channel: "telegram" }));
    expect(res.json()).toEqual({ kind: "refused", code: "not_authorized" });
  });

  it("org scoping: a foreign-org approval is not_found; engine untouched", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, storage, respondToApprovalSpy } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
    });
    await seedLegacyApproval(storage, { organizationId: "org-foreign" });
    const res = await inject(app, validBody());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: "refused", code: "not_found" });
    expect(respondToApprovalSpy).not.toHaveBeenCalled();
  });

  it("revocation is immediate: revoked binding refuses the next tap", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    let active = true;
    const bindingStore: OperatorChannelBindingStore = {
      findActiveBinding: async () => (active ? ({ principalId: OPERATOR } as never) : null),
    };
    const { app, lifecycleService, executeApproved } = await buildApp({
      bindingStore,
      lifecycle: true,
    });
    const first = await parkLifecycle(lifecycleService!, {
      envelopeId: "env_lc1",
      bindingHash: "hash-1",
    });
    const ok = await inject(
      app,
      validBody({ approvalId: first.lifecycle.id, bindingHash: "hash-1" }),
    );
    expect(ok.json()).toEqual({ kind: "responded", action: "approve", executionSuccess: true });

    active = false; // operator unbound between taps
    const second = await parkLifecycle(lifecycleService!, {
      envelopeId: "env_lc2",
      bindingHash: "hash-2",
    });
    const refused = await inject(
      app,
      validBody({ approvalId: second.lifecycle.id, bindingHash: "hash-2" }),
    );
    expect(refused.json()).toEqual({ kind: "refused", code: "not_authorized" });
    expect(executeApproved).toHaveBeenCalledTimes(1);
  });
});

describe("flow outcomes over a real in-memory lifecycle (fallback leg)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("double-tap: first approve dispatches once, second returns already_responded", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, lifecycleService, executeApproved } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
      lifecycle: true,
    });
    const { lifecycle } = await parkLifecycle(lifecycleService!, {
      envelopeId: "env_lc",
      bindingHash: "hash-lc",
    });
    const body = validBody({ approvalId: lifecycle.id, bindingHash: "hash-lc" });
    const first = await inject(app, body);
    expect(first.json()).toEqual({ kind: "responded", action: "approve", executionSuccess: true });
    const second = await inject(app, body);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ kind: "refused", code: "already_responded" });
    expect(executeApproved).toHaveBeenCalledTimes(1);
  });

  it("stale hash refuses before any mutation", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, lifecycleService } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
      lifecycle: true,
    });
    const { lifecycle } = await parkLifecycle(lifecycleService!, {
      envelopeId: "env_lc",
      bindingHash: "hash-lc",
    });
    const res = await inject(app, validBody({ approvalId: lifecycle.id, bindingHash: "wrong" }));
    expect(res.json()).toEqual({ kind: "refused", code: "stale" });
    expect((await lifecycleService!.getLifecycleById(lifecycle.id))?.status).toBe("pending");
  });

  it("expiry replay refuses with expired", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, lifecycleService } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
      lifecycle: true,
    });
    const { lifecycle } = await parkLifecycle(lifecycleService!, {
      envelopeId: "env_exp",
      bindingHash: "hash-exp",
      expiresAt: new Date(Date.now() - 1_000),
    });
    const res = await inject(app, validBody({ approvalId: lifecycle.id, bindingHash: "hash-exp" }));
    expect(res.json()).toEqual({ kind: "refused", code: "expired" });
  });

  it("reject responds through the parked leg", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, lifecycleService } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
      lifecycle: true,
    });
    const { lifecycle } = await parkLifecycle(lifecycleService!, {
      envelopeId: "env_lc",
      bindingHash: "hash-lc",
    });
    const res = await inject(app, validBody({ approvalId: lifecycle.id, action: "reject" }));
    expect(res.json()).toEqual({ kind: "responded", action: "reject", executionSuccess: null });
  });
});
