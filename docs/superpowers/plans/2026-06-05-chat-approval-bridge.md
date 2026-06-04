# Chat Approval Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat approvals real in production: a WhatsApp/Slack approve tap in the two-process topology executes the frozen action through the real engine (or surfaces recovery) with the existing honest replies, with the operator principal derived server-side from OperatorChannelBinding, never from the wire.

**Architecture:** Extract the gateway's auth-bearing respond flow into one outcome-returning core function (`respondToChannelApproval`); expose it on the API as an INTERNAL_API_SECRET-authenticated internal route; give the gateway a transport seam (`ApprovalRespondTransport`) plus the production HTTP implementation in core; the chat process thin-forwards attested channel identity. Spec: `docs/superpowers/specs/2026-06-05-chat-approval-bridge-design.md`.

**Tech Stack:** TypeScript ESM (`.js` relative imports), Fastify, Zod, vitest, pnpm + Turborepo.

**Delivery:** Four sequential file-disjoint PRs. Full gate before each push: `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm arch:check`. Conventional commits, lowercase subject first word. No em-dashes anywhere. No new env vars. Known full-suite flakes (rerun once before investigating): chat gateway-bridge-attribution, pg_advisory, bootstrap-smoke, api-auth prod-hardening.

**File map (all PRs):**

| PR           | Files                                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR-1 (core)  | C `channel-gateway/respond-to-channel-approval.ts`, C `channel-gateway/http-approval-respond-transport.ts`, M `channel-gateway/handle-approval-response.ts`, M `channel-gateway/types.ts`, M `channel-gateway/index.ts`, M `channel-gateway/__tests__/channel-gateway-approval.test.ts` (terminal-branch case), C 3 test files |
| PR-2 (api)   | C `routes/internal-chat-approvals.ts`, M `middleware/auth.ts`, M `validation.ts`, M `bootstrap/routes.ts`, C 1 test file, M `__tests__/api-auth.test.ts` (exclusion exactness)                                                                                                                                                 |
| PR-3 (proof) | C `__tests__/chat-approval-world.ts`, M `__tests__/chat-approval-loop.test.ts` (imports only), C `__tests__/chat-approval-bridge-loop.test.ts`                                                                                                                                                                                 |
| PR-4 (flip)  | M `gateway/gateway-bridge.ts`, M `main.ts` (comment), M `gateway/__tests__/gateway-bridge.test.ts`                                                                                                                                                                                                                             |

Sequencing (review amendment): the e2e proof lands BEFORE the chat wiring so the full
bridge proof is on main before anything can go live. PR-4 is the activation PR, gated by
the spec section 5 pre-flip hardening checklist. The PR-3/PR-4 section bodies below are
ordered accordingly; branch each from fresh origin/main after its predecessor merges.

---

## PR-1: core seam (`packages/core` only)

Branch: `feat/chat-approval-bridge-core`

### Task 1: outcome-returning core flow `respondToChannelApproval`

**Files:**

- Create: `packages/core/src/channel-gateway/respond-to-channel-approval.ts`
- Test: `packages/core/src/channel-gateway/__tests__/respond-to-channel-approval.test.ts`

- [ ] **Step 1.1: Write the failing test file**

```ts
// packages/core/src/channel-gateway/__tests__/respond-to-channel-approval.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  respondToChannelApproval,
  refusalCodeForError,
  type ChannelApprovalRespondDeps,
  type ChannelApprovalRespondRequest,
} from "../respond-to-channel-approval.js";
import { StaleVersionError } from "../../approval/state-machine.js";
import {
  ParkedLifecycleNotFoundError,
  ParkedLifecycleAlreadyRespondedError,
  ParkedLifecycleExpiredError,
} from "../../approval/respond-to-parked-lifecycle.js";
import { DispatchAdmissionError } from "../../approval/dispatch-admission.js";
import {
  PAYLOAD,
  REJECT_PAYLOAD,
  BASE_ARGS,
  makeApproval,
  makeStore,
  makeBindingStore,
  makeIdentityStore,
  makePrincipal,
  makeRespondDeps,
  makeLifecycleWorld,
} from "./approval-response-fixtures.js";

function makeRequest(
  overrides: Partial<ChannelApprovalRespondRequest> = {},
): ChannelApprovalRespondRequest {
  return {
    approvalId: PAYLOAD.approvalId,
    action: PAYLOAD.action,
    bindingHash: PAYLOAD.bindingHash,
    organizationId: BASE_ARGS.organizationId,
    channel: BASE_ARGS.channel,
    channelIdentifier: BASE_ARGS.channelIdentifier,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ChannelApprovalRespondDeps> = {}): ChannelApprovalRespondDeps {
  return {
    approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval())),
    bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
    identityStore: makeIdentityStore(makePrincipal(["operator"])),
    respondDeps: makeRespondDeps() as never,
    ...overrides,
  };
}

describe("respondToChannelApproval: legacy-row leg refusals", () => {
  it("returns lookup_error when getById throws", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockRejectedValue(new Error("db down"))),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "lookup_error",
    });
  });

  it("returns not_found on org mismatch (no existence leak)", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(
        vi.fn().mockResolvedValue(makeApproval({ organizationId: "org-other" })),
      ),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_found",
    });
  });

  it("returns not_found when stored organizationId is null", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval({ organizationId: null }))),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_found",
    });
  });

  it("returns already_responded when state is not pending", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval({ status: "approved" }))),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "already_responded",
    });
  });

  it("returns stale on binding hash mismatch (timing-safe compare)", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(
        vi.fn().mockResolvedValue(makeApproval({ bindingHash: "different" })),
      ),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "stale",
    });
  });

  it("returns stale when stored hash is empty (defensive)", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockResolvedValue(makeApproval({ bindingHash: "" }))),
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "stale",
    });
  });

  it("returns not_authorized when the authority stack is unwired (fail closed)", async () => {
    const deps = makeDeps({ bindingStore: null, identityStore: null, respondDeps: null });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_authorized",
    });
  });

  it("returns not_authorized when no active binding exists", async () => {
    const deps = makeDeps({ bindingStore: makeBindingStore(null) });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_authorized",
    });
  });

  it("returns not_authorized when the principal lacks an approver role", async () => {
    const deps = makeDeps({ identityStore: makeIdentityStore(makePrincipal(["requester"])) });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_authorized",
    });
  });

  it("returns not_authorized when the principal record is missing", async () => {
    const deps = makeDeps({ identityStore: makeIdentityStore(null) });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_authorized",
    });
  });

  it("queries the binding with the attested identity triple", async () => {
    const bindingStore = makeBindingStore({ principalId: "principal-1" } as never);
    const deps = makeDeps({ bindingStore });
    await respondToChannelApproval(deps, makeRequest());
    expect(bindingStore.findActiveBinding).toHaveBeenCalledWith({
      organizationId: BASE_ARGS.organizationId,
      channel: BASE_ARGS.channel,
      channelIdentifier: BASE_ARGS.channelIdentifier,
    });
  });
});

describe("respondToChannelApproval: legacy-row leg responds", () => {
  it("approve drives the engine with the binding principal and returns executionSuccess true", async () => {
    const respondDeps = makeRespondDeps();
    const deps = makeDeps({ respondDeps: respondDeps as never });
    const outcome = await respondToChannelApproval(deps, makeRequest());
    expect(outcome).toEqual({ kind: "responded", action: "approve", executionSuccess: true });
    expect(respondDeps.platformLifecycle.respondToApproval).toHaveBeenCalledWith(
      expect.objectContaining({ respondedBy: "principal-1", action: "approve" }),
    );
  });

  it("reject responds with executionSuccess null", async () => {
    const respondDeps = makeRespondDeps();
    respondDeps.platformLifecycle.respondToApproval = vi.fn().mockResolvedValue({
      envelope: { id: "env_1" },
      approvalState: { status: "rejected" },
      executionResult: null,
    });
    const deps = makeDeps({ respondDeps: respondDeps as never });
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ action: REJECT_PAYLOAD.action }),
    );
    expect(outcome).toEqual({ kind: "responded", action: "reject", executionSuccess: null });
  });

  it("maps a thrown engine error through refusalCodeForError", async () => {
    const deps = makeDeps({ respondDeps: makeRespondDeps({ throwInRespond: true }) as never });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "execution_error",
    });
  });
});

describe("respondToChannelApproval: lifecycle fallback leg", () => {
  it("returns not_found when no approval row and no lifecycle stack", async () => {
    const deps = makeDeps({
      approvalStore: makeStore(vi.fn().mockResolvedValue(null)),
      respondDeps: null,
      bindingStore: null,
      identityStore: null,
    });
    expect(await respondToChannelApproval(deps, makeRequest())).toEqual({
      kind: "refused",
      code: "not_found",
    });
  });

  it("approves a parked lifecycle through the real service and dispatch spy", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id }),
    );
    expect(outcome).toEqual({ kind: "responded", action: "approve", executionSuccess: true });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
    expect((await w.lifecycleService.getLifecycleById(w.lifecycle.id))?.status).toBe("approved");
  });

  it("fallback org mismatch returns not_found", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id, organizationId: "org-other" }),
    );
    expect(outcome).toEqual({ kind: "refused", code: "not_found" });
    expect(w.executeApproved).not.toHaveBeenCalled();
  });

  it("fallback approve refuses a hash that does not match the current revision", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id, bindingHash: "wrong-hash" }),
    );
    expect(outcome).toEqual({ kind: "refused", code: "stale" });
  });

  it("fallback reject skips the hash pre-check and responds", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const outcome = await respondToChannelApproval(
      deps,
      makeRequest({ approvalId: w.lifecycle.id, action: "reject", bindingHash: "wrong-hash" }),
    );
    expect(outcome).toEqual({ kind: "responded", action: "reject", executionSuccess: null });
  });

  it("double respond returns already_responded with exactly one dispatch", async () => {
    const w = await makeLifecycleWorld({ noApprovalRow: true });
    const deps: ChannelApprovalRespondDeps = {
      approvalStore: w.approvalStore,
      bindingStore: makeBindingStore({ principalId: "principal-1" } as never),
      identityStore: makeIdentityStore(makePrincipal(["operator"])),
      respondDeps: w.respondDeps as never,
    };
    const req = makeRequest({ approvalId: w.lifecycle.id });
    expect(await respondToChannelApproval(deps, req)).toEqual({
      kind: "responded",
      action: "approve",
      executionSuccess: true,
    });
    expect(await respondToChannelApproval(deps, req)).toEqual({
      kind: "refused",
      code: "already_responded",
    });
    expect(w.executeApproved).toHaveBeenCalledTimes(1);
  });
});

describe("refusalCodeForError", () => {
  it.each([
    [new StaleVersionError("v"), "conflict"],
    [new Error('Cannot approve: lifecycle status is "approved"'), "conflict"],
    [new Error("stale binding hash"), "stale"],
    [new Error("Self-approval is not permitted"), "self_approval"],
    [new Error("anything else"), "execution_error"],
    ["not-an-error", "execution_error"],
  ])("maps %s to %s", (err, code) => {
    expect(refusalCodeForError(err)).toBe(code);
  });

  it("maps the parked error family and admission errors to their codes", () => {
    // Use the real constructors; check signatures in respond-to-parked-lifecycle.ts
    // and dispatch-admission.ts during RED and adjust arguments if they differ.
    expect(refusalCodeForError(new ParkedLifecycleNotFoundError("lc-1"))).toBe("not_found");
    expect(refusalCodeForError(new ParkedLifecycleAlreadyRespondedError("lc-1", "approved"))).toBe(
      "already_responded",
    );
    expect(refusalCodeForError(new ParkedLifecycleExpiredError("lc-1"))).toBe("expired");
    expect(refusalCodeForError(Object.create(DispatchAdmissionError.prototype) as Error)).toBe(
      "admission_failed",
    );
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- respond-to-channel-approval`
Expected: FAIL (module `../respond-to-channel-approval.js` does not exist)

