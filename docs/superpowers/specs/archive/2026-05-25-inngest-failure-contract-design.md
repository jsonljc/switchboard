# Inngest Failure Contract — Design Spec (Phase 3B)

**Status:** Design — pending user review.
**Audit lane:** Wave 2 cleanup, Category 2 (reliability). Closes Cat 2.1 (absent `onFailure` handlers) and the launch-blocker #18 expansion.
**Consumes:** `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` (Route Governance Contract v1) §4, §9, §13.
**Companion to:** the synchronous Route Governance Contract. This is the asynchronous half of the same audit discipline.

---

## Section 0 — Problem

Switchboard **registers 15 Inngest functions** in `apps/api/src/bootstrap/inngest.ts` (the live contract surface), drawing from `apps/api`, `packages/creative-pipeline`, `packages/ad-optimizer`, and `packages/core`. A further three functions (`ad-optimizer-weekly-dispatch`, `ad-optimizer-daily-dispatch`, `skill-runtime-batch-executor`) are **defined but not registered** — out of scope until wired (Section 13). The deploy-infra-parity audit lane (`docs/audits/2026-05-15-cleanup/deploy-infra-parity.md`) found, on the then-current 14-function snapshot:

- **0 functions define an `onFailure` handler.** When a function exhausts its `retries`, the failed job state is abandoned: no error event, no dead-letter record, no operator signal. The only exception is `ugc-job-runner`, which emits a `creative-pipeline/ugc.failed` event via internal phase-level try/catch — a one-off, not a contract.
- **No shared error envelope** across async functions. Each function fails in its own shape (or no shape).
- **Diverged retry semantics** — `retries` ranges 0/2/3 with no rationale tying the value to the function's failure criticality.

Concrete impact when retries exhaust silently: stuck leads (`lead-retry`), undetected Stripe reconciliation divergence (`stripe-reconciliation`), silently-degraded conversion signal health (`signal-health`), abandoned paid creative jobs (`creative-job-runner` / `ugc-job-runner`).

DOCTRINE invariant **§7 "Dead-letter for every async path"** already mandates that _every_ async execution path have a dead-letter destination (it names `FailedMessage`, `OutboxEvent`, and pipeline-level error handling). **§7 is silent on the Inngest function surface specifically** — the principle exists, but it has never been operationalized for cron/event functions. This spec is that operationalization.

> **Audit-citation correction.** The deploy-infra-parity lane report attributes the rule to "DOCTRINE §7: functions with `retries > 1` MUST define `onFailure`." The _number_ is right (§7 governs async dead-lettering) but §7's text does not mention Inngest functions or `onFailure` at all — the lane report paraphrased the principle into a rule that DOCTRINE does not yet literally state. §8 of this spec proposes the literal refinement.

---

## Section 1 — Shared async-failure envelope

A single typed shape for every async failure, declared in `@switchboard/schemas`. It **shares the `{ code, message, stage? }` shape** of WorkTrace's `ExecutionError` (`packages/core/src/platform/types.ts`) — a structural re-declaration in schemas (per DOCTRINE §11, cross-app types live in `@switchboard/schemas`), not a TypeScript `extends` of the core type — so both contracts share the `{ code, message }` core that Route Governance Contract §13 names as the seam, and diverge only on async-specific metadata.

```ts
// packages/schemas/src/async-failure.ts (new)
export const AsyncFailureEnvelopeSchema = z.object({
  // Shared core with ExecutionError (the §13 seam):
  code: z.string(), // stable UPPER_SNAKE failure code, e.g. "UPSTREAM_TIMEOUT"
  message: z.string(), // human-readable, scrubbed of secrets
  stage: z.string().optional(), // sub-step within the function, when known

  // Async-specific metadata:
  functionId: z.string(), // the Inngest function id, e.g. "stripe-reconciliation-hourly"
  eventName: z.string(), // trigger event or cron expression
  runId: z.string().optional(), // Inngest run id when available
  attempts: z.number().int(), // total attempts made (retries + 1)
  retryable: z.boolean(), // was this classified recoverable? (Section 6)
  organizationId: z.string().optional(), // present when the failure is org-scoped
  deploymentId: z.string().optional(),
  occurredAt: z.string().datetime(), // ISO-8601 exhaustion timestamp
});
export type AsyncFailureEnvelope = z.infer<typeof AsyncFailureEnvelopeSchema>;
```

