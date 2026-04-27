# Trust Spine Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the five highest-risk trust breakers in the production execution spine: unsafe idempotency replay, non-durable execute approvals, patch-vs-execute drift, unwired skill governance, and SSRF in website scanning.

**Architecture:** Surgical fixes only — tighten the existing platform path. No runtime convergence, no package splits, no new abstractions. Each task is a self-contained bug fix with TDD cadence.

**Tech Stack:** TypeScript, Fastify, Vitest, Prisma, Switchboard platform ingress/lifecycle, Anthropic skill runtime

**Design spec:** `docs/superpowers/specs/2026-04-21-trust-spine-hardening-design.md`

---

## File Structure

### Runtime files (modify only)

| File                                               | Task | Change                                                     |
| -------------------------------------------------- | ---- | ---------------------------------------------------------- |
| `apps/api/src/middleware/idempotency.ts`           | 1    | Add fingerprint to cache entries, 409 on mismatch          |
| `apps/api/src/routes/execute.ts`                   | 2    | Call `createApprovalForWorkUnit()` in approval branch      |
| `packages/core/src/platform/platform-lifecycle.ts` | 3    | Extend `updateWorkTraceApproval` type, pass patched params |
| `apps/api/src/bootstrap/skill-mode.ts`             | 4    | Import `GovernanceHook`, pass to `SkillExecutorImpl`       |
| `apps/api/src/routes/website-scan.ts`              | 5    | Call `assertSafeUrl()` before `fetch()`                    |

### Test files

| File                                                              | Task | Action                                     |
| ----------------------------------------------------------------- | ---- | ------------------------------------------ |
| `apps/api/src/__tests__/api-idempotency.test.ts`                  | 1    | Modify — add mismatch tests                |
| `apps/api/src/__tests__/api-execute.test.ts`                      | 2    | Modify — add approval persistence test     |
| `apps/api/src/__tests__/execute-platform-parity.test.ts`          | 2    | Modify — tighten approval shape assertions |
| `packages/core/src/platform/__tests__/platform-lifecycle.test.ts` | 3    | Modify — add patched-params-in-trace test  |
| `apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts`  | 4    | Create                                     |
| `apps/api/src/__tests__/website-scan.test.ts`                     | 5    | Create                                     |

---

## Task 1: Enforce idempotency mismatch detection

**Files:**

- Modify: `apps/api/src/middleware/idempotency.ts`
- Test: `apps/api/src/__tests__/api-idempotency.test.ts`

### Context

The idempotency middleware currently caches responses keyed by the raw `Idempotency-Key` header value. Two different routes or two different payloads sharing the same key will replay the first cached response — a correctness bug that can cause silent data corruption.

The fix stores a request fingerprint (method + route + body hash) alongside the cached response. On cache hit, the fingerprint is compared: match → replay, mismatch → 409 Conflict.

- [ ] **Step 1: Write the failing tests**

Add two new tests to `apps/api/src/__tests__/api-idempotency.test.ts`, inside the existing `describe("Idempotency Middleware")` block, after the existing tests:

```typescript
it("returns 409 when the same key is used on a different route", async () => {
  const propose = await app.inject({
    method: "POST",
    url: "/api/actions/propose",
    headers: { "idempotency-key": "cross-route-key" },
    payload: proposePayload,
  });

  expect(propose.statusCode).toBe(201);

  const execute = await app.inject({
    method: "POST",
    url: "/api/execute",
    headers: { "idempotency-key": "cross-route-key" },
    payload: {
      actorId: "default",
      organizationId: "default",
      action: {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_execute" },
        sideEffect: true,
      },
    },
  });

  expect(execute.statusCode).toBe(409);
  expect(execute.json().error).toContain("Idempotency-Key");
});

it("returns 409 when the same key is used with a different payload", async () => {
  const first = await app.inject({
    method: "POST",
    url: "/api/actions/propose",
    headers: { "idempotency-key": "same-key-diff-body" },
    payload: proposePayload,
  });

  expect(first.statusCode).toBe(201);

  const second = await app.inject({
    method: "POST",
    url: "/api/actions/propose",
    headers: { "idempotency-key": "same-key-diff-body" },
    payload: {
      ...proposePayload,
      parameters: { campaignId: "camp_changed" },
    },
  });

  expect(second.statusCode).toBe(409);
  expect(second.json().error).toContain("Idempotency-Key");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm vitest run apps/api/src/__tests__/api-idempotency.test.ts
```

