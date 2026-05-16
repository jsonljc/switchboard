# Launch-Blocker #17 — Governance Error Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop silent failure modes in `PlatformIngress` — surface governance eval exceptions and terminal trace-persist failures to the audit ledger and the operator alerter.

**Architecture:** Reuse `AuditEventType: "action.failed"` with a typed infrastructure-failure snapshot built by a shared helper. Introduce a dedicated `OperatorAlerter` interface (no widening of approval notifiers). Replace the single trace-persist retry with a 3-attempt exponential backoff (`100ms / ×4 / ±25% jitter`) confined to `WorkTraceStore.persist`. Governance evaluation is **never** retried.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, `@switchboard/core` package, existing `AuditLedger` from `packages/core/src/audit/ledger.ts`.

**Spec:** `docs/superpowers/specs/2026-04-28-launch-governance-error-visibility-design.md` (committed at `28f7b750`).

**Worktree:** `.worktrees/launch-governance-error-visibility` on branch `fix/launch-governance-error-visibility` (forked from `origin/main` @ `0dd2f91c`). All commands below run from the worktree root unless noted.

**Hard constraints (per user, do not violate):**

- Do not add `AuditEventType` enum values.
- Do not reuse / widen approval notifiers (`ApprovalNotifier`).
- Do not create a generic `retryWithBackoff` package — keep helpers local.
- Preserve all invariants from the spec (no recursive failure logging; alerter best-effort with timeout; retry only `WorkTraceStore.persist`; same logical `WorkTrace` across retries; exactly one terminal audit + one terminal alert per terminal failure).

---

## File Structure

**New files (all in `packages/core/src/observability/`):**

- `operator-alerter.ts` — `OperatorAlerter` interface, `InfrastructureFailureAlert` type, `NoopOperatorAlerter`, `WebhookOperatorAlerter`, `safeAlert` wrapper.
- `__tests__/operator-alerter.test.ts`
- `infrastructure-failure.ts` — `InfrastructureErrorType`, `InfrastructureFailureSnapshot`, `buildInfrastructureFailureAuditParams()`, `extractErrorMessage()`.
- `__tests__/infrastructure-failure.test.ts`
- `index.ts` — barrel re-exports.

**New test file in existing dir:**

- `packages/core/src/platform/__tests__/platform-ingress-governance-error.test.ts`

**Modified files:**

- `packages/core/src/platform/platform-ingress.ts` — add `auditLedger` + `operatorAlerter` config fields, governance error audit/alert, replace retry loop with backoff + terminal audit/alert.
- `packages/core/src/platform/__tests__/platform-ingress-trace-retry.test.ts` — update existing two tests for new 3-attempt semantics, add assertions on terminal audit + alert.
- `packages/core/src/index.ts` — re-export observability barrel.
- `apps/api/src/app.ts` — construct `OperatorAlerter` from env, pass `auditLedger` + `operatorAlerter` into `new PlatformIngress({ … })`.

**Files NOT touched (verify after each task):**

- `packages/schemas/src/audit.ts` (no enum changes).
- `packages/core/src/notifications/*` (no approval-notifier changes).

---

## Task 1: `OperatorAlerter` types + `NoopOperatorAlerter`

**Files:**

- Create: `packages/core/src/observability/operator-alerter.ts`
- Test: `packages/core/src/observability/__tests__/operator-alerter.test.ts`

- [ ] **Step 1.1: Write the failing test for `NoopOperatorAlerter`**

```ts
// packages/core/src/observability/__tests__/operator-alerter.test.ts
import { describe, it, expect } from "vitest";
import { NoopOperatorAlerter } from "../operator-alerter.js";
import type { InfrastructureFailureAlert } from "../operator-alerter.js";

const samplePayload: InfrastructureFailureAlert = {
  errorType: "governance_eval_exception",
  severity: "critical",
  errorMessage: "boom",
  retryable: false,
  occurredAt: "2026-04-28T00:00:00.000Z",
  source: "platform_ingress",
};

describe("NoopOperatorAlerter", () => {
  it("resolves without throwing and performs no I/O", async () => {
    const alerter = new NoopOperatorAlerter();
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run from worktree root:

```
pnpm --filter @switchboard/core test -- packages/core/src/observability/__tests__/operator-alerter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement `OperatorAlerter` types + `NoopOperatorAlerter`**

```ts
// packages/core/src/observability/operator-alerter.ts
export type InfrastructureErrorType = "governance_eval_exception" | "trace_persist_failed";

export interface InfrastructureFailureAlert {
  errorType: InfrastructureErrorType;
  severity: "critical" | "warning";
  errorMessage: string;
  intent?: string;
  traceId?: string;
  deploymentId?: string;
  organizationId?: string;
  retryable: boolean;
  occurredAt: string;
  source: "platform_ingress";
}

export interface OperatorAlerter {
  alert(payload: InfrastructureFailureAlert): Promise<void>;
}

export class NoopOperatorAlerter implements OperatorAlerter {
  async alert(_payload: InfrastructureFailureAlert): Promise<void> {
    // intentional no-op
  }
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Same command. Expected: PASS (1 test).

- [ ] **Step 1.5: Commit**

```
git add packages/core/src/observability/operator-alerter.ts \
        packages/core/src/observability/__tests__/operator-alerter.test.ts
