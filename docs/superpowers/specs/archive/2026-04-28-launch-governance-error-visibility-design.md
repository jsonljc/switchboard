# Launch-Blocker #17 — Governance Error Visibility

**Branch slug:** `fix/launch-governance-error-visibility`
**Effort:** S (< 2h)
**Source:** `.audit/08-launch-blocker-sequence.md` lines 380–395

## Problem

`packages/core/src/platform/platform-ingress.ts` has two silent failure modes:

1. **Governance eval exception swallowed.** The catch at `submit()` builds a denied result with `reasonCode: "GOVERNANCE_ERROR"` and persists a trace, but the underlying exception is never logged, audited, or alerted. Operators have no signal that the governance engine failed — approvals appear to be "denied" by normal policy.
2. **Trace persist retry weak.** `persistTrace` retries once with no backoff, then falls back to `console.error`. Transient DB blips can cause permanent observability loss with no operator notification.

## Goals

- Governance eval failures are recorded to the audit ledger with a typed `errorType` snapshot field and trigger an operator alert.
- WorkTrace persist failures use bounded exponential backoff (3 attempts) and, on terminal failure, emit exactly one infrastructure-failure audit entry plus one operator alert.
- Hot-path latency budget for retries is bounded (~500ms worst case).
- No new `AuditEventType` enum values; reuse `action.failed` with a typed snapshot shape.
- Approval-flow notifier interfaces remain untouched; infra alerting has its own abstraction.

## Non-Goals

- Generalized `retryWithBackoff` utility shared across packages.
- Dashboards/queries on infrastructure failure rates.
- Alerter transports beyond webhook + noop.
- Adding `governance.error` / `trace.persist_failed` event types to `AuditEventTypeSchema`. Deferred until a downstream consumer needs top-level filtering.

## Design

### 1. Typed infrastructure-failure audit shape

New module: `packages/core/src/observability/infrastructure-failure.ts`.

Reuses existing `AuditEventType: "action.failed"`. All infra-failure audit entries from `PlatformIngress` route through a single builder so the snapshot shape is consistent and queryable.

```ts
export type InfrastructureErrorType = "governance_eval_exception" | "trace_persist_failed";

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
  occurredAt: string; // ISO 8601
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

export function buildInfrastructureFailureAuditParams(input: BuildInfrastructureFailureInput): {
  ledgerParams: AuditLedgerRecordParams;
  alert: InfrastructureFailureAlert;
};
```

Severity defaults:

- `governance_eval_exception` → `"critical"` (control-plane failure; safety fallback denied a real action).
- `trace_persist_failed` → `"critical"` (terminal — emitted only after backoff exhausted).

Naming convention is camelCase (`errorType`), consistent with existing snapshot conventions across the codebase.

### 2. `OperatorAlerter` abstraction

New module: `packages/core/src/observability/operator-alerter.ts`.

```ts
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
  /* … */
}

export class WebhookOperatorAlerter implements OperatorAlerter {
  // POST JSON to a configured webhook URL.
  // Best-effort: timeouts and errors are swallowed and console.error'd.
  // Default timeoutMs: 2000 (range 1500–3000 acceptable).
}
```

The wrapper used by `PlatformIngress` swallows any throw from `alerter.alert()` and logs via `console.error`. Alert delivery must never propagate back into the request path.

This interface is **separate** from `notifications/notifier.ts` (`ApprovalNotifier` / `ApprovalNotification`). Approval lifecycle notifications and infrastructure alerts have different domains; conflating them would force the approval schema to widen.

### 3. `PlatformIngress` changes

`PlatformIngressConfig` gains two optional fields:

```ts
auditLedger?: AuditLedger;
operatorAlerter?: OperatorAlerter; // default: NoopOperatorAlerter
```

**Governance error path** (currently lines 174–191):

1. `governanceGate.evaluate()` throws.
2. Decision is set to deny with `reasonCode: "GOVERNANCE_ERROR"` (unchanged).
3. **New:** build infra-failure audit params via helper, write to `auditLedger` if present, fire `operatorAlerter.alert()` immediately. `severity: "critical"`. `retryable: false`.
4. Persist denied trace, return `{ ok: true, result, workUnit }` (unchanged response shape). Ingress still returns `ok: true` because the platform handled the request safely; the contained work result is failed/denied with `reasonCode`/`error.code = "GOVERNANCE_ERROR"`. The governance failure is represented as a failed/denied work result inside an `ok: true` ingress response, **not** as a thrown platform error.
5. **Governance is not retried.** A logic/config-driven failure would just fail again, possibly with side effects.

**Trace persist path** (currently `persistTrace`, lines 290–318):

1. Replace single-retry with bounded backoff (max 3 attempts).
2. Same `WorkTrace` object reused across attempts — `traceId`, `workUnitId`, `idempotencyKey` invariant holds.
3. On success at any attempt: no audit, no alert (transient retries are not noisy).
4. On terminal exhaustion: write **one** infra-failure audit entry (`errorType: "trace_persist_failed"`, `retryable: false`) and fire **one** operator alert.

### 4. Backoff policy