Expected: FAIL — both new tests will replay the cached response instead of returning 409, because the middleware doesn't compare fingerprints.

- [ ] **Step 3: Implement fingerprint-based mismatch detection**

Replace the full contents of `apps/api/src/middleware/idempotency.ts`:

```typescript
import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import Redis from "ioredis";

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  statusCode: number;
  body: string;
  fingerprint: string;
}

function computeFingerprint(request: FastifyRequest): string {
  const method = request.method;
  const route = request.routerPath ?? request.routeOptions.url ?? request.url;
  const bodyHash = createHash("sha256")
    .update(JSON.stringify(request.body ?? null))
    .digest("hex");
  return `${method}:${route}:${bodyHash}`;
}

export interface IdempotencyBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export class MemoryBackend implements IdempotencyBackend {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

export class RedisBackend implements IdempotencyBackend {
  constructor(private redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(`idempotency:${key}`);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(`idempotency:${key}`, value, "PX", ttlMs);
  }
}

export function createBackend(sharedRedis?: Redis): IdempotencyBackend {
  if (sharedRedis) {
    return new RedisBackend(sharedRedis);
  }
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    return new RedisBackend(new Redis(redisUrl));
  }
  return new MemoryBackend();
}

const idempotencyPlugin: FastifyPluginAsync = async (app) => {
  const sharedRedis = (app as unknown as Record<string, unknown>)["redis"] as Redis | undefined;
  const backend = createBackend(sharedRedis);

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return;

    if (idempotencyKey.length > 256) {
      return reply.code(400).send({ error: "Idempotency-Key exceeds maximum length of 256" });
    }

    const cached = await backend.get(idempotencyKey);
    if (!cached) return;

    const entry = JSON.parse(cached) as CacheEntry;
    const currentFingerprint = computeFingerprint(request);

    if (entry.fingerprint !== currentFingerprint) {
      return reply.code(409).send({
        error: "Idempotency-Key reused with different request",
      });
    }

    return reply.code(entry.statusCode).send(JSON.parse(entry.body));
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "POST") return payload;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return payload;

    if (typeof payload === "string") {
      const entry: CacheEntry = {
        statusCode: reply.statusCode,
        body: payload,
        fingerprint: computeFingerprint(request),
      };
      await backend.set(idempotencyKey, JSON.stringify(entry), WINDOW_MS);
    }

    return payload;
  });
};

export const idempotencyMiddleware = fp(idempotencyPlugin);
```

- [ ] **Step 4: Run the idempotency tests**

Run:

```bash
pnpm vitest run apps/api/src/__tests__/api-idempotency.test.ts
```

Expected: PASS — all 7 tests (5 existing + 2 new) should pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/idempotency.ts apps/api/src/__tests__/api-idempotency.test.ts
git commit -m "$(cat <<'EOF'
fix: detect idempotency key reuse with 409 Conflict