git commit -m "feat(core/observability): add OperatorAlerter interface + NoopOperatorAlerter"
```

---

## Task 2: `safeAlert` wrapper + `WebhookOperatorAlerter`

`safeAlert` ensures any throw from a real alerter is swallowed and `console.error`'d — `PlatformIngress` will route every alert through it so alerter delivery can never propagate.

**Files:**

- Modify: `packages/core/src/observability/operator-alerter.ts`
- Modify: `packages/core/src/observability/__tests__/operator-alerter.test.ts`

- [ ] **Step 2.1: Write failing tests for `safeAlert` + `WebhookOperatorAlerter`**

Append to `__tests__/operator-alerter.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { WebhookOperatorAlerter, safeAlert, type OperatorAlerter } from "../operator-alerter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeAlert", () => {
  it("swallows alerter throws and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: OperatorAlerter = {
      alert: vi.fn().mockRejectedValue(new Error("alerter down")),
    };
    await expect(safeAlert(failing, samplePayload)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[OperatorAlerter] alert delivery failed",
      expect.any(Error),
    );
  });

  it("propagates nothing on alerter success", async () => {
    const ok: OperatorAlerter = { alert: vi.fn().mockResolvedValue(undefined) };
    await expect(safeAlert(ok, samplePayload)).resolves.toBeUndefined();
  });
});

describe("WebhookOperatorAlerter", () => {
  it("POSTs JSON payload to the configured URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const alerter = new WebhookOperatorAlerter({ webhookUrl: "https://example.test/alert" });
    await alerter.alert(samplePayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.test/alert");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(samplePayload);
  });

  it("swallows non-2xx responses and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));

    const alerter = new WebhookOperatorAlerter({ webhookUrl: "https://example.test/alert" });
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("swallows AbortError on timeout and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );

    const alerter = new WebhookOperatorAlerter({
      webhookUrl: "https://example.test/alert",
      timeoutMs: 10,
    });
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("swallows fetch throws and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dns fail")));

    const alerter = new WebhookOperatorAlerter({ webhookUrl: "https://example.test/alert" });
    await expect(alerter.alert(samplePayload)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2.2: Run the tests to verify they fail**

```
pnpm --filter @switchboard/core test -- packages/core/src/observability/__tests__/operator-alerter.test.ts
```

Expected: FAIL — `safeAlert` and `WebhookOperatorAlerter` not exported.

- [ ] **Step 2.3: Implement `safeAlert` + `WebhookOperatorAlerter`**

Append to `packages/core/src/observability/operator-alerter.ts`:

```ts
const DEFAULT_WEBHOOK_TIMEOUT_MS = 2000;

export async function safeAlert(
  alerter: OperatorAlerter,
  payload: InfrastructureFailureAlert,
): Promise<void> {
  try {
    await alerter.alert(payload);
  } catch (err) {
    console.error("[OperatorAlerter] alert delivery failed", err);
  }
}

export class WebhookOperatorAlerter implements OperatorAlerter {
  private readonly webhookUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(config: {
    webhookUrl: string;
    headers?: Record<string, string>;
    /** Default 2000ms; range 1500–3000ms acceptable. */
    timeoutMs?: number;
  }) {
    this.webhookUrl = config.webhookUrl;
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  }

  async alert(payload: InfrastructureFailureAlert): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error(
          `[OperatorAlerter] webhook returned ${response.status}: ${response.statusText}`,
        );
      }
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        console.error("[OperatorAlerter] webhook request timed out", e);
      } else {
        console.error("[OperatorAlerter] webhook delivery error", e);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 2.4: Run the tests to verify they pass**

Same command. Expected: PASS (all 6 tests in the file).

- [ ] **Step 2.5: Commit**

```
git add packages/core/src/observability/operator-alerter.ts \
        packages/core/src/observability/__tests__/operator-alerter.test.ts
git commit -m "feat(core/observability): add safeAlert wrapper + WebhookOperatorAlerter with timeout"
```

---

## Task 3: Infrastructure-failure audit-params builder

**Files:**

- Create: `packages/core/src/observability/infrastructure-failure.ts`
- Create: `packages/core/src/observability/__tests__/infrastructure-failure.test.ts`

- [ ] **Step 3.1: Write the failing tests**

```ts
// packages/core/src/observability/__tests__/infrastructure-failure.test.ts
import { describe, it, expect } from "vitest";
import {
  buildInfrastructureFailureAuditParams,
  extractErrorMessage,
} from "../infrastructure-failure.js";

const baseWorkUnit = {
  id: "wu_1",
  intent: "test.intent",
  traceId: "t_1",
  organizationId: "org_1",
  deployment: { deploymentId: "dep_1" },
};

describe("extractErrorMessage", () => {
  it("returns Error.message", () => {
    expect(extractErrorMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error throws", () => {
    expect(extractErrorMessage("oops")).toBe("oops");
    expect(extractErrorMessage({ code: 42 })).toBe('{"code":42}');
    expect(extractErrorMessage(null)).toBe("null");
  });
});

describe("buildInfrastructureFailureAuditParams", () => {
  it("populates all fields from workUnit when present", () => {
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: "governance_eval_exception",
      error: new Error("gate exploded"),
      workUnit: baseWorkUnit,
      retryable: false,
    });

    expect(ledgerParams.eventType).toBe("action.failed");
    expect(ledgerParams.entityType).toBe("work_unit");
    expect(ledgerParams.entityId).toBe("wu_1");
    expect(ledgerParams.actorType).toBe("system");
    expect(ledgerParams.actorId).toBe("platform_ingress");
    expect(ledgerParams.organizationId).toBe("org_1");
    expect(ledgerParams.traceId).toBe("t_1");
    expect(ledgerParams.snapshot).toMatchObject({
      errorType: "governance_eval_exception",
      failureClass: "infrastructure",
      severity: "critical",
      errorMessage: "gate exploded",
      intent: "test.intent",
      traceId: "t_1",
      deploymentId: "dep_1",
      organizationId: "org_1",
      retryable: false,
    });
    expect(typeof ledgerParams.snapshot.occurredAt).toBe("string");

    expect(alert).toMatchObject({
      errorType: "governance_eval_exception",
      severity: "critical",
      errorMessage: "gate exploded",
      intent: "test.intent",
      traceId: "t_1",
      deploymentId: "dep_1",
      organizationId: "org_1",
      retryable: false,
      source: "platform_ingress",
    });
    expect(typeof alert.occurredAt).toBe("string");
  });

  it("omits optional snapshot fields when workUnit is absent", () => {
    const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
      errorType: "trace_persist_failed",
      error: new Error("db down"),
      retryable: false,
    });

    const snap = ledgerParams.snapshot as Record<string, unknown>;
    expect("intent" in snap).toBe(false);
    expect("traceId" in snap).toBe(false);
    expect("deploymentId" in snap).toBe(false);
    expect("organizationId" in snap).toBe(false);
    expect(snap.failureClass).toBe("infrastructure");
    expect(snap.severity).toBe("critical");
    expect(snap.errorType).toBe("trace_persist_failed");

    expect("intent" in alert).toBe(false);
    expect("traceId" in alert).toBe(false);
    expect(ledgerParams.entityId).toBe("unknown");
    expect(ledgerParams.organizationId).toBeUndefined();
    expect(ledgerParams.traceId).toBeNull();
  });

  it("uses critical severity for both error types by default", () => {
    const a = buildInfrastructureFailureAuditParams({
      errorType: "governance_eval_exception",
      error: new Error("x"),
      retryable: false,
    });
    const b = buildInfrastructureFailureAuditParams({
      errorType: "trace_persist_failed",
      error: new Error("x"),
      retryable: false,
    });
    expect(a.alert.severity).toBe("critical");
    expect(b.alert.severity).toBe("critical");
  });

  it("handles non-Error throws via extractErrorMessage", () => {
    const { alert } = buildInfrastructureFailureAuditParams({
      errorType: "trace_persist_failed",
      error: "string error",
      retryable: false,
    });
    expect(alert.errorMessage).toBe("string error");
  });
});
```

- [ ] **Step 3.2: Run the tests to verify they fail**

```
pnpm --filter @switchboard/core test -- packages/core/src/observability/__tests__/infrastructure-failure.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the builder**

