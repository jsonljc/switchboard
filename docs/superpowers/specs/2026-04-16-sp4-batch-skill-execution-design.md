# SP4: Batch Skill Execution

**Date:** 2026-04-16
**Status:** Draft
**Governing sentence:** SP4 standardizes batch skill execution for wedge-critical, per-deployment optimization jobs, starting with ad-optimizer, using the same governance, tracing, and explicit orchestration patterns established in SP1–SP3.

---

## Problem

The revenue loop has async workflows (ad audits, campaign optimization, scheduled diagnostics) that run as Inngest crons with hardcoded TypeScript orchestration. These workflows:

- Live in `packages/core/src/ad-optimizer/` as 14 files of domain logic
- Bypass the skill runtime entirely — no governance, no traces, no safety gates
- Run as monolithic loops over all deployments in a single function
- Produce unstructured outputs with no governance over proposed writes

SP1–SP3 established that skill execution should be traceable, governable, and safe. But those guarantees only apply to chat-triggered skills. Batch workflows are the gap.

## SP4 Goal

Make batch skill execution first-class, observable, and governable. Prove it by migrating the ad-optimizer from hardcoded TypeScript into a batch skill with the same runtime discipline as chat skills.

**SP4 standardizes batch execution only for wedge-critical, per-deployment optimization jobs. It does not attempt to unify all async workflows in the system.**

**SP4 is not:**

- A generalized async agent platform
- A scheduler replacement (Inngest stays)
- A creative-pipeline migration (separate SP)
- A cross-skill trace correlation system
- Full runtime schema enforcement for outputs

### SP4 is complete when:

- Inngest cron dispatches one `batch.requested` event per eligible deployment
- `BatchSkillHandler` executes one ad-optimizer skill run per deployment
- Each run emits a `batch_job` trace (SP3 compatible)
- Batch context is loaded via typed contract, not ad-hoc in cron code
- Proposed writes pass through the governance tier system
- Circuit breaker and blast radius gates apply to batch executions
- The weekly audit path produces parity output against current `AuditRunner.run()`: same recommendation set (types + actions), same diagnosis categories, same output schema shape

---

## Architecture

### Two Layers

```
Layer 1: Batch Dispatcher (Inngest)
  cron fires → list eligible deployments → emit one event per deployment → done

Layer 2: Batch Skill Execution (Skill Runtime)
  load context contract → run skill → enforce governance → emit trace → produce structured output
```

**Inngest's job:** decide when to run.
**Skill runtime's job:** decide how to run for one deployment.

### Why This Split

- **Thin harness:** Inngest handles scheduling, retries, concurrency — infrastructure the runtime should not absorb
- **Per-deployment isolation:** each run gets its own trace, safety checks, circuit breaker. One bad deployment does not poison the batch
- **Clean traces:** one deployment, one trigger, one context package, one result, one outcome link path
- **Naming discipline:** the cron is the dispatcher, the skill is the optimizer. The cron never contains domain logic

---

## Layer 1: Batch Dispatcher

The existing cron functions become thin dispatchers.

### Current State (to be replaced)

```typescript
// inngest-functions.ts — current monolithic loop
export async function executeWeeklyAudit(step, deps) {
  const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());
  for (const deployment of deployments) {
    // loads creds, creates clients, runs audit, saves report — all inline
  }
}
```

### Target State

```typescript
// inngest-functions.ts — thin dispatcher
export function createWeeklyAuditDispatcher(inngestClient: InngestClient) {
  return inngestClient.createFunction(
    { id: "ad-optimizer-weekly-dispatch", triggers: [{ cron: "0 6 * * 1" }] },
    async ({ step }) => {
      const deployments = await step.run("list-deployments", () =>
        listEligibleDeployments("ad-optimizer"),
      );

      for (const deployment of deployments) {
        await step.sendEvent(`dispatch-${deployment.id}`, {
          name: "skill-runtime/batch.requested",
          data: {
            deploymentId: deployment.id,
            skillSlug: "ad-optimizer",
            trigger: "weekly_audit",
            scheduleName: "ad-optimizer-weekly",
          },
        });
      }
    },
  );
}
```

### Batch Executor Function

A single Inngest function handles all `batch.requested` events:

```typescript
export function createBatchExecutor(inngestClient: InngestClient, runtime: BatchRuntime) {
  return inngestClient.createFunction(
    {
      id: "skill-runtime-batch-executor",
      triggers: [{ event: "skill-runtime/batch.requested" }],
      concurrency: { limit: 5 }, // max 5 concurrent batch executions
    },
    async ({ event, step }) => {
      await step.run("execute-batch-skill", () =>
        runtime.executeBatch({
          deploymentId: event.data.deploymentId,
          skillSlug: event.data.skillSlug,
          trigger: event.data.trigger,
        }),
      );
    },
  );
}
```