- [ ] **Step 1.3: Implement the module**

The flow is `handleApprovalResponse` + `respondViaLifecycleFallback` from
`handle-approval-response.ts` moved verbatim with replies replaced by outcomes
(spec sections 2.1 and 3.3). Full content:

```ts
// packages/core/src/channel-gateway/respond-to-channel-approval.ts
// ---------------------------------------------------------------------------
// Channel approval respond flow, outcome-returning
// ---------------------------------------------------------------------------
//
// The single auth-bearing respond flow for channel surfaces: approval lookup,
// org check, state pre-check, timing-safe hash check, binding + role identity
// derivation, unified-engine call, error mapping. Two consumers, one
// implementation:
//   - the gateway's in-process mode (handle-approval-response.ts),
//   - the API internal bridge route (apps/api routes/internal-chat-approvals).
// The flow ends in respondToApproval or respondToParkedLifecycle; there is no
// parallel approve path.
//
// Outcomes are wire-safe (spec 2026-06-05-chat-approval-bridge-design.md
// section 3): reply rendering stays in the gateway.

import { timingSafeEqual } from "node:crypto";
import type { ExecuteResult, Principal } from "@switchboard/schemas";
import type { ApprovalStore, IdentityStore } from "../storage/interfaces.js";
import type { OperatorChannelBindingStore } from "./operator-channel-binding-store.js";
import type { RespondToApprovalDeps } from "../approval/respond-to-approval.js";
import { respondToApproval } from "../approval/respond-to-approval.js";
import {
  respondToParkedLifecycle,
  ParkedLifecycleNotFoundError,
  ParkedLifecycleAlreadyRespondedError,
  ParkedLifecycleExpiredError,
} from "../approval/respond-to-parked-lifecycle.js";
import { DispatchAdmissionError } from "../approval/dispatch-admission.js";
import { StaleVersionError } from "../approval/state-machine.js";

/** Everything the chat process attests about a respond tap. respondedBy is
 * deliberately NOT representable: identity is derived from the binding. */
export interface ChannelApprovalRespondRequest {
  approvalId: string;
  action: "approve" | "reject";
  bindingHash: string;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
}

export type ChannelApprovalRefusalCode =
  | "not_found"
  | "stale"
  | "not_authorized"
  | "lookup_error"
  | "already_responded"
  | "conflict"
  | "expired"
  | "self_approval"
  | "admission_failed"
  | "execution_error";

export type ChannelApprovalRespondOutcome =
  | {
      kind: "responded";
      action: "approve" | "reject";
      /** executionResult.success; null = quorum still open (and reject). */
      executionSuccess: boolean | null;
    }
  | { kind: "refused"; code: ChannelApprovalRefusalCode };

/** Cross-process seam: prod = HTTP to the API internal route; tests = inject. */
export interface ApprovalRespondTransport {
  respond(request: ChannelApprovalRespondRequest): Promise<ChannelApprovalRespondOutcome>;
}

/**
 * Authority stack: nullable so the unconfigured gateway keeps today's exact
 * fail-closed semantics (pre-checks still run; authorization always refuses).
 * "Configured" means all three of bindingStore/identityStore/respondDeps.
 */
export interface ChannelApprovalRespondDeps {
  approvalStore: ApprovalStore;
  bindingStore: OperatorChannelBindingStore | null;
  identityStore: IdentityStore | null;
  respondDeps: RespondToApprovalDeps | null;
}

/**
 * Roles that authorize a Principal to respond to approvals from a bound
 * channel. emergency_responder is deliberately excluded: emergency overrides
 * belong to the API/dashboard surface where the caller can see broader system
 * state. The chat surface is stricter than the API route because the caller's
 * authority is asserted via a binding lookup, not auth.
 */
export const APPROVER_ROLES = ["approver", "operator", "admin"] as const;

function principalHasApproverRole(principal: Principal): boolean {
  return principal.roles.some((r) => (APPROVER_ROLES as readonly string[]).includes(r));
}

function timingSafeMatch(stored: string | undefined | null, supplied: string): boolean {
  if (typeof stored !== "string" || stored.length === 0) return false;
  if (stored.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(supplied, "utf8"));
}

interface ConfiguredAuthority {
  bindingStore: OperatorChannelBindingStore;
  identityStore: IdentityStore;
  respondDeps: RespondToApprovalDeps;
}

function configuredAuthority(deps: ChannelApprovalRespondDeps): ConfiguredAuthority | null {
  if (!deps.bindingStore || !deps.identityStore || !deps.respondDeps) return null;
  return {
    bindingStore: deps.bindingStore,
    identityStore: deps.identityStore,
    respondDeps: deps.respondDeps,
  };
}

/**
 * Channel-possession alone is NOT authority: require an active
 * OperatorChannelBinding to a Principal carrying an approver role. Returns
 * null (caller refuses not_authorized) when unwired or unauthorized.
 */
async function deriveOperatorPrincipal(
  authority: ConfiguredAuthority | null,
  request: ChannelApprovalRespondRequest,
): Promise<string | null> {
  if (!authority) return null;
  const binding = await authority.bindingStore.findActiveBinding({
    organizationId: request.organizationId,
    channel: request.channel,
    channelIdentifier: request.channelIdentifier,
  });
  if (!binding) return null;
  const principal = await authority.identityStore.getPrincipal(binding.principalId);
  if (!principal || !principalHasApproverRole(principal)) return null;
  return binding.principalId;
}

/** Today's replyForError, recast to wire-safe codes (spec table 3.3). */
export function refusalCodeForError(err: unknown): ChannelApprovalRefusalCode {
  if (err instanceof StaleVersionError) return "conflict";
  if (err instanceof ParkedLifecycleNotFoundError) return "not_found";
  if (err instanceof ParkedLifecycleAlreadyRespondedError) return "already_responded";
  if (err instanceof ParkedLifecycleExpiredError) return "expired";
  if (err instanceof DispatchAdmissionError) return "admission_failed";
  if (err instanceof Error && /lifecycle status is "/.test(err.message)) {
    // Race: another responder mutated state between our pre-check and the
    // lifecycle call ("Cannot approve: lifecycle status is ...").
    return "conflict";
  }
  if (err instanceof Error && /stale binding/i.test(err.message)) return "stale";
  if (err instanceof Error && /self-approval/i.test(err.message)) return "self_approval";
  return "execution_error";
}

function respondedOutcome(
  action: "approve" | "reject",
  executionResult: ExecuteResult | null,
): ChannelApprovalRespondOutcome {
  return {
    kind: "responded",
    action,
    executionSuccess: executionResult === null ? null : executionResult.success,
  };
}

function refused(code: ChannelApprovalRefusalCode): ChannelApprovalRespondOutcome {
  return { kind: "refused", code };
}

export async function respondToChannelApproval(
  deps: ChannelApprovalRespondDeps,
  request: ChannelApprovalRespondRequest,
): Promise<ChannelApprovalRespondOutcome> {
  let approval: Awaited<ReturnType<ApprovalStore["getById"]>>;
  try {
    approval = await deps.approvalStore.getById(request.approvalId);
  } catch {
    return refused("lookup_error");
  }

  if (!approval) {
    // Lifecycle fallback (mirrors the #877 route fallback): parked WorkUnits
    // and post-restart in-memory rows have no ApprovalRequest row; the id on
    // the button may be a lifecycle id. Approve on recovery_required IS retry.
    return respondViaLifecycleFallback(deps, request);
  }

  if (approval.organizationId !== request.organizationId) return refused("not_found");

  // Pre-check approval state. Once an approval has been responded to or
  // expired, retrying here is futile and confusing; the operator needs a
  // distinct already-handled outcome (vs. a downstream failure).
  if (approval.state.status !== "pending") return refused("already_responded");

  if (!timingSafeMatch(approval.request.bindingHash, request.bindingHash)) {
    return refused("stale");
  }

  // Hash matches, but channel-possession alone is NOT authority.
  const authority = configuredAuthority(deps);
  const principalId = await deriveOperatorPrincipal(authority, request);
  if (!principalId || !authority) return refused("not_authorized");

  try {
    const result = await respondToApproval(
      authority.respondDeps,
      {
        approvalId: request.approvalId,
        action: request.action,
        respondedBy: principalId,
        bindingHash: request.bindingHash,
      },
      approval,
    );
    return respondedOutcome(request.action, result.executionResult);
  } catch (err) {
    return refused(refusalCodeForError(err));
  }
}

/**
 * Lifecycle fallback leg: the approval row is missing but the id may be an
 * ApprovalLifecycle id (parked WorkUnits; future lifecycle-native chat
 * notifications; in-memory rows lost to a restart in dev). Same authority
 * model as the legacy leg: org check, hash pre-check against the CURRENT
 * revision (approve only), binding + role auth, then the lifecycle-native
 * respond (whose approve-on-recovery_required IS the retry leg).
 */
async function respondViaLifecycleFallback(
  deps: ChannelApprovalRespondDeps,
  request: ChannelApprovalRespondRequest,
): Promise<ChannelApprovalRespondOutcome> {
  const authority = configuredAuthority(deps);
  const lifecycleService = authority?.respondDeps.lifecycleService ?? null;
  const workTraceStore = authority?.respondDeps.workTraceStore ?? null;
  if (!authority || !lifecycleService || !workTraceStore) return refused("not_found");

  let lifecycle;
  try {
    lifecycle = await lifecycleService.getLifecycleById(request.approvalId);
  } catch {
    return refused("lookup_error");
  }
  if (!lifecycle || lifecycle.organizationId !== request.organizationId) {
    return refused("not_found");
  }

  // Approve commits to the CURRENT revision; refuse a button whose hash no
  // longer matches it (e.g. after a patch) before any mutation. Reject
  // deliberately skips this pre-check: the parked contract (and the API
  // route) accept a reject without a binding hash; authority comes from the
  // binding + role, not from hash possession.
  if (request.action === "approve") {
    let revision;
    try {
      revision = await lifecycleService.getCurrentRevision(lifecycle.id);
    } catch {
      return refused("lookup_error");
    }
    if (!timingSafeMatch(revision?.bindingHash, request.bindingHash)) {
      return refused("stale");
    }
  }

  const principalId = await deriveOperatorPrincipal(authority, request);
  if (!principalId) return refused("not_authorized");

  try {
    const result = await respondToParkedLifecycle(
      {
        lifecycleService,
        workTraceStore,
        platformLifecycle: authority.respondDeps.platformLifecycle,
        auditLedger: authority.respondDeps.auditLedger,
        logger: authority.respondDeps.logger,
        selfApprovalAllowed: authority.respondDeps.selfApprovalAllowed,
      },
      {
        lifecycleId: lifecycle.id,
        action: request.action,
        respondedBy: principalId,
        bindingHash: request.bindingHash,
      },
    );
    return respondedOutcome(request.action, result.executionResult);
  } catch (err) {
    return refused(refusalCodeForError(err));
  }
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- respond-to-channel-approval`
Expected: PASS (all cases)