```ts
// packages/core/src/observability/infrastructure-failure.ts
import type { InfrastructureErrorType, InfrastructureFailureAlert } from "./operator-alerter.js";

export type { InfrastructureErrorType } from "./operator-alerter.js";

export interface InfrastructureFailureSnapshot {
  errorType: InfrastructureErrorType;
  failureClass: "infrastructure";
  severity: "critical" | "warning";
  errorMessage: string;
  intent?: string;
  traceId?: string;
  deploymentId?: string;
  organizationId?: string;
  retryable: boolean;
  occurredAt: string;
}

export interface BuildInfrastructureFailureInput {
  errorType: InfrastructureErrorType;
  error: unknown;
  workUnit?: {
    id: string;
    intent: string;
    traceId: string;
    organizationId: string;
    deployment?: { deploymentId: string };
  };
  retryable: boolean;
}

export interface InfrastructureFailureAuditParams {
  eventType: "action.failed";
  actorType: "system";
  actorId: "platform_ingress";
  entityType: "work_unit";
  entityId: string;
  riskCategory: "high";
  summary: string;
  snapshot: InfrastructureFailureSnapshot;
  organizationId?: string;
  traceId: string | null;
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function buildInfrastructureFailureAuditParams(input: BuildInfrastructureFailureInput): {
  ledgerParams: InfrastructureFailureAuditParams;
  alert: InfrastructureFailureAlert;
} {
  const occurredAt = new Date().toISOString();
  const errorMessage = extractErrorMessage(input.error);
  const severity: "critical" | "warning" = "critical";

  const snapshot: InfrastructureFailureSnapshot = {
    errorType: input.errorType,
    failureClass: "infrastructure",
    severity,
    errorMessage,
    retryable: input.retryable,
    occurredAt,
  };
  const alert: InfrastructureFailureAlert = {
    errorType: input.errorType,
    severity,
    errorMessage,
    retryable: input.retryable,
    occurredAt,
    source: "platform_ingress",
  };

  if (input.workUnit) {
    snapshot.intent = input.workUnit.intent;
    snapshot.traceId = input.workUnit.traceId;
    snapshot.organizationId = input.workUnit.organizationId;
    alert.intent = input.workUnit.intent;
    alert.traceId = input.workUnit.traceId;
    alert.organizationId = input.workUnit.organizationId;
    if (input.workUnit.deployment) {
      snapshot.deploymentId = input.workUnit.deployment.deploymentId;
      alert.deploymentId = input.workUnit.deployment.deploymentId;
    }
  }

  const ledgerParams: InfrastructureFailureAuditParams = {
    eventType: "action.failed",
    actorType: "system",
    actorId: "platform_ingress",
    entityType: "work_unit",
    entityId: input.workUnit?.id ?? "unknown",
    riskCategory: "high",
    summary: `Infrastructure failure: ${input.errorType}`,
    snapshot,
    organizationId: input.workUnit?.organizationId,
    traceId: input.workUnit?.traceId ?? null,
  };

  return { ledgerParams, alert };
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

Same command. Expected: PASS (5 tests).

- [ ] **Step 3.5: Commit**

```
git add packages/core/src/observability/infrastructure-failure.ts \
        packages/core/src/observability/__tests__/infrastructure-failure.test.ts
