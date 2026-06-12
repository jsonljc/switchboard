# Creative dead-letter completion: a retry-exhausted job reaches a terminal FAILED state

Date: 2026-06-11
Audit: docs/audits/2026-06-10-mira-capability-audit (FINDINGS.md rec 0.4; domains D5-F1, D9-F2; touches D5-F4)
Status: design approved (autonomous slice)

## Problem

When a polished creative render exhausts its Inngest retries, nothing writes a
terminal state to the `CreativeJob` row. The job keeps its mid-pipeline
`currentStage` / `stageOutputs`, so `mapCreativeJobToMiraStatus` returns
`awaiting_review` (or `in_progress`) forever. The operator desk shows a zombie
with a Continue button that no run consumes, and the row counts toward
`inFlight` permanently, which eventually trips Mira's self-brief backlog cap
(`SELF_BRIEF_BACKLOG_CAP = 5`) and silences her self-initiated briefs for that
org with no operator signal.

This is the natural completion of the fail-loud arc whose first leg shipped in
PR #979 (a zero-clip polished render now throws into the dead-letter). That
throw now reaches the `creative-job-runner` function-level `onFailure`
(`makeOnFailureHandler`), which records the canonical
`infrastructure.job.retry_exhausted` audit row and emits `creative.polished.failed`.
But:

1. **Nothing consumes `creative.polished.failed`** (grep: producers only).
2. The `AsyncFailureContext` carries only `auditLedger`, `operatorAlerter`, and
   `inngest.send`, so `onFailure` has **no job-store access** and cannot persist
   a terminal marker even in principle.
3. The emitted envelope (`AsyncFailureEnvelope`) carries **no jobId** (the handler
   builds it without organizationId/deploymentId, and there is no entity id at
   all), so even a consumer could not tell which job died. The original trigger
   payload `{ jobId, taskId, organizationId, deploymentId }` is present in the
   onFailure arg at `arg.event.data.event.data` but is never propagated.

The status mapper can only derive a *polished* `failed` from
`productionErrorsWithoutVideo` (a job that completed the production stage with
all clips errored, no throw). A crash in trends/hooks/scripts/storyboard, or any
out-of-band step failure (load-job, load-production-tier, save-stage,
save-durable-asset), leaves no error record, so the row falls through to
`awaiting_review`.

UGC has the same gap for its out-of-band step failures (D5-F4): the UGC runner
persists `failUgc` in-band only for `phase-*` step throws, and its `onFailure`
is wired `emitEvent:false`, so a failure of any non-phase step dies invisibly.

Verified against `main` @ cbefaf20.

## Goal (this slice)

A retry-exhausted creative job reaches a terminal `failed` lifecycle state and
is surfaced to the operator as failed (not as a stuck `awaiting_review` zombie),
by consuming the dead-letter the pipeline now emits. The status flip is the
keystone: a `failed` job drops out of `inFlight` automatically
(`inFlight = awaiting_review + in_progress`), freeing the self-brief backlog cap,
and renders through the existing `failed` status path (already used by UGC), so
no new dashboard component is required.

## Design

Consume the dead-letter via a new Inngest function and persist a terminal marker.
This is faithful to the audit framing ("nothing consumes that event") and is
strictly more complete than an in-band runner try/catch, which would catch only
stage-execution throws and miss every out-of-band step failure. The function-level
`onFailure` fires once after Inngest exhausts retries, on any uncaught step, so
consuming its event catches the whole failure surface.

### Components

1. **Dead-letter carries trigger identity** (`packages/core/src/observability/async-failure-handler.ts`).
   `makeOnFailureHandler` passes the original trigger payload
   (`arg.event.data.event.data`) through to the emitted `<domain>.failed` event
   under a `trigger` key. Purely additive: the audit row is unchanged, the typed
   envelope is unchanged, and no `.failed` event has a consumer today. General:
   any future dead-letter consumer gains its trigger context. The `InngestOnFailureArg`
   type gains an optional `event.data.event.data` field.