- [ ] **Step 1.5: Commit**

```bash
git add packages/core/src/channel-gateway/respond-to-channel-approval.ts packages/core/src/channel-gateway/__tests__/respond-to-channel-approval.test.ts
git commit -m "feat(core): outcome-returning channel approval respond flow"
```

### Task 2: refactor `handle-approval-response.ts` to outcomes + transport mode

**Files:**

- Modify: `packages/core/src/channel-gateway/handle-approval-response.ts` (flow half rewritten; the 12 reply constants unchanged)
- Modify: `packages/core/src/channel-gateway/types.ts:54-65` (config union)
- Modify: `packages/core/src/channel-gateway/index.ts` (exports)
- Test: `packages/core/src/channel-gateway/__tests__/handle-approval-response.transport.test.ts` (new)

- [ ] **Step 2.1: Write the failing transport-mode test**

```ts
// packages/core/src/channel-gateway/__tests__/handle-approval-response.transport.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  handleApprovalResponse,
  replyForChannelOutcome,
  NOT_FOUND_MSG,
  STALE_MSG,
  NOT_AUTHORIZED_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
  ALREADY_RESPONDED_MSG,
  REJECT_SUCCESS_MSG,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  PARTIAL_APPROVAL_MSG,
  SELF_APPROVAL_MSG,
  ADMISSION_FAILED_MSG,
  APPROVAL_EXECUTION_ERROR_MSG,
} from "../handle-approval-response.js";
import type {
  ApprovalRespondTransport,
  ChannelApprovalRespondOutcome,
} from "../respond-to-channel-approval.js";
import { PAYLOAD, BASE_ARGS, makeStore, makeReplySink } from "./approval-response-fixtures.js";

function run(transport: ApprovalRespondTransport) {
  const { sink, sendSpy } = makeReplySink();
  const approvalStore = makeStore(vi.fn());
  const promise = handleApprovalResponse({
    payload: PAYLOAD,
    ...BASE_ARGS,
    approvalStore,
    replySink: sink,
    config: { transport },
  });
  return { promise, sendSpy, approvalStore };
}

describe("handleApprovalResponse: transport mode", () => {
  it("forwards the attested identity and renders the outcome reply", async () => {
    const respond = vi.fn().mockResolvedValue({
      kind: "responded",
      action: "approve",
      executionSuccess: true,
    } satisfies ChannelApprovalRespondOutcome);
    const { promise, sendSpy } = run({ respond });
    await promise;
    expect(respond).toHaveBeenCalledWith({
      approvalId: PAYLOAD.approvalId,
      action: PAYLOAD.action,
      bindingHash: PAYLOAD.bindingHash,
      organizationId: BASE_ARGS.organizationId,
      channel: BASE_ARGS.channel,
      channelIdentifier: BASE_ARGS.channelIdentifier,
    });
    expect(sendSpy).toHaveBeenCalledWith(APPROVE_EXECUTED_MSG);
  });

  it("does not touch local stores in transport mode (thin-forward)", async () => {
    const respond = vi.fn().mockResolvedValue({
      kind: "refused",
      code: "not_found",
    } satisfies ChannelApprovalRespondOutcome);
    const { promise, sendSpy, approvalStore } = run({ respond });
    await promise;
    expect(approvalStore.getById).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(NOT_FOUND_MSG);
  });

  it("renders APPROVAL_LOOKUP_ERROR_MSG when the transport throws", async () => {
    const respond = vi.fn().mockRejectedValue(new Error("bridge down"));
    const { promise, sendSpy } = run({ respond });
    await promise;
    expect(sendSpy).toHaveBeenCalledWith(APPROVAL_LOOKUP_ERROR_MSG);
  });
});

describe("replyForChannelOutcome: total mapping", () => {
  it.each<[ChannelApprovalRespondOutcome, string]>([
    [{ kind: "responded", action: "reject", executionSuccess: null }, REJECT_SUCCESS_MSG],
    [{ kind: "responded", action: "approve", executionSuccess: true }, APPROVE_EXECUTED_MSG],
    [
      { kind: "responded", action: "approve", executionSuccess: false },
      APPROVE_DISPATCH_FAILED_MSG,
    ],
    [{ kind: "responded", action: "approve", executionSuccess: null }, PARTIAL_APPROVAL_MSG],
    [{ kind: "refused", code: "not_found" }, NOT_FOUND_MSG],
    [{ kind: "refused", code: "stale" }, STALE_MSG],
    [{ kind: "refused", code: "expired" }, STALE_MSG],
    [{ kind: "refused", code: "not_authorized" }, NOT_AUTHORIZED_MSG],
    [{ kind: "refused", code: "lookup_error" }, APPROVAL_LOOKUP_ERROR_MSG],
    [{ kind: "refused", code: "already_responded" }, ALREADY_RESPONDED_MSG],
    [{ kind: "refused", code: "conflict" }, ALREADY_RESPONDED_MSG],
    [{ kind: "refused", code: "self_approval" }, SELF_APPROVAL_MSG],
    [{ kind: "refused", code: "admission_failed" }, ADMISSION_FAILED_MSG],
    [{ kind: "refused", code: "execution_error" }, APPROVAL_EXECUTION_ERROR_MSG],
  ])("maps %j to the right constant", (outcome, expected) => {
    expect(replyForChannelOutcome(outcome)).toBe(expected);
  });
});
```