git commit -m "feat(core/observability): add infrastructure-failure audit-params builder"
```

---

## Task 4: Observability barrel + core re-export

**Files:**

- Create: `packages/core/src/observability/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 4.1: Create the barrel**

```ts
// packages/core/src/observability/index.ts
export { NoopOperatorAlerter, WebhookOperatorAlerter, safeAlert } from "./operator-alerter.js";
export type {
  OperatorAlerter,
  InfrastructureFailureAlert,
  InfrastructureErrorType,
} from "./operator-alerter.js";
export {
  buildInfrastructureFailureAuditParams,
  extractErrorMessage,
} from "./infrastructure-failure.js";
export type {
  InfrastructureFailureSnapshot,
  BuildInfrastructureFailureInput,
  InfrastructureFailureAuditParams,
} from "./infrastructure-failure.js";
```

- [ ] **Step 4.2: Add the re-export to the package barrel**

In `packages/core/src/index.ts`, add (alphabetically near other `export *` lines):

```ts
export * from "./observability/index.js";
```

- [ ] **Step 4.3: Verify typecheck and existing core tests still green**

```
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core test
```

Expected: typecheck clean, all tests pass (baseline 2064 + 9 new = 2073).

- [ ] **Step 4.4: Commit**

```
git add packages/core/src/observability/index.ts packages/core/src/index.ts
git commit -m "chore(core): export observability barrel from package root"
```

---

## Task 5: Wire `auditLedger` + `operatorAlerter` into `PlatformIngressConfig` (no behavior change yet)

This task adds the config plumbing so subsequent tasks can use them. No call sites change yet.

**Files:**

- Modify: `packages/core/src/platform/platform-ingress.ts`

- [ ] **Step 5.1: Read the current config interface**

`packages/core/src/platform/platform-ingress.ts:25-34`:

```ts
export interface PlatformIngressConfig {
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  governanceGate: GovernanceGateInterface;
  deploymentResolver: AuthoritativeDeploymentResolver;
  traceStore?: WorkTraceStore;
  lifecycleService?: ApprovalLifecycleService;
  approvalRoutingConfig?: ApprovalRoutingConfig;
  entitlementResolver?: BillingEntitlementResolver;
}
```

- [ ] **Step 5.2: Add imports + new optional config fields**

At the top of `platform-ingress.ts`, add:

```ts
import type { AuditLedger } from "../audit/ledger.js";
import type { OperatorAlerter } from "../observability/operator-alerter.js";
import { NoopOperatorAlerter, safeAlert } from "../observability/operator-alerter.js";
import { buildInfrastructureFailureAuditParams } from "../observability/infrastructure-failure.js";
```

Extend `PlatformIngressConfig`:

```ts
export interface PlatformIngressConfig {
  // … existing fields …
  auditLedger?: AuditLedger;
  operatorAlerter?: OperatorAlerter;
  /** Injectable for tests — defaults to setTimeout-based delay. */
  delayFn?: (ms: number) => Promise<void>;
}
```

In the constructor, resolve the alerter default:

```ts
private readonly alerter: OperatorAlerter;

constructor(config: PlatformIngressConfig) {
  this.config = config;
  this.alerter = config.operatorAlerter ?? new NoopOperatorAlerter();
}
```

- [ ] **Step 5.3: Verify typecheck + core tests**

```
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core test
```

Expected: clean. No behavior change yet.

- [ ] **Step 5.4: Commit**

```
git add packages/core/src/platform/platform-ingress.ts
git commit -m "chore(core/platform-ingress): plumb auditLedger + operatorAlerter config (no behavior change)"
```

---

## Task 6: Governance error path — write infra-failure audit + fire alerter

**Files:**

- Create: `packages/core/src/platform/__tests__/platform-ingress-governance-error.test.ts`
- Modify: `packages/core/src/platform/platform-ingress.ts`

- [ ] **Step 6.1: Write the failing test**

