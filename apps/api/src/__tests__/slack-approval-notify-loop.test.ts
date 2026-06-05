/**
 * The outbound twin of chat-approval-bridge-loop.test.ts: prove that the
 * notification a REAL SlackApprovalNotifier sends at park time contains button
 * values that drive the REAL engine through the REAL bridge. Loop under test:
 * park (real cron submit) -> park-hook notification (real notifier, captured
 * chat.postMessage) -> button value -> REAL parseApprovalResponsePayload ->
 * REAL handleApprovalResponse in transport mode -> REAL internal route with a
 * slack U... binding -> server-side re-derivation -> dispatch -> honest reply.
 */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleApprovalResponse,
  HttpApprovalRespondTransport,
  parseApprovalResponsePayload,
  APPROVE_EXECUTED_MSG,
  REJECT_SUCCESS_MSG,
  NOT_AUTHORIZED_MSG,
} from "@switchboard/core";
import type { HandleApprovalResponseConfig, OperatorChannelBindingStore } from "@switchboard/core";
import { SlackApprovalNotifier } from "@switchboard/core/notifications";
import { internalChatApprovalsRoutes } from "../routes/internal-chat-approvals.js";
import { ORG, readerFor } from "./recommendation-handoff-harness.js";
import { buildLifecycleWorld } from "./recommendation-handoff-lifecycle-world.js";
import {
  OPERATOR_PRINCIPAL,
  parkViaCron,
  replyCapture,
  seedOperatorPrincipal,
} from "./chat-approval-world.js";

const SECRET = "bridge-test-secret";
const OPS_CHANNEL = "C_OPS_PILOT";
const SLACK_OPERATOR = "U_OP_1";

/** Org-and-triple-exact binding for the SLACK operator (the bridged authority row). */
function slackBindingStore(): OperatorChannelBindingStore {
  return {
    findActiveBinding: async (q) =>
      q.organizationId === ORG && q.channel === "slack" && q.channelIdentifier === SLACK_OPERATOR
        ? ({ principalId: OPERATOR_PRINCIPAL } as never)
        : null,
  };
}

/** Capture chat.postMessage bodies from the REAL notifier via a stubbed global fetch. */
function stubSlackFetch(opts: { failWith?: number } = {}): Array<Record<string, unknown>> {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (opts.failWith) {
        return new Response("{}", { status: opts.failWith });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
  return posts;
}

function buttonValue(post: Record<string, unknown>, actionId: string): string {
  const blocks = post["blocks"] as Array<{
    type: string;
    elements?: Array<{ action_id: string; value: string }>;
  }>;
  const actions = blocks.find((b) => b.type === "actions");
  const btn = actions?.elements?.find((e) => e.action_id === actionId);
  if (!btn) throw new Error(`button ${actionId} not found in notification`);
  return btn.value;
}

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
    bindingStore: slackBindingStore(),
  });
  await app.ready();
  return app;
}

/** fetch facade over fastify inject: the transport speaks real HTTP semantics
 * while the request never leaves the process. */
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

function bridgedConfig(app: FastifyInstance): HandleApprovalResponseConfig {
  return {
    transport: new HttpApprovalRespondTransport({
      baseUrl: "http://api.internal",
      internalApiSecret: SECRET,
      fetchImpl: injectFetch(app),
      retryDelayMs: 1,
    }),
  };
}

async function tapButton(
  w: ReturnType<typeof buildLifecycleWorld>,
  app: FastifyInstance,
  value: string,
  channelIdentifier = SLACK_OPERATOR,
): Promise<string[]> {
  const payload = parseApprovalResponsePayload(value);
  expect(payload).not.toBeNull();
  const { sink, replies } = replyCapture();
  await handleApprovalResponse({
    payload: payload!,
    organizationId: ORG,
    channel: "slack",
    channelIdentifier,
    approvalStore: w.storage.approvals,
    replySink: sink,
    config: bridgedConfig(app),
  });
  return replies;
}