- [ ] **Step 2.2: Run new + existing suites; verify the new one fails, the old ones pass**

Run: `pnpm --filter @switchboard/core test -- handle-approval-response`
Expected: transport suite FAILS (no transport mode, no `replyForChannelOutcome`); the two existing suites PASS

- [ ] **Step 2.3: Update `types.ts` (config union)**

Replace the `HandleApprovalResponseConfig` interface (lines 54-65) with the block below, and add
`import type { ApprovalRespondTransport } from "./respond-to-channel-approval.js";` to the imports:

```ts
/**
 * Configuration to enable chat approval execution. Two shapes:
 *
 * In-process (tests, integration proofs, single-process deployments): the
 * authority stack + engine deps live in this process; hash-match success
 * triggers an OperatorChannelBinding lookup, role check, and the shared
 * respondToApproval call.
 *
 * Transport (production two-process topology): the gateway thin-forwards the
 * webhook-authenticated channel identity to the API internal route, which
 * re-derives the operator principal server-side and runs the same engine.
 *
 * When omitted (misconfiguration), hash-match still refuses with "not
 * authorized": channel-possession is NOT authority, and we never execute on
 * hash match alone.
 */
export interface InProcessApprovalResponseConfig {
  bindingStore: OperatorChannelBindingStore;
  identityStore: IdentityStore;
  respondDeps: RespondToApprovalDeps;
}

export interface TransportApprovalResponseConfig {
  transport: ApprovalRespondTransport;
}

export type HandleApprovalResponseConfig =
  | InProcessApprovalResponseConfig
  | TransportApprovalResponseConfig;
```

- [ ] **Step 2.4: Rewrite `handle-approval-response.ts`**

Keep ALL 12 reply constants verbatim (current lines 17-51). Delete `timingSafeMatch`,
`principalHasApproverRole`, `authorizeOperator`, `replyForOutcome`, `replyForError`,
`respondViaLifecycleFallback`, the old flow, and the now-unused imports. The file becomes
(constants elided here for brevity ONLY in the plan; they stay in the file):

```ts
// packages/core/src/channel-gateway/handle-approval-response.ts
import type { ReplySink, HandleApprovalResponseConfig } from "./types.js";
import type { ParsedApprovalResponsePayload } from "./approval-response-payload.js";
import type { ApprovalStore } from "../storage/interfaces.js";
import type { ChannelApprovalRespondOutcome } from "./respond-to-channel-approval.js";
import { respondToChannelApproval } from "./respond-to-channel-approval.js";

/* ... the 12 exported *_MSG constants, UNCHANGED ... */

// Identity derivation (APPROVER_ROLES + binding + role check) lives with the
// flow in respond-to-channel-approval.ts; re-exported here for compatibility.
export { APPROVER_ROLES } from "./respond-to-channel-approval.js";

/**
 * Honest outcome reply: the reply tracks what actually happened, not what was
 * requested (chat-approval-seam spec section 3; bridge spec table 3.3).
 * Success covers completed AND queued (the #860 mapping); a null execution on
 * an approve means a quorum is still open.
 */
export function replyForChannelOutcome(outcome: ChannelApprovalRespondOutcome): string {
  if (outcome.kind === "responded") {
    if (outcome.action === "reject") return REJECT_SUCCESS_MSG;
    if (outcome.executionSuccess === null) return PARTIAL_APPROVAL_MSG;
    return outcome.executionSuccess ? APPROVE_EXECUTED_MSG : APPROVE_DISPATCH_FAILED_MSG;
  }
  switch (outcome.code) {
    case "not_found":
      return NOT_FOUND_MSG;
    case "stale":
    case "expired":
      return STALE_MSG;
    case "not_authorized":
      return NOT_AUTHORIZED_MSG;
    case "lookup_error":
      return APPROVAL_LOOKUP_ERROR_MSG;
    case "already_responded":
    case "conflict":
      return ALREADY_RESPONDED_MSG;
    case "self_approval":
      return SELF_APPROVAL_MSG;
    case "admission_failed":
      return ADMISSION_FAILED_MSG;
    case "execution_error":
      return APPROVAL_EXECUTION_ERROR_MSG;
  }
}

export async function handleApprovalResponse(params: {
  payload: ParsedApprovalResponsePayload;
  organizationId: string;
  channel: string;
  channelIdentifier: string;
  approvalStore: ApprovalStore;
  replySink: ReplySink;
  config?: HandleApprovalResponseConfig;
}): Promise<void> {
  const { payload, organizationId, channel, channelIdentifier, approvalStore, replySink, config } =
    params;

  const request = {
    approvalId: payload.approvalId,
    action: payload.action,
    bindingHash: payload.bindingHash,
    organizationId,
    channel,
    channelIdentifier,
  };

  if (config && "transport" in config) {
    // Bridged topology: thin-forward the webhook-authenticated identity. The
    // API re-derives the principal and runs the engine; no local lookups here
    // (one authority, not two). A transport failure renders as a lookup
    // error: honest (nothing verified, the dashboard works) and re-tap safe
    // (a duplicate respond surfaces as already_responded).
    let outcome: ChannelApprovalRespondOutcome;
    try {
      outcome = await config.transport.respond(request);
    } catch {
      await replySink.send(APPROVAL_LOOKUP_ERROR_MSG);
      return;
    }
    await replySink.send(replyForChannelOutcome(outcome));
    return;
  }

  const outcome = await respondToChannelApproval(
    {
      approvalStore,
      bindingStore: config?.bindingStore ?? null,
      identityStore: config?.identityStore ?? null,
      respondDeps: config?.respondDeps ?? null,
    },
    request,
  );
  await replySink.send(replyForChannelOutcome(outcome));
}
```

- [ ] **Step 2.5: Update the barrel `channel-gateway/index.ts`**

After the existing `handle-approval-response.js` export block, add:

```ts
export { replyForChannelOutcome } from "./handle-approval-response.js";
export { respondToChannelApproval, refusalCodeForError } from "./respond-to-channel-approval.js";
export type {
  ChannelApprovalRespondRequest,
  ChannelApprovalRespondOutcome,
  ChannelApprovalRefusalCode,
  ApprovalRespondTransport,
  ChannelApprovalRespondDeps,
} from "./respond-to-channel-approval.js";
export type { InProcessApprovalResponseConfig, TransportApprovalResponseConfig } from "./types.js";
```

- [ ] **Step 2.5b: Gateway terminal-branch pin for transport mode (extend `channel-gateway-approval.test.ts`, failing first)**

Follow that suite's existing construction pattern (it builds a `ChannelGateway` with a
spy `platformIngress` and drives `handleIncoming` with an approval-shaped
`message.text`). Add one case: config = `{ transport }` whose `respond` resolves
`{ kind: "responded", action: "approve", executionSuccess: true }`; assert the reply
sink received APPROVE_EXECUTED_MSG and `platformIngress.submit` was NEVER called (an
approval-shaped payload is terminal in the gateway regardless of bridge mode; no LLM
fallthrough). Mirror the suite's existing config-less terminal pins.

- [ ] **Step 2.6: Run the full core suite (refactor proof)**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS, including the UNCHANGED `handle-approval-response.test.ts` (18 cases) and
`handle-approval-response.lifecycle.test.ts`. If any existing case fails, the refactor changed
behavior: fix the refactor, never the test.

- [ ] **Step 2.7: Commit**

```bash
git add packages/core/src/channel-gateway/
git commit -m "feat(core): transport seam for bridged chat approval responses"
```

### Task 3: production HTTP transport (in core, per spec 3.2)

**Files:**

- Create: `packages/core/src/channel-gateway/http-approval-respond-transport.ts`
- Test: `packages/core/src/channel-gateway/__tests__/http-approval-respond-transport.test.ts`

- [ ] **Step 3.1: Write the failing transport test**