```ts
// packages/core/src/platform/__tests__/platform-ingress-governance-error.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlatformIngress } from "../platform-ingress.js";
import type { GovernanceGateInterface } from "../platform-ingress.js";
import type { OperatorAlerter } from "../../observability/operator-alerter.js";
import type { AuditLedger } from "../../audit/ledger.js";

function makeIntentRegistry() {
  return {
    lookup: vi.fn().mockReturnValue({
      intent: "test.intent",
      triggers: ["api"],
      mode: "skill",
      slug: "test",
      defaultMode: "skill",
      allowedModes: ["skill"],
      executor: { mode: "skill", skillSlug: "test" },
      parameterSchema: {},
      mutationClass: "read",
      budgetClass: "standard",
      approvalPolicy: "none",
      idempotent: false,
      allowedTriggers: ["api"],
      timeoutMs: 30000,
      retryable: false,
    }),
    validateTrigger: vi.fn().mockReturnValue(true),
    resolveMode: vi.fn().mockReturnValue("skill"),
  };
}
function makeModeRegistry() {
  return { dispatch: vi.fn() };
}
function makeDeploymentResolver() {
  return {
    resolve: vi.fn().mockResolvedValue({
      deploymentId: "dep_1",
      skillSlug: "test",
      trustScore: 50,
    }),
  };
}
function makeThrowingGate(): GovernanceGateInterface {
  return { evaluate: vi.fn().mockRejectedValue(new Error("gate exploded")) };
}
function makeTraceStore() {
  return {
    persist: vi.fn().mockResolvedValue(undefined),
    getByIdempotencyKey: vi.fn().mockResolvedValue(null),
  };
}

const baseRequest = {
  intent: "test.intent",
  trigger: "api" as const,
  organizationId: "org_1",
  actor: { id: "actor_1", type: "user" as const },
  parameters: {},
  surface: { surface: "api" as const, requestId: "req_test" },
};

describe("PlatformIngress governance error path", () => {
  let alerter: OperatorAlerter & { alert: ReturnType<typeof vi.fn> };
  let auditLedger: { record: ReturnType<typeof vi.fn> };
  let gate: GovernanceGateInterface;

  beforeEach(() => {
    alerter = { alert: vi.fn().mockResolvedValue(undefined) };
    auditLedger = { record: vi.fn().mockResolvedValue(undefined) };
    gate = makeThrowingGate();
  });

  function buildIngress(opts?: { withAudit?: boolean }) {
    return new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: gate,
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: makeTraceStore() as never,
      operatorAlerter: alerter,
      auditLedger: opts?.withAudit === false ? undefined : (auditLedger as unknown as AuditLedger),
    });
  }

  it("returns ok:true with denied result and reasonCode GOVERNANCE_ERROR", async () => {
    const result = await buildIngress().submit(baseRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.outcome).toBe("failed");
    expect(result.result.error?.code).toBe("GOVERNANCE_ERROR");
  });

  it("writes one infra-failure audit entry with errorType=governance_eval_exception", async () => {
    await buildIngress().submit(baseRequest);
    expect(auditLedger.record).toHaveBeenCalledTimes(1);
    const params = auditLedger.record.mock.calls[0]![0];
    expect(params.eventType).toBe("action.failed");
    expect(params.snapshot).toMatchObject({
      errorType: "governance_eval_exception",
      failureClass: "infrastructure",
      severity: "critical",
      retryable: false,
    });
  });

  it("fires operator alerter exactly once with matching payload", async () => {
    await buildIngress().submit(baseRequest);
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert.mock.calls[0]![0]).toMatchObject({
      errorType: "governance_eval_exception",
      severity: "critical",
      source: "platform_ingress",
      retryable: false,
    });
  });

  it("does not retry governance evaluation", async () => {
    await buildIngress().submit(baseRequest);
    expect(gate.evaluate).toHaveBeenCalledTimes(1);
  });

  it("still alerts when auditLedger is absent and does not throw", async () => {
    const ingress = buildIngress({ withAudit: false });
    const result = await ingress.submit(baseRequest);
    expect(result.ok).toBe(true);
    expect(alerter.alert).toHaveBeenCalledTimes(1);
  });

  it("swallows audit-write failure and still alerts; no second infra-failure entry", async () => {
    auditLedger.record.mockRejectedValueOnce(new Error("ledger down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await buildIngress().submit(baseRequest);
    expect(result.ok).toBe(true);
    expect(auditLedger.record).toHaveBeenCalledTimes(1); // not retried, not re-emitted
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 6.2: Run the tests to verify they fail**

```
pnpm --filter @switchboard/core test -- packages/core/src/platform/__tests__/platform-ingress-governance-error.test.ts
```

Expected: FAIL — `auditLedger.record` not called, `alerter.alert` not called.

- [ ] **Step 6.3: Update the governance catch block**

In `packages/core/src/platform/platform-ingress.ts`, replace the `try { decision = await governanceGate.evaluate(...) } catch { … }` block (currently lines 174–191) with:

```ts
try {
  decision = await governanceGate.evaluate(workUnit, registration);
} catch (governanceErr) {
  decision = {
    outcome: "deny",
    reasonCode: "GOVERNANCE_ERROR",
    riskScore: 1,
    matchedPolicies: [],
  };

  await this.recordInfrastructureFailure({
    errorType: "governance_eval_exception",
    error: governanceErr,
    workUnit,
    retryable: false,
  });

  const result = this.buildFailedResult(
    workUnit,
    "GOVERNANCE_ERROR",
    "Governance evaluation failed",
  );
  await this.persistTrace(traceStore, workUnit, decision, governanceCompletedAt, result);
  return { ok: true, result, workUnit };
}
```

Add a private helper to the `PlatformIngress` class:

```ts
private async recordInfrastructureFailure(input: {
  errorType: "governance_eval_exception" | "trace_persist_failed";
  error: unknown;
  workUnit?: WorkUnit;
  retryable: boolean;
}): Promise<void> {
  const { ledgerParams, alert } = buildInfrastructureFailureAuditParams({
    errorType: input.errorType,
    error: input.error,
    workUnit: input.workUnit
      ? {
          id: input.workUnit.id,
          intent: input.workUnit.intent,
          traceId: input.workUnit.traceId,
          organizationId: input.workUnit.organizationId,
          deployment: input.workUnit.deployment
            ? { deploymentId: input.workUnit.deployment.deploymentId }
            : undefined,
        }
      : undefined,
    retryable: input.retryable,
  });

  if (this.config.auditLedger) {
    try {
      await this.config.auditLedger.record(ledgerParams);
    } catch (auditErr) {
      // Invariant: no recursive failure logging.
      console.error("[PlatformIngress] failed to record infrastructure-failure audit entry", auditErr);
    }
  }

  await safeAlert(this.alerter, alert);
}
```

- [ ] **Step 6.4: Run the new test file to verify all six tests pass**

```
pnpm --filter @switchboard/core test -- packages/core/src/platform/__tests__/platform-ingress-governance-error.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6.5: Run the full core suite (catch unintended regressions)**