Store request fingerprint (method + route + body hash) alongside cached
responses. On cache hit, compare fingerprints: match replays, mismatch
returns 409. Prevents cross-route and cross-payload key collisions.
EOF
)"
```

---

## Task 2: Make /api/execute create durable approval records

**Files:**

- Modify: `apps/api/src/routes/execute.ts`
- Test: `apps/api/src/__tests__/api-execute.test.ts`
- Test: `apps/api/src/__tests__/execute-platform-parity.test.ts`

### Context

When `PlatformIngress.submit()` returns `approvalRequired: true`, the execute route returns `approvalId: undefined` and `approvalRequest: {}` because:

1. The ingress only persists a WorkTrace — it never creates approval records (that's app-layer responsibility)
2. The propose route calls `createApprovalForWorkUnit()` in this path — the execute route skips it

The fix: call the same `createApprovalForWorkUnit()` helper from the execute route.

- [ ] **Step 1: Write the failing test**

Add this test to `apps/api/src/__tests__/api-execute.test.ts`, inside the existing `describe("Execute API")` block:

```typescript
it("persists an approval record when execution returns PENDING_APPROVAL", async () => {
  await app.storageContext.identity.saveSpec({
    id: "spec_default",
    principalId: "default",
    organizationId: null,
    name: "Default User",
    description: "Approval-path test spec",
    riskTolerance: {
      none: "none" as const,
      low: "standard" as const,
      medium: "elevated" as const,
      high: "mandatory" as const,
      critical: "mandatory" as const,
    },
    globalSpendLimits: { daily: 10000, weekly: 50000, monthly: null, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/execute",
    headers: { "Idempotency-Key": "approval-persist-key" },
    payload: {
      actorId: "default",
      organizationId: ORG_ID,
      action: {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_needs_approval" },
        sideEffect: true,
      },
    },
  });

  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.outcome).toBe("PENDING_APPROVAL");
  expect(body.approvalRequest).toBeDefined();
  expect(body.approvalRequest.id).toBeTruthy();
  expect(body.approvalRequest.bindingHash).toBeTruthy();

  const persisted = await app.storageContext.approvals.getById(body.approvalRequest.id);
  expect(persisted).not.toBeNull();
  expect(persisted?.envelopeId).toBe(body.envelopeId);
});
```

- [ ] **Step 2: Update the parity test to assert approval metadata**

In `apps/api/src/__tests__/execute-platform-parity.test.ts`, find the test `"returns PENDING_APPROVAL when governance requires approval"` (around line 188). Replace the assertions at lines 229-232:

```typescript
// Before (lines 229-232):
// const body = res.json();
// expect(res.statusCode).toBe(200);
// expect(body.outcome).toBe("PENDING_APPROVAL");
// expect(body.envelopeId).toBeDefined();
// expect(body.traceId).toBeDefined();

// After:
const body = res.json();
expect(res.statusCode).toBe(200);
expect(body.outcome).toBe("PENDING_APPROVAL");
expect(body.envelopeId).toBeDefined();
expect(body.traceId).toBeDefined();
expect(body.approvalRequest).toBeDefined();
expect(body.approvalRequest.id).toBeTruthy();
expect(body.approvalRequest.bindingHash).toBeTruthy();
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
pnpm vitest run apps/api/src/__tests__/api-execute.test.ts apps/api/src/__tests__/execute-platform-parity.test.ts
```

Expected: FAIL — the new test fails because `approvalRequest` is `{}` (the empty `result.outputs`), and the parity test fails because `approvalRequest.id` is falsy.

- [ ] **Step 4: Wire createApprovalForWorkUnit into the execute route**

In `apps/api/src/routes/execute.ts`, add the import at the top (after line 6):

```typescript
import { createApprovalForWorkUnit } from "./approval-factory.js";
```

Then replace the approval-pending branch (lines 102-109):

```typescript
// Approval pending
if ("approvalRequired" in response && response.approvalRequired) {
  try {
    const { approvalId, bindingHash } = await createApprovalForWorkUnit({
      workUnit,
      storageContext: app.storageContext,
      routingConfig: app.orchestrator.routingConfig,
    });

    return reply.code(200).send({
      outcome: "PENDING_APPROVAL",
      envelopeId: workUnit.id,
      traceId: workUnit.traceId,
      approvalRequest: { id: approvalId, bindingHash },
    });
  } catch (err) {
    request.log.error({ err, workUnitId: workUnit.id }, "Failed to persist execute approval");
    return reply.code(500).send({
      error: "Failed to persist approval state",
      statusCode: 500,
    });
  }
}
```

- [ ] **Step 5: Run the execute tests**

Run:

```bash
pnpm vitest run apps/api/src/__tests__/api-execute.test.ts apps/api/src/__tests__/execute-platform-parity.test.ts
```

Expected: PASS — all tests in both files pass, including the new approval persistence test and the tightened parity assertion.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/execute.ts apps/api/src/__tests__/api-execute.test.ts apps/api/src/__tests__/execute-platform-parity.test.ts
git commit -m "$(cat <<'EOF'
fix: persist durable approval records for /api/execute

The execute route now calls createApprovalForWorkUnit() when governance
requires approval, matching the propose route's behavior. One factory,
two call sites, zero double-persist.
EOF
)"
```