```ts
export const TRACE_PERSIST_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 100,
  factor: 4,
  jitterRatio: 0.25,
} as const;
```

Schedule:

- Attempt 1: immediate
- Attempt 2: `100ms ± 25ms` (jitter = ±jitterRatio × delay)
- Attempt 3: `400ms ± 100ms`
- Worst-case added latency on terminal failure: ~500ms

`delayFn: (ms: number) => Promise<void>` is injectable on the ingress config (or a private static default) so tests use zero-delay variants.

The backoff helper lives locally in `platform-ingress.ts` (or a sibling private module). It is **not** lifted to a shared util — YAGNI. Lift only if a second caller appears.

### 5. Bootstrap wiring

`apps/api/src/bootstrap/` constructs `WebhookOperatorAlerter` when `OPERATOR_ALERT_WEBHOOK_URL` env is set; otherwise `NoopOperatorAlerter`. The constructed alerter and existing `auditLedger` are passed into `new PlatformIngress({ ... })`.

## Invariants

These constraints are load-bearing — implementation must preserve them and tests must assert them.

1. **No recursive failure logging.** If writing the infrastructure-failure audit entry itself fails, the failure is caught and `console.error`'d. Do **not** emit a second infrastructure-failure audit entry for the audit-write failure. The operator alert is still attempted once.
2. **Optional `AuditLedger`.** `PlatformIngressConfig.auditLedger` is optional. If absent, skip audit recording but still invoke `OperatorAlerter` for terminal infrastructure failures. `PlatformIngress` must not throw because `auditLedger` is unset.
3. **Webhook alerter timeout.** `WebhookOperatorAlerter` enforces a short request timeout (default 2000ms; 1500–3000ms acceptable). Timeout or HTTP error is swallowed and `console.error`'d. Alert delivery is best-effort and must never block or throw back into `PlatformIngress`.
4. **Retry scope.** `retryWithBackoff` applies **only** to `WorkTraceStore.persist`. It does not wrap governance evaluation, audit-ledger recording, or alerter delivery.
5. **Single logical trace.** All retry attempts preserve the same `traceId`, `workUnitId`, and `idempotencyKey`. No retry may create a second logical `WorkTrace`.
6. **One terminal audit + one terminal alert.** Per terminal failure, exactly one infra-failure audit entry and exactly one alert are emitted — never per attempt.

## Files

**New:**

- `packages/core/src/observability/operator-alerter.ts`
- `packages/core/src/observability/__tests__/operator-alerter.test.ts`
- `packages/core/src/observability/infrastructure-failure.ts`
- `packages/core/src/observability/__tests__/infrastructure-failure.test.ts`
- `packages/core/src/platform/__tests__/platform-ingress-governance-error.test.ts`

**Modified:**

- `packages/core/src/platform/platform-ingress.ts`
- `packages/core/src/platform/__tests__/platform-ingress-trace-retry.test.ts`
- `apps/api/src/bootstrap/*` (wire `WebhookOperatorAlerter` from env)

## Testing Strategy (TDD)

1. **`operator-alerter.test.ts`**
   - `NoopOperatorAlerter` resolves without I/O.
   - `WebhookOperatorAlerter` POSTs JSON payload with correct shape.
   - Webhook timeout is swallowed, `console.error` called, no throw.
   - Webhook 5xx is swallowed, no throw.
2. **`infrastructure-failure.test.ts`**
   - Builder produces snapshot with all required fields populated when `workUnit` is provided.
   - Optional fields (`intent`, `traceId`, `deploymentId`, `organizationId`) are omitted (not `undefined`-valued) when `workUnit` is absent.
   - Severity defaults match the table above.
   - `errorMessage` extracted from `Error` and from non-Error throw values.
3. **`platform-ingress-governance-error.test.ts`**
   - Gate throws → response is `{ ok: true, result.outcome: "failed", result.error.code: "GOVERNANCE_ERROR" }`.
   - `auditLedger.record` called once with `eventType: "action.failed"` and snapshot containing `errorType: "governance_eval_exception"`, `failureClass: "infrastructure"`, `severity: "critical"`.
   - `operatorAlerter.alert` called once with matching payload.
   - `governanceGate.evaluate` called exactly once (no retry).
   - With `auditLedger` absent: alert still fires; no throw.
   - Audit-write throw is swallowed; alert still fires; no second infra-failure audit entry written.
4. **`platform-ingress-trace-retry.test.ts` (updated)**
   - Three attempts on permanent failure with injected zero-delay `delayFn`.
   - On terminal failure: one infra-failure audit entry, one alert.
   - On success at attempt 2 or 3: no infra-failure audit, no alert.
   - Same `WorkTrace` object passed to `persist` on every attempt (assert by reference or by `traceId` equality across calls).
   - Backoff policy constants are exported and match `TRACE_PERSIST_RETRY_POLICY`.

## Acceptance (matches audit doc)

- [x] Governance eval failures logged to AuditEntry with `errorType` field.
- [x] Trace persist retry upgraded to exponential backoff + alerting on terminal failure.
- [x] Operator receives notification on governance failure.

Plus the redline invariants above.