```
pnpm --filter @switchboard/core test
```

Expected: all green. The pre-existing `platform-ingress-trace-retry.test.ts` should still pass (we have not touched the retry logic yet).

- [ ] **Step 6.6: Commit**

```
git add packages/core/src/platform/platform-ingress.ts \
        packages/core/src/platform/__tests__/platform-ingress-governance-error.test.ts
git commit -m "feat(core/platform-ingress): audit + alert on governance eval exceptions"
```

---

## Task 7: Trace persist exponential backoff + terminal audit/alert

This task replaces the single-retry `persistTrace` with a 3-attempt exponential backoff and emits a terminal infra-failure audit + alert when retries are exhausted.

**Files:**

- Modify: `packages/core/src/platform/platform-ingress.ts`
- Modify: `packages/core/src/platform/__tests__/platform-ingress-trace-retry.test.ts`

- [ ] **Step 7.1: Update existing trace-retry tests to the new semantics**

Replace the entire body of `packages/core/src/platform/__tests__/platform-ingress-trace-retry.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest";
import { PlatformIngress, TRACE_PERSIST_RETRY_POLICY } from "../platform-ingress.js";
import type { GovernanceGateInterface } from "../platform-ingress.js";

function makeIntentRegistry() {
  return {
    lookup: vi.fn().mockReturnValue({
      intent: "test.intent",
      triggers: ["api"],
      mode: "skill",
      slug: "test",
      defaultMode: "skill",
      allowedModes: ["skill"],
      executor: { mode: "skill", skillSlug: "test" },
      parameterSchema: {},
      mutationClass: "read",
      budgetClass: "standard",
      approvalPolicy: "none",
      idempotent: false,
      allowedTriggers: ["api"],
      timeoutMs: 30000,
      retryable: false,
    }),
    validateTrigger: vi.fn().mockReturnValue(true),
    resolveMode: vi.fn().mockReturnValue("skill"),
  };
}
function makeModeRegistry() {
  return {
    dispatch: vi.fn().mockResolvedValue({
      workUnitId: "wu_1",
      outcome: "completed",
      summary: "OK",
      outputs: {},
      mode: "skill",
      durationMs: 100,
      traceId: "t_1",
    }),
  };
}
function makeGate(): GovernanceGateInterface {
  return {
    evaluate: vi.fn().mockResolvedValue({
      outcome: "execute",
      reasonCode: "ALLOWED",
      riskScore: 0,
      matchedPolicies: [],
      constraints: {
        allowedModelTiers: ["default"],
        maxToolCalls: 5,
        maxLlmTurns: 3,
        maxTotalTokens: 4000,
        maxRuntimeMs: 30000,
        maxWritesPerExecution: 2,
        trustLevel: "guided",
      },
    }),
  };
}
function makeDeploymentResolver() {
  return {
    resolve: vi.fn().mockResolvedValue({
      deploymentId: "dep_1",
      skillSlug: "test",
      trustScore: 50,
    }),
  };
}

const baseRequest = {
  intent: "test.intent",
  trigger: "api" as const,
  organizationId: "org_1",
  actor: { id: "actor_1", type: "user" as const },
  parameters: {},
  surface: { surface: "api" as const, requestId: "req_test" },
};

const zeroDelay = () => Promise.resolve();

describe("WorkTrace persist — exponential backoff", () => {
  it("exposes retry policy constants", () => {
    expect(TRACE_PERSIST_RETRY_POLICY).toEqual({
      maxAttempts: 3,
      baseDelayMs: 100,
      factor: 4,
      jitterRatio: 0.25,
    });
  });

  it("succeeds on attempt 2 without writing audit/alert", async () => {
    const persistFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockResolvedValueOnce(undefined);
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };
    const auditLedger = { record: vi.fn() };
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) };

    const result = await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      auditLedger: auditLedger as never,
      operatorAlerter: alerter,
      delayFn: zeroDelay,
    }).submit(baseRequest);

    expect(result.ok).toBe(true);
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(auditLedger.record).not.toHaveBeenCalled();
    expect(alerter.alert).not.toHaveBeenCalled();
  });

  it("succeeds on attempt 3 without writing audit/alert", async () => {
    const persistFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockRejectedValueOnce(new Error("transient 2"))
      .mockResolvedValueOnce(undefined);
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };
    const auditLedger = { record: vi.fn() };
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) };

    await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      auditLedger: auditLedger as never,
      operatorAlerter: alerter,
      delayFn: zeroDelay,
    }).submit(baseRequest);

    expect(persistFn).toHaveBeenCalledTimes(3);
    expect(auditLedger.record).not.toHaveBeenCalled();
    expect(alerter.alert).not.toHaveBeenCalled();
  });

  it("after 3 terminal failures: writes one audit entry, fires one alert, does not throw", async () => {
    const persistFn = vi.fn().mockRejectedValue(new Error("permanent"));
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) };
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) };

    const result = await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      auditLedger: auditLedger as never,
      operatorAlerter: alerter,
      delayFn: zeroDelay,
    }).submit(baseRequest);

    expect(result.ok).toBe(true);
    expect(persistFn).toHaveBeenCalledTimes(3);
    expect(auditLedger.record).toHaveBeenCalledTimes(1);
    const params = auditLedger.record.mock.calls[0]![0];
    expect(params.snapshot).toMatchObject({
      errorType: "trace_persist_failed",
      failureClass: "infrastructure",
      severity: "critical",
      retryable: false,
    });
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert.mock.calls[0]![0]).toMatchObject({
      errorType: "trace_persist_failed",
      source: "platform_ingress",
    });
  });

  it("preserves the same WorkTrace identity across all retry attempts", async () => {
    const persistFn = vi.fn().mockRejectedValue(new Error("permanent"));
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };

    await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
      delayFn: zeroDelay,
    }).submit(baseRequest);

    const traceA = persistFn.mock.calls[0]![0];
    const traceB = persistFn.mock.calls[1]![0];
    const traceC = persistFn.mock.calls[2]![0];
    // Same reference each call (single logical WorkTrace).
    expect(traceA).toBe(traceB);
    expect(traceB).toBe(traceC);
    expect(traceA.traceId).toBe(traceC.traceId);
    expect(traceA.workUnitId).toBe(traceC.workUnitId);
  });

  it("invokes delayFn with bounded backoff between attempts", async () => {
    const persistFn = vi.fn().mockRejectedValue(new Error("permanent"));
    const delays: number[] = [];
    const delayFn = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const traceStore = { persist: persistFn, getByIdempotencyKey: vi.fn().mockResolvedValue(null) };

    await new PlatformIngress({
      intentRegistry: makeIntentRegistry() as never,
      modeRegistry: makeModeRegistry() as never,
      governanceGate: makeGate(),
      deploymentResolver: makeDeploymentResolver() as never,
      traceStore: traceStore as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) },
      delayFn,
    }).submit(baseRequest);

    expect(delays).toHaveLength(2); // before attempt 2 and before attempt 3
    expect(delays[0]).toBeGreaterThanOrEqual(75);
    expect(delays[0]).toBeLessThanOrEqual(125);
    expect(delays[1]).toBeGreaterThanOrEqual(300);
    expect(delays[1]).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 7.2: Run the updated test file to verify it fails**

```
pnpm --filter @switchboard/core test -- packages/core/src/platform/__tests__/platform-ingress-trace-retry.test.ts
```

Expected: FAIL — `TRACE_PERSIST_RETRY_POLICY` not exported, only 2 attempts in current `persistTrace`.

- [ ] **Step 7.3: Implement the backoff helper + replace `persistTrace`**

In `packages/core/src/platform/platform-ingress.ts`, near the top-level (above the class):

```ts
export const TRACE_PERSIST_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 100,
  factor: 4,
  jitterRatio: 0.25,
} as const;