`code` is a stable, grep-able literal exported as a constant per function-domain (mirrors `OPERATOR_INTENT_ERROR_CODES` from the operator-direct path). `message` is scrubbed before persistence (no credentials, no raw upstream bodies).

---

## Section 2 — The standard `onFailure` handler

The shape every function adopts. Inngest invokes `onFailure` exactly once, when `retries` are exhausted. The handler does three things, gated by the function's class (Section 5):

```ts
// pseudo-shape; injected deps come from the function's existing factory
async function onFailure({ error, event, runId }) {
  const envelope = buildAsyncFailureEnvelope({ error, event, runId, functionId, attempts });

  // (a) ALWAYS — the canonical exhausted-failure AUDIT record:
  await auditLedger.record({
    eventType: "infrastructure.job.retry_exhausted", // NEW AuditEventType (Section 8)
    actorType: "system",
    actorId: functionId,
    entityType: "async_job",
    entityId: envelope.runId ?? `${functionId}:${envelope.eventName}:${envelope.occurredAt}`,
    riskCategory, // per class (Section 5)
    summary: `async job ${functionId} exhausted retries: ${envelope.code}`,
    snapshot: envelope,
    organizationId: envelope.organizationId,
  });

  // (b) ALWAYS — the §7 dead-letter DESTINATION (domain-readable event):
  await inngest.send({ name: `${domain}.failed`, data: envelope });

  // (c) ALERT CLASSES ONLY — page the operator:
  if (classRequiresAlert) {
    await operatorAlerter.alert({ ...envelope, severity, source: "inngest_function" });
  }
}
```

Notes:

- **(a) is the audit record.** It uses `AuditLedger.record` (`packages/core/src/audit/ledger.ts`) with `actorType: "system"` and `actorId: <functionId>`. The `entityId` falls back to a deterministic `functionId:eventName:occurredAt` composite when `runId` is unavailable, so every record is uniquely keyed.
- **(b) is the §7 dead-letter destination.** It is a **domain-readable** event (`ugc.failed`, `riley.outcome-attribution.failed`, `stripe-reconciliation.failed`), never `${functionId}.failed` — see Section 5.4. The event payload is the `AsyncFailureEnvelope`. This event is what makes the failure replayable / consumable downstream (Section 7); it satisfies invariant §7's "dead-letter destination" requirement. **Required for classes A–D.** For **Class E (best-effort/enrichment)** the event is **optional** — emit it only if a downstream/recovery consumer exists; otherwise the audit record (a) plus the cron's idempotent self-heal on the next scheduled run is the §7 discharge (these jobs degrade gracefully and have no consumer waiting on the failure signal). The audit record (a) is written for **every** class, always.
- **(c) alerts only the classes that warrant immediate operator attention** (Section 5). Over-alerting recoverable-but-important jobs is an explicit non-goal.

---

## Section 3 — Type-seam widening (a required finding)

`OperatorAlerter` / `InfrastructureFailureAlert` (`packages/core/src/observability/operator-alerter.ts`) is today hardwired to:

- `source: "platform_ingress"` — a string-literal union with a single member.
- `errorType: InfrastructureErrorType` — a fixed enum of ingress-only error types (`governance_eval_exception`, `trace_persist_failed`, …).

The async failure contract reuses this alerter (the §13 seam) and therefore must widen it:

- **`source`** becomes `"platform_ingress" | "inngest_function"`.
- **`errorType`** generalizes so async failure codes can flow through, OR the alert carries the `AsyncFailureEnvelope.code` in a dedicated field. (Implementation chooses; the spec mandates only that an `inngest_function`-sourced alert is representable without overloading the ingress enum.)