2. **Terminal marker column** (`packages/db/prisma/schema.prisma` + migration).
   Add `stageFailure Json?` to `CreativeJob`, mirroring `ugcFailure Json?`.
   Nullable JSONB, no backfill, non-breaking. No index (read from already-loaded
   rows only).

3. **Store method** (`packages/db/src/stores/prisma-creative-job-store.ts`).
   `failPolished(organizationId, id, failure)` mirrors `failUgc`:
   `assertMode("polished")`, org-scoped `updateMany` writing `{ stageFailure: failure }`,
   `count === 0 => StaleVersionError`. It does **not** touch `currentStage` (the
   last-reached stage stays for "failed at X" context; the failure JSON also
   carries the stage when known). Additionally, `updateStage` clears
   `stageFailure` (sets it null) on every successful stage save, so a replayed run
   that progresses self-heals out of `failed` (handles the one interaction the
   D5-F2 replay defect has with this marker without doing the D5-F2 slice).

4. **The consumer** (`apps/api/src/services/creative-failure-recorder.ts`, mirrors
   `creative-publish-function.ts`). Exposes a testable
   `executeCreativeFailureRecorder(eventData, step, deps)` plus a
   `createCreativeFailureRecorder(deps)` Inngest wiring. Triggers on
   **both** `creative.polished.failed` and `creative.ugc.failed`. Logic:
   - Zod-parse `eventData.trigger` for `{ jobId }`; missing => audit-skip (cannot act).
   - `step.run("load-job")`; null => skip (job vanished).
   - Idempotency guard: skip if the job is already terminal (`stoppedAt != null`,
     or polished `stageFailure != null` / `currentStage === "complete"`, or ugc
     `ugcFailure != null` / `ugcPhase === "complete"`).
   - Build the failure JSON from the envelope: `{ kind: "terminal", code, message,
     stage?, occurredAt, functionId }`.
   - Branch on the **loaded** `job.mode` (authoritative, not the event): polished =>
     `failPolished(job.organizationId, jobId, failure)`; ugc =>
     `failUgc(job.organizationId, jobId, job.ugcPhase ?? "planning", failure)`.
   - `retries: 3` (a transient DB hiccup recovers); its own Class-E `onFailure`
     (`emitEvent:false`, `alert:false`) so a recorder failure audits without
     recursing into another `.failed` event.

5. **UGC parity** (`apps/api/src/bootstrap/inngest.ts`). Flip the `ugc-job-runner`
   `onFailure` from `emitEvent:false` to `emitEvent:true, eventDomain:"creative.ugc"`,
   so out-of-band UGC failures emit `creative.ugc.failed` for the same consumer to
   record. The in-band `failUgc` path (phase throws) and the `onFailure` path
   (out-of-band) are mutually exclusive, so there is no double-write. Register the
   new function in the bootstrap `functions: [...]` array, reusing the in-scope
   `jobStore` and `asyncFailure`.

6. **Status mapper** (`packages/core/src/creative-read-model/status-mapper.ts`).
   Add to the mode-agnostic failure section, before the `stoppedAt` check:
   `if (job.mode !== "ugc" && job.stageFailure != null) return "failed";`. The
   existing `productionErrorsWithoutVideo` rule stays (different path). `deriveReviewAction("failed")`
   already returns `{ canContinue:false, canStop:false }`, so the dead Continue
   button disappears.

7. **Decision workflow** (`apps/api/src/services/workflows/creative-job-decision-workflow.ts`).
   Extend the polished not-awaiting guard to also reject `stageFailure != null`,
   mirroring the ugc `ugcFailure != null` guard, so a forced or raced Continue on a
   failed polished job returns `CREATIVE_JOB_NOT_AWAITING_APPROVAL` instead of a
   phantom queued success.

### Data flow