const defaultDelayFn = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function jitteredDelayMs(attempt: number): number {
  // attempt is 1-indexed; delay applies BEFORE attempt 2 and BEFORE attempt 3.
  const { baseDelayMs, factor, jitterRatio } = TRACE_PERSIST_RETRY_POLICY;
  const base = baseDelayMs * Math.pow(factor, attempt - 2); // attempt 2 → base, attempt 3 → base*factor
  const jitter = base * jitterRatio;
  // Uniform [-jitter, +jitter]
  return base + (Math.random() * 2 - 1) * jitter;
}
```

Replace the `persistTrace` method body with:

```ts
private async persistTrace(
  traceStore: WorkTraceStore | undefined,
  workUnit: WorkUnit,
  decision: GovernanceDecision,
  governanceCompletedAt: string,
  executionResult?: ExecutionResult,
  executionStartedAt?: string,
  completedAt?: string,
): Promise<void> {
  if (!traceStore) return;
  const trace = buildWorkTrace({
    workUnit,
    governanceDecision: decision,
    governanceCompletedAt,
    executionResult,
    executionStartedAt,
    completedAt,
  });

  const delayFn = this.config.delayFn ?? defaultDelayFn;
  const { maxAttempts } = TRACE_PERSIST_RETRY_POLICY;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await delayFn(jitteredDelayMs(attempt));
    }
    try {
      await traceStore.persist(trace);
      return; // success — no audit, no alert
    } catch (err) {
      lastError = err;
    }
  }

  // Terminal failure — exactly one infra-failure audit + one alert.
  await this.recordInfrastructureFailure({
    errorType: "trace_persist_failed",
    error: lastError,
    workUnit,
    retryable: false,
  });
}
```

- [ ] **Step 7.4: Run the trace-retry tests to verify they pass**

```
pnpm --filter @switchboard/core test -- packages/core/src/platform/__tests__/platform-ingress-trace-retry.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 7.5: Run the full core suite**

```
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/core typecheck
```

Expected: all green; typecheck clean.

- [ ] **Step 7.6: Commit**

```
git add packages/core/src/platform/platform-ingress.ts \
        packages/core/src/platform/__tests__/platform-ingress-trace-retry.test.ts
git commit -m "feat(core/platform-ingress): exponential backoff + terminal audit/alert on trace persist"
```

---

## Task 8: Bootstrap wiring in `apps/api/src/app.ts`

**Files:**

- Modify: `apps/api/src/app.ts`

- [ ] **Step 8.1: Read the current `PlatformIngress` construction site**

`apps/api/src/app.ts:440-449`:

```ts
const platformIngress = new PlatformIngress({
  intentRegistry,
  modeRegistry,
  governanceGate: platformGovernanceGate,
  deploymentResolver: resolveAuthoritativeDeployment(deploymentResolver),
  traceStore: workTraceStore,
  lifecycleService: lifecycleService ?? undefined,
  entitlementResolver: billingEntitlementResolver,
});
```

`auditLedger` is already constructed elsewhere in `app.ts` (search for `new AuditLedger` or the `app.decorate("auditLedger", …)` line).

