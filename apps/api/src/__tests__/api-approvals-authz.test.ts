/**
 * A16: approver-role floor + designated-approver membership on the public
 * respond route (POST /api/approvals/:id/respond).
 *
 * Two distinct controls:
 *  - role floor: requireRole(...APPROVER_ROLES) gates the handler so a
 *    `requester`-only principal (or an unbound one) gets 403 before any work.
 *  - membership: the core respondToParkedLifecycle spine throws
 *    ParkedLifecycleNotAuthorizedError when the revision's approvers list is
 *    non-empty and excludes the responder; the route maps it to 403
 *    not_authorized (not the generic 400).
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  ApprovalLifecycleService,
  InMemoryLifecycleStore,
  createInMemoryStorage,
} from "@switchboard/core";
import { approvalsRoutes } from "../routes/approvals.js";

const ORG = "org-authz";
const okExec = {
  success: true,
  summary: "ran",
  externalRefs: {},
  rollbackAvailable: false,
  partialFailures: [],
  durationMs: 1,
  undoRecipe: null,
};

async function buildApp(opts: {
  authDisabled: boolean;
  principalId?: string;
  roles?: string[];
  lifecycle?: boolean;
  originator?: string;
}) {
  const app = Fastify({ logger: false });
  const storage = createInMemoryStorage();
  if (opts.principalId) {
    await storage.identity.savePrincipal({
      id: opts.principalId,
      type: "user",
      name: "P",
      organizationId: ORG,
      roles: (opts.roles ?? []) as never,
    });
  }
  const lifecycleService = opts.lifecycle
    ? new ApprovalLifecycleService({ store: new InMemoryLifecycleStore() })
    : null;
  const executeApproved = vi.fn(async () => okExec);
  let trace: Record<string, unknown> = {
    workUnitId: "env_lc",
    requestedAt: new Date().toISOString(),
    organizationId: ORG,
    actor: { id: opts.originator ?? "user-orig", type: "user" },
    intent: "test.action",
    parameters: { campaignId: "c1" },
    mode: "skill",
    traceId: "trace-1",
    trigger: "api",
    governanceConstraints: {},
  };
  app.decorate("authDisabled", opts.authDisabled);
  app.decorate("storageContext", storage as never);
  app.decorate("workTraceStore", {
    getByWorkUnitId: vi.fn(async () => ({ trace, integrity: { status: "ok" } })),
    update: vi.fn(async (_id: string, fields: Record<string, unknown>) => {
      trace = { ...trace, ...fields };
      return { ok: true, trace };
    }),
  } as never);
  app.decorate("lifecycleService", lifecycleService as never);
  app.decorate("platformLifecycle", { respondToApproval: vi.fn(), executeApproved } as never);
  app.decorate("sessionManager", null);
  app.decorate("auditLedger", { record: vi.fn(async () => undefined) } as never);
  app.decorateRequest("principalIdFromAuth", undefined);
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.addHook("onRequest", async (request) => {
    request.principalIdFromAuth = opts.principalId;
    request.organizationIdFromAuth = ORG;
  });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.ready();
  return { app, lifecycleService, executeApproved };
}

function parkWithApprovers(lifecycleService: ApprovalLifecycleService, approvers: string[]) {
  return lifecycleService.createGatedLifecycle({
    actionEnvelopeId: "env_lc",
    organizationId: ORG,
    expiresAt: new Date(Date.now() + 3_600_000),
    initialRevision: {
      parametersSnapshot: { campaignId: "c1" },
      approvalScopeSnapshot: { approvers },
      bindingHash: "hash123",
      createdBy: "user-orig",
    },
  });
}

describe("POST /api/approvals/:id/respond — approver-role floor (A16)", () => {
  it("403s a requester-only principal (role floor)", async () => {
    const { app, executeApproved } = await buildApp({
      authDisabled: false,
      principalId: "req_1",
      roles: ["requester"],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/approvals/appr_x/respond",
      payload: { action: "reject" },
    });
    expect(res.statusCode).toBe(403);
    expect(executeApproved).not.toHaveBeenCalled();
    await app.close();
  });

  it("403s when auth is enabled but no principal is bound", async () => {
    const { app } = await buildApp({ authDisabled: false, principalId: undefined });
    const res = await app.inject({
      method: "POST",
      url: "/api/approvals/appr_x/respond",
      payload: { action: "reject" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("lets an approver-role principal past the role floor (downstream 404, not 403)", async () => {
    const { app } = await buildApp({
      authDisabled: false,
      principalId: "op_1",
      roles: ["operator"],
      lifecycle: false,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/approvals/appr_x/respond",
      payload: { action: "reject" },
    });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });
});

describe("POST /api/approvals/:id/respond — designated-approver membership (A16)", () => {
  it("403 not_authorized when a non-member approves a lifecycle with a non-empty approvers list", async () => {
    // authDisabled bypasses the role floor so this isolates the membership spine.
    const { app, lifecycleService, executeApproved } = await buildApp({
      authDisabled: true,
      lifecycle: true,
      originator: "user-orig",
    });
    const { lifecycle } = await parkWithApprovers(lifecycleService!, ["designated_1"]);
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${lifecycle.id}/respond`,
      payload: { action: "approve", respondedBy: "intruder", bindingHash: "hash123" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("not_authorized");
    expect(executeApproved).not.toHaveBeenCalled();
    await app.close();
  });

  it("approves when the responder IS a designated approver", async () => {
    const { app, lifecycleService, executeApproved } = await buildApp({
      authDisabled: true,
      lifecycle: true,
      originator: "user-orig",
    });
    const { lifecycle } = await parkWithApprovers(lifecycleService!, ["designated_1"]);
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${lifecycle.id}/respond`,
      payload: { action: "approve", respondedBy: "designated_1", bindingHash: "hash123" },
    });
    expect(res.statusCode).toBe(200);
    expect(executeApproved).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