`ugc-job-runner`'s existing `creative-pipeline/ugc.failed` event is **grandfathered as the convention exemplar** — the domain-readable `.failed` naming in Section 5.4 generalizes what UGC already does.

---

## Section 4 — Record-type boundary: AuditLedger, not WorkTrace

**Async failures record to `AuditLedger`. WorkTrace stays reserved for the synchronous governed-ingress path.**

Rationale: most Inngest functions (crons, fan-out dispatch) **never pass through `PlatformIngress`**, so they have no WorkTrace to attach to. WorkTrace is the persistence truth for _governed mutations submitted at ingress_ (DOCTRINE §3, §6). An async cron failure is an _infrastructure_ event, not a governed mutation, and modeling it as a WorkTrace would blur the exact boundary the Route Governance Contract just protected.

This holds **even for ingress-reaching jobs.** `lead-retry`, for example, replays a webhook through the same handler path and that inner submit produces its _own_ WorkTrace independently. The async failure contract records retry-_exhaustion_ at the **function boundary** via AuditLedger; it does not reach inside to mint or mutate the inner WorkTrace. Same function, two records, two surfaces — the reciprocal of Route Governance §13's "same function, different obligations per call surface."

| Surface                       | Canonical record                                                              | Where        |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------ |
| Synchronous governed mutation | `WorkTrace`                                                                   | ingress path |
| Async job retry-exhaustion    | `AuditLedger` `infrastructure.job.retry_exhausted`                            | `onFailure`  |
| Shared                        | typed error core `{ code, message, stage? }` + `OperatorAlerter` for critical | both         |

---

## Section 5 — Function-class taxonomy

Five classes. Each function is assigned exactly one. The class determines retry floor, whether `onFailure` alerts, and idempotency expectations. **The split between Class A and Class B is deliberate: "important and recoverable" is not "page someone now."**

### 5.1 The classes

| Class                                  | Definition                                                                      | `onFailure` does                                                              | Alert on first exhaustion?                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **A — customer/revenue-critical**      | Failure causes _immediate_ customer or operator harm with no automatic recovery | audit + `.failed` event + **OperatorAlerter**                                 | **Yes (critical)**                                                                                         |
| **B — business-critical, recoverable** | Important, but failure is recoverable / not immediately customer-visible        | audit + `.failed` event                                                       | No — alert only on **repeated** exhaustion or when downstream marks it customer-visible (warning severity) |
| **C — fan-out dispatch**               | Emits per-item events; the dispatcher failing ≠ an item failing                 | audit + `.failed` event; **per-item failures isolated to the Class-D worker** | No (worker owns item-level alerting)                                                                       |
| **D — per-item worker**                | Processes one item/org per invocation                                           | audit + `.failed` event, scoped to the item                                   | Critical items only                                                                                        |
| **E — best-effort / enrichment**       | Quality/enrichment; failure degrades gracefully                                 | audit always; `.failed` event **optional** (only if a consumer exists)        | No                                                                                                         |

### 5.2 Assignments (all 15 registered functions)