### Event Contract

```typescript
type BatchEvents = {
  "skill-runtime/batch.requested": {
    deploymentId: string;
    skillSlug: string;
    trigger: string; // "weekly_audit" | "daily_check" | "manual"
    scheduleName: string; // for trace attribution
  };
  "skill-runtime/batch.completed": {
    deploymentId: string;
    skillSlug: string;
    traceId: string;
    recommendationCount: number;
    proposedWriteCount: number;
    executedWriteCount: number;
    durationMs: number;
  };
};
```

---

## Layer 2: Batch Skill Execution

### BatchSkillHandler

Parallel to `SkillHandler` (chat). Same runtime philosophy, different trigger/context/output model.

| Dimension          | Chat (SkillHandler)                 | Batch (BatchSkillHandler)                                          |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------ |
| Trigger            | User message                        | Inngest event                                                      |
| Context source     | Conversation messages + persona     | Typed context contract (campaign state, spend windows, etc.)       |
| Parameter builder  | `ParameterBuilder`                  | `BatchParameterBuilder`                                            |
| Output             | `ctx.chat.send(text)`               | `BatchSkillResult` (recommendations + proposed writes)             |
| Trace trigger type | `"chat_message"`                    | `"batch_job"`                                                      |
| Interaction model  | Conversational                      | Fire-and-forget                                                    |
| Write execution    | Inline (tool calls during LLM loop) | Post-execution (handler routes proposed writes through governance) |

### BatchParameterBuilder

Same family as chat's `ParameterBuilder`. Resolves deployment-specific context into skill parameters via the context contract.

```typescript
type BatchParameterBuilder = (
  config: { deploymentId: string; orgId: string; trigger: string },
  stores: BatchSkillStores,
  contract: BatchContextContract,
) => Promise<Record<string, unknown>>;
```

No `AgentContext` — batch jobs have no conversation, no persona, no chat provider. The builder queries data sources defined in the contract and returns typed parameters.

### Context Contract

Each batch skill declares what context it needs. The contract is typed, not string soup.

```typescript
interface BatchContextRequirement {
  key: string;
  source: "ads" | "crm" | "deployment" | "benchmark";
  freshnessSeconds?: number;
  scope?: string; // e.g. "current_period", "previous_period", "last_30d"
}

interface BatchContextContract {
  required: BatchContextRequirement[];
}
```

**Ad-optimizer context contract:**

```yaml
required:
  - key: campaign_insights
    source: ads
    scope: current_period
  - key: campaign_insights_previous
    source: ads
    scope: previous_period
  - key: account_summary
    source: ads
  - key: crm_funnel_data
    source: crm
  - key: benchmarks
    source: benchmark
  - key: learning_phase_status
    source: ads
  - key: deployment_config
    source: deployment
    freshnessSeconds: 0 # always fresh
```

The `scope` field handles recurring patterns like current vs previous period without pushing that distinction into magic key names.

### Structured Output

Batch skills produce operational results, not chat prose.

```typescript
interface BatchSkillResult {
  recommendations: Array<{
    type: string; // e.g. "budget_reallocation", "pause_campaign", "scale_winner"
    action: string; // human-readable action description
    confidence: "high" | "medium" | "low";
    reasoning: string;
  }>;
  proposedWrites: Array<{
    tool: string;
    operation: string;
    params: unknown;
    governanceTier: GovernanceTier;
  }>;
  summary: string; // one-paragraph execution summary for the trace
  nextRunHint?: string; // e.g. "run again in 24h", "escalate to human"
}
```

SP4 requires declared structured outputs and validates shape at the handler boundary (the handler checks that the skill returned valid `BatchSkillResult` before processing writes). Full generic runtime schema enforcement is deferred.

### Write Execution Path

Batch skills return proposed writes. The handler decides. The skill never executes writes directly.

```
Skill returns BatchSkillResult with proposedWrites[]
        ↓
Handler iterates proposedWrites sequentially
        ↓
For each write: getToolGovernanceDecision(op, trustLevel)
    ├── auto-approve → handler executes the write via tool operation
    ├── require-approval → handler persists to AgentTask (status: pending_approval)
    └── deny → handler logs as denied in trace, skips
        ↓
All writes complete → emit batch.completed event + persist trace
```

**Sequential execution:** auto-approved writes execute sequentially, not in parallel. If write N fails, writes N+1..M are skipped and the failure is recorded in the trace. This keeps failure semantics simple — partial execution is visible in the trace, and the next scheduled run can pick up where it left off.

**Approval queue:** `require-approval` writes create `AgentTask` records with the proposed write as input. These appear in the existing task review queue (SP1 marketplace). When approved, a separate handler executes the write.