- [ ] **Step 8.2: Construct alerter from env + pass into ingress**

Near the top imports of `app.ts`, add:

```ts
import {
  NoopOperatorAlerter,
  WebhookOperatorAlerter,
  type OperatorAlerter,
} from "@switchboard/core";
```

Above the `new PlatformIngress(...)` block, add:

```ts
const operatorAlerter: OperatorAlerter = process.env.OPERATOR_ALERT_WEBHOOK_URL
  ? new WebhookOperatorAlerter({ webhookUrl: process.env.OPERATOR_ALERT_WEBHOOK_URL })
  : new NoopOperatorAlerter();
```

Update the construction:

```ts
const platformIngress = new PlatformIngress({
  intentRegistry,
  modeRegistry,
  governanceGate: platformGovernanceGate,
  deploymentResolver: resolveAuthoritativeDeployment(deploymentResolver),
  traceStore: workTraceStore,
  lifecycleService: lifecycleService ?? undefined,
  entitlementResolver: billingEntitlementResolver,
  auditLedger, // already in scope
  operatorAlerter,
});
```

If `auditLedger` is not in lexical scope at this site, pass it through from wherever it's constructed (it lives in `apps/api/src/bootstrap/storage.ts:75` and is decorated onto `app` — find its variable name in `app.ts` and reuse it directly).

- [ ] **Step 8.3: Verify api typecheck**

```
pnpm --filter @switchboard/api typecheck
```

Expected: clean.

- [ ] **Step 8.4: Verify api tests still pass**

```
pnpm --filter @switchboard/api test
```

Expected: all green.

- [ ] **Step 8.5: Commit**

```
git add apps/api/src/app.ts
git commit -m "feat(api): wire OperatorAlerter (env-gated webhook) into PlatformIngress"
```

---

## Task 9: Final verification

- [ ] **Step 9.1: Full repo typecheck**

```
pnpm typecheck
```

Expected: clean (note: the `@switchboard/chat` build has a pre-existing error on `origin/main` unrelated to this branch — `pnpm typecheck` may or may not surface it; if it does, document it does not regress and move on).

- [ ] **Step 9.2: Full repo test**

```
pnpm test
```

Expected: at minimum, `@switchboard/core` and `@switchboard/api` are green. Other packages may have pre-existing issues independent of this branch.

- [ ] **Step 9.3: Lint**

```
pnpm lint
```

Expected: clean for changed files.

- [ ] **Step 9.4: Confirm acceptance bullets from `.audit/08-launch-blocker-sequence.md` line 395 are met**
  - [x] Governance eval failures logged to `AuditEntry` with `errorType` field — covered by `platform-ingress-governance-error.test.ts`.
  - [x] Trace persist retry upgraded to exponential backoff + alerting — covered by `platform-ingress-trace-retry.test.ts`.
  - [x] Operator receives notification on governance failure — covered by alerter assertions in both files.

- [ ] **Step 9.5: Push branch + open PR**

```
git push -u origin fix/launch-governance-error-visibility
gh pr create --title "fix(launch): surface governance + trace-persist failures in PlatformIngress (#17)" --body "$(cat <<'EOF'
## Summary
- Adds `OperatorAlerter` abstraction (`Noop` / `Webhook` impls) and a typed infrastructure-failure audit-params builder. Both live under `packages/core/src/observability/`.
- Governance eval exceptions now write a single `action.failed` audit entry with `snapshot.errorType = "governance_eval_exception"` and fire the operator alerter immediately. Governance is not retried.
- WorkTrace persist now uses 3-attempt exponential backoff (`100ms / ×4 / ±25% jitter`) confined to `WorkTraceStore.persist`. On terminal failure: exactly one infra-failure audit entry + one alert. Same logical `WorkTrace` (traceId/workUnitId/idempotencyKey) preserved across all attempts.
- Bootstrap wires `WebhookOperatorAlerter` from `OPERATOR_ALERT_WEBHOOK_URL` (no-op fallback).

## Closes
Launch-blocker #17 (`.audit/08-launch-blocker-sequence.md` lines 380–395).

## Test plan
- [ ] CI green for `@switchboard/core` and `@switchboard/api`.
- [ ] `platform-ingress-governance-error.test.ts` covers all 6 governance-error scenarios (denied result; audit shape; alert payload; no retry; auditLedger absent; audit-write failure swallowed).
- [ ] `platform-ingress-trace-retry.test.ts` covers all 5 backoff scenarios (policy constants; success on attempts 2/3; terminal audit+alert; trace identity invariant; jittered delay bounds).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

- Goals (audit + alert governance failures, exp. backoff, terminal audit/alert) → Tasks 6, 7.
- `OperatorAlerter` abstraction with no-op default + webhook impl + timeout → Tasks 1, 2.
- Typed infra-failure builder, no `AuditEventType` enum changes → Task 3.
- `auditLedger` optional + alerter best-effort + retry scoped to persist + same trace identity + one terminal audit/alert → enforced in Tasks 5–7 and asserted by tests.
- No recursive failure logging → Task 6 helper catches `auditLedger.record` throws (asserted in test 6.1).
- Webhook timeout → Task 2 (default 2000ms; test asserts AbortError swallowed).
- Bootstrap wiring → Task 8.

**Placeholder scan:** none.

**Type/name consistency:** `errorType` (camelCase) used throughout; `InfrastructureErrorType` re-exported via barrel; `safeAlert` used consistently in `platform-ingress.ts`; `TRACE_PERSIST_RETRY_POLICY` exported and asserted in test 7.1.