| Function                             | File                                                      | Class | Why                                                                                                         |
| ------------------------------------ | --------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `stripe-reconciliation-hourly`       | `apps/api/src/services/cron/reconciliation.ts`            | **A** | Billing integrity; divergence is direct revenue harm                                                        |
| `lead-retry`                         | `apps/api/src/services/cron/lead-retry.ts`                | **A** | Dropped lead = lost customer; no other recovery path                                                        |
| `creative-mode-dispatcher`           | `packages/creative-pipeline/src/mode-dispatcher.ts`       | **A** | Blocks live governed creative execution for every job submission                                            |
| `reconciliation-daily`               | `apps/api/src/services/cron/reconciliation.ts`            | **B** | Detects data-sync issues; recoverable on next run, not instantly customer-visible                           |
| `ad-optimizer-weekly-audit`          | `packages/ad-optimizer/src/inngest-functions.ts`          | **B** | Drives recommendations weekly; a missed run is recoverable next cycle                                       |
| `ad-optimizer-daily-signal-health`   | `packages/ad-optimizer/src/inngest-functions.ts`          | **B** | Gates recommendations, but a missed _daily_ run self-heals on the next run — recoverable, alert if repeated |
| `meta-token-refresh`                 | `apps/api/src/services/cron/meta-token-refresh.ts`        | **B** | Infra; marks tokens `needs_reauth` on failure — degrades visibly downstream, alert if repeated              |
| `creative-job-runner`                | `packages/creative-pipeline/src/creative-job-runner.ts`   | **B** | Paid workflow but retry/approval-gated and recoverable; escalate if repeated                                |
| `ugc-job-runner`                     | `packages/creative-pipeline/src/ugc/ugc-job-runner.ts`    | **B** | Already feeds a `.failed` recovery path; grandfathered exemplar                                             |
| `riley-outcome-attribution-dispatch` | `packages/ad-optimizer/src/inngest-functions.ts`          | **C** | Fan-out cron; per-org item failures belong to the worker                                                    |
| `riley-outcome-attribution-worker`   | `apps/api/src/services/cron/riley-outcome-attribution.ts` | **D** | Per-org worker; flag-gated (default off)                                                                    |
| `memory-daily-pattern-decay`         | `apps/api/src/bootstrap/inngest.ts`                       | **E** | Relevance enrichment; degrades gracefully                                                                   |
| `ad-optimizer-daily-check`           | `packages/ad-optimizer/src/inngest-functions.ts`          | **E** | Lightweight API canary                                                                                      |
| `lifecycle-stalled-sweep-hourly`     | `apps/api/src/services/cron/lifecycle-stalled-sweep.ts`   | **E** | Autonomy control; inert until governance flag on                                                            |
| `pcd-registry-backfill`              | `apps/api/src/services/cron/pcd-registry-backfill.ts`     | **E** | Asset-registry completeness; best-effort batch                                                              |

> **Count reconciliation.** The deploy-infra-parity table listed 14 functions; the live _registered_ count in `apps/api/src/bootstrap/inngest.ts` is **15** (the audit predates `riley-outcome-attribution` dispatch + worker and `daily-signal-health`, and conversely listed `batch-executor` which is not registered). The implementation plan MUST re-baseline against the `functions: [...]` array in `bootstrap/inngest.ts` at execution time, not against the audit table or this list — the surface drifts. When `skill-runtime-batch-executor` is registered (Section 13) it is **Class D**; the two ad-optimizer dispatchers, when registered, are **Class C** (fan-out).

### 5.3 Retry floors per class

| Class | `retries` floor                        | Idempotency                                                                          |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| A     | ≥ 2                                    | **required** — handler must be safe to re-run (Stripe/lead re-processing must dedup) |
| B     | ≥ 2                                    | required                                                                             |
| C     | 2                                      | dispatch is idempotent (re-emitting per-item events is deduped by the worker)        |
| D     | explicit `retries` set (not defaulted) | per-item idempotency key                                                             |
| E     | ≥ 1                                    | guarded (e.g. `lastDecayedAt` date-guard already present on pattern-decay)           |

The **mandatory `onFailure` bar is `retries > 1`** (Section 8). Class E functions running at `retries: 1` are _encouraged_ to define `onFailure` for audit visibility but are not in scope of the blocking doctrine invariant — this avoids manufacturing compliance debt for single-retry best-effort jobs. (A function explicitly set to `retries > 1` in any class is in scope regardless.)

### 5.4 Event-naming convention

The `.failed` dead-letter event is **domain-readable**, not function-id-leaking:

- ✅ `ugc.failed`, `riley.outcome-attribution.failed`, `stripe-reconciliation.failed`
- ❌ `ugc-job-runner.failed`, `riley-outcome-attribution-worker.failed`

The `functionId` is carried in the **payload** (`AsyncFailureEnvelope.functionId`), keeping the event namespace stable as factory names change. Every `.failed` payload carries the full envelope: `{ code, message, stage?, functionId, eventName, runId?, attempts, retryable, organizationId?, deploymentId?, occurredAt }`.

---

## Section 6 — Retry-vs-fail-fast classification

