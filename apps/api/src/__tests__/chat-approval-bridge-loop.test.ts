/**
 * The bridged twin of chat-approval-loop.test.ts: the SAME guarantee (a human
 * approves exactly one frozen action; the system executes it or exposes
 * recovery) driven through the REAL two-process seam: handleApprovalResponse
 * in transport mode -> the REAL HttpApprovalRespondTransport -> fastify
 * inject -> the REAL internal route -> server-side binding re-derivation ->
 * the REAL lifecycle + dispatch engine -> the real Mira read model.
 */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleApprovalResponse,
  HttpApprovalRespondTransport,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  ALREADY_RESPONDED_MSG,
  NOT_AUTHORIZED_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
} from "@switchboard/core";
import type { HandleApprovalResponseConfig } from "@switchboard/core";
import { internalChatApprovalsRoutes } from "../routes/internal-chat-approvals.js";
import { ORG, readerFor } from "./recommendation-handoff-harness.js";
import { buildLifecycleWorld } from "./recommendation-handoff-lifecycle-world.js";
import { synthesizeCreativeBrief } from "../services/workflows/creative-brief-synthesis.js";
import {
  OPERATOR_PRINCIPAL,
  CHANNEL,
  CHANNEL_IDENTIFIER,
  parkViaCron,
  seedLegacyApprovalRow,
  replyCapture,
  bindingStoreFor,
  seedOperatorPrincipal,
} from "./chat-approval-world.js";

const SECRET = "bridge-test-secret";

async function buildBridgeApp(w: ReturnType<typeof buildLifecycleWorld>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", null);
  app.decorate("storageContext", w.storage as never);
  app.decorate("workTraceStore", w.harness.traceStore as never);
  app.decorate("lifecycleService", w.lifecycleService as never);
  app.decorate("platformLifecycle", w.platformLifecycle as never);
  app.decorate("sessionManager", null);
  app.decorate("auditLedger", w.ledger as never);
  await app.register(internalChatApprovalsRoutes, {
    prefix: "/api/internal/chat-approvals",
    bindingStore: bindingStoreFor(ORG, OPERATOR_PRINCIPAL),
  });
  await app.ready();
  return app;
}

/** fetch facade over fastify inject: the transport speaks real HTTP semantics
 * while the request never leaves the process. Precondition: callers pass an
 * ABSOLUTE url (the transport always builds `${baseUrl}/api/...`). */
function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const res = await app.inject({
      method: "POST",
      url: url.pathname,
      headers,
      payload: init?.body as string,
    });
    return new Response(res.body, { status: res.statusCode });
  }) as typeof fetch;
}

function bridgedConfig(app: FastifyInstance, secret = SECRET): HandleApprovalResponseConfig {
  return {
    transport: new HttpApprovalRespondTransport({
      baseUrl: "http://api.internal",
      internalApiSecret: secret,
      fetchImpl: injectFetch(app),
      retryDelayMs: 1,
    }),
  };
}

async function bridgeRespond(
  w: ReturnType<typeof buildLifecycleWorld>,
  app: FastifyInstance,
  payload: { action: "approve" | "reject"; approvalId: string; bindingHash: string },
  opts?: { channelIdentifier?: string; secret?: string },
): Promise<string[]> {
  const { sink, replies } = replyCapture();
  await handleApprovalResponse({
    payload,
    organizationId: ORG,
    channel: CHANNEL,
    channelIdentifier: opts?.channelIdentifier ?? CHANNEL_IDENTIFIER,
    approvalStore: w.storage.approvals,
    replySink: sink,
    config: bridgedConfig(app, opts?.secret),
  });
  return replies;
}