```ts
// packages/core/src/channel-gateway/__tests__/http-approval-respond-transport.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  HttpApprovalRespondTransport,
  BridgeTransportError,
} from "../http-approval-respond-transport.js";
import type { ChannelApprovalRespondRequest } from "../respond-to-channel-approval.js";

const REQUEST: ChannelApprovalRespondRequest = {
  approvalId: "appr_1",
  action: "approve",
  bindingHash: "hash123",
  organizationId: "org-1",
  channel: "whatsapp",
  channelIdentifier: "+6591234567",
};

const OUTCOME = { kind: "responded", action: "approve", executionSuccess: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function transportWith(fetchImpl: typeof fetch) {
  return new HttpApprovalRespondTransport({
    baseUrl: "http://api.test",
    internalApiSecret: "s3cret",
    fetchImpl,
    retryDelayMs: 1,
    timeoutMs: 50,
  });
}

describe("HttpApprovalRespondTransport", () => {
  it("POSTs the request to the internal route with the bearer secret", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OUTCOME));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual(OUTCOME);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/internal/chat-approvals/respond");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it("passes refusal outcomes through without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ kind: "refused", code: "stale" }));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual({ kind: "refused", code: "stale" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once on network error, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse(OUTCOME));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual(OUTCOME);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once on 503, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "x" }, 503))
      .mockResolvedValueOnce(jsonResponse(OUTCOME));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual(OUTCOME);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws after the retry is exhausted", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(transportWith(fetchImpl as never).respond(REQUEST)).rejects.toBeInstanceOf(
      BridgeTransportError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 404, 429])("does not retry on %s", async (status) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "x" }, status));
    await expect(transportWith(fetchImpl as never).respond(REQUEST)).rejects.toBeInstanceOf(
      BridgeTransportError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed outcomes (unknown code) without retry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ kind: "refused", code: "brand_new" }));
    await expect(transportWith(fetchImpl as never).respond(REQUEST)).rejects.toBeInstanceOf(
      BridgeTransportError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects non-JSON bodies without retry", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 200 }));
    await expect(transportWith(fetchImpl as never).respond(REQUEST)).rejects.toBeInstanceOf(
      BridgeTransportError,
    );
  });

  it("timeout-after-server-commit: retry surfaces already_responded (spec 3.2 accepted UX)", async () => {
    // Attempt 1 dies on the wire AFTER the server committed; attempt 2 sees the
    // committed state. The conservative "already handled" outcome passes through.
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(jsonResponse({ kind: "refused", code: "already_responded" }));
    const outcome = await transportWith(fetchImpl as never).respond(REQUEST);
    expect(outcome).toEqual({ kind: "refused", code: "already_responded" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed without ever fetching when unconfigured", async () => {
    const fetchImpl = vi.fn();
    const transport = new HttpApprovalRespondTransport({
      baseUrl: "",
      internalApiSecret: "",
      fetchImpl: fetchImpl as never,
    });
    await expect(transport.respond(REQUEST)).rejects.toBeInstanceOf(BridgeTransportError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test -- http-approval-respond-transport`
Expected: FAIL (module does not exist)

- [ ] **Step 3.3: Implement the transport**