---

## Task 3: Make patch approval execute the patched payload

**Files:**

- Modify: `packages/core/src/platform/platform-lifecycle.ts`
- Test: `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`

### Context

In `PlatformLifecycle.respondToApproval()`, the patch branch applies patched parameters to the envelope but does not update the WorkTrace. `executeAfterApproval()` reads `trace?.parameters` first (line 318), so the trace's stale pre-patch parameters would be used if the trace existed. Currently execution happens to work because it falls through to `proposal?.parameters` (which was patched), but:

- The trace retains stale data for audit/debugging
- Any code path that adds `trace.parameters` earlier in the pipeline will silently use pre-patch values

The fix: extend `updateWorkTraceApproval`'s typed interface to accept `parameters`, and pass the patched values in the patch branch.

- [ ] **Step 1: Write the failing test**

Add this test to `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`, inside the `describe("patched parameter re-evaluation")` block (after the existing `"denies when patched parameters violate policy"` test, around line 664):

```typescript
it("persists patched parameters to the work trace", async () => {
  const { approvalId, envelopeId } = seedWithCartridge();

  // Set trace parameters to match the original proposal
  const trace = stores._traces.get(envelopeId)!;
  trace.parameters = { campaignId: "camp-1", budget: 100 };
  stores._traces.set(envelopeId, trace);

  await lifecycle.respondToApproval({
    approvalId,
    action: "patch",
    respondedBy: "approver-1",
    bindingHash: BINDING_HASH,
    patchValue: { budget: 55 },
  });

  // modeRegistry.dispatch was called with patched parameters
  expect(stores.modeRegistry.dispatch).toHaveBeenCalledOnce();
  const dispatchCall = vi.mocked(stores.modeRegistry.dispatch).mock.calls[0]!;
  const dispatchedWorkUnit = dispatchCall[1];
  expect(dispatchedWorkUnit.parameters).toEqual(
    expect.objectContaining({ campaignId: "camp-1", budget: 55 }),
  );

  // The stored trace reflects patched parameters
  const updatedTrace = stores._traces.get(envelopeId)!;
  expect(updatedTrace.parameters).toEqual(
    expect.objectContaining({ campaignId: "camp-1", budget: 55 }),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run packages/core/src/platform/__tests__/platform-lifecycle.test.ts
```

Expected: FAIL — `updatedTrace.parameters` will still contain `{ campaignId: "camp-1", budget: 100 }` because `updateWorkTraceApproval` doesn't pass `parameters` through to the trace store.

- [ ] **Step 3: Extend the updateWorkTraceApproval interface and pass patched params**

In `packages/core/src/platform/platform-lifecycle.ts`, update the `updateWorkTraceApproval` method signature (around line 539). Add `parameters?` to the fields type:

```typescript
  private async updateWorkTraceApproval(
    workUnitId: string,
    fields: {
      approvalId: string;
      approvalOutcome: WorkTrace["approvalOutcome"];
      approvalRespondedBy: string;
      approvalRespondedAt: string;
      outcome?: WorkTrace["outcome"];
      completedAt?: string;
      parameters?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.config.traceStore.update(workUnitId, fields);
    } catch {
      // Best-effort — trace may not exist for legacy envelopes
    }
  }
```

Then update the patch branch (around line 157) to pass `parameters: patchedParameters`. Find this block:

```typescript
    } else if (params.action === "patch") {
      if (params.patchValue && envelope?.proposals[0]) {
        envelope.proposals[0].parameters = applyPatch(
          envelope.proposals[0].parameters,
          params.patchValue,
        );
        await envelopeStore.update(envelope.id, {
          status: "approved",
          proposals: envelope.proposals,
        });
      }

      await this.updateWorkTraceApproval(workUnitId, {
        approvalId: params.approvalId,
        approvalOutcome: "patched",
        approvalRespondedBy: params.respondedBy,
        approvalRespondedAt: respondedAt,
      });
```

Replace it with:

```typescript
    } else if (params.action === "patch") {
      let patchedParameters: Record<string, unknown> | undefined;

      if (params.patchValue && envelope?.proposals[0]) {
        envelope.proposals[0].parameters = applyPatch(
          envelope.proposals[0].parameters,
          params.patchValue,
        );
        patchedParameters = { ...envelope.proposals[0].parameters };
        delete patchedParameters["_principalId"];
        delete patchedParameters["_cartridgeId"];
        delete patchedParameters["_organizationId"];
        await envelopeStore.update(envelope.id, {
          status: "approved",
          proposals: envelope.proposals,
        });
      }

      await this.updateWorkTraceApproval(workUnitId, {
        approvalId: params.approvalId,
        approvalOutcome: "patched",
        approvalRespondedBy: params.respondedBy,
        approvalRespondedAt: respondedAt,
        ...(patchedParameters ? { parameters: patchedParameters } : {}),
      });
```

Note: the `_principalId`, `_cartridgeId`, and `_organizationId` fields are internal routing metadata on proposals, not user-facing parameters. The trace stores clean parameters. Check how `buildWorkTrace` handles this — if it already strips these, match that behavior.

- [ ] **Step 4: Run the lifecycle tests**

Run:

```bash
pnpm vitest run packages/core/src/platform/__tests__/platform-lifecycle.test.ts
```

Expected: PASS — all tests pass, including the new patched-parameters test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/platform-lifecycle.ts packages/core/src/platform/__tests__/platform-lifecycle.test.ts
git commit -m "$(cat <<'EOF'
fix: persist patched parameters to WorkTrace before execution

Extend updateWorkTraceApproval to accept a parameters field and pass
patched values in the patch branch. executeAfterApproval reads
trace.parameters first, so this makes the trace the canonical source.
EOF
)"
```

---

## Task 4: Wire governance hook into live skill-mode bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts`
- Create: `apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts`

### Context

`bootstrapSkillMode()` constructs `SkillExecutorImpl(adapter, toolsMap)` with only two arguments. The constructor accepts `hooks: SkillHook[] = []` as the fourth parameter. `GovernanceHook` is tested in `skill-executor.test.ts` but is never instantiated in production.

The fix: import `GovernanceHook` and pass it in the hooks array.

The test strategy avoids positional constructor assertions. Instead, we assert:

1. `GovernanceHook` was constructed exactly once with the tools map
2. `SkillExecutorImpl` was constructed exactly once
3. The `GovernanceHook` instance was passed to `SkillExecutorImpl`

- [ ] **Step 1: Create the bootstrap test directory**

Run:

```bash
mkdir -p apps/api/src/bootstrap/__tests__
```

- [ ] **Step 2: Write the failing bootstrap wiring test**