`onFailure` only fires _after_ retries exhaust, so the retry policy decides how many times a transient failure gets a chance before it becomes a dead-letter.

**Retry (transient — let Inngest re-run):**

- Network timeouts, connection resets, DNS hiccups.
- Upstream `5xx` and `429` (rate-limit) responses — Meta API, Stripe API.
- Optimistic-concurrency / lock contention (`StaleVersionError`, advisory-lock contention).

**Fail-fast (non-recoverable — do not burn retries):**

- Validation failures (malformed event payload, Zod parse failure).
- Auth/permission failures (`403`, revoked token that needs re-auth, not a transient `401`).
- Referential failures (entity does not exist, org not found) — retrying cannot fix them.

**Mechanism.** Inngest's `NonRetriableError` is thrown for fail-fast cases so the function terminates immediately into `onFailure` rather than consuming retries. The `AsyncFailureEnvelope.retryable` boolean records which path was taken (`true` = exhausted after transient retries, `false` = fail-fast). Classifiers live next to each function's domain error types; the contract mandates the _distinction_, not a single shared classifier.

---

## Section 7 — Seam with the outbox / conversion path

The `.failed` event (Section 2b) is an at-least-once emission. Two integration points:

1. **Outbox persistence (optional per class).** For Class A/B failures whose downstream consumers must not miss the signal, the `.failed` event MAY also be persisted via the existing outbox (`PrismaOutboxStore.write` / `PrismaEventStore.emit`, which already has `markDeadLetters`). This gives the dead-letter a durable, replayable home beyond Inngest's own event retention — directly discharging invariant §7's "`OutboxEvent` … must cover every case."
2. **Downstream dedup.** Consumers of `.failed` events dedup on `functionId + runId` (or the `entityId` composite when `runId` is absent). At-least-once delivery means a consumer may see the same exhaustion twice (e.g. Inngest event redelivery); the dedup key makes downstream handling idempotent. This mirrors the at-least-once + dedup contract the revenue/outbox path adopted in audit issue #654-B.

**Boundary — AuditLedger is not a replay queue.** The `AuditLedger` `infrastructure.job.retry_exhausted` entry (Section 2a) is the **canonical exhausted-failure audit record**: it provides DLQ-like _visibility_ (queryable via the audit/activity feed, the same surface operators already use). It is **not** a replay queue — it has no claim/requeue/repair/triage state machine, no retention policy beyond audit retention. If the platform later needs operable queue semantics (requeue a failed Stripe sync, triage a backlog), that is a _separate_ surface (a generalized `FailedJobStore`, deferred); this contract deliberately does not build it. The replayable signal is the `.failed` event / its optional outbox row, not the audit entry.

**Why "no replay queue" is not a recovery hole for the Class-A crons.** The remaining Class-A cron, `stripe-reconciliation-hourly`, is **idempotent over current state** — each run re-checks the same subscriptions against live Stripe truth, so a single exhausted run **self-heals on the next scheduled tick** (re-reconciles within the hour). The contract's job for it is _visibility + signal_ (the operator learns a tick was dropped and can investigate an upstream outage), not requeue — the cron schedule _is_ the retry loop. The genuinely non-self-healing Class-A function is `lead-retry`, whose _inner_ per-lead `maxAttempts` exhaustion terminally drops a lead; that inner exhaustion is a domain concern the function already owns, distinct from the function-level `onFailure` this contract adds (Section 4's two-records-two-surfaces distinction). `creative-mode-dispatcher` failure is re-driven by re-submitting the creative job. So deferring an operable replay queue (Section 13) leaves no Class-A recovery gap today.

---

## Section 8 — Doctrine: refine invariant §7

DOCTRINE invariant **§7 "Dead-letter for every async path"** exists and is the governing rule, but its text enumerates `FailedMessage` (channels), `OutboxEvent` (events), and "pipeline-level error handling" — it **does not mention the Inngest function surface**. The Inngest cron/event surface is the un-operationalized gap that produced 0/18 coverage.

**Proposed refinement** (the implementation PR lands it, the way Route Governance landed invariant 12). Add to §7:

> **Inngest functions.** Every Inngest function with `retries > 1` MUST define an `onFailure` handler that (a) records an `infrastructure.job.retry_exhausted` AuditLedger entry carrying the `AsyncFailureEnvelope`, and (b) emits a domain-readable `*.failed` dead-letter event. Critical-class functions additionally raise an `OperatorAlerter` alert. `check-routes`-style enforcement may later assert presence.

This keeps the bar at **`retries > 1`** (not `> 0`) so single-retry best-effort jobs are not force-marched into the blocking contract. The spec also records the audit lane's §7 mis-citation (Section 0) as a documentation finding to be corrected when the refinement lands.

---

## Section 9 — Seam with Route Governance Contract (§13 reciprocal)

Route Governance Contract v1 §13 documents this seam from the synchronous side. This spec is its asynchronous reciprocal. Confirmed consumption:

- **Reused from §13 / `@switchboard/schemas`:** the typed-error core `{ code, message }` (extended here as `AsyncFailureEnvelope`); `OperatorAlerter` (widened, Section 3); `AuditLedger.record`; the `outputs`-as-structured-payload sub-pattern (an async function's structured non-error result has the same need as a route handler's — §1's envelope is the failure analogue of §9's `outputs`).
- **Owned here (the "diverged" half §13 lists):** retry-vs-fail-fast classification (Section 6); the dead-letter destination shape (Section 7); the `onFailure` handler pattern (Section 2); replay/dedup semantics (Section 7).
- **The shared-function rule, restated:** a function invoked both synchronously (route handler) and asynchronously (Inngest trigger) satisfies the Route Governance Contract on the sync path (WorkTrace) and _this_ contract on the async path (AuditLedger). Two records, two surfaces, one function.

Out of scope (tracked separately): Sentry parity for `mcp-server` (audit Cat 2.4) — an observability-init gap, not a failure-contract gap; noted here only because §13 mentions it.

---

## Section 10 — Coverage rule + where handlers go

**The rule:** every Inngest function with `retries > 1` carries an `onFailure` handler conforming to Section 2, with its class (Section 5) determining alert behavior and retry floor.

Handlers are added at each function's definition site (the existing `createFunction({...})` call), reusing the dependencies the factory already receives (Prisma stores, `auditLedger`, `operatorAlerter`, the `inngest` client for `.send`). No new registration site is needed — `apps/api/src/bootstrap/inngest.ts` already wires every function's dependencies; `onFailure` reads from the same closure.

Wiring requirements the implementation must satisfy:

- `auditLedger` + `operatorAlerter` are injectable into every function factory (some factories do not receive them today).
- A shared `buildAsyncFailureEnvelope(...)` helper in `packages/core` (analogous to `buildInfrastructureFailureAuditParams` in `observability/infrastructure-failure.ts`) so the handler shape is not copy-pasted 16+ times.
- The new `infrastructure.job.retry_exhausted` member is added to `AuditEventTypeSchema` (`packages/schemas/src/audit.ts`).
- The `AsyncFailureEnvelopeSchema` is added to `packages/schemas` and re-exported from its barrel.

---

## Section 11 — Success criteria

This spec is successful when, post-implementation:

1. **Every registered Inngest function with `retries > 1` defines an `onFailure` handler** conforming to Section 2 (closes Cat 2.1; 0 → full coverage of the 15 registered functions, and any newly-registered function inherits the contract).
2. **A single `AsyncFailureEnvelope`** is the shape of every async failure, declared once in `@switchboard/schemas`.
3. **Exhausted failures produce an `infrastructure.job.retry_exhausted` AuditLedger entry** — operators can see every dead-lettered job in the audit/activity feed, the same way a WorkTrace surfaces a sync mutation.
4. **A domain-readable `*.failed` dead-letter event is emitted** for every exhausted failure, carrying the full envelope (satisfies invariant §7 for the Inngest surface).
5. **Class-A functions alert the operator** on first exhaustion via `OperatorAlerter`; Class B/E do not over-alert.
6. **Retry values are justified by class** (Section 5.3), not arbitrary.
7. **DOCTRINE §7 is refined** to literally state the Inngest `onFailure` obligation (Section 8).
8. **The Route Governance ↔ Inngest seam is real** — `AsyncFailureEnvelope` extends `ExecutionError`; `OperatorAlerter` is shared (widened); WorkTrace/AuditLedger boundary is documented and respected.