### Safety Gates

Batch executions inherit SP3 safety gates:

- **Circuit breaker:** 5+ failures in 1 hour → disable batch execution for this deployment
- **Blast radius:** 50+ writes in 1 hour → halt writes, continue read-only execution
- Both gates check at the start of `BatchSkillHandler.execute()` and abort before LLM call if tripped

---

## Ad-Optimizer Migration

### Latent vs Deterministic Split

| Current File               | Lines | Classification           | SP4 Destination                                     |
| -------------------------- | ----- | ------------------------ | --------------------------------------------------- |
| `audit-runner.ts`          | 180   | Process (orchestration)  | `skills/ad-optimizer.md` body                       |
| `recommendation-engine.ts` | 95    | Latent (LLM judgment)    | `skills/ad-optimizer.md` body                       |
| `metric-diagnostician.ts`  | 85    | Deterministic            | `ads-analytics.diagnose` tool operation             |
| `period-comparator.ts`     | 55    | Deterministic            | `ads-analytics.compare-periods` tool operation      |
| `funnel-analyzer.ts`       | 70    | Deterministic            | `ads-analytics.analyze-funnel` tool operation       |
| `learning-phase-guard.ts`  | 60    | Deterministic            | `ads-analytics.check-learning-phase` tool operation |
| `meta-ads-client.ts`       | 120   | Deterministic (external) | `ads-data.get-insights` tool (read tier)            |
| `meta-capi-client.ts`      | 45    | Deterministic (external) | `ads-data.send-event` tool (external_write tier)    |
| `inngest-functions.ts`     | 100   | Infrastructure           | Thin dispatcher (stays in core, rewritten)          |
| `meta-leads-ingester.ts`   | 40    | Deterministic            | `ads-data.parse-lead-webhook` tool (read tier)      |
| `facebook-oauth.ts`        | 90    | Infrastructure           | Stays in core (auth, not domain logic)              |

### Tools

**`ads-analytics`** (tier: `read`)

| Operation              | Wraps                                            | Idempotent |
| ---------------------- | ------------------------------------------------ | ---------- |
| `diagnose`             | `metric-diagnostician.ts` → `diagnose()`         | Yes        |
| `compare-periods`      | `period-comparator.ts` → `comparePeriods()`      | Yes        |
| `analyze-funnel`       | `funnel-analyzer.ts` → `analyzeFunnel()`         | Yes        |
| `check-learning-phase` | `learning-phase-guard.ts` → `LearningPhaseGuard` | Yes        |

**`ads-data`** (mixed tiers)

| Operation               | Wraps                                           | Tier           | Idempotent |
| ----------------------- | ----------------------------------------------- | -------------- | ---------- |
| `get-campaign-insights` | `meta-ads-client.ts` → `getCampaignInsights()`  | read           | Yes        |
| `get-account-summary`   | `meta-ads-client.ts` → `getAccountSummary()`    | read           | Yes        |
| `send-conversion-event` | `meta-capi-client.ts` → `sendEvent()`           | external_write | No         |
| `parse-lead-webhook`    | `meta-leads-ingester.ts` → `parseLeadWebhook()` | read           | Yes        |

### Skill File: `skills/ad-optimizer.md`

```yaml
---
name: ad-optimizer
slug: ad-optimizer
version: 1.0.0
description: >
  Weekly campaign audit — analyzes ad performance, diagnoses issues,
  and produces prioritized recommendations for budget reallocation,
  campaign scaling, and underperformer management.
author: switchboard
parameters:
  - name: CAMPAIGN_INSIGHTS
    type: object
    required: true
  - name: PREVIOUS_INSIGHTS
    type: object
    required: true
  - name: ACCOUNT_SUMMARY
    type: object
    required: true
  - name: CRM_FUNNEL
    type: object
    required: true
  - name: BENCHMARKS
    type: object
    required: true
  - name: DEPLOYMENT_CONFIG
    type: object
    required: true
tools:
  - ads-analytics
output:
  fields:
    - name: recommendations
      type: array
      required: true
    - name: summary
      type: string
      required: true
    - name: confidence
      type: enum
      values: [high, medium, low]
      required: true
---
```

Skill body defines the audit process:

1. Compare current vs previous period via `ads-analytics.compare-periods`
2. Diagnose anomalies via `ads-analytics.diagnose`
3. Analyze funnel health via `ads-analytics.analyze-funnel`
4. Check learning phase status via `ads-analytics.check-learning-phase`
5. Synthesize findings and produce prioritized recommendations (LLM judgment)

The skill does NOT call `ads-data` tools directly. Data loading happens in the `BatchParameterBuilder` before the skill runs. The skill only uses `ads-analytics` tools for deterministic analysis, then applies LLM judgment for recommendations.

