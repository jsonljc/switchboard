# Lifecycle Phase 2: Opportunity-Based Agent Routing — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Depends on:** Unified Lifecycle spec (2026-03-25), Contact Creation on First Touch (PR #178)

---

## 1. Problem Statement

Agents don't directly update the lifecycle pipeline. They emit `opportunity.stage_advanced` events as informational signals, but the actual stage advancement relies on a brittle post-processing hack in the conversation endpoint (lines 180-211 of `apps/api/src/routes/conversation.ts`) that guesses transitions by matching event name strings. This creates:

1. **Fragile stage advancement** — string-matching maps `lead.qualified` to `"qualified"` and SalesCloser's `opportunity.stage_advanced` to `"booked"`. Any new agent or stage requires manual mapping.
2. **No graceful degradation** — if the mapping misses a case, the opportunity stage silently doesn't advance.
3. **Two routing systems** — `agentForThreadStage()` (deprecated) and `agentForOpportunityStage()` both exist. ConversationRouter tries opportunity-based first, falls back to thread-based. But most conversations still go through the thread path because opportunity data isn't reliably populated.

---

## 2. Design Decisions

Decisions made during brainstorming, with rationale:

| Decision                           | Choice                                                                        | Rationale                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How agents advance stages          | Agents call `advanceOpportunityStage()` directly                              | More reliable than event-based guessing. Each agent knows exactly what transition it's making.                                                              |
| How agents access lifecycle        | Optional narrow interface on `AgentContext` (`lifecycle?: LifecycleAdvancer`) | Graceful degradation — agents that don't need it ignore it; works without database. Avoids coupling agents to the concrete `ContactLifecycleService` class. |
| What happens to old routing        | Keep thread-stage routing as fallback, remove post-processing hack            | Old leads without Contact/Opportunity use old path. New leads use new path. No migration needed.                                                            |
| Nurture/AdOptimizer empty handlers | Leave for later                                                               | Separate concern. Keep scope focused on routing + stage advancement.                                                                                        |
| Event payload format               | No change — `outputEvents` stays `string[]`                                   | Agents update the board directly; events are informational, not authoritative. Single source of truth = lifecycle service.                                  |
| Data migration                     | No migration — fresh start                                                    | Old threads keep working via fallback. New conversations go through lifecycle. Old data eventually goes stale.                                              |

---

## 3. Changes

### 3.1 AgentContext — Optional Lifecycle Access via Narrow Interface

Define a narrow `LifecycleAdvancer` interface in `packages/agents/src/ports.ts` (where `AgentContext` is defined, line 31) with only the two methods agents need:

```typescript
// packages/agents/src/ports.ts

import type { OpportunityStage } from "@switchboard/schemas";

export interface LifecycleAdvancer {
  advanceOpportunityStage(
    orgId: string,
    opportunityId: string,
    toStage: OpportunityStage,
    advancedBy: string,
  ): Promise<unknown>;
  reopenOpportunity(
    orgId: string,
    opportunityId: string,
    toStage: "interested" | "qualified",
  ): Promise<unknown>;
}

export interface AgentContext {
  organizationId: string;
  profile?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; content: string }>;
  contactData?: Record<string, unknown>;
  thread?: ConversationThread;
  lifecycle?: LifecycleAdvancer; // NEW — optional, agents check before calling
}
```

The concrete `ContactLifecycleService` satisfies this interface without agents importing it. This avoids tight coupling and follows the existing pattern of narrow interfaces in `ports.ts`.

### 3.2 Agent Handler Updates

Three agents get updated to call lifecycle methods directly. All use `context.organizationId` (not bare `orgId`) and wrap calls in try/catch for graceful failure.

#### LeadResponder (`packages/agents/src/agents/lead-responder/handler.ts`)

After qualifying a lead (score meets threshold), calls:

```typescript
if (context.lifecycle && event.metadata?.lifecycleOpportunityId) {
  try {
    await context.lifecycle.advanceOpportunityStage(
      context.organizationId,
      event.metadata.lifecycleOpportunityId as string,
      "qualified",
      "lead-responder",
    );
  } catch (err) {
    console.warn("Opportunity stage advancement failed", err);
  }
}
```