```
stage step throws --> Inngest retries x3 --> onFailure (makeOnFailureHandler)
  |-- (a) audit: infrastructure.job.retry_exhausted   [unchanged]
  |-- (b) emit: creative.polished.failed { ...envelope, trigger:{ jobId, ... } }  [now carries trigger]
        |
        v
  creative-failure-recorder (new)
    load job by trigger.jobId; skip if already terminal
    branch on job.mode -> failPolished(stageFailure) | failUgc(ugcFailure)
        |
        v
  status-mapper: stageFailure != null -> "failed"
    -> desk shows failed, Continue disabled, drops from inFlight (cap freed)
```

### Error handling

- Recorder write failure: Inngest retries the `step.run`; persistent failure
  dead-letters to its own Class-E audit row.
- Missing/garbage `trigger`: the recorder skips (no throw), leaving the existing
  audit row as the only signal (status quo for that job, no regression).
- Replay of a failed run that then succeeds: `updateStage` clears `stageFailure`,
  so the job leaves `failed` on real progress.

## Out of scope (deferred, stated explicitly)

- **Operator alerting (D9-F1, rec 0.5).** The `OperatorAlerter` is webhook-or-noop
  and the webhook is wired nowhere in the production topology (render.yaml /
  provisioning omit `OPERATOR_ALERT_WEBHOOK_URL`). Flipping the runner to
  `alert:true` would alert into a Noop. Wiring the webhook into the deploy topology
  is a separate ops slice. The terminal `failed` state plus the already-emitted
  `retry_exhausted` audit row are this slice's in-product surfaces.
- **Replay / idempotency-concurrency guard (D5-F2, rec 0.4's middle leg).** Distinct
  defect (duplicate event delivery corrupting terminal state via unclamped resume
  and no `concurrency` config). Separable; only its single interaction with this
  marker is handled by the `updateStage` clear-on-progress above.
- **Stage-scoped approval matching (D1-F10, rec 0.4's other half).** Separate slice.
- **Failure-reason surfacing in the dashboard.** The status flip to `failed` is the
  keystone surface; a "why it failed" reason card is a follow-up.
- **Dispatcher dead-letter (`creative.dispatch.failed`).** Different surface
  (pre-execution routing), already `alert:true`; a fresh `in_progress` job rather
  than a mid-pipeline zombie.

## Test plan (TDD)

- `async-failure-handler` (core): emitted `.failed` event includes `trigger` when
  the original trigger payload is present; omits it cleanly when absent; audit row
  unchanged.
- `prisma-creative-job-store` (db, mocked Prisma): `failPolished` writes
  `stageFailure` org-scoped, `count===0` throws, `assertMode` rejects a ugc job;
  `updateStage` clears `stageFailure`.
- `status-mapper` (core): polished job with `stageFailure` maps to `failed`, beating
  `awaiting_review` / `in_progress`; unaffected when null.
- `creative-job-decision-workflow` (api): `continue` on a polished job with
  `stageFailure` returns `CREATIVE_JOB_NOT_AWAITING_APPROVAL`.
- `creative-failure-recorder` (api): polished event => `failPolished`; ugc event =>
  `failUgc(ugcPhase)`; already-terminal => no write; missing trigger => skip;
  job-not-found => skip; exported failure params satisfy the doctrine-#7 contract.
- Run `pnpm --filter @switchboard/core test`, `--filter @switchboard/db test`,
  `--filter @switchboard/schemas test`, and `--filter api test`, plus
  `pnpm typecheck`, `lint`, `format:check`, `arch:check`, and `db:check-drift`.

## Invariants respected

- Inngest step state is JSON-only: the consumer rides `deps`/closure, matches on
  ids, and persists via `step.run`.
- Dual-lifecycle: the consumer handles both modes in one place; the new status
  value's only new reader is the status mapper (every other lifecycle reader keys
  off the same `failed` status UGC already produces).
- Surface-agnostic backend: core emits the event and maps status; the apps layer
  consumes and writes via the db store.
- Schema change ships with its migration in the same commit; index-name limits N/A
  (no index added).
