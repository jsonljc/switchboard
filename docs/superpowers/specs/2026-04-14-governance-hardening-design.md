# Governance Hardening — Confidence, Idempotency, Notification Tiers

**Date:** 2026-04-14
**Status:** Approved
**Goal:** Three surgical additions to the governance pipeline that close the confidence gap, prevent duplicate side effects, and make trust graduation tangible to business owners.
**Predecessor:** `2026-04-13-switchboard-three-channel-comms-design.md` (Section 4 + 4.4)

---

## 1. Confidence Thresholds

### Problem

The policy engine answers "is this risky?" but not "does the agent understand what it's doing?" A low-risk read can still have terrible confidence — missing params, bad retrieval, unreliable tool. Without confidence scoring, ambiguous actions auto-execute and fail silently, tanking trust scores.

### Design

Pure function `computeConfidence(input: ConfidenceInput): ConfidenceResult` in `packages/core/src/engine/confidence.ts`.

**Signals and weights:**

| Signal                                 | Weight | Source                                                 | Range                |
| -------------------------------------- | ------ | ------------------------------------------------------ | -------------------- |
| `riskScore`                            | 0.3    | Risk scorer (inverted: lower risk = higher confidence) | 0-100                |
| `schemaComplete` + `hasRequiredParams` | 0.3    | Action parameter validation                            | boolean → 1.0 or 0.2 |
| `retrievalQuality`                     | 0.2    | RAG retrieval score (optional, default 0.7)            | 0-1                  |
| `toolSuccessRate`                      | 0.2    | Historical tool success (optional, default 0.8)        | 0-1                  |

**Thresholds:**

| Level    | Score   | Behavior                                            |
| -------- | ------- | --------------------------------------------------- |
| `high`   | >= 0.75 | Auto-execute                                        |
| `medium` | >= 0.45 | Suggest clarification for mutations                 |
| `low`    | < 0.45  | Escalate: upgrade `"none"` approval to `"standard"` |

**Integration point:** Between Step 8 (risk scoring) and Step 9 (approval determination) in `policy-engine.ts`. Confidence is **additive only** — never downgrades approval requirements. Recorded in the decision trace via `addCheck()` with check code `CONFIDENCE` (must be added to `CheckCodeSchema` in `packages/schemas/src/decision-trace.ts`).

### Files

| File                                             | Action                                                                    | Lines |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ----- |
| `packages/schemas/src/decision-trace.ts`         | Modify — add `CONFIDENCE` and `MANUAL_APPROVAL_GATE` to `CheckCodeSchema` | ~2    |
| `packages/core/src/engine/confidence.ts`         | Create                                                                    | ~60   |
| `packages/core/src/__tests__/confidence.test.ts` | Create                                                                    | ~50   |
| `packages/core/src/engine/policy-engine.ts`      | Modify                                                                    | ~15   |
| `packages/core/src/engine/index.ts`              | Modify                                                                    | ~3    |
| `packages/core/src/index.ts`                     | Already exports `./engine/index.js`                                       | 0     |

---

## 2. Idempotency Audit + Fixes

### Problem

`IdempotencyGuard` exists at the orchestrator level (`packages/core/src/idempotency/guard.ts`) and HTTP level (`apps/api/src/middleware/idempotency.ts`), but the action execution path in `packages/agents/src/action-executor.ts` has no dedup. A retry, dead-letter replay, or concurrent request creates real duplicate side effects — critical for payment and booking actions.

### Design

**Audit:** Document all action execution paths, categorize as READ/WRITE, check idempotency coverage.

**Fix:** Wire `IdempotencyGuard` into `ActionExecutor.execute()` for write actions. The guard wraps the handler call using the existing `IdempotencyGuard.checkDuplicate()` and `recordResponse()` API (which generates SHA-256 keys internally):

```
1. Call guard.checkDuplicate(principalId, actionType, parameters)
2. If duplicate → return cached result
3. Execute handler
4. Call guard.recordResponse(principalId, actionType, parameters, result)
```

The `ActionExecutor` receives an `IdempotencyGuard` instance via constructor injection. Write detection uses a `writeActions: Set<string>` passed at construction (populated from tool registry metadata).

### Files