```ts
// packages/core/src/channel-gateway/http-approval-respond-transport.ts
import type {
  ApprovalRespondTransport,
  ChannelApprovalRespondRequest,
  ChannelApprovalRespondOutcome,
  ChannelApprovalRefusalCode,
} from "./respond-to-channel-approval.js";

// HTTP half of the chat approval bridge (spec
// docs/superpowers/specs/2026-06-05-chat-approval-bridge-design.md section 3.2).
// Forwards the webhook-authenticated channel identity to the API internal
// route; the API re-derives the operator principal server-side. One retry on
// transient transport failures: a duplicate respond is safe (the engine's
// optimistic locks surface it as already_responded, never a second dispatch).
// Lives in core beside the seam it implements so the apps/api e2e proof can
// drive the REAL production class; apps/chat consumes it from the barrel.

export interface HttpApprovalRespondTransportOptions {
  baseUrl: string;
  internalApiSecret: string;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout; ONE retry on network error/timeout/502/503/504. */
  timeoutMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const REFUSAL_CODES: ReadonlySet<string> = new Set([
  "not_found",
  "stale",
  "not_authorized",
  "lookup_error",
  "already_responded",
  "conflict",
  "expired",
  "self_approval",
  "admission_failed",
  "execution_error",
] satisfies ChannelApprovalRefusalCode[]);

export class BridgeTransportError extends Error {
  readonly retryable: boolean;
  constructor(message: string, opts?: { retryable?: boolean }) {
    super(message);
    this.name = "BridgeTransportError";
    this.retryable = opts?.retryable ?? false;
  }
}

/** Strict runtime guard: an unknown shape or code maps to a lookup-error
 * reply on the gateway side instead of an undefined reply string. */
function isRespondOutcome(value: unknown): value is ChannelApprovalRespondOutcome {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj["kind"] === "responded") {
    return (
      (obj["action"] === "approve" || obj["action"] === "reject") &&
      (typeof obj["executionSuccess"] === "boolean" || obj["executionSuccess"] === null)
    );
  }
  if (obj["kind"] === "refused") {
    return typeof obj["code"] === "string" && REFUSAL_CODES.has(obj["code"]);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpApprovalRespondTransport implements ApprovalRespondTransport {
  constructor(private readonly options: HttpApprovalRespondTransportOptions) {}

  async respond(request: ChannelApprovalRespondRequest): Promise<ChannelApprovalRespondOutcome> {
    if (!this.options.baseUrl || !this.options.internalApiSecret) {
      // Fail closed: never forward without the trust channel. The gateway
      // renders this as a lookup error; it must never silently approve.
      throw new BridgeTransportError("approval respond bridge is not configured");
    }
    let lastError: BridgeTransportError | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) {
        await sleep(this.options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
      }
      try {
        return await this.attempt(request);
      } catch (err) {
        if (err instanceof BridgeTransportError && err.retryable) {
          console.error(`[approval-bridge] attempt ${attempt} failed (retryable): ${err.message}`);
          lastError = err;
          continue;
        }
        console.error(
          `[approval-bridge] attempt ${attempt} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    }
    throw lastError ?? new BridgeTransportError("approval respond bridge failed");
  }

  private async attempt(
    request: ChannelApprovalRespondRequest,
  ): Promise<ChannelApprovalRespondOutcome> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response: Response;
    try {
      response = await fetchImpl(`${this.options.baseUrl}/api/internal/chat-approvals/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.internalApiSecret}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new BridgeTransportError(
        `network error: ${err instanceof Error ? err.message : String(err)}`,
        { retryable: true },
      );
    }
    if (!response.ok) {
      throw new BridgeTransportError(`bridge HTTP ${response.status}`, {
        retryable: RETRYABLE_STATUS.has(response.status),
      });
    }
    let outcome: unknown;
    try {
      outcome = await response.json();
    } catch {
      throw new BridgeTransportError("bridge returned a non-JSON body");
    }
    if (!isRespondOutcome(outcome)) {
      throw new BridgeTransportError("bridge returned a malformed outcome");
    }
    return outcome;
  }
}
```

- [ ] **Step 3.4: Add barrel exports**

In `channel-gateway/index.ts`, after the Task 2.5 block:

```ts
export {
  HttpApprovalRespondTransport,
  BridgeTransportError,
} from "./http-approval-respond-transport.js";
export type { HttpApprovalRespondTransportOptions } from "./http-approval-respond-transport.js";
```

- [ ] **Step 3.5: Run to verify pass, commit**

Run: `pnpm --filter @switchboard/core test -- http-approval-respond-transport`
Expected: PASS

```bash
git add packages/core/src/channel-gateway/
git commit -m "feat(core): http approval respond transport"
```

### Task 4: PR-1 gate and merge

- [ ] Full gate from the repo root: `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm arch:check` (watch `handle-approval-response.ts` and the new module against the 600-line limits)
- [ ] `git push -u origin feat/chat-approval-bridge-core`; open PR `feat(core): channel approval respond seam for the chat bridge` (body links the spec); `gh pr merge --squash --auto`
- [ ] Dispatch a code-review subagent; verify findings against real code; fix real ones (disarm auto-merge first, re-arm after)
- [ ] After merge: `git fetch origin && git merge-base --is-ancestor <squash-sha> origin/main && echo ANCESTOR-OK`

---

## PR-2: API internal route (`apps/api` only)

Branch: `feat/chat-approval-bridge-route` (cut from fresh origin/main after PR-1 lands)

### Task 5: body schema

**Files:**

- Modify: `apps/api/src/validation.ts` (append near `ApprovalRespondBodySchema`, line ~58)

- [ ] **Step 5.1: Add the schema (strict: a smuggled respondedBy is a 400)**

```ts
/**
 * Internal chat-approval bridge respond body (bridge spec section 3.1).
 * .strict() is load-bearing: identity fields (respondedBy) must be
 * unrepresentable on this wire; the binding lookup is the only authority.
 */
export const InternalChatApprovalRespondBodySchema = z
  .object({
    approvalId: z.string().min(1),
    action: z.enum(["approve", "reject"]),
    bindingHash: z.string().min(1),
    channel: z.string().min(1),
    channelIdentifier: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
```

### Task 6: the internal route

**Files:**

- Create: `apps/api/src/routes/internal-chat-approvals.ts`
- Modify: `apps/api/src/middleware/auth.ts:122-135` (exact-path exclusion)
- Modify: `apps/api/src/bootstrap/routes.ts` (registration)
- Test: `apps/api/src/__tests__/internal-chat-approvals.test.ts`

- [ ] **Step 6.1: Write the failing route test**

```ts
// apps/api/src/__tests__/internal-chat-approvals.test.ts
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
    findActiveBinding: vi.fn(async (q: { organizationId: string }) =>
      principalId && q.organizationId === ORG ? ({ principalId } as never) : null,
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
  const respondToApprovalSpy = vi.fn(async () => ({
    envelope: { id: "env_1" },
    approvalState: { status: "approved" },
    executionResult: okExec,
  }));
  // Trace stub: shapes must satisfy what respondToParkedLifecycle and the
  // four-eyes guard read; mirror makeLifecycleWorld in
  // packages/core/src/channel-gateway/__tests__/approval-response-fixtures.ts
  // and adjust during GREEN if the engine demands more fields.
  let trace: Record<string, unknown> = {
    workUnitId: "env_lc",
    organizationId: ORG,
    actor: { id: "user-orig", type: "user" },
    parameters: { campaignId: "c1" },
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

describe("auth and shape", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("503 bridge_not_configured when INTERNAL_API_SECRET is unset", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const { app } = await buildApp({ bindingStore: bindingStoreFor(OPERATOR) });
    const res = await inject(app, validBody());
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("bridge_not_configured");
  });

  it("401 when the Authorization header is missing or wrong", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app } = await buildApp({ bindingStore: bindingStoreFor(OPERATOR) });
    expect((await inject(app, validBody(), {})).statusCode).toBe(401);
    expect((await inject(app, validBody(), { authorization: "Bearer wrong" })).statusCode).toBe(
      401,
    );
    expect((await inject(app, validBody(), { authorization: SECRET })).statusCode).toBe(401);
  });

  it("400 on missing fields and on a smuggled respondedBy (spoof attempt)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, respondToApprovalSpy } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
    });
    expect((await inject(app, { approvalId: "appr_1" })).statusCode).toBe(400);
    const spoof = await inject(app, validBody({ respondedBy: "principal-evil" }));
    expect(spoof.statusCode).toBe(400);
    expect(respondToApprovalSpy).not.toHaveBeenCalled();
  });

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
});

describe("flow outcomes over a real in-memory lifecycle (fallback leg)", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function parkLifecycle(lifecycleService: ApprovalLifecycleService) {
    return lifecycleService.createGatedLifecycle({
      actionEnvelopeId: "env_lc",
      organizationId: ORG,
      expiresAt: new Date(Date.now() + 3_600_000),
      initialRevision: {
        parametersSnapshot: { campaignId: "c1" },
        approvalScopeSnapshot: {},
        bindingHash: "hash-lc",
        createdBy: "user-orig",
      },
    });
  }

  it("double-tap: first approve dispatches once, second returns already_responded", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, lifecycleService, executeApproved } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
      lifecycle: true,
    });
    const { lifecycle } = await parkLifecycle(lifecycleService!);
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
    const { lifecycle } = await parkLifecycle(lifecycleService!);
    const res = await inject(app, validBody({ approvalId: lifecycle.id, bindingHash: "wrong" }));
    expect(res.json()).toEqual({ kind: "refused", code: "stale" });
    expect((await lifecycleService!.getLifecycleById(lifecycle.id))?.status).toBe(
      "pending_approval",
    );
  });

  it("reject responds through the parked leg", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, lifecycleService } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
      lifecycle: true,
    });
    const { lifecycle } = await parkLifecycle(lifecycleService!);
    const res = await inject(app, validBody({ approvalId: lifecycle.id, action: "reject" }));
    expect(res.json()).toEqual({ kind: "responded", action: "reject", executionSuccess: null });
  });
});
```

Notes: (1) `createGatedLifecycle` argument shape must match
`packages/core/src/approval/lifecycle-service.ts`; verify during RED. (2) `createApprovalState`
must be exported from `@switchboard/core` (it is; `chat-approval-loop.test.ts` imports it). (3)
The workTrace stub exists so the four-eyes guard and the parked dispatch leg have a trace to
read/update; if `respondToParkedLifecycle` rejects the stub, mirror the richer trace from
`approval-response-fixtures.ts`'s `makeLifecycleWorld`.

- [ ] **Step 6.2: Run to verify failure**

Run: `pnpm --filter @switchboard/api test -- internal-chat-approvals`
Expected: FAIL (route module does not exist)

- [ ] **Step 6.3: Implement the route**

```ts
// apps/api/src/routes/internal-chat-approvals.ts
// @route-class: lifecycle
import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { respondToChannelApproval } from "@switchboard/core";
import type { OperatorChannelBindingStore } from "@switchboard/core";
import { InternalChatApprovalRespondBodySchema } from "../validation.js";

// Internal chat-approval bridge (spec
// docs/superpowers/specs/2026-06-05-chat-approval-bridge-design.md).
//
// The chat process forwards webhook-authenticated channel identity; this route
// re-derives the operator principal SERVER-SIDE from the org-scoped
// OperatorChannelBinding + role check and runs the same unified respond engine
// as POST /api/approvals/:id/respond. Trust model: INTERNAL_API_SECRET
// authenticates the CALLER PROCESS, not an operator. respondedBy never crosses
// this wire (the strict body schema 400s it); the binding lookup is the only
// identity authority.
//
// HTTP discipline (spec 3.1): 200 + outcome JSON for every FLOW outcome,
// refusals included; non-2xx only for bridge-level failures (400 shape, 401
// secret, 503 unconfigured, 429 rate limit). The path is excluded from the
// API-key auth middleware (exact path) and self-authenticates here, fail
// closed, mirroring apps/chat/src/main.ts /internal/provision-notify.

const INTERNAL_RATE_LIMIT_MAX = 300; // operator taps are human-scale
const INTERNAL_RATE_LIMIT_WINDOW_MS = 60_000;

export interface InternalChatApprovalsOptions {
  /** Test seam; production builds PrismaOperatorChannelBindingStore from app.prisma. */
  bindingStore?: OperatorChannelBindingStore;
}

type SecretCheck = "ok" | "unconfigured" | "unauthorized";

function validateInternalSecret(request: FastifyRequest): SecretCheck {
  const secret = process.env["INTERNAL_API_SECRET"];
  if (!secret) return "unconfigured";
  const header = request.headers.authorization;
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) return "unauthorized";
  if (!timingSafeEqual(Buffer.from(header), Buffer.from(expected))) return "unauthorized";
  return "ok";
}

export const internalChatApprovalsRoutes: FastifyPluginAsync<InternalChatApprovalsOptions> = async (
  app,
  opts,
) => {
  // Same four-eyes posture as the public respond route and PlatformLifecycle.
  const selfApprovalAllowed = !!process.env["ALLOW_SELF_APPROVAL"];

  let bindingStore: OperatorChannelBindingStore | null = opts.bindingStore ?? null;
  if (!bindingStore && app.prisma) {
    const { PrismaOperatorChannelBindingStore } = await import("@switchboard/db");
    bindingStore = new PrismaOperatorChannelBindingStore(app.prisma);
  }

  app.post(
    "/respond",
    {
      schema: {
        description:
          "Internal chat-approval bridge: re-derives the operator principal from " +
          "OperatorChannelBinding and runs the unified respond engine. " +
          "Authenticated by INTERNAL_API_SECRET, not API keys.",
        tags: ["Internal"],
        // Public /docs is auth-excluded; an internal surface must not
        // advertise itself in the public OpenAPI document (spec 4.1).
        hide: true,
      },
      config: {
        rateLimit: {
          max: INTERNAL_RATE_LIMIT_MAX,
          timeWindow: INTERNAL_RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      const secretCheck = validateInternalSecret(request);
      if (secretCheck === "unconfigured") {
        request.log.error(
          "INTERNAL_API_SECRET is not configured; rejecting chat approval bridge request",
        );
        return reply.code(503).send({
          error: "Internal authentication not configured",
          code: "bridge_not_configured",
          statusCode: 503,
        });
      }
      if (secretCheck === "unauthorized") {
        return reply
          .code(401)
          .send({ error: "Unauthorized", code: "unauthorized", statusCode: 401 });
      }

      const parsed = InternalChatApprovalRespondBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request body",
          details: parsed.error.issues,
          statusCode: 400,
        });
      }
      const body = parsed.data;

      if (!bindingStore) {
        // No database: no OperatorChannelBinding rows can exist, so no
        // identity can ever be derived. Fail closed; never an in-memory
        // authority shortcut.
        return reply.code(503).send({
          error: "Approval bridge requires a database-backed binding store",
          code: "bridge_not_configured",
          statusCode: 503,
        });
      }

      const outcome = await respondToChannelApproval(
        {
          approvalStore: app.storageContext.approvals,
          bindingStore,
          identityStore: app.storageContext.identity,
          respondDeps: {
            approvalStore: app.storageContext.approvals,
            envelopeStore: app.storageContext.envelopes,
            workTraceStore: app.workTraceStore,
            lifecycleService: app.lifecycleService,
            platformLifecycle: app.platformLifecycle,
            sessionManager: app.sessionManager,
            auditLedger: app.auditLedger,
            logger: request.log,
            selfApprovalAllowed,
          },
        },
        {
          approvalId: body.approvalId,
          action: body.action,
          bindingHash: body.bindingHash,
          organizationId: body.organizationId,
          channel: body.channel,
          channelIdentifier: body.channelIdentifier,
        },
      );

      request.log.info(
        {
          approvalId: body.approvalId,
          action: body.action,
          organizationId: body.organizationId,
          channel: body.channel,
          outcome:
            outcome.kind === "refused"
              ? `refused:${outcome.code}`
              : `responded:${String(outcome.executionSuccess)}`,
        },
        "Chat approval bridge respond",
      );
      return reply.code(200).send(outcome);
    },
  );
};
```

- [ ] **Step 6.4: Exclude the exact path from API-key auth**

In `apps/api/src/middleware/auth.ts`, extend the skip list (after the meta deletion lines):

```ts
request.url.startsWith("/api/meta/deletion/status") ||
  // Chat approval bridge: self-authenticates with INTERNAL_API_SECRET
  // (timing-safe) inside the route; exact path, never a prefix.
  request.url === "/api/internal/chat-approvals/respond";
```

- [ ] **Step 6.5: Register in `bootstrap/routes.ts`**

Import: `import { internalChatApprovalsRoutes } from "../routes/internal-chat-approvals.js";`
After the approvals registration (line ~113):

```ts
// Internal chat-approval bridge: INTERNAL_API_SECRET-authenticated respond
// surface for the chat process (excluded from API-key auth by exact path).
await app.register(internalChatApprovalsRoutes, { prefix: "/api/internal/chat-approvals" });
```

- [ ] **Step 6.5b: Review-amendment test additions (same files, failing first)**

Append to `internal-chat-approvals.test.ts`:

```ts
describe("review-amendment hardening cases", () => {
  afterEach(() => vi.unstubAllEnvs());

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

  it("wrong channel for a real principal refuses not_authorized", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, storage } = await buildApp({ bindingStore: bindingStoreFor(OPERATOR) });
    await seedLegacyApproval(storage);
    const res = await inject(app, validBody({ channel: "telegram" }));
    expect(res.json()).toEqual({ kind: "refused", code: "not_authorized" });
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
    const first = await lifecycleService!.createGatedLifecycle({
      actionEnvelopeId: "env_lc1",
      organizationId: ORG,
      expiresAt: new Date(Date.now() + 3_600_000),
      initialRevision: {
        parametersSnapshot: {},
        approvalScopeSnapshot: {},
        bindingHash: "hash-1",
        createdBy: "user-orig",
      },
    });
    const ok = await inject(
      app,
      validBody({ approvalId: first.lifecycle.id, bindingHash: "hash-1" }),
    );
    expect(ok.json()).toEqual({ kind: "responded", action: "approve", executionSuccess: true });

    active = false; // operator unbound between taps
    const second = await lifecycleService!.createGatedLifecycle({
      actionEnvelopeId: "env_lc2",
      organizationId: ORG,
      expiresAt: new Date(Date.now() + 3_600_000),
      initialRevision: {
        parametersSnapshot: {},
        approvalScopeSnapshot: {},
        bindingHash: "hash-2",
        createdBy: "user-orig",
      },
    });
    const refused = await inject(
      app,
      validBody({ approvalId: second.lifecycle.id, bindingHash: "hash-2" }),
    );
    expect(refused.json()).toEqual({ kind: "refused", code: "not_authorized" });
    expect(executeApproved).toHaveBeenCalledTimes(1);
  });

  it("expiry replay refuses with expired", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    const { app, lifecycleService } = await buildApp({
      bindingStore: bindingStoreFor(OPERATOR),
      lifecycle: true,
    });
    const { lifecycle } = await lifecycleService!.createGatedLifecycle({
      actionEnvelopeId: "env_exp",
      organizationId: ORG,
      expiresAt: new Date(Date.now() - 1_000),
      initialRevision: {
        parametersSnapshot: {},
        approvalScopeSnapshot: {},
        bindingHash: "hash-exp",
        createdBy: "user-orig",
      },
    });
    const res = await inject(app, validBody({ approvalId: lifecycle.id, bindingHash: "hash-exp" }));
    expect(res.json()).toEqual({ kind: "refused", code: "expired" });
  });
});
```

Note: the expiry case depends on `respondToParkedLifecycle` raising
`ParkedLifecycleExpiredError` for a past `expiresAt`; verify against
`respond-to-parked-lifecycle.ts` during RED (if expiry is enforced at a different layer,
seed accordingly rather than weakening the assertion).

- [ ] **Step 6.5c: Auth-middleware exclusion exactness (extend `apps/api/src/__tests__/api-auth.test.ts`, failing first)**

Follow the file's existing app-construction pattern (it registers the real
`authMiddleware` with `API_KEYS` set). Add:

```ts
describe("internal chat-approvals path exclusion", () => {
  it("the exact path bypasses API-key auth and reaches the route's own auth", async () => {
    // No Authorization header at all: middleware lets it through; the ROUTE
    // answers (503 unconfigured or 401 secret), never the middleware's
    // "Missing Authorization header".
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/chat-approvals/respond",
      payload: {},
    });
    expect([401, 503]).toContain(res.statusCode);
    expect(res.json().error).not.toBe("Missing Authorization header");
  });

  it("querystring and trailing-slash variants stay behind API-key auth", async () => {
    for (const url of [
      "/api/internal/chat-approvals/respond?x=1",
      "/api/internal/chat-approvals/respond/",
    ]) {
      const res = await app.inject({ method: "POST", url, payload: {} });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Missing Authorization header");
    }
  });
});
```

Adjust to the suite's actual harness shape (it may build the app per test or share one);
the internal route itself does not need to be registered for the second case (middleware
401s first); for the first case register `internalChatApprovalsRoutes` if the suite's
app does not already include production route registration.

- [ ] **Step 6.6: Run to verify pass; mutation-check the two security tests**

Run: `pnpm --filter @switchboard/api test -- internal-chat-approvals`
Expected: PASS.
Mutation checks (apply, observe RED, revert immediately):

1. In the route handler, bypass derivation by threading the wire identity into the engine:
   the derivation test (respondedBy assertion) MUST red.
2. In `respond-to-channel-approval.ts`, comment out the legacy-leg org comparison: the
   org-scope test MUST red. Revert.

- [ ] **Step 6.7: Commit**

```bash
git add apps/api/src/routes/internal-chat-approvals.ts apps/api/src/middleware/auth.ts apps/api/src/bootstrap/routes.ts apps/api/src/validation.ts apps/api/src/__tests__/internal-chat-approvals.test.ts
git commit -m "feat(api): internal chat-approval bridge respond route"
```

### Task 7: PR-2 gate and merge

- [ ] Full gate; rerun known api flakes once if they appear (bootstrap-smoke, api-auth prod-hardening)
- [ ] Push, PR `feat(api): internal chat-approval respond bridge route`, code-review subagent (expect identity-spoofing, replay, and silent-failure scrutiny), auto-merge, ancestry check

---

## PR-4 (EXECUTE FOURTH, the flip): chat wiring (`apps/chat` only)

Branch: `feat/chat-approval-bridge-wiring` (cut from fresh origin/main after the e2e
proof PR lands; this PR activates the bridge and is gated by the spec section 5
pre-flip hardening checklist)

### Task 8: wire the managed gateway; document the single-tenant decision

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`
- Modify: `apps/chat/src/main.ts:104-114` (comment only)
- Test: `apps/chat/src/gateway/__tests__/gateway-bridge.test.ts` (extend)

- [ ] **Step 8.1: Extend the construction test (failing first)**

Append to the existing file (keep the existing case untouched); add `afterEach` to the
vitest import line:

```ts
import { HttpApprovalRespondTransport } from "@switchboard/core";

describe("createGatewayBridge: approval respond bridge wiring", () => {
  afterEach(() => vi.unstubAllEnvs());

  function build() {
    return createGatewayBridge({} as never, { platformIngress: { submit: vi.fn() } });
  }

  it("wires the transport when SWITCHBOARD_API_URL and INTERNAL_API_SECRET are set", () => {
    vi.stubEnv("SWITCHBOARD_API_URL", "http://api.internal");
    vi.stubEnv("INTERNAL_API_SECRET", "s3cret");
    const gateway = build();
    const config = (
      gateway as unknown as { config: { approvalResponseConfig?: { transport?: unknown } } }
    ).config;
    expect(config.approvalResponseConfig).toBeDefined();
    expect(config.approvalResponseConfig?.transport).toBeInstanceOf(HttpApprovalRespondTransport);
  });

  it("omits the config (fail-closed) when either env var is missing", () => {
    vi.stubEnv("SWITCHBOARD_API_URL", "http://api.internal");
    vi.stubEnv("INTERNAL_API_SECRET", "");
    expect(
      (build() as unknown as { config: { approvalResponseConfig?: unknown } }).config
        .approvalResponseConfig,
    ).toBeUndefined();
  });
});
```

- [ ] **Step 8.2: Run to verify failure** (`pnpm --filter @switchboard/chat test -- gateway-bridge`)

- [ ] **Step 8.3: Wire `gateway-bridge.ts`**

Add to imports: `HttpApprovalRespondTransport` (value) and `HandleApprovalResponseConfig` (type)
from `@switchboard/core`. Add the helper above `createGatewayBridge`:

```ts
/**
 * Approval respond bridge (spec 2026-06-05-chat-approval-bridge-design.md
 * section 5): the chat process cannot host the respond engine (no
 * ExecutionModeRegistry), so operator approve/reject taps thin-forward the
 * webhook-authenticated channel identity to the API internal route over the
 * INTERNAL_API_SECRET trust channel; the API re-derives the principal from
 * OperatorChannelBinding. Wired only when both env vars are present;
 * otherwise the gateway keeps the fail-closed NOT_AUTHORIZED reply for
 * approval-shaped payloads.
 */
function buildApprovalResponseConfig(): HandleApprovalResponseConfig | undefined {
  const baseUrl = process.env["SWITCHBOARD_API_URL"];
  const internalApiSecret = process.env["INTERNAL_API_SECRET"];
  if (!baseUrl || !internalApiSecret) {
    console.warn(
      "[gateway] approval respond bridge disabled: set SWITCHBOARD_API_URL and " +
        "INTERNAL_API_SECRET to enable chat approve/reject buttons. Approval taps " +
        "will reply not-authorized until then.",
    );
    return undefined;
  }
  return {
    transport: new HttpApprovalRespondTransport({ baseUrl, internalApiSecret }),
  };
}
```

In the `new ChannelGateway({ ... })` config, after `approvalStore: new PrismaApprovalStore(prisma),`:

```ts
    approvalResponseConfig: buildApprovalResponseConfig(),
```

In `main.ts`, extend the existing comment on the single-tenant `approvalStore` block (comment-only change):

```ts
// Single-tenant path is used in dev/no-DB environments where no real approvals
// exist. If an approval-shaped payload arrives, the gateway intercepts it and
// getById returns null → the caller receives a NOT_FOUND_MSG and the message is
// dropped before reaching PlatformIngress.submit() or the LLM.
// approvalResponseConfig stays DELIBERATELY unwired here: without a database
// there are no orgs, no OperatorChannelBindings, and no real approvals, and
// this path's only channel is Telegram, whose outbound approve buttons are
// undeliverable anyway (callback_data 64-byte cap). See the chat-approval
// bridge spec (2026-06-05), section 5.
```

- [ ] **Step 8.4: Run chat suite, commit**

Run: `pnpm --filter @switchboard/chat test`
Expected: PASS (rerun `gateway-bridge-attribution` once if it times out under load; known flake)

```bash
git add apps/chat/src/gateway/ apps/chat/src/main.ts
git commit -m "feat(chat): wire approval respond bridge into the managed gateway"
```

### Task 9: flip-PR gate and merge (FOURTH AND LAST)

- [ ] Run the spec section 5 pre-flip hardening checklist and record each item's result in the PR body: route deployed + reachable (or explicitly note deploy state if Render lags merges), route hidden from /docs, OperatorChannelBinding row inventory, stale-button posture, e2e proof green on main
- [ ] Full gate, push, PR `feat(chat): chat approval respond bridge wiring`, code-review subagent, auto-merge, ancestry check
- [ ] PR body MUST note: merging makes the bridge live on the next chat deploy wherever both env vars are set (they are, for provisioning); the API route deploys first by merge order; OperatorChannelBinding rows still gate actual authority (none exist until seeded; spec section 9)

---

## PR-3 (EXECUTE THIRD, before the flip): end-to-end bridge proof (`apps/api/src/__tests__` only)

Branch: `test/chat-approval-bridge-proof` (cut from fresh origin/main after PR-2 lands;
lands BEFORE the chat wiring so the full proof is on main before activation)

### Task 10: extract the shared chat-approval world

**Files:**

- Create: `apps/api/src/__tests__/chat-approval-world.ts`
- Modify: `apps/api/src/__tests__/chat-approval-loop.test.ts` (replace local helpers with imports; zero behavior change)

- [ ] **Step 10.1: Move helpers verbatim**

Move `OPERATOR_PRINCIPAL`, `CHANNEL`, `CHANNEL_IDENTIFIER`, `parkViaCron`,
`seedLegacyApprovalRow`, `replyCapture` (and their imports) from
`chat-approval-loop.test.ts` into the new module; export all. Add two new helpers:

```ts
import type { OperatorChannelBindingStore } from "@switchboard/core";
import { ORG } from "./recommendation-handoff-harness.js";
import type { buildLifecycleWorld } from "./recommendation-handoff-lifecycle-world.js";

export function bindingStoreFor(orgId: string, principalId: string): OperatorChannelBindingStore {
  return {
    findActiveBinding: async (q) =>
      q.organizationId === orgId &&
      q.channel === CHANNEL &&
      q.channelIdentifier === CHANNEL_IDENTIFIER
        ? ({ principalId } as never)
        : null,
  };
}

/** The bridge route derives the principal from app.storageContext.identity;
 * seed the operator there for bridged worlds. */
export async function seedOperatorPrincipal(
  w: ReturnType<typeof buildLifecycleWorld>,
): Promise<void> {
  await w.storage.identity.savePrincipal({
    id: OPERATOR_PRINCIPAL,
    type: "user",
    name: "Chat Operator",
    organizationId: ORG,
    roles: ["operator"],
  });
}
```

- [ ] **Step 10.2: Refactor `chat-approval-loop.test.ts` to import them; run it**

Run: `pnpm --filter @switchboard/api test -- chat-approval-loop`
Expected: the existing four cases PASS unchanged

- [ ] **Step 10.3: Commit**

```bash
git add apps/api/src/__tests__/chat-approval-world.ts apps/api/src/__tests__/chat-approval-loop.test.ts
git commit -m "refactor(api): extract shared chat-approval test world"
```

### Task 11: the bridge loop test

**Files:**

- Create: `apps/api/src/__tests__/chat-approval-bridge-loop.test.ts`

- [ ] **Step 11.1: Write the test (failing only until PR-1/2/3 are on main; here it should pass immediately, which is acceptable for an integration proof of already-merged code)**

```ts
// apps/api/src/__tests__/chat-approval-bridge-loop.test.ts
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
    const approvalId = await seedLegacyApprovalRow(w, parked);

    const replies = await bridgeRespond(w, app, {
      action: "approve",
      approvalId,
      bindingHash: parked.bindingHash,
    });

    expect(replies).toEqual([APPROVE_EXECUTED_MSG]);
    expect(w.harness.jobs).toHaveLength(1);
    const expectedBrief = synthesizeCreativeBrief(null);
    const rm = await readerFor(w.harness.jobs).read(ORG, { now: new Date(), timezone: "UTC" });
    expect(rm.jobs.find((j) => j.title === expectedBrief.productDescription)).toBeDefined();
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
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "pending_approval",
    );
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
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "pending_approval",
    );
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
    expect((await w.lifecycleService.getLifecycleById(parked.lifecycleId))?.status).toBe(
      "pending_approval",
    );
    expect(w.store.listDispatchRecords()).toHaveLength(0);
  });
});
```

- [ ] **Step 11.2: Run; verify all six legs pass**

Run: `pnpm --filter @switchboard/api test -- chat-approval-bridge-loop`
Expected: PASS

- [ ] **Step 11.3: Mutation checks (apply, observe RED, revert each)**

1. In `routes/internal-chat-approvals.ts`, thread `body.channelIdentifier` as `respondedBy`
   (skipping derivation): the happy-path `approvalRespondedBy` assertion reds.
2. Short-circuit `HttpApprovalRespondTransport.respond` to return
   `{ kind: "refused", code: "not_found" }`: the handler-ran assertion (`jobs` length) reds.
3. In `respond-to-channel-approval.ts`, drop the fallback-leg org comparison: the PR-2 org
   test reds (run `pnpm --filter @switchboard/api test -- internal-chat-approvals`).

- [ ] **Step 11.4: Commit**

```bash
git add apps/api/src/__tests__/chat-approval-bridge-loop.test.ts
git commit -m "test(api): end-to-end chat approval bridge proof"
```

### Task 12: proof-PR gate and merge (THIRD)

- [ ] Full gate, push, PR `test(api): chat approval bridge end-to-end proof`, code-review subagent, auto-merge, ancestry check
- [ ] Then execute the flip PR (Tasks 8-9 above, the LAST PR)

### Task 13: post-merge verification; teardown (after the flip merges)

- [ ] On merged main (fresh fetch): run `pnpm build && pnpm test` and capture real output for the final report; run the bridge-relevant suites explicitly
- [ ] Worktree teardown: exit + `git worktree remove <path> && git worktree prune`; delete local AND remote slice branches (only this slice's)

---

## Plan self-review (completed during writing)

- **Spec coverage:** spec 2.1 -> Task 1; 2.2 -> Task 2 (incl. 2.5b terminal pin); 2.3 -> Task 6; 3.1 -> Tasks 5-6; 3.2 -> Task 3 (incl. timeout-after-commit case); 3.3 -> Task 2 (mapping + tests); 4.1-4.5 -> Tasks 6 + 6.5b/6.5c security tests; 5 -> Task 9 pre-flip checklist; 6 -> no tasks by design (Telegram, backfill, outbound notifiers OUT); 7 -> Tasks 1, 2, 3, 6, 8, 11; 8 -> PR structure (proof before flip, review amendment); 9 deploy notes -> spec section 5.
- **Placeholder scan:** none (the two "verify during RED" notes name exact files and the resolution rule: match the real constructor/shape, never weaken the assertion).
- **Type consistency:** `ChannelApprovalRespondRequest/Outcome/RefusalCode`, `ApprovalRespondTransport`, `ChannelApprovalRespondDeps`, `InProcessApprovalResponseConfig`, `TransportApprovalResponseConfig`, `HttpApprovalRespondTransportOptions`, `BridgeTransportError`, `InternalChatApprovalsOptions` are used with identical names and shapes across all tasks.