Create `apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapSkillMode } from "../skill-mode.js";

const register = vi.fn();

const governanceInstance = { name: "governance" };
const GovernanceHook = vi.fn().mockImplementation(() => governanceInstance);

const SkillExecutorImpl = vi.fn().mockImplementation(function (
  this: Record<string, unknown>,
  ...args: unknown[]
) {
  this._constructorArgs = args;
  return this;
});

vi.mock("@switchboard/core/skill-runtime", () => ({
  loadSkill: vi.fn(() => ({
    slug: "alex",
    body: "You are Alex",
    parameters: {},
    tools: ["crm-write"],
  })),
  SkillExecutorImpl,
  GovernanceHook,
  AnthropicToolCallingAdapter: vi.fn().mockImplementation(() => ({})),
  BuilderRegistry: vi.fn().mockImplementation(() => ({})),
  createCrmQueryTool: vi.fn(() => ({ operations: { get: { effectCategory: "read" } } })),
  createCrmWriteTool: vi.fn(() => ({ operations: { upsert: { effectCategory: "write" } } })),
  createCalendarBookTool: vi.fn(() => ({
    operations: { create: { effectCategory: "external_mutation" } },
  })),
  createEscalateTool: vi.fn(() => ({ operations: { owner: { effectCategory: "external_send" } } })),
  BookingFailureHandler: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@switchboard/core/platform", () => ({
  SkillMode: class SkillMode {
    constructor(public config: Record<string, unknown>) {}
  },
  registerSkillIntents: vi.fn(),
}));

vi.mock("@switchboard/core", () => ({
  HandoffPackageAssembler: vi.fn().mockImplementation(() => ({})),
  HandoffNotifier: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@switchboard/core/notifications", () => ({
  NoopNotifier: vi.fn().mockImplementation(() => ({})),
  TelegramApprovalNotifier: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@switchboard/db", () => ({
  PrismaContactStore: vi.fn().mockImplementation(() => ({})),
  PrismaOpportunityStore: vi.fn().mockImplementation(() => ({
    findActiveByContact: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: "opp_1" })),
  })),
  PrismaActivityLogStore: vi.fn().mockImplementation(() => ({})),
  PrismaBookingStore: vi.fn().mockImplementation(() => ({ findById: vi.fn(async () => null) })),
  PrismaHandoffStore: vi.fn().mockImplementation(() => ({})),
  PrismaBusinessFactsStore: vi.fn().mockImplementation(() => ({})),
}));

describe("bootstrapSkillMode governance wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ANTHROPIC_API_KEY"] = "test-key";
  });

  it("constructs GovernanceHook and passes it to SkillExecutorImpl", async () => {
    await bootstrapSkillMode({
      prismaClient: {
        $transaction: vi.fn(async (fn: (tx: Record<string, unknown>) => unknown) =>
          fn({
            booking: { update: vi.fn() },
            escalationRecord: {},
            outboxEvent: { create: vi.fn() },
          }),
        ),
        escalationRecord: { findMany: vi.fn(async () => []) },
      } as never,
      intentRegistry: {} as never,
      modeRegistry: { register } as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    // GovernanceHook was constructed with the tools map
    expect(GovernanceHook).toHaveBeenCalledOnce();
    const hookArg = GovernanceHook.mock.calls[0]![0];
    expect(hookArg).toBeInstanceOf(Map);

    // SkillExecutorImpl was constructed
    expect(SkillExecutorImpl).toHaveBeenCalledOnce();

    // The GovernanceHook instance was passed to SkillExecutorImpl
    // (check all args for an array containing the governance instance)
    const executorArgs = SkillExecutorImpl.mock.calls[0]!;
    const hooksArg = executorArgs.find(
      (arg) => Array.isArray(arg) && arg.some((h) => h === governanceInstance),
    );
    expect(hooksArg).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the bootstrap test to verify it fails**

Run:

```bash
pnpm vitest run apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts
```

Expected: FAIL — `GovernanceHook` is never constructed, and `SkillExecutorImpl` receives no hooks array.

- [ ] **Step 4: Wire GovernanceHook into the live executor**

In `apps/api/src/bootstrap/skill-mode.ts`, update the import block (around line 15) to include `GovernanceHook`:

```typescript
const {
  loadSkill,
  SkillExecutorImpl,
  GovernanceHook,
  AnthropicToolCallingAdapter,
  BuilderRegistry,
  createCrmQueryTool,
  createCrmWriteTool,
  createCalendarBookTool,
  createEscalateTool,
  BookingFailureHandler,
} = await import("@switchboard/core/skill-runtime");
```

Then update the executor construction (around line 162-164). Replace:

```typescript
const anthropicClient = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
const adapter = new AnthropicToolCallingAdapter(anthropicClient);
const skillExecutor = new SkillExecutorImpl(adapter, toolsMap);
```

With:

```typescript
const anthropicClient = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });
const adapter = new AnthropicToolCallingAdapter(anthropicClient);
const hooks = [new GovernanceHook(toolsMap)];
const skillExecutor = new SkillExecutorImpl(adapter, toolsMap, undefined, hooks);
```

- [ ] **Step 5: Run the bootstrap test and existing skill executor tests**

Run:

```bash
pnpm vitest run apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts packages/core/src/skill-runtime/skill-executor.test.ts
```

Expected: PASS — the bootstrap test proves the hook is wired, and existing skill executor tests remain green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts
git commit -m "$(cat <<'EOF'
fix: wire GovernanceHook into live skill-mode bootstrap

SkillExecutorImpl now receives a GovernanceHook in production,
matching the tested behavior in skill-executor.test.ts.
EOF
)"
```