describe("bridged chat approve drives the REAL engine across the process seam", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("happy path: tap -> internal route -> binding re-derivation -> handler ran -> honest reply", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const w = buildLifecycleWorld();
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);
    const parked = await parkViaCron(w);
    // Legacy+lifecycle coexistence leg here (ApprovalRequest row seeded); the
    // remaining tests drive the lifecycle-fallback leg via parked.lifecycleId.
    const approvalId = await seedLegacyApprovalRow(w, parked);

    const replies = await bridgeRespond(w, app, {
      action: "approve",
      approvalId,
      bindingHash: parked.bindingHash,
    });

    // honest reply through the bridge
    expect(replies).toEqual([APPROVE_EXECUTED_MSG]);
    // THE HANDLER RAN: the real workflow handler created the Mira job
    expect(w.harness.jobs).toHaveLength(1);
    const expectedBrief = synthesizeCreativeBrief(null);
    const rm = await readerFor(w.harness.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    expect(rm.jobs.find((j) => j.title === expectedBrief.productDescription)).toBeDefined();
    // canonical records: trace completed, identity is the BINDING principal
    const trace = (await w.harness.traceStore.getByWorkUnitId(parked.workUnitId))!.trace;
    expect(trace.outcome).toBe("completed");
    expect(trace.approvalOutcome).toBe("approved");
    expect(trace.approvalRespondedBy).toBe(OPERATOR_PRINCIPAL);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "approved",
    );
    const dispatches = w.store.listDispatchRecords();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.state).toBe("succeeded");
  });

  it("failure leg + bridged retry: honest failed reply, recovery_required, attempt 2 recovers", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const w = buildLifecycleWorld();
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);
    w.harness.breakHandoffHandlerOnce();
    const parked = await parkViaCron(w);

    const first = await bridgeRespond(w, app, {
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(first).toEqual([APPROVE_DISPATCH_FAILED_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "recovery_required",
    );

    // the SAME button tap through the bridge is approve-on-recovery_required
    const second = await bridgeRespond(w, app, {
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(second).toEqual([APPROVE_EXECUTED_MSG]);
    expect(w.harness.jobs).toHaveLength(1);
    const records = w.store.listDispatchRecords();
    expect(records).toHaveLength(2);
    expect(records[1]?.attemptNumber).toBe(2);
    expect(records[1]?.state).toBe("succeeded");
  });

  it("double-tap: second tap is already_responded with exactly one dispatch", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const w = buildLifecycleWorld();
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);
    const parked = await parkViaCron(w);

    const first = await bridgeRespond(w, app, {
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(first).toEqual([APPROVE_EXECUTED_MSG]);
    const second = await bridgeRespond(w, app, {
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });
    expect(second).toEqual([ALREADY_RESPONDED_MSG]);
    expect(w.store.listDispatchRecords().filter((d) => d.state === "succeeded")).toHaveLength(1);
    expect(w.harness.jobs).toHaveLength(1);
  });

  it("unbound channel identity: NOT_AUTHORIZED through the bridge, nothing mutates", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const w = buildLifecycleWorld();
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);
    const parked = await parkViaCron(w);

    const replies = await bridgeRespond(
      w,
      app,
      { action: "approve", approvalId: parked.lifecycleId, bindingHash: parked.bindingHash },
      { channelIdentifier: "+0000000000" },
    );
    expect(replies).toEqual([NOT_AUTHORIZED_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe("pending");
    expect(w.store.listDispatchRecords()).toHaveLength(0);
  });

  it("a spoofed respondedBy in the wire body is rejected by the route schema", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const w = buildLifecycleWorld();
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);
    const parked = await parkViaCron(w);

    const res = await app.inject({
      method: "POST",
      url: "/api/internal/chat-approvals/respond",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: {
        approvalId: parked.lifecycleId,
        action: "approve",
        bindingHash: parked.bindingHash,
        channel: CHANNEL,
        channelIdentifier: CHANNEL_IDENTIFIER,
        organizationId: ORG,
        respondedBy: "principal-evil",
      },
    });
    expect(res.statusCode).toBe(400);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe("pending");
  });

  it("wrong secret fails closed: honest lookup-error reply, nothing mutates", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const w = buildLifecycleWorld();
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);
    const parked = await parkViaCron(w);

    const replies = await bridgeRespond(
      w,
      app,
      { action: "approve", approvalId: parked.lifecycleId, bindingHash: parked.bindingHash },
      { secret: "wrong-secret" },
    );
    expect(replies).toEqual([APPROVAL_LOOKUP_ERROR_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe("pending");
    expect(w.store.listDispatchRecords()).toHaveLength(0);
  });
});