---

## Section 12 — Open risks + verifications during implementation

| Risk                                                                                       | Verification step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OperatorAlerter` widening breaks existing ingress alert callers                           | The `source` union widening is additive; existing `"platform_ingress"` callers are unaffected. Implementation runs `packages/core` tests for `operator-alerter` + `infrastructure-failure` after widening.                                                                                                                                                                                                                                                                                                  |
| Inngest `onFailure` invocation semantics differ from assumption                            | Verify against the installed Inngest SDK version that `onFailure` fires once on retry-exhaustion and receives `{ error, event, runId }`; adjust `buildAsyncFailureEnvelope` arg extraction to the real signature before coding the handler.                                                                                                                                                                                                                                                                 |
| `NonRetriableError` not available / different name in the SDK version                      | Verify the fail-fast mechanism (Section 6) against the installed SDK; if the API differs, the classification intent stands and only the throw mechanism changes.                                                                                                                                                                                                                                                                                                                                            |
| Function factories that don't receive `auditLedger`/`operatorAlerter` today                | The implementation plan must thread these deps through each factory's signature; `riley-outcome-attribution-worker`, `batch-executor`, and the ad-optimizer crons are the likely gaps.                                                                                                                                                                                                                                                                                                                      |
| At-least-once `.failed` emission double-counts                                             | Downstream consumers dedup on `functionId + runId` (Section 7); the contract mandates the dedup key, the consumer owns enforcement.                                                                                                                                                                                                                                                                                                                                                                         |
| Class assignments contested                                                                | Classes are reviewable in this spec; the A-vs-B split (alert-now vs recoverable) is the contested boundary and is resolved here, not deferred to CI.                                                                                                                                                                                                                                                                                                                                                        |
| New `AuditEventType` member breaks exhaustive switches; new event invisible in `/activity` | Grep consumers of `AuditEventType` for exhaustive `switch` statements before adding the member; add the new arm where required. The known consumer `apps/dashboard/.../activity/event-bands.ts` types its map as `Record<string, ...>` so it will not fail to compile — but the new event is **unbanded in the `/activity` UI** and absent from `OPERATIONAL_AUDIT_EVENT_TYPES` until explicitly added; the impl must place it in a band + the operational allowlist if operators should see it by default. |

---

## Section 13 — Out of scope (deferred)

- **A generalized, operable `FailedJobStore`** (requeue / claim / repair / triage / retention) — explicitly _not_ built here. AuditLedger provides visibility; the `.failed` event + optional outbox row provides replay. If operable queue semantics are later needed, that is a separate spec.
- **Sentry parity for `mcp-server`** (Cat 2.4) — observability-init gap, tracked under Cat 2 separately.
- **Defined-but-not-registered functions** — `skill-runtime-batch-executor`, `ad-optimizer-weekly-dispatch`, and `ad-optimizer-daily-dispatch` are defined but absent from the `bootstrap/inngest.ts` `functions: [...]` array. Whether each is dead code or pending wiring is a separate Cat 2 verification. They inherit this contract (Class D / Class C respectively, per §5.2) **at the moment they are registered** — not before.
- **Product-code implementation** — this is a design spec. The handlers, schema additions, and doctrine refinement land via a separate implementation branch consuming this spec from `main`.

---

## Next step

After user review and approval, merge this spec to `main` via a focused docs PR (branch `worktree-phase3b-inngest-failure`). Then, optionally, `superpowers:writing-plans` produces an implementation plan (also a docs PR). The handler implementation runs as its own branch consuming this spec — **no product code in the spec PR**.

After the spec PR opens, update `project_audit_wave_2_phased_state.md`: Phase 3B design spec landed; implementation tracked separately.