---

## Task 5: Block SSRF in website scan route

**Files:**

- Modify: `apps/api/src/routes/website-scan.ts`
- Create: `apps/api/src/__tests__/website-scan.test.ts`

### Context

`website-scan.ts` calls `fetch(url)` directly with no SSRF protection. `assertSafeUrl()` and `SSRFError` already exist in `apps/api/src/utils/ssrf-guard.ts` (tested in `ssrf-guard.test.ts`).

The fix: import and call `assertSafeUrl()` before `fetch()`. Return 400 with the SSRFError message if the URL is unsafe.

The test server (`test-server.ts`) does not register website-scan routes and lacks the `organizationIdFromAuth` decorator. This test creates a minimal Fastify instance with just the scan route and stubs both the auth check and global `fetch`.

- [ ] **Step 1: Write the failing route test**

Create `apps/api/src/__tests__/website-scan.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import websiteScanRoutes from "../routes/website-scan.js";

describe("POST /api/website-scan", () => {
  let app: FastifyInstance;
  const fetchSpy = vi.fn();

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Stub organizationIdFromAuth on every request
    app.decorateRequest("organizationIdFromAuth", null);
    app.addHook("preHandler", async (request) => {
      const orgHeader = request.headers["x-organization-id"];
      if (typeof orgHeader === "string") {
        request.organizationIdFromAuth = orgHeader;
      }
    });

    await app.register(websiteScanRoutes);

    vi.stubGlobal(
      "fetch",
      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () =>
          "<html><body>Test page with enough content to pass the length check. ".repeat(10) +
          "</body></html>",
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
    await app.close();
  });

  it("rejects localhost URLs before attempting fetch", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/website-scan",
      headers: { "x-organization-id": "org_test" },
      payload: { url: "https://localhost/internal" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS URLs", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/website-scan",
      headers: { "x-organization-id": "org_test" },
      payload: { url: "http://example.com" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("HTTPS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm vitest run apps/api/src/__tests__/website-scan.test.ts
```

Expected: FAIL — `fetch` is called for localhost URLs, and the response is not 400.

- [ ] **Step 3: Apply assertSafeUrl() before fetch**

In `apps/api/src/routes/website-scan.ts`, add the import after line 2:

```typescript
import { assertSafeUrl, SSRFError } from "../utils/ssrf-guard.js";
```

Then add the SSRF check before the `fetch` call. Replace lines 30-34:

```typescript
    // Before (lines 30-34):
    // try {
    //   const response = await fetch(url, {
    //     headers: { "User-Agent": "SwitchboardBot/1.0" },
    //     signal: AbortSignal.timeout(10000),
    //   });

    // After:
    try {
      await assertSafeUrl(url);
    } catch (err) {
      if (err instanceof SSRFError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "SwitchboardBot/1.0" },
        signal: AbortSignal.timeout(10000),
      });
```

The full file after the change should look like:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { ScanRequestSchema, ScanResultSchema } from "@switchboard/schemas";
import Anthropic from "@anthropic-ai/sdk";
import { assertSafeUrl, SSRFError } from "../utils/ssrf-guard.js";