| File                                                    | Action | Lines |
| ------------------------------------------------------- | ------ | ----- |
| `docs/audits/2026-04-14-idempotency-coverage.md`        | Create | ~80   |
| `packages/agents/src/action-executor.ts`                | Modify | ~25   |
| `packages/agents/src/__tests__/action-executor.test.ts` | Modify | ~40   |

---

## 3. Notification Tier System (SP2 partial)

### Problem

No notification intelligence exists. Events either push or don't. Trust graduation is invisible to the business owner — trust scores are numbers in a database, not experienced behavior changes.

### Design

**NotificationClassifier** (`packages/core/src/notifications/notification-classifier.ts`, ~100 lines):

Pure function: `classifyNotification(event: NotificationEvent): NotificationTier`

Classification rules:

| Event Type                                                         | Tier         |
| ------------------------------------------------------------------ | ------------ |
| `pending_approval`, `action_failed`, `escalation`, `revenue_event` | T1 (Act Now) |
| `fact_learned`, `faq_drafted`, `agent_contradicted`                | T2 (Confirm) |
| `weekly_summary`, `milestone`, `performance_stats`                 | T3 (FYI)     |

Trust level modifiers: at `observe`, all actions become T1. At `autonomous`, only `pending_approval` for high-risk stays T1.

**NotificationBatcher** (`packages/core/src/notifications/notification-batcher.ts`, ~80 lines):

- Accumulates T2 events per deployment in `Map<deploymentId, events[]>`
- Flushes on: 20-minute timer OR 3 accumulated events (whichever first)
- Flush calls existing `ProactiveSender.sendProactive()`
- Constructor takes `flushIntervalMs` and `maxBatchSize` for testability
- Exposes `stop()` method to clear interval timer (prevents test process hangs)

**Policy Engine Step 0** (`packages/core/src/engine/policy-engine.ts`, ~10 lines):

At the top of `evaluate()`, before forbidden behavior check. Must compute a default risk score before calling `buildTrace()` (which throws without one):

```typescript
if (evalContext.metadata["requiresManualApproval"]) {
  const riskScoreResult = riskInput(engineContext, config);
  builder.computedRiskScore = riskScoreResult;
  addCheck(
    builder,
    "MANUAL_APPROVAL_GATE",
    { tool: proposal.actionType },
    `Tool "${proposal.actionType}" requires manual approval regardless of trust level.`,
    true,
    "skip",
  );
  builder.finalDecision = "allow";
  builder.approvalRequired = "mandatory";
  return buildTrace(builder);
}
```

**Edge case — forbidden + requiresManualApproval:** Step 0 runs before the forbidden check intentionally. If a tool is both forbidden AND requires manual approval, the manual gate takes precedence (returns "allow" + "mandatory" approval). This is correct: a forbidden tool should never reach execution, but `requiresManualApproval` means the owner explicitly registered it — it's not forbidden, it just always needs approval. If a tool is truly forbidden, remove `requiresManualApproval` from its definition.

### Files

| File                                                                        | Action | Lines |
| --------------------------------------------------------------------------- | ------ | ----- |
| `packages/core/src/notifications/notification-classifier.ts`                | Create | ~100  |
| `packages/core/src/notifications/__tests__/notification-classifier.test.ts` | Create | ~80   |
| `packages/core/src/notifications/notification-batcher.ts`                   | Create | ~80   |
| `packages/core/src/notifications/__tests__/notification-batcher.test.ts`    | Create | ~60   |
| `packages/core/src/notifications/index.ts`                                  | Modify | ~4    |
| `packages/core/src/engine/policy-engine.ts`                                 | Modify | ~10   |
| `packages/core/src/__tests__/policy-engine.test.ts`                         | Modify | ~15   |

---

## 4. Total Scope

~8 tasks, ~600 new lines across 7 new files, ~70 modified lines across 5 existing files. No new infrastructure. No new dependencies. All additive — existing tests must continue to pass.

## 5. Implementation Order

1. Confidence Thresholds (Tasks 1-3) — self-contained, no deps
2. Idempotency Audit (Tasks 4-5) — self-contained, no deps
3. Notification Tiers + Policy Gate (Tasks 6-8) — depends on nothing above

All three can be parallelized if needed since they touch different files (except `policy-engine.ts` which gets both confidence + Step 0).