Gets `lifecycleOpportunityId` from event metadata (injected by ContactResolver on inbound `message.received`).

Continues to emit `lead.qualified` and `opportunity.stage_advanced` events as informational signals for downstream consumers (RevenueTracker CRM logging).

**Metadata propagation:** When LeadResponder emits `lead.disqualified` or `lead.qualified` output events, it must include `lifecycleOpportunityId` and `lifecycleContactId` from the original event metadata so downstream agents (Nurture, SalesCloser) can access them.

#### SalesCloser (`packages/agents/src/agents/sales-closer/handler.ts`)

After booking (from `handleQualified` flow), calls:

```typescript
if (context.lifecycle && event.metadata?.lifecycleOpportunityId) {
  try {
    await context.lifecycle.advanceOpportunityStage(
      context.organizationId,
      event.metadata.lifecycleOpportunityId as string,
      "booked",
      "sales-closer",
    );
  } catch (err) {
    console.warn("Opportunity stage advancement failed", err);
  }
}
```

Continues to emit `stage.advanced` and `opportunity.stage_advanced` as informational signals.

#### Nurture (`packages/agents/src/agents/nurture/handler.ts`)

On requalification via `handleDisqualified()` (triggered by `lead.disqualified` events, not `message.received`). Note: `handleDisqualified` is currently synchronous — it must be changed to `async` to support the `await` call.

The Nurture requalification case operates on opportunities in `nurturing` stage, not `lost` stage. Therefore use `advanceOpportunityStage()` (which validates `nurturing → interested` as a valid transition) instead of `reopenOpportunity()` (which requires `stage === "lost"`):

```typescript
if (context.lifecycle && event.metadata?.lifecycleOpportunityId) {
  try {
    await context.lifecycle.advanceOpportunityStage(
      context.organizationId,
      event.metadata.lifecycleOpportunityId as string,
      "interested",
      "nurture",
    );
  } catch (err) {
    console.warn("Opportunity stage advancement failed", err);
  }
}
```

### 3.3 Remove Post-Processing Hack

Delete the stage advancement post-processing block at lines 180-211 of `apps/api/src/routes/conversation.ts`. This is a 31-line block that maps output event names to stage transitions:

```typescript
// REMOVE THIS ENTIRE BLOCK (lines 180-211):
// 6. Apply opportunity stage advancements from agent processing
if (resolvedContact && app.lifecycleDeps?.lifecycleService) {
  const lifecycleService = app.lifecycleDeps.lifecycleService;
  for (const agent of result.processed) {
    let targetStage: OpportunityStage | null = null;

    if (agent.outputEvents.includes("lead.qualified")) {
      targetStage = "qualified";
    } else if (
      agent.outputEvents.includes("opportunity.stage_advanced") &&
      agent.agentId === "sales-closer"
    ) {
      targetStage = "booked";
    }

    if (targetStage) {
      try {
        await lifecycleService.advanceOpportunityStage(
          orgId,
          resolvedContact.opportunity.id,
          targetStage,
          agent.agentId,
        );
      } catch (err) {
        app.log.warn(
          { err, targetStage, opportunityId: resolvedContact.opportunity.id },
          "Opportunity stage advancement skipped",
        );
      }
    }
  }
}
```

Agents now handle stage advancement themselves.

### 3.4 Wire Lifecycle Service into Agent Context

The `AgentContext` is constructed at the `eventLoop.process()` call site in `apps/api/src/routes/conversation.ts` (line 140), not in `agent-bootstrap.ts`. Update this call to include the lifecycle service:

```typescript
// apps/api/src/routes/conversation.ts, line 140
const result = await agentSystem.eventLoop.process(event, {
  organizationId: orgId,
  lifecycle: app.lifecycleDeps?.lifecycleService ?? undefined,
});
```

The `ContactLifecycleService` satisfies the `LifecycleAdvancer` interface structurally (duck typing) — no explicit cast needed.

### 3.5 Thread-Stage Routing Stays as Fallback

No changes to `ConversationRouter`. It already implements the correct priority:

1. Opportunity-based routing (if `opportunityStage` in metadata)
2. Thread-based routing (if thread store available)
3. Legacy lifecycle routing (last resort)

`agentForThreadStage()` remains deprecated but functional. Old leads without Contact/Opportunity data continue to route through the thread path.

### 3.6 Lifecycle Metadata Propagation

When agents emit output events that trigger downstream agents, they must propagate lifecycle metadata from the original event. Specifically, `lifecycleOpportunityId` and `lifecycleContactId` must be included in the metadata of emitted events so downstream agents can access the lifecycle service for their own stage transitions.

This applies to:

- LeadResponder emitting `lead.qualified` → consumed by SalesCloser
- LeadResponder emitting `lead.disqualified` → consumed by Nurture

Implementation: when constructing output event envelopes, spread lifecycle fields from `event.metadata`:

```typescript
const outputEvent = createEventEnvelope({
  // ... existing fields
  metadata: {
    ...existingMetadata,
    lifecycleOpportunityId: event.metadata?.lifecycleOpportunityId,
    lifecycleContactId: event.metadata?.lifecycleContactId,
  },
});
```

---

## 4. What Does NOT Change

- **Nurture's `opportunity.stage_advanced` inbound handler** — port declares it but handler ignores it; separate task
- **AdOptimizer's `opportunity.stage_advanced` inbound handler** — same; separate task
- **`outputEvents` format** — stays `string[]`, informational only
- **`stage.advanced` event type** — coexists with `opportunity.stage_advanced`, deprecated later
- **Old thread data** — no migration, no backfill
- **ContactResolver** — already works, no changes needed
- **`DEFAULT_STAGE_HANDLER_MAP`** — already correct

---

## 5. File Impact Summary

| File                                                   | Change                                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `packages/agents/src/ports.ts`                         | Add `LifecycleAdvancer` interface, add optional `lifecycle` field to `AgentContext`                            |
| `packages/agents/src/agents/lead-responder/handler.ts` | Call `advanceOpportunityStage("qualified")` after qualification; propagate lifecycle metadata to output events |
| `packages/agents/src/agents/sales-closer/handler.ts`   | Call `advanceOpportunityStage("booked")` after booking                                                         |
| `packages/agents/src/agents/nurture/handler.ts`        | Change `handleDisqualified` to async; call `advanceOpportunityStage("interested")` on requalification          |
| `apps/api/src/routes/conversation.ts`                  | Remove post-processing block (lines 180-211); pass `lifecycle` in `eventLoop.process()` context (line 140)     |

---

## 6. Testing Strategy

- **Unit tests per agent**: Mock `lifecycle` (satisfying `LifecycleAdvancer`), verify `advanceOpportunityStage()` is called with correct args (`context.organizationId`, opportunity ID, target stage, agent ID) on the right code path.
- **Graceful degradation tests**: Verify agents work correctly when `context.lifecycle` is `undefined` — no errors, no stage advancement, existing behavior preserved.
- **Regression**: Existing agent tests must continue to pass (lifecycle is optional, so old tests without it still work).
- **Integration**: Verify the conversation endpoint no longer has the post-processing block and that stage advancement happens via agent handlers instead.
- **Metadata propagation**: Verify `lifecycleOpportunityId` is included in output events from LeadResponder.

---

## 7. Risks & Mitigations

| Risk                                                                           | Mitigation                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Agent handler errors on `advanceOpportunityStage()` (e.g., invalid transition) | Wrap in try/catch with `console.warn`. Agent continues processing — stage advancement failure is non-fatal.          |
| Missing `lifecycleOpportunityId` in metadata                                   | Guard with `if` check. Old leads without lifecycle data skip advancement silently.                                   |
| `lifecycleOpportunityId` not propagated to downstream agents                   | Explicit metadata propagation in Section 3.6. LeadResponder includes lifecycle fields in emitted events.             |
| Thread-stage fallback gets stale over time                                     | Acceptable — new leads use lifecycle path. Thread routing naturally phases out as old leads go dormant.              |
| Nurture's `handleDisqualified` sync→async change                               | Minimal risk — adding `async` to a method that returns `AgentResponse` only requires updating the caller to `await`. |