const EXTRACTION_PROMPT = `You are extracting structured business information from a website page.
Return a JSON object with these fields (omit any you can't determine):
- businessName: { value: string, confidence: "high"|"medium"|"low" }
- category: { value: string, confidence: "high"|"medium"|"low" }
- location: { value: string, confidence: "high"|"medium"|"low" }
- services: [{ name: string, price?: number, duration?: number, confidence: "high"|"medium"|"low" }]
- hours: { mon?: "HH:MM-HH:MM", tue?: "HH:MM-HH:MM", ... }
- contactMethods: string[]
- faqHints: string[]

Only include information you can clearly identify. Set confidence to "high" when explicitly stated, "medium" when reasonably inferred, "low" when uncertain.
Return ONLY valid JSON, no markdown.`;

const websiteScanRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/website-scan", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized" });

    const parsed = ScanRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const { url } = parsed.data;

    try {
      await assertSafeUrl(url);
    } catch (err) {
      if (err instanceof SSRFError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "SwitchboardBot/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return reply.send({
          result: { services: [], contactMethods: [], faqHints: [] },
          error: "Could not fetch page",
        });
      }

      const html = await response.text();
      const textContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8000);

      if (textContent.length < 200) {
        return reply.send({
          result: { services: [], contactMethods: [], faqHints: [] },
          warning: "The page content was very short — some information may be missing",
        });
      }

      const anthropic = new Anthropic();
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: EXTRACTION_PROMPT,
        messages: [
          {
            role: "user",
            content: `Extract business information from this website content:\n\n${textContent}`,
          },
        ],
      });

      const content = message.content[0];
      if (!content || content.type !== "text") {
        return reply.send({ result: { services: [], contactMethods: [], faqHints: [] } });
      }

      const parsed = ScanResultSchema.safeParse(JSON.parse(content.text));
      if (!parsed.success) {
        app.log.warn({ validation: parsed.error }, "Scan result failed validation");
        return reply.send({ result: { services: [], contactMethods: [], faqHints: [] } });
      }

      return reply.send({ result: parsed.data });
    } catch (err) {
      app.log.warn({ err, url }, "Website scan failed");
      return reply.send({
        result: { services: [], contactMethods: [], faqHints: [] },
        error: "Scan failed — we'll build your playbook from questions instead",
      });
    }
  });
};

export default websiteScanRoutes;
```

- [ ] **Step 4: Run the website scan and SSRF guard tests**

Run:

```bash
pnpm vitest run apps/api/src/__tests__/website-scan.test.ts apps/api/src/__tests__/ssrf-guard.test.ts
```

Expected: PASS — unsafe URLs are rejected before outbound I/O, and the existing SSRF guard utility tests remain green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/website-scan.ts apps/api/src/__tests__/website-scan.test.ts
git commit -m "$(cat <<'EOF'
fix: enforce SSRF guard in website scan route

assertSafeUrl() is called before fetch(), blocking localhost, private
IPs, and non-HTTPS URLs. The guard already existed in ssrf-guard.ts
but was not wired into the scan route.
EOF
)"
```

---

## Final Verification

- [ ] **Run the full targeted hardening suite**

```bash
pnpm vitest run \
  apps/api/src/__tests__/api-idempotency.test.ts \
  apps/api/src/__tests__/api-execute.test.ts \
  apps/api/src/__tests__/execute-platform-parity.test.ts \
  apps/api/src/__tests__/website-scan.test.ts \
  apps/api/src/__tests__/ssrf-guard.test.ts \
  apps/api/src/bootstrap/__tests__/skill-mode-governance.test.ts \
  packages/core/src/platform/__tests__/platform-lifecycle.test.ts \
  packages/core/src/skill-runtime/skill-executor.test.ts
```

Expected: PASS across all listed files.

- [ ] **Run the broader API regression slice**

```bash
pnpm vitest run \
  apps/api/src/__tests__/api-approvals.test.ts \
  apps/api/src/__tests__/persistence-truth.test.ts \
  apps/api/src/__tests__/api-hardening.test.ts
```

Expected: PASS. Approval state, persistence truth, and hardening assertions should remain green.

- [ ] **Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS — no type errors introduced.