### Parity Target

The weekly audit migration has parity when:

- **Same recommendation types:** budget_reallocation, pause_campaign, scale_winner, audience_refresh, creative_fatigue — matching `recommendation-engine.ts` output categories
- **Same diagnosis categories:** matching `metric-diagnostician.ts` → `Diagnosis` type (overspend, underspend, fatigue, learning_phase, funnel_leak, etc.)
- **Same output shape:** `BatchSkillResult` maps to current `AuditReport` schema fields — recommendations, account summary, period comparison, diagnoses

Parity is validated by running both paths (legacy `AuditRunner.run()` and new skill execution) against the same mock data and comparing output structure. Values may differ (LLM wording varies), but categories and coverage must match.

---

## Changes to Existing Code

### New Files

| File                                                                | Purpose                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/core/src/skill-runtime/batch-skill-handler.ts`            | `BatchSkillHandler` — batch execution equivalent of `SkillHandler`                |
| `packages/core/src/skill-runtime/batch-skill-handler.test.ts`       | Tests                                                                             |
| `packages/core/src/skill-runtime/batch-parameter-builder.ts`        | `BatchParameterBuilder` type + `BatchContextContract` + `BatchContextRequirement` |
| `packages/core/src/skill-runtime/batch-parameter-builder.test.ts`   | Tests                                                                             |
| `packages/core/src/skill-runtime/builders/ad-optimizer.ts`          | Ad-optimizer `BatchParameterBuilder`                                              |
| `packages/core/src/skill-runtime/builders/ad-optimizer.test.ts`     | Tests                                                                             |
| `packages/core/src/skill-runtime/tools/ads-analytics.ts`            | Wraps diagnostician, comparator, funnel analyzer, learning guard                  |
| `packages/core/src/skill-runtime/tools/ads-analytics.test.ts`       | Tests                                                                             |
| `packages/core/src/skill-runtime/tools/ads-data.ts`                 | Wraps meta-ads-client, meta-capi-client, leads ingester                           |
| `packages/core/src/skill-runtime/tools/ads-data.test.ts`            | Tests                                                                             |
| `skills/ad-optimizer.md`                                            | Ad-optimizer skill file                                                           |
| `packages/core/src/skill-runtime/__tests__/eval-fixtures/ao-*.json` | Eval fixtures                                                                     |

### Modified Files

| File                                                  | Change                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/core/src/ad-optimizer/inngest-functions.ts` | Replace monolithic loops with thin dispatchers                                  |
| `packages/core/src/skill-runtime/types.ts`            | Add `BatchSkillResult`, `BatchContextContract`, `BatchContextRequirement` types |
| `packages/core/src/skill-runtime/index.ts`            | Export new batch modules                                                        |
| `apps/api/src/bootstrap/`                             | Wire batch executor Inngest function                                            |

### Files NOT Changed (stay as-is until parity confirmed)

| File                         | Reason                                                   |
| ---------------------------- | -------------------------------------------------------- |
| `audit-runner.ts`            | Kept for parity comparison until migration validated     |
| `recommendation-engine.ts`   | Domain logic moves to skill body, but keep for reference |
| `metric-diagnostician.ts`    | Wrapped by tool, original preserved                      |
| All other ad-optimizer files | Wrapped, not deleted                                     |

---

## Risks

| Risk                                                       | Mitigation                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Batch LLM recommendations differ from deterministic engine | Parity eval compares categories/coverage, not exact wording. Both paths run against same mock data.                      |
| Context contract too rigid for future batch skills         | Contract is per-skill, not global. New skills define their own requirements.                                             |
| Batch execution blows token budget (large campaign data)   | BatchParameterBuilder summarizes/truncates data before passing to skill. Token budget enforcement from SP1 applies.      |
| Proposed writes pile up in approval queue                  | Blast radius limiter caps writes per window. Dashboard shows pending approvals.                                          |
| Inngest concurrency limits throttle batch runs             | Start with limit=5, tune based on observed latency. Each deployment run is independent.                                  |
| Circuit breaker trips too aggressively for batch           | Batch failures are often transient (API timeouts). Consider separate batch-specific thresholds (e.g., 3 failures not 5). |

---

## What Comes After SP4

| Future Work                           | Depends On                                               |
| ------------------------------------- | -------------------------------------------------------- |
| **Creative pipeline batch migration** | SP4 pattern proven with ad-optimizer                     |
| **Cross-skill trace correlation**     | SP3 traces + SP4 batch traces both persisted             |
| **Automated write execution**         | Governance tier system + trust score maturity            |
| **Batch scheduling UI**               | Dashboard extension for manual trigger / schedule config |
| **Runtime output schema enforcement** | Declared schemas from SP2 + SP4 structured outputs       |