describe("a notifier-built Slack button drives the REAL engine through the REAL bridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("park -> notification -> approve tap -> handler ran -> honest reply", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const posts = stubSlackFetch();
    const notifier = new SlackApprovalNotifier("xoxb-test", {
      defaultConversationId: OPS_CHANNEL,
    });
    const w = buildLifecycleWorld({ approvalNotifier: notifier });
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);

    const parked = await parkViaCron(w);
    await vi.waitFor(() => expect(posts).toHaveLength(1));

    // The notification targeted the configured operator conversation and its
    // approve button value IS the parser-canonical payload for the parked unit.
    expect(posts[0]!["channel"]).toBe(OPS_CHANNEL);
    const approveValue = buttonValue(posts[0]!, "approval_approve");
    expect(parseApprovalResponsePayload(approveValue)).toEqual({
      action: "approve",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });

    const replies = await tapButton(w, app, approveValue);

    expect(replies).toEqual([APPROVE_EXECUTED_MSG]);
    // THE HANDLER RAN: the real workflow handler created the Mira job.
    expect(w.harness.jobs).toHaveLength(1);
    const rm = await readerFor(w.harness.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    expect(rm.jobs).toHaveLength(1);
    const trace = (await w.harness.traceStore.getByWorkUnitId(parked.workUnitId))!.trace;
    expect(trace.outcome).toBe("completed");
    expect(trace.approvalRespondedBy).toBe(OPERATOR_PRINCIPAL);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "approved",
    );
    const dispatches = w.store.listDispatchRecords();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.state).toBe("succeeded");
  });

  it("the reject button ends the lifecycle rejected with zero dispatches", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const posts = stubSlackFetch();
    const notifier = new SlackApprovalNotifier("xoxb-test", {
      defaultConversationId: OPS_CHANNEL,
    });
    const w = buildLifecycleWorld({ approvalNotifier: notifier });
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);

    const parked = await parkViaCron(w);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    const rejectValue = buttonValue(posts[0]!, "approval_reject");
    expect(parseApprovalResponsePayload(rejectValue)).toEqual({
      action: "reject",
      approvalId: parked.lifecycleId,
      bindingHash: parked.bindingHash,
    });

    const replies = await tapButton(w, app, rejectValue);

    expect(replies).toEqual([REJECT_SUCCESS_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "rejected",
    );
    expect(w.store.listDispatchRecords()).toHaveLength(0);
    expect(w.harness.jobs).toHaveLength(0);
  });

  it("an unbound Slack identity refuses NOT_AUTHORIZED and mutates nothing", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const posts = stubSlackFetch();
    const notifier = new SlackApprovalNotifier("xoxb-test", {
      defaultConversationId: OPS_CHANNEL,
    });
    const w = buildLifecycleWorld({ approvalNotifier: notifier });
    await seedOperatorPrincipal(w);
    const app = await buildBridgeApp(w);

    const parked = await parkViaCron(w);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    const approveValue = buttonValue(posts[0]!, "approval_approve");

    const replies = await tapButton(w, app, approveValue, "U_INTRUDER");

    expect(replies).toEqual([NOT_AUTHORIZED_MSG]);
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe("pending");
    expect(w.store.listDispatchRecords()).toHaveLength(0);
  });

  it("delivery failure is logged, the park is intact, the approval stays actionable", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const posts = stubSlackFetch({ failWith: 500 });
    const notifier = new SlackApprovalNotifier("xoxb-test", {
      defaultConversationId: OPS_CHANNEL,
    });
    const w = buildLifecycleWorld({ approvalNotifier: notifier });
    await seedOperatorPrincipal(w);

    const parked = await parkViaCron(w);
    await vi.waitFor(() =>
      expect(
        errorSpy.mock.calls.some((c) => String(c[0]).includes("[SlackApprovalNotifier]")),
      ).toBe(true),
    );

    expect(posts).toHaveLength(1);
    expect(parked.lifecycleId).toBeDefined();
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe("pending");
  });
});
