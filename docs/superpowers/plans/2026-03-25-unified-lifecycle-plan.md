# Unified Contact Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified Contact → Opportunity → Revenue pipeline with graceful fallback for partial agent bundles, replacing the fragmented thread-stage lifecycle model.

**Architecture:** New entities (Contact, Opportunity, LifecycleRevenueEvent, OwnerTask) in schemas/core/db layers. ContactLifecycleService as central authority for stage mutations. FallbackHandler creates structured OwnerTasks when agents are missing. ConversationRouter updated to route by opportunity stage instead of thread stage. Agents migrated to read/write opportunity stages.

**Tech Stack:** TypeScript (ESM), Zod, Prisma, Vitest, Fastify

**Spec:** `docs/superpowers/specs/2026-03-25-unified-lifecycle-design.md`

---

## File Structure

### New Files

| File                                                                  | Responsibility                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/lifecycle.ts`                                   | Zod schemas: ContactStage, OpportunityStage, ThreadStatus, TaskStatus, Contact, Opportunity, LifecycleRevenueEvent, OwnerTask, StageHandlerConfig, PipelineSnapshot |
| `packages/core/src/lifecycle/transition-validator.ts`                 | Opportunity stage transition graph + `validateTransition()`                                                                                                         |
| `packages/core/src/lifecycle/contact-stage-deriver.ts`                | `deriveContactStage()` pure function                                                                                                                                |
| `packages/core/src/lifecycle/contact-store.ts`                        | ContactStore interface                                                                                                                                              |
| `packages/core/src/lifecycle/opportunity-store.ts`                    | OpportunityStore interface                                                                                                                                          |
| `packages/core/src/lifecycle/revenue-store.ts`                        | RevenueStore interface                                                                                                                                              |
| `packages/core/src/lifecycle/owner-task-store.ts`                     | OwnerTaskStore interface                                                                                                                                            |
| `packages/core/src/lifecycle/lifecycle-types.ts`                      | Core-layer types: StageAdvancementResult, FallbackContext, FallbackResult (avoids importing from agents layer)                                                      |
| `packages/core/src/lifecycle/lifecycle-service.ts`                    | ContactLifecycleService implementation (returns plain data, NOT RoutedEventEnvelope — caller wraps into events)                                                     |
| `packages/core/src/lifecycle/fallback-handler.ts`                     | FallbackHandler — creates OwnerTasks + notifications for unrouted events (uses core-layer types only)                                                               |
| `packages/core/src/lifecycle/stage-handler-map.ts`                    | STAGE_HANDLER_MAP config + `agentForOpportunityStage()`                                                                                                             |
| `packages/core/src/lifecycle/index.ts`                                | Barrel exports                                                                                                                                                      |
| `packages/core/src/lifecycle/__tests__/transition-validator.test.ts`  | Transition validation tests                                                                                                                                         |
| `packages/core/src/lifecycle/__tests__/contact-stage-deriver.test.ts` | Contact stage derivation tests                                                                                                                                      |
| `packages/core/src/lifecycle/__tests__/lifecycle-service.test.ts`     | Lifecycle service tests                                                                                                                                             |
| `packages/core/src/lifecycle/__tests__/fallback-handler.test.ts`      | Fallback handler tests                                                                                                                                              |
| `packages/core/src/lifecycle/__tests__/stage-handler-map.test.ts`     | Agent routing + fallback detection tests                                                                                                                            |
| `packages/db/src/stores/prisma-contact-store.ts`                      | PrismaContactStore                                                                                                                                                  |
| `packages/db/src/stores/prisma-opportunity-store.ts`                  | PrismaOpportunityStore                                                                                                                                              |
| `packages/db/src/stores/prisma-revenue-store.ts`                      | PrismaRevenueStore                                                                                                                                                  |
| `packages/db/src/stores/prisma-owner-task-store.ts`                   | PrismaOwnerTaskStore                                                                                                                                                |
| `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`       | Contact store unit tests                                                                                                                                            |
| `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts`   | Opportunity store unit tests                                                                                                                                        |
| `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`       | Revenue store unit tests                                                                                                                                            |
| `packages/db/src/stores/__tests__/prisma-owner-task-store.test.ts`    | OwnerTask store unit tests                                                                                                                                          |
| `apps/api/src/bootstrap/lifecycle-deps.ts`                            | Factory: builds ContactLifecycleService + FallbackHandler from app dependencies                                                                                     |
| `apps/api/src/routes/lifecycle.ts`                                    | REST endpoints: contacts, opportunities, revenue, tasks, pipeline                                                                                                   |

### Modified Files

| File                                              | Change                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/index.ts`                   | Add `export * from "./lifecycle.js"`                                                                                                               |
| `packages/schemas/src/revenue-event.ts`           | Rename `RevenueEventSchema` → `LegacyRevenueEventSchema`, `RevenueEvent` → `LegacyRevenueEvent` (avoids naming conflict with new lifecycle schema) |
| `packages/agents/src/events.ts`                   | Remove `AttributionChain` interface (replaced by Zod-inferred type from `@switchboard/schemas`)                                                    |
| `packages/schemas/src/conversation-thread.ts`     | Add `ThreadStatusSchema`, `threadStatus` to ConversationThread. Keep `stage` for now (removed in Phase 3).                                         |
| `packages/core/src/index.ts`                      | Add `export * from "./lifecycle/index.js"`                                                                                                         |
| `packages/core/src/conversations/thread-store.ts` | Add `threadStatus` to update interface                                                                                                             |
| `packages/db/prisma/schema.prisma`                | Add Contact, Opportunity, LifecycleRevenueEvent, OwnerTask models. Add contactId, opportunityId, threadStatus to ConversationThread.               |
| `packages/db/src/index.ts`                        | Export new Prisma stores                                                                                                                           |
| `packages/agents/src/events.ts`                   | Add `"opportunity.stage_advanced"` to AGENT_EVENT_TYPES                                                                                            |
| `packages/agents/src/lifecycle.ts`                | Add `agentForOpportunityStage()` alongside existing functions                                                                                      |
| `packages/agents/src/conversation-router.ts`      | Update to use opportunity-based routing                                                                                                            |
| `packages/agents/src/index.ts`                    | Export new lifecycle functions                                                                                                                     |
| `apps/api/src/app.ts`                             | Register lifecycle routes, wire lifecycle deps                                                                                                     |
| `apps/api/src/routes/conversation.ts`             | Use FallbackHandler for escalateToOwner cases                                                                                                      |
| `skins/clinic.json`                               | Add stageDefinitions, dormancyThresholdDays, reopenWindowDays, fallbackSLA                                                                         |
| `skins/gym.json`                                  | Add stageDefinitions, dormancyThresholdDays, reopenWindowDays, fallbackSLA                                                                         |
| `skins/commerce.json`                             | Add stageDefinitions, dormancyThresholdDays, reopenWindowDays, fallbackSLA                                                                         |
| `skins/generic.json`                              | Add stageDefinitions, dormancyThresholdDays, reopenWindowDays, fallbackSLA                                                                         |

---

## Phase 1: Entity Model + Core Logic (Tasks 1-8)

### Task 1: Lifecycle Zod Schemas

**Files:**

- Create: `packages/schemas/src/lifecycle.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/lifecycle.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  ContactStageSchema,
  OpportunityStageSchema,
  ThreadStatusSchema,
  TaskStatusSchema,
  TaskPrioritySchema,
  ContactSchema,
  OpportunitySchema,
  LifecycleRevenueEventSchema,
  OwnerTaskSchema,
  AttributionChainSchema,
} from "../lifecycle.js";

describe("ContactStageSchema", () => {
  it.each(["new", "active", "customer", "retained", "dormant"])("accepts %s", (stage) => {
    expect(ContactStageSchema.parse(stage)).toBe(stage);
  });

  it("rejects invalid stage", () => {
    expect(() => ContactStageSchema.parse("invalid")).toThrow();
  });
});

describe("OpportunityStageSchema", () => {
  it.each(["interested", "qualified", "quoted", "booked", "showed", "won", "lost", "nurturing"])(
    "accepts %s",
    (stage) => {
      expect(OpportunityStageSchema.parse(stage)).toBe(stage);
    },
  );
});

describe("ThreadStatusSchema", () => {
  it.each(["open", "waiting_on_customer", "waiting_on_business", "stale", "closed"])(
    "accepts %s",
    (status) => {
      expect(ThreadStatusSchema.parse(status)).toBe(status);
    },
  );
});

describe("ContactSchema", () => {
  it("validates a complete contact", () => {
    const contact = {
      id: "c-1",
      organizationId: "org-1",
      name: "Jason",
      phone: "+6591234567",
      email: null,
      primaryChannel: "whatsapp",
      firstTouchChannel: "whatsapp",
      stage: "new",
      source: "instagram_ad",
      attribution: {
        fbclid: "abc123",
        gclid: null,
        ttclid: null,
        sourceCampaignId: "camp-1",
        sourceAdId: "ad-1",
        utmSource: "instagram",
        utmMedium: "paid",
        utmCampaign: "botox-promo",
      },
      roles: ["lead"],
      firstContactAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => ContactSchema.parse(contact)).not.toThrow();
  });

  it("defaults stage to new", () => {
    const minimal = {
      id: "c-1",
      organizationId: "org-1",
      primaryChannel: "whatsapp",
      roles: ["lead"],
      firstContactAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = ContactSchema.parse(minimal);
    expect(result.stage).toBe("new");
  });
});

describe("OpportunitySchema", () => {
  it("validates a complete opportunity", () => {
    const opp = {
      id: "o-1",
      organizationId: "org-1",
      contactId: "c-1",
      serviceId: "svc-botox",
      serviceName: "Botox",
      stage: "interested",
      timeline: "immediate",
      priceReadiness: "ready",
      objections: [],
      qualificationComplete: false,
      estimatedValue: 50000,
      revenueTotal: 0,
      assignedAgent: "lead-responder",
      assignedStaff: null,
      lostReason: null,
      notes: null,
      openedAt: new Date(),
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => OpportunitySchema.parse(opp)).not.toThrow();
  });
});

describe("LifecycleRevenueEventSchema", () => {
  it("validates a revenue event", () => {
    const event = {
      id: "r-1",
      organizationId: "org-1",
      contactId: "c-1",
      opportunityId: "o-1",
      amount: 50000,
      currency: "SGD",
      type: "payment",
      status: "confirmed",
      recordedBy: "owner",
      externalReference: null,
      verified: false,
      sourceCampaignId: "camp-1",
      sourceAdId: null,
      recordedAt: new Date(),
      createdAt: new Date(),
    };
    expect(() => LifecycleRevenueEventSchema.parse(event)).not.toThrow();
  });
});

describe("OwnerTaskSchema", () => {
  it("validates an owner task", () => {
    const task = {
      id: "t-1",
      organizationId: "org-1",
      contactId: "c-1",
      opportunityId: "o-1",
      type: "fallback_handoff",
      title: "Follow up qualified lead",
      description: "Jason qualified for Botox — no Sales Closer active",
      suggestedAction: "Call within 24h",
      status: "pending",
      priority: "high",
      triggerReason: "no_sales_closer_active",
      sourceAgent: "lead-responder",
      fallbackReason: "not_configured",
      dueAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
    };
    expect(() => OwnerTaskSchema.parse(task)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- lifecycle`
Expected: FAIL — module `../lifecycle.js` not found

- [ ] **Step 3: Write lifecycle schemas**

Create `packages/schemas/src/lifecycle.ts`:

```typescript
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ContactStageSchema = z.enum(["new", "active", "customer", "retained", "dormant"]);
export type ContactStage = z.infer<typeof ContactStageSchema>;

export const OpportunityStageSchema = z.enum([
  "interested",
  "qualified",
  "quoted",
  "booked",
  "showed",
  "won",
  "lost",
  "nurturing",
]);
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

export const TERMINAL_OPPORTUNITY_STAGES: OpportunityStage[] = ["won", "lost"];

export const ThreadStatusSchema = z.enum([
  "open",
  "waiting_on_customer",
  "waiting_on_business",
  "stale",
  "closed",
]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "dismissed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskTypeSchema = z.enum([
  "fallback_handoff",
  "approval_required",
  "manual_action",
  "review_needed",
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const RevenueTypeSchema = z.enum(["payment", "deposit", "invoice", "refund"]);
export type RevenueType = z.infer<typeof RevenueTypeSchema>;

export const RevenueStatusSchema = z.enum(["pending", "confirmed", "refunded", "failed"]);
export type RevenueStatus = z.infer<typeof RevenueStatusSchema>;

export const RecordedBySchema = z.enum(["owner", "staff", "stripe", "integration"]);
export type RecordedBy = z.infer<typeof RecordedBySchema>;

export const FallbackReasonSchema = z.enum(["not_configured", "paused", "errored"]);
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;

// ---------------------------------------------------------------------------
// Attribution Chain
// ---------------------------------------------------------------------------

export const AttributionChainSchema = z.object({
  fbclid: z.string().nullable(),
  gclid: z.string().nullable(),
  ttclid: z.string().nullable(),
  sourceCampaignId: z.string().nullable(),
  sourceAdId: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
});
export type AttributionChain = z.infer<typeof AttributionChainSchema>;

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export const ContactSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  primaryChannel: z.enum(["whatsapp", "telegram", "dashboard"]),
  firstTouchChannel: z.string().nullable().optional(),
  stage: ContactStageSchema.default("new"),
  source: z.string().nullable().optional(),
  attribution: AttributionChainSchema.nullable().optional(),
  roles: z.array(z.string()).default(["lead"]),
  firstContactAt: z.coerce.date(),
  lastActivityAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Contact = z.infer<typeof ContactSchema>;

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

export const ObjectionRecordSchema = z.object({
  category: z.string(),
  raisedAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable(),
});
export type ObjectionRecord = z.infer<typeof ObjectionRecordSchema>;

export const OpportunitySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  contactId: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  stage: OpportunityStageSchema.default("interested"),
  timeline: z.enum(["immediate", "soon", "exploring", "unknown"]).optional(),
  priceReadiness: z.enum(["ready", "flexible", "price_sensitive", "unknown"]).optional(),
  objections: z.array(ObjectionRecordSchema).default([]),
  qualificationComplete: z.boolean().default(false),
  estimatedValue: z.number().int().nullable().optional(),
  revenueTotal: z.number().int().default(0),
  assignedAgent: z.string().nullable().optional(),
  assignedStaff: z.string().nullable().optional(),
  lostReason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  openedAt: z.coerce.date(),
  closedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

// ---------------------------------------------------------------------------
// Lifecycle Revenue Event
// ---------------------------------------------------------------------------

export const LifecycleRevenueEventSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  contactId: z.string().min(1),
  opportunityId: z.string().min(1),
  amount: z.number().int(),
  currency: z.string().length(3).default("SGD"),
  type: RevenueTypeSchema,
  status: RevenueStatusSchema.default("confirmed"),
  recordedBy: RecordedBySchema,
  externalReference: z.string().nullable().optional(),
  verified: z.boolean().default(false),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
  recordedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type LifecycleRevenueEvent = z.infer<typeof LifecycleRevenueEventSchema>;

// ---------------------------------------------------------------------------
// Owner Task
// ---------------------------------------------------------------------------

export const OwnerTaskSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  contactId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
  type: TaskTypeSchema,
  title: z.string().min(1),
  description: z.string(),
  suggestedAction: z.string().nullable().optional(),
  status: TaskStatusSchema.default("pending"),
  priority: TaskPrioritySchema.default("medium"),
  triggerReason: z.string().min(1),
  sourceAgent: z.string().nullable().optional(),
  fallbackReason: FallbackReasonSchema.nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});
export type OwnerTask = z.infer<typeof OwnerTaskSchema>;

// ---------------------------------------------------------------------------
// Stage Handler Map Config (used by routing + fallback)
// ---------------------------------------------------------------------------

export const StageHandlerConfigSchema = z.object({
  preferredAgent: z.union([z.string(), z.array(z.string())]).nullable(),
  fallbackType: z.enum(["fallback_handoff", "none"]),
});
export type StageHandlerConfig = z.infer<typeof StageHandlerConfigSchema>;

// ---------------------------------------------------------------------------
// Pipeline Snapshot (query result for dashboard)
// ---------------------------------------------------------------------------

export const PipelineStageCountSchema = z.object({
  stage: OpportunityStageSchema,
  count: z.number().int().nonnegative(),
  totalValue: z.number().int().nonnegative(),
});
export type PipelineStageCount = z.infer<typeof PipelineStageCountSchema>;

export const PipelineSnapshotSchema = z.object({
  organizationId: z.string().min(1),
  stages: z.array(PipelineStageCountSchema),
  totalContacts: z.number().int().nonnegative(),
  totalRevenue: z.number().int().nonnegative(),
  generatedAt: z.coerce.date(),
});
export type PipelineSnapshot = z.infer<typeof PipelineSnapshotSchema>;
```

- [ ] **Step 4: Rename existing RevenueEvent to LegacyRevenueEvent**

In `packages/schemas/src/revenue-event.ts`, rename:

- `RevenueEventSchema` → `LegacyRevenueEventSchema`
- `RevenueEvent` → `LegacyRevenueEvent`
- `RevenueEventSourceSchema` → `LegacyRevenueEventSourceSchema`
- `RevenueEventSource` → `LegacyRevenueEventSource`

In `packages/schemas/src/index.ts`, update the existing re-export:

```typescript
export { LegacyRevenueEventSchema, LegacyRevenueEventSourceSchema } from "./revenue-event.js";
export type { LegacyRevenueEvent, LegacyRevenueEventSource } from "./revenue-event.js";
```

Then find and update all consumers of the old `RevenueEvent` type across the codebase. Run `pnpm typecheck` to find them.

- [ ] **Step 5: Remove AttributionChain interface from agents/events.ts**

In `packages/agents/src/events.ts`, remove the `AttributionChain` interface (lines 31-40). Replace with an import:

```typescript
import type { AttributionChain } from "@switchboard/schemas";
```

This is valid because agents (Layer 5) can import from schemas (Layer 1).

- [ ] **Step 6: Add barrel export**

Add to `packages/schemas/src/index.ts`:

```typescript
// Unified lifecycle (Contact, Opportunity, Revenue, OwnerTask)
export * from "./lifecycle.js";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test -- lifecycle`
Expected: PASS

- [ ] **Step 8: Run full typecheck to catch rename ripple**

Run: `pnpm typecheck`
Expected: PASS (all LegacyRevenueEvent renames propagated)

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: add lifecycle Zod schemas, rename existing RevenueEvent to Legacy"
```

---

### Task 2: Opportunity Stage Transition Validator

**Files:**

- Create: `packages/core/src/lifecycle/transition-validator.ts`
- Create: `packages/core/src/lifecycle/__tests__/transition-validator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/lifecycle/__tests__/transition-validator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateTransition, TRANSITION_GRAPH } from "../transition-validator.js";

describe("validateTransition", () => {
  describe("valid forward transitions", () => {
    it.each([
      ["interested", "qualified"],
      ["interested", "quoted"],
      ["interested", "booked"],
      ["interested", "lost"],
      ["interested", "nurturing"],
      ["qualified", "quoted"],
      ["qualified", "booked"],
      ["qualified", "lost"],
      ["qualified", "nurturing"],
      ["quoted", "booked"],
      ["quoted", "lost"],
      ["quoted", "nurturing"],
      ["booked", "showed"],
      ["booked", "lost"],
      ["booked", "nurturing"],
      ["showed", "won"],
      ["showed", "lost"],
      ["showed", "nurturing"],
    ] as const)("%s → %s is valid", (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(true);
    });
  });

  describe("re-engagement paths", () => {
    it.each([
      ["nurturing", "interested"],
      ["nurturing", "qualified"],
      ["nurturing", "lost"],
      ["lost", "nurturing"],
      ["lost", "interested"],
    ] as const)("%s → %s is valid", (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it.each([
      ["interested", "showed"],
      ["interested", "won"],
      ["qualified", "won"],
      ["qualified", "showed"],
      ["won", "interested"],
      ["won", "lost"],
      ["won", "nurturing"],
      ["booked", "interested"],
      ["booked", "qualified"],
      ["showed", "booked"],
      ["showed", "interested"],
    ] as const)("%s → %s is invalid", (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe("same-stage transition", () => {
    it("rejects same-stage", () => {
      const result = validateTransition("interested", "interested");
      expect(result.valid).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- transition-validator`
Expected: FAIL — module not found

- [ ] **Step 3: Write transition validator**

Create `packages/core/src/lifecycle/transition-validator.ts`:

```typescript
import type { OpportunityStage } from "@switchboard/schemas";

export interface TransitionResult {
  valid: boolean;
  reason?: string;
}

/** Explicitly enumerated valid transitions. Each key maps to the set of valid target stages. */
export const TRANSITION_GRAPH: Record<OpportunityStage, readonly OpportunityStage[]> = {
  interested: ["qualified", "quoted", "booked", "lost", "nurturing"],
  qualified: ["quoted", "booked", "lost", "nurturing"],
  quoted: ["booked", "lost", "nurturing"],
  booked: ["showed", "lost", "nurturing"],
  showed: ["won", "lost", "nurturing"],
  won: [],
  lost: ["nurturing", "interested"],
  nurturing: ["interested", "qualified", "lost"],
};

export function validateTransition(from: OpportunityStage, to: OpportunityStage): TransitionResult {
  if (from === to) {
    return { valid: false, reason: `Already in stage "${from}"` };
  }

  const validTargets = TRANSITION_GRAPH[from];
  if (validTargets.includes(to)) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `Invalid transition: "${from}" → "${to}". Valid targets: ${validTargets.join(", ") || "none (terminal)"}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- transition-validator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add opportunity stage transition validator"
```

---

### Task 3: Contact Stage Deriver

**Files:**

- Create: `packages/core/src/lifecycle/contact-stage-deriver.ts`
- Create: `packages/core/src/lifecycle/__tests__/contact-stage-deriver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/lifecycle/__tests__/contact-stage-deriver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveContactStage } from "../contact-stage-deriver.js";
import type { OpportunityStage } from "@switchboard/schemas";

function makeOpps(...stages: OpportunityStage[]) {
  return stages.map((stage) => ({ stage }));
}

const RECENT = new Date(); // now
const OLD = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago

describe("deriveContactStage", () => {
  it("returns 'new' when no opportunities", () => {
    expect(deriveContactStage([], RECENT, 30)).toBe("new");
  });

  it("returns 'active' when has non-terminal opportunity", () => {
    expect(deriveContactStage(makeOpps("interested"), RECENT, 30)).toBe("active");
  });

  it("returns 'active' for nurturing (non-terminal)", () => {
    expect(deriveContactStage(makeOpps("nurturing"), RECENT, 30)).toBe("active");
  });

  it("returns 'customer' when has won and no active opps and recent", () => {
    expect(deriveContactStage(makeOpps("won"), RECENT, 30)).toBe("customer");
  });

  it("returns 'retained' when has won AND active opps", () => {
    expect(deriveContactStage(makeOpps("won", "interested"), RECENT, 30)).toBe("retained");
  });

  it("returns 'dormant' when all terminal and inactive", () => {
    expect(deriveContactStage(makeOpps("lost"), OLD, 30)).toBe("dormant");
  });

  it("returns 'dormant' when won but inactive too long", () => {
    expect(deriveContactStage(makeOpps("won"), OLD, 30)).toBe("dormant");
  });

  it("returns 'active' when no active opps but recent activity (v1 approximation)", () => {
    expect(deriveContactStage(makeOpps("lost"), RECENT, 30)).toBe("active");
  });

  it("respects custom threshold", () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(deriveContactStage(makeOpps("lost"), thirtyOneDaysAgo, 30)).toBe("dormant");
    expect(deriveContactStage(makeOpps("lost"), thirtyOneDaysAgo, 60)).toBe("active");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- contact-stage-deriver`
Expected: FAIL

- [ ] **Step 3: Write deriver**

Create `packages/core/src/lifecycle/contact-stage-deriver.ts`:

```typescript
import type { ContactStage, OpportunityStage } from "@switchboard/schemas";

interface OpportunityStageSummary {
  stage: OpportunityStage;
}

const TERMINAL_STAGES: OpportunityStage[] = ["won", "lost"];

export function deriveContactStage(
  opportunities: OpportunityStageSummary[],
  lastActivityAt: Date,
  thresholdDays: number,
): ContactStage {
  if (opportunities.length === 0) {
    return "new";
  }

  const hasWon = opportunities.some((o) => o.stage === "won");
  const hasActive = opportunities.some((o) => !TERMINAL_STAGES.includes(o.stage));
  const daysSinceActivity = (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
  const isRecent = daysSinceActivity < thresholdDays;

  if (hasWon && hasActive) return "retained";
  if (hasWon && !hasActive && isRecent) return "customer";
  if (hasWon && !hasActive && !isRecent) return "dormant";
  if (!hasWon && hasActive) return "active";
  // v1 approximation: recent activity but no active opps — still considered active
  if (!hasWon && !hasActive && isRecent) return "active";
  return "dormant";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- contact-stage-deriver`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add contact stage derivation function"
```

---

### Task 4: Store Interfaces

**Files:**

- Create: `packages/core/src/lifecycle/contact-store.ts`
- Create: `packages/core/src/lifecycle/opportunity-store.ts`
- Create: `packages/core/src/lifecycle/revenue-store.ts`
- Create: `packages/core/src/lifecycle/owner-task-store.ts`

- [ ] **Step 1: Write store interfaces**

Create `packages/core/src/lifecycle/contact-store.ts`:

```typescript
import type { Contact, ContactStage } from "@switchboard/schemas";

export interface CreateContactInput {
  organizationId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  primaryChannel: "whatsapp" | "telegram" | "dashboard";
  firstTouchChannel?: string | null;
  source?: string | null;
  attribution?: Record<string, unknown> | null;
  roles?: string[];
}

export interface ContactFilters {
  stage?: ContactStage;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface ContactStore {
  create(input: CreateContactInput): Promise<Contact>;
  findById(orgId: string, id: string): Promise<Contact | null>;
  findByPhone(orgId: string, phone: string): Promise<Contact | null>;
  updateStage(orgId: string, id: string, stage: ContactStage): Promise<Contact>;
  updateLastActivity(orgId: string, id: string): Promise<void>;
  list(orgId: string, filters?: ContactFilters): Promise<Contact[]>;
}
```

Create `packages/core/src/lifecycle/opportunity-store.ts`:

```typescript
import type { Opportunity, OpportunityStage } from "@switchboard/schemas";

export interface CreateOpportunityInput {
  organizationId: string;
  contactId: string;
  serviceId: string;
  serviceName: string;
  estimatedValue?: number | null;
  assignedAgent?: string | null;
}

export interface OpportunityStore {
  create(input: CreateOpportunityInput): Promise<Opportunity>;
  findById(orgId: string, id: string): Promise<Opportunity | null>;
  findByContact(orgId: string, contactId: string): Promise<Opportunity[]>;
  findActiveByContact(orgId: string, contactId: string): Promise<Opportunity[]>;
  updateStage(
    orgId: string,
    id: string,
    stage: OpportunityStage,
    closedAt?: Date,
  ): Promise<Opportunity>;
  updateRevenueTotal(orgId: string, id: string): Promise<void>;
  countByStage(
    orgId: string,
  ): Promise<Array<{ stage: OpportunityStage; count: number; totalValue: number }>>;
}
```

Create `packages/core/src/lifecycle/revenue-store.ts`:

```typescript
import type { LifecycleRevenueEvent } from "@switchboard/schemas";

export interface RecordRevenueInput {
  organizationId: string;
  contactId: string;
  opportunityId: string;
  amount: number;
  currency?: string;
  type: "payment" | "deposit" | "invoice" | "refund";
  status?: "pending" | "confirmed" | "refunded" | "failed";
  recordedBy: "owner" | "staff" | "stripe" | "integration";
  externalReference?: string | null;
  verified?: boolean;
  sourceCampaignId?: string | null;
  sourceAdId?: string | null;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface RevenueSummary {
  totalAmount: number;
  count: number;
}

export interface CampaignRevenueSummary {
  sourceCampaignId: string;
  totalAmount: number;
  count: number;
}

export interface RevenueStore {
  record(input: RecordRevenueInput): Promise<LifecycleRevenueEvent>;
  findByOpportunity(orgId: string, opportunityId: string): Promise<LifecycleRevenueEvent[]>;
  sumByOrg(orgId: string, dateRange?: DateRange): Promise<RevenueSummary>;
  sumByCampaign(orgId: string, dateRange?: DateRange): Promise<CampaignRevenueSummary[]>;
}
```

Create `packages/core/src/lifecycle/owner-task-store.ts`:

```typescript
import type { OwnerTask, TaskStatus } from "@switchboard/schemas";

export interface CreateOwnerTaskInput {
  organizationId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  type: "fallback_handoff" | "approval_required" | "manual_action" | "review_needed";
  title: string;
  description: string;
  suggestedAction?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  triggerReason: string;
  sourceAgent?: string | null;
  fallbackReason?: "not_configured" | "paused" | "errored" | null;
  dueAt?: Date | null;
}

export interface OwnerTaskStore {
  create(input: CreateOwnerTaskInput): Promise<OwnerTask>;
  findPending(orgId: string): Promise<OwnerTask[]>;
  updateStatus(
    orgId: string,
    id: string,
    status: TaskStatus,
    completedAt?: Date,
  ): Promise<OwnerTask>;
  autoComplete(orgId: string, opportunityId: string, reason: string): Promise<number>;
}
```

- [ ] **Step 2: Create barrel export**

Create `packages/core/src/lifecycle/index.ts`:

```typescript
export { validateTransition, TRANSITION_GRAPH } from "./transition-validator.js";
export type { TransitionResult } from "./transition-validator.js";
export { deriveContactStage } from "./contact-stage-deriver.js";
export type { ContactStore, CreateContactInput, ContactFilters } from "./contact-store.js";
export type { OpportunityStore, CreateOpportunityInput } from "./opportunity-store.js";
export type {
  RevenueStore,
  RecordRevenueInput,
  DateRange,
  RevenueSummary,
  CampaignRevenueSummary,
} from "./revenue-store.js";
export type { OwnerTaskStore, CreateOwnerTaskInput } from "./owner-task-store.js";
export type {
  StageAdvancementResult,
  RevenueRecordedData,
  ContactDetail,
} from "./lifecycle-types.js";
```

- [ ] **Step 3: Add to core barrel**

Add to `packages/core/src/index.ts`:

```typescript
// Lifecycle (Contact, Opportunity, Revenue, OwnerTask)
export * from "./lifecycle/index.js";
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add lifecycle store interfaces (Contact, Opportunity, Revenue, OwnerTask)"
```

---

### Task 5: Stage Handler Map + agentForOpportunityStage

**Files:**

- Create: `packages/core/src/lifecycle/stage-handler-map.ts`
- Create: `packages/core/src/lifecycle/__tests__/stage-handler-map.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/lifecycle/__tests__/stage-handler-map.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DEFAULT_STAGE_HANDLER_MAP, agentForOpportunityStage } from "../stage-handler-map.js";

describe("DEFAULT_STAGE_HANDLER_MAP", () => {
  it("maps all opportunity stages", () => {
    const stages = [
      "interested",
      "qualified",
      "quoted",
      "booked",
      "showed",
      "won",
      "lost",
      "nurturing",
    ];
    for (const stage of stages) {
      expect(
        DEFAULT_STAGE_HANDLER_MAP[stage as keyof typeof DEFAULT_STAGE_HANDLER_MAP],
      ).toBeDefined();
    }
  });

  it("booked has system handler and no fallback", () => {
    expect(DEFAULT_STAGE_HANDLER_MAP.booked.preferredAgent).toBe("system");
    expect(DEFAULT_STAGE_HANDLER_MAP.booked.fallbackType).toBe("none");
  });
});

describe("agentForOpportunityStage", () => {
  const mockRegistry = {
    get: (orgId: string, agentId: string) => {
      if (agentId === "lead-responder") return { status: "active" };
      if (agentId === "sales-closer") return { status: "paused" };
      return undefined;
    },
  } as any;

  it("returns agentId when preferred agent is active", () => {
    const result = agentForOpportunityStage(
      "interested",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
    );
    expect(result).toEqual({ agentId: "lead-responder" });
  });

  it("returns fallback when preferred agent is paused", () => {
    const result = agentForOpportunityStage(
      "qualified",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
    );
    expect(result).toEqual({
      fallback: true,
      missingAgent: "sales-closer",
      reason: "paused",
    });
  });

  it("returns fallback with not_configured when agent does not exist", () => {
    const result = agentForOpportunityStage(
      "nurturing",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
    );
    expect(result).toEqual({
      fallback: true,
      missingAgent: "nurture",
      reason: "not_configured",
    });
  });

  it("returns system handler for booked stage", () => {
    const result = agentForOpportunityStage(
      "booked",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
    );
    expect(result).toEqual({ agentId: "system" });
  });

  it("suppresses dispatch when threadStatus is waiting_on_customer", () => {
    const result = agentForOpportunityStage(
      "interested",
      DEFAULT_STAGE_HANDLER_MAP,
      mockRegistry,
      "org-1",
      "waiting_on_customer",
    );
    expect(result).toEqual({ suppress: true, reason: "waiting_on_customer" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- stage-handler-map`
Expected: FAIL

- [ ] **Step 3: Write stage handler map**

Create `packages/core/src/lifecycle/stage-handler-map.ts`:

```typescript
import type { OpportunityStage, StageHandlerConfig, ThreadStatus } from "@switchboard/schemas";

export type StageHandlerMap = Record<OpportunityStage, StageHandlerConfig>;

export const DEFAULT_STAGE_HANDLER_MAP: StageHandlerMap = {
  interested: { preferredAgent: "lead-responder", fallbackType: "fallback_handoff" },
  qualified: { preferredAgent: "sales-closer", fallbackType: "fallback_handoff" },
  quoted: { preferredAgent: "sales-closer", fallbackType: "fallback_handoff" },
  booked: { preferredAgent: "system", fallbackType: "none" },
  showed: { preferredAgent: "revenue-tracker", fallbackType: "fallback_handoff" },
  won: { preferredAgent: "revenue-tracker", fallbackType: "fallback_handoff" },
  lost: { preferredAgent: "nurture", fallbackType: "fallback_handoff" },
  nurturing: { preferredAgent: "nurture", fallbackType: "fallback_handoff" },
};

interface AgentRegistryLike {
  get(orgId: string, agentId: string): { status: string } | undefined;
}

type RoutingResult =
  | { agentId: string }
  | { fallback: true; missingAgent: string; reason: "not_configured" | "paused" | "errored" }
  | { suppress: true; reason: string };

export function agentForOpportunityStage(
  stage: OpportunityStage,
  stageHandlerMap: StageHandlerMap,
  registry: AgentRegistryLike,
  orgId: string,
  threadStatus?: ThreadStatus,
): RoutingResult {
  // Suppress proactive dispatch when waiting on customer
  if (threadStatus === "waiting_on_customer") {
    return { suppress: true, reason: "waiting_on_customer" };
  }

  const config = stageHandlerMap[stage];
  const preferred = config.preferredAgent;

  if (preferred === null) {
    return { fallback: true, missingAgent: "unknown", reason: "not_configured" };
  }

  // System handler (e.g., booked stage) — always available
  if (preferred === "system") {
    return { agentId: "system" };
  }

  const agents = Array.isArray(preferred) ? preferred : [preferred];

  for (const agentId of agents) {
    const entry = registry.get(orgId, agentId);
    if (entry?.status === "active") {
      return { agentId };
    }
  }

  // No active agent found — determine reason from first preferred
  const firstAgent = agents[0];
  const entry = registry.get(orgId, firstAgent);

  if (!entry) {
    return { fallback: true, missingAgent: firstAgent, reason: "not_configured" };
  }
  if (entry.status === "paused") {
    return { fallback: true, missingAgent: firstAgent, reason: "paused" };
  }
  return { fallback: true, missingAgent: firstAgent, reason: "errored" };
}
```

- [ ] **Step 4: Update barrel export**

Add to `packages/core/src/lifecycle/index.ts`:

```typescript
export { DEFAULT_STAGE_HANDLER_MAP, agentForOpportunityStage } from "./stage-handler-map.js";
export type { StageHandlerMap } from "./stage-handler-map.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- stage-handler-map`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add stage handler map and agentForOpportunityStage routing"
```

---

### Task 6: Prisma Models + Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add new models to Prisma schema**

Add to `packages/db/prisma/schema.prisma`:

```prisma
model Contact {
  id                String    @id @default(uuid())
  organizationId    String
  name              String?
  phone             String?
  email             String?
  primaryChannel    String    @default("whatsapp")
  firstTouchChannel String?
  stage             String    @default("new")
  source            String?
  attribution       Json?
  roles             String[]  @default(["lead"])
  firstContactAt    DateTime  @default(now())
  lastActivityAt    DateTime  @default(now())
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  opportunities     Opportunity[]
  revenueEvents     LifecycleRevenueEvent[]
  ownerTasks        OwnerTask[]

  @@index([organizationId])
  @@index([organizationId, stage])
  @@index([organizationId, phone])
  @@index([organizationId, lastActivityAt])
}

model Opportunity {
  id                    String    @id @default(uuid())
  organizationId        String
  contactId             String
  contact               Contact   @relation(fields: [contactId], references: [id])
  serviceId             String
  serviceName           String
  stage                 String    @default("interested")
  timeline              String?
  priceReadiness        String?
  objections            Json      @default("[]")
  qualificationComplete Boolean   @default(false)
  estimatedValue        Int?
  revenueTotal          Int       @default(0)
  assignedAgent         String?
  assignedStaff         String?
  lostReason            String?
  notes                 String?
  openedAt              DateTime  @default(now())
  closedAt              DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  revenueEvents         LifecycleRevenueEvent[]
  ownerTasks            OwnerTask[]

  @@index([organizationId])
  @@index([organizationId, stage])
  @@index([contactId])
}

model LifecycleRevenueEvent {
  id                String    @id @default(uuid())
  organizationId    String
  contactId         String
  contact           Contact   @relation(fields: [contactId], references: [id])
  opportunityId     String
  opportunity       Opportunity @relation(fields: [opportunityId], references: [id])
  amount            Int
  currency          String    @default("SGD")
  type              String
  status            String    @default("confirmed")
  recordedBy        String
  externalReference String?
  verified          Boolean   @default(false)
  sourceCampaignId  String?
  sourceAdId        String?
  recordedAt        DateTime  @default(now())
  createdAt         DateTime  @default(now())

  @@index([organizationId])
  @@index([opportunityId])
  @@index([organizationId, recordedAt])
}

model OwnerTask {
  id              String    @id @default(uuid())
  organizationId  String
  contactId       String?
  contact         Contact?  @relation(fields: [contactId], references: [id])
  opportunityId   String?
  opportunity     Opportunity? @relation(fields: [opportunityId], references: [id])
  type            String
  title           String
  description     String
  suggestedAction String?
  status          String    @default("pending")
  priority        String    @default("medium")
  triggerReason   String
  sourceAgent     String?
  fallbackReason  String?
  dueAt           DateTime?
  completedAt     DateTime?
  createdAt       DateTime  @default(now())

  @@index([organizationId, status])
  @@index([organizationId, priority])
}
```

- [ ] **Step 2: Add threadStatus and opportunityId to ConversationThread**

In the existing `ConversationThread` model in `packages/db/prisma/schema.prisma`, add:

```prisma
  threadStatus    String    @default("open")
  opportunityId   String?
```

Note: `contactId` already exists on ConversationThread (it's the primary lookup key). Add a `Contact` relation to the existing `contactId` field:

```prisma
  contact         Contact?  @relation(fields: [contactId], references: [id])
```

The existing `contactId` is reused as the FK to the new `Contact` model — no separate `lifecycleContactId` needed. During migration (Task 15), existing thread contactIds will be matched to Contact records.

- [ ] **Step 3: Generate and run migration**

Run:

```bash
pnpm db:generate
pnpm db:migrate -- --name add-lifecycle-entities
```

Expected: Migration created and applied

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add Prisma models for Contact, Opportunity, RevenueEvent, OwnerTask"
```

---

### Task 7: Prisma Store Implementations

**Files:**

- Create: `packages/db/src/stores/prisma-contact-store.ts`
- Create: `packages/db/src/stores/prisma-opportunity-store.ts`
- Create: `packages/db/src/stores/prisma-revenue-store.ts`
- Create: `packages/db/src/stores/prisma-owner-task-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-contact-store.test.ts`
- Create: `packages/db/src/stores/__tests__/prisma-opportunity-store.test.ts`
- Create: `packages/db/src/stores/__tests__/prisma-revenue-store.test.ts`
- Create: `packages/db/src/stores/__tests__/prisma-owner-task-store.test.ts`
- Modify: `packages/db/src/index.ts`

This task is large — the implementer should follow the existing `PrismaWorkflowStore` pattern in `packages/db/src/stores/prisma-workflow-store.ts` for structure. Each store method maps to a Prisma query. Tests use mocked Prisma client (see existing test patterns).

- [ ] **Step 1: Write PrismaContactStore tests**

Follow the pattern from `packages/db/src/stores/__tests__/prisma-workflow-store.test.ts`. Test each method: `create`, `findById`, `findByPhone`, `updateStage`, `updateLastActivity`, `list`.

- [ ] **Step 2: Implement PrismaContactStore**

Standard Prisma CRUD. `create()` generates UUID, sets timestamps. `findByPhone` uses `@@index([organizationId, phone])`.

- [ ] **Step 3: Run ContactStore tests**

Run: `pnpm --filter @switchboard/db test -- prisma-contact-store`
Expected: PASS

- [ ] **Step 4: Write + implement PrismaOpportunityStore**

Methods: `create`, `findById`, `findByContact`, `findActiveByContact` (where stage NOT IN won, lost), `updateStage`, `updateRevenueTotal` (aggregate SUM from LifecycleRevenueEvent), `countByStage` (GROUP BY stage).

- [ ] **Step 5: Run OpportunityStore tests**

Run: `pnpm --filter @switchboard/db test -- prisma-opportunity-store`
Expected: PASS

- [ ] **Step 6: Write + implement PrismaRevenueStore**

Methods: `record`, `findByOpportunity`, `sumByOrg` (aggregate SUM with optional date range), `sumByCampaign` (GROUP BY sourceCampaignId).

- [ ] **Step 7: Run RevenueStore tests**

Run: `pnpm --filter @switchboard/db test -- prisma-revenue-store`
Expected: PASS

- [ ] **Step 8: Write + implement PrismaOwnerTaskStore**

Methods: `create`, `findPending` (where status = pending, ordered by priority + createdAt), `updateStatus`, `autoComplete` (update all pending tasks for opportunityId to completed).

- [ ] **Step 9: Run OwnerTaskStore tests**

Run: `pnpm --filter @switchboard/db test -- prisma-owner-task-store`
Expected: PASS

- [ ] **Step 10: Add exports to db barrel**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaContactStore } from "./stores/prisma-contact-store.js";
export { PrismaOpportunityStore } from "./stores/prisma-opportunity-store.js";
export { PrismaRevenueStore } from "./stores/prisma-revenue-store.js";
export { PrismaOwnerTaskStore } from "./stores/prisma-owner-task-store.js";
```

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: add Prisma store implementations for lifecycle entities"
```

---

### Task 8: ContactLifecycleService

**Files:**

- Create: `packages/core/src/lifecycle/lifecycle-service.ts`
- Create: `packages/core/src/lifecycle/__tests__/lifecycle-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/lifecycle/__tests__/lifecycle-service.test.ts`. Test scenarios:

1. `createContact()` — creates contact, returns with stage "new"
2. `createOpportunity()` — creates opportunity, refreshes contact stage to "active"
3. `advanceOpportunityStage()` — valid transition: updates stage, emits event, refreshes contact
4. `advanceOpportunityStage()` — invalid transition: throws with reason
5. `advanceOpportunityStage()` to "won": sets closedAt, refreshes contact to "customer"
6. `recordRevenue()` — creates event, updates opportunity revenueTotal, auto-advances showed→won
7. `recordRevenue()` — from "booked" stage: records revenue but does NOT auto-advance
8. `reopenOpportunity()` — within window: succeeds
9. `getPipeline()` — returns stage counts and totals

Use in-memory store implementations for tests (simple Map-based stores implementing the interfaces).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- lifecycle-service`
Expected: FAIL

- [ ] **Step 3: Write ContactLifecycleService**

First, create `packages/core/src/lifecycle/lifecycle-types.ts` with core-layer types that avoid importing from `@switchboard/agents`:

```typescript
import type { Opportunity, OpportunityStage, Contact } from "@switchboard/schemas";

/** Plain data returned by advanceOpportunityStage — caller wraps into event envelope at apps layer */
export interface StageAdvancementResult {
  opportunity: Opportunity;
  advancementData: {
    contactId: string;
    opportunityId: string;
    fromStage: OpportunityStage;
    toStage: OpportunityStage;
    serviceName: string;
    advancedBy: string;
  };
}

/** Contact with its opportunities — query result type */
export interface ContactDetail {
  contact: Contact;
  opportunities: Opportunity[];
}

/** Plain data returned by recordRevenue — caller wraps into event envelope at apps layer */
export interface RevenueRecordedData {
  contactId: string;
  opportunityId: string;
  amount: number;
  currency: string;
  type: string;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
}
```

Then create `packages/core/src/lifecycle/lifecycle-service.ts`:

```typescript
import type {
  Contact,
  Opportunity,
  OpportunityStage,
  LifecycleRevenueEvent,
  PipelineSnapshot,
} from "@switchboard/schemas";
import type { ContactStore, CreateContactInput } from "./contact-store.js";
import type { OpportunityStore, CreateOpportunityInput } from "./opportunity-store.js";
import type { RevenueStore, RecordRevenueInput } from "./revenue-store.js";
import type { OwnerTaskStore } from "./owner-task-store.js";
import { validateTransition } from "./transition-validator.js";
import { deriveContactStage } from "./contact-stage-deriver.js";
import type {
  StageAdvancementResult,
  RevenueRecordedData,
  ContactDetail,
} from "./lifecycle-types.js";

export interface ContactLifecycleServiceConfig {
  contactStore: ContactStore;
  opportunityStore: OpportunityStore;
  revenueStore: RevenueStore;
  ownerTaskStore: OwnerTaskStore;
  defaultDormancyThresholdDays?: number;
  defaultReopenWindowDays?: number;
}

export class ContactLifecycleService {
  private contactStore: ContactStore;
  private opportunityStore: OpportunityStore;
  private revenueStore: RevenueStore;
  private _ownerTaskStore: OwnerTaskStore;
  private dormancyThresholdDays: number;
  private reopenWindowDays: number;

  constructor(config: ContactLifecycleServiceConfig) {
    this.contactStore = config.contactStore;
    this.opportunityStore = config.opportunityStore;
    this.revenueStore = config.revenueStore;
    this._ownerTaskStore = config.ownerTaskStore;
    this.dormancyThresholdDays = config.defaultDormancyThresholdDays ?? 30;
    this.reopenWindowDays = config.defaultReopenWindowDays ?? 90;
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    return this.contactStore.create(input);
  }

  async getContact(orgId: string, contactId: string): Promise<Contact | null> {
    return this.contactStore.findById(orgId, contactId);
  }

  async findContactByPhone(orgId: string, phone: string): Promise<Contact | null> {
    return this.contactStore.findByPhone(orgId, phone);
  }

  async refreshContactStage(orgId: string, contactId: string): Promise<Contact> {
    const contact = await this.contactStore.findById(orgId, contactId);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);

    const opportunities = await this.opportunityStore.findByContact(orgId, contactId);
    const newStage = deriveContactStage(
      opportunities,
      contact.lastActivityAt,
      this.dormancyThresholdDays,
    );

    if (newStage !== contact.stage) {
      return this.contactStore.updateStage(orgId, contactId, newStage);
    }
    return contact;
  }

  async createOpportunity(input: CreateOpportunityInput): Promise<Opportunity> {
    const opportunity = await this.opportunityStore.create(input);
    await this.contactStore.updateLastActivity(input.organizationId, input.contactId);
    await this.refreshContactStage(input.organizationId, input.contactId);
    return opportunity;
  }

  async advanceOpportunityStage(
    orgId: string,
    opportunityId: string,
    toStage: OpportunityStage,
    advancedBy: string,
  ): Promise<StageAdvancementResult> {
    const opportunity = await this.opportunityStore.findById(orgId, opportunityId);
    if (!opportunity) throw new Error(`Opportunity not found: ${opportunityId}`);

    const result = validateTransition(opportunity.stage as OpportunityStage, toStage);
    if (!result.valid) {
      throw new Error(result.reason);
    }

    const closedAt = toStage === "won" ? new Date() : undefined;
    const updated = await this.opportunityStore.updateStage(
      orgId,
      opportunityId,
      toStage,
      closedAt,
    );
    await this.contactStore.updateLastActivity(orgId, opportunity.contactId);
    await this.refreshContactStage(orgId, opportunity.contactId);

    // Return plain data — caller at apps layer wraps into RoutedEventEnvelope
    return {
      opportunity: updated,
      advancementData: {
        contactId: opportunity.contactId,
        opportunityId,
        fromStage: opportunity.stage as OpportunityStage,
        toStage,
        serviceName: opportunity.serviceName,
        advancedBy,
      },
    };
  }

  async reopenOpportunity(
    orgId: string,
    opportunityId: string,
    toStage: "interested" | "qualified",
  ): Promise<Opportunity> {
    const opportunity = await this.opportunityStore.findById(orgId, opportunityId);
    if (!opportunity) throw new Error(`Opportunity not found: ${opportunityId}`);

    if (opportunity.stage !== "lost") {
      throw new Error(`Can only reopen lost opportunities, current stage: ${opportunity.stage}`);
    }

    if (opportunity.closedAt) {
      const daysSinceClosed =
        (Date.now() - new Date(opportunity.closedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceClosed > this.reopenWindowDays) {
        throw new Error(
          `Reopen window expired (${Math.floor(daysSinceClosed)} days > ${this.reopenWindowDays} day limit). Create a new opportunity instead.`,
        );
      }
    }

    const result = validateTransition("lost", toStage);
    if (!result.valid) throw new Error(result.reason);

    const updated = await this.opportunityStore.updateStage(orgId, opportunityId, toStage);
    await this.refreshContactStage(orgId, opportunity.contactId);
    return updated;
  }

  async recordRevenue(input: RecordRevenueInput): Promise<{
    revenueEvent: LifecycleRevenueEvent;
    revenueData: RevenueRecordedData;
    stageAdvancement: StageAdvancementResult | null;
  }> {
    const opportunity = await this.opportunityStore.findById(
      input.organizationId,
      input.opportunityId,
    );
    if (!opportunity) throw new Error(`Opportunity not found: ${input.opportunityId}`);

    const revenueEvent = await this.revenueStore.record(input);
    await this.opportunityStore.updateRevenueTotal(input.organizationId, input.opportunityId);

    // Auto-advance showed → won on revenue recording
    let stageAdvancement: StageAdvancementResult | null = null;
    if (opportunity.stage === "showed") {
      stageAdvancement = await this.advanceOpportunityStage(
        input.organizationId,
        input.opportunityId,
        "won",
        "system",
      );
    }

    await this.contactStore.updateLastActivity(input.organizationId, input.contactId);
    await this.refreshContactStage(input.organizationId, input.contactId);

    // Return plain data — caller wraps into "revenue.recorded" event at apps layer
    const revenueData: RevenueRecordedData = {
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      amount: input.amount,
      currency: input.currency ?? "SGD",
      type: input.type,
      sourceCampaignId: input.sourceCampaignId ?? null,
      sourceAdId: input.sourceAdId ?? null,
    };

    return { revenueEvent, revenueData, stageAdvancement };
  }

  async getPipeline(orgId: string): Promise<PipelineSnapshot> {
    const stageCounts = await this.opportunityStore.countByStage(orgId);
    const revenue = await this.revenueStore.sumByOrg(orgId);

    return {
      organizationId: orgId,
      stages: stageCounts.map((s) => ({
        stage: s.stage,
        count: s.count,
        totalValue: s.totalValue,
      })),
      totalContacts: stageCounts.reduce((sum, s) => sum + s.count, 0),
      totalRevenue: revenue.totalAmount,
      generatedAt: new Date(),
    };
  }

  async getContactWithOpportunities(
    orgId: string,
    contactId: string,
  ): Promise<ContactDetail | null> {
    const contact = await this.contactStore.findById(orgId, contactId);
    if (!contact) return null;
    const opportunities = await this.opportunityStore.findByContact(orgId, contactId);
    return { contact, opportunities };
  }
}
```

- [ ] **Step 4: Update barrel export**

Add to `packages/core/src/lifecycle/index.ts`:

```typescript
export type { StageAdvancementResult, RevenueRecordedData } from "./lifecycle-types.js";
export { ContactLifecycleService } from "./lifecycle-service.js";
export type { ContactLifecycleServiceConfig } from "./lifecycle-service.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- lifecycle-service`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: implement ContactLifecycleService"
```

---

## Phase 2: Fallback Handler + Wiring (Tasks 9-12)

### Task 9: FallbackHandler

**Files:**

- Create: `packages/core/src/lifecycle/fallback-handler.ts`
- Create: `packages/core/src/lifecycle/__tests__/fallback-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Test scenarios:

1. Creates OwnerTask with correct type, title, description from event context
2. Sets priority based on opportunity stage + estimated value
3. Sets dueAt based on fallback SLA config
4. Includes fallback reason (not_configured vs paused vs errored)
5. Returns notification list (dashboard + whatsapp if configured)
6. Does nothing when fallbackType is "none" (booked stage)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- fallback-handler`
Expected: FAIL

- [ ] **Step 3: Implement FallbackHandler**

Create `packages/core/src/lifecycle/fallback-handler.ts`:

```typescript
import type {
  Contact,
  Opportunity,
  OwnerTask,
  TaskPriority,
  OpportunityStage,
  FallbackReason,
} from "@switchboard/schemas";
import type { OwnerTaskStore, CreateOwnerTaskInput } from "./owner-task-store.js";
import type { Message } from "../conversation-store.js";
import type { StageHandlerMap } from "./stage-handler-map.js";

export interface FallbackContext {
  contact: Contact;
  opportunity: Opportunity | null;
  recentMessages: Message[];
  missingCapability: string;
  fallbackReason: FallbackReason;
}

export interface FallbackNotification {
  channel: "dashboard" | "whatsapp";
  recipientId: string;
  message: string;
}

export interface FallbackResult {
  task: OwnerTask | null;
  notifications: FallbackNotification[];
}

export interface FallbackSLAConfig {
  urgent?: number;
  high?: number;
  medium?: number;
  low?: number;
}

const DEFAULT_SLA: Required<FallbackSLAConfig> = {
  urgent: 4,
  high: 12,
  medium: 24,
  low: 72,
};

export interface FallbackHandlerConfig {
  ownerTaskStore: OwnerTaskStore;
  stageHandlerMap: StageHandlerMap;
  slaConfig?: FallbackSLAConfig;
  highValueThreshold?: number;
}

export class FallbackHandler {
  private ownerTaskStore: OwnerTaskStore;
  private stageHandlerMap: StageHandlerMap;
  private slaConfig: Required<FallbackSLAConfig>;
  private highValueThreshold: number;

  constructor(config: FallbackHandlerConfig) {
    this.ownerTaskStore = config.ownerTaskStore;
    this.stageHandlerMap = config.stageHandlerMap;
    this.slaConfig = { ...DEFAULT_SLA, ...config.slaConfig };
    this.highValueThreshold = config.highValueThreshold ?? 100_000; // $1000 in cents
  }

  async handleUnrouted(context: FallbackContext): Promise<FallbackResult> {
    const { contact, opportunity, missingCapability, fallbackReason } = context;

    // Check if this stage has fallback disabled (e.g., "booked" with fallbackType: "none")
    if (opportunity) {
      const stageConfig = this.stageHandlerMap[opportunity.stage as OpportunityStage];
      if (stageConfig?.fallbackType === "none") {
        return { task: null, notifications: [] };
      }
    }

    const priority = this.derivePriority(opportunity);
    const dueAt = this.computeDueAt(priority);
    const title = this.buildTitle(contact, opportunity, missingCapability);
    const description = this.buildDescription(context);

    const taskInput: CreateOwnerTaskInput = {
      organizationId: contact.organizationId,
      contactId: contact.id,
      opportunityId: opportunity?.id ?? null,
      type: "fallback_handoff",
      title,
      description,
      suggestedAction: this.buildSuggestedAction(opportunity),
      priority,
      triggerReason: `no_${missingCapability}_active`,
      sourceAgent: null,
      fallbackReason,
      dueAt,
    };

    const task = await this.ownerTaskStore.create(taskInput);

    const notifications: FallbackNotification[] = [
      {
        channel: "dashboard",
        recipientId: contact.organizationId,
        message: `${contact.name ?? "New lead"} needs attention: ${title}`,
      },
    ];

    return { task, notifications };
  }

  private derivePriority(opportunity: Opportunity | null): TaskPriority {
    if (!opportunity) return "low";

    const stage = opportunity.stage as OpportunityStage;
    if (stage === "booked" || stage === "showed") return "urgent";
    if (stage === "qualified") {
      return (opportunity.estimatedValue ?? 0) > this.highValueThreshold ? "high" : "medium";
    }
    return "low";
  }

  private computeDueAt(priority: TaskPriority): Date {
    const hours = this.slaConfig[priority];
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private buildTitle(
    contact: Contact,
    opportunity: Opportunity | null,
    missingCapability: string,
  ): string {
    const name = contact.name ?? "Unknown lead";
    const service = opportunity?.serviceName ?? "general inquiry";
    return `${name} — ${service} (no ${missingCapability})`;
  }

  private buildDescription(context: FallbackContext): string {
    const { contact, opportunity, recentMessages, fallbackReason } = context;
    const parts: string[] = [];

    parts.push(`Contact: ${contact.name ?? contact.phone ?? "Unknown"}`);
    if (opportunity) {
      parts.push(`Service: ${opportunity.serviceName}`);
      parts.push(`Stage: ${opportunity.stage}`);
      if (opportunity.estimatedValue) {
        parts.push(`Est. value: $${(opportunity.estimatedValue / 100).toFixed(2)}`);
      }
    }
    parts.push(`Reason: agent ${fallbackReason}`);

    if (recentMessages.length > 0) {
      parts.push("");
      parts.push("Recent messages:");
      for (const msg of recentMessages.slice(-3)) {
        const dir = msg.direction === "inbound" ? "Lead" : "Agent";
        parts.push(`  ${dir}: ${msg.content.slice(0, 200)}`);
      }
    }

    return parts.join("\n");
  }

  private buildSuggestedAction(opportunity: Opportunity | null): string | null {
    if (!opportunity) return "Review lead and respond";

    const stage = opportunity.stage as OpportunityStage;
    switch (stage) {
      case "interested":
        return `Respond to inquiry about ${opportunity.serviceName}`;
      case "qualified":
        return `Follow up — lead is qualified for ${opportunity.serviceName}, timeline: ${opportunity.timeline ?? "unknown"}`;
      case "quoted":
        return `Follow up on quote for ${opportunity.serviceName}`;
      case "showed":
        return `Record payment for ${opportunity.serviceName}`;
      default:
        return null;
    }
  }
}
```

- [ ] **Step 4: Update barrel export**

Add to `packages/core/src/lifecycle/index.ts`:

```typescript
export { FallbackHandler } from "./fallback-handler.js";
export type {
  FallbackContext,
  FallbackResult,
  FallbackNotification,
  FallbackHandlerConfig,
  FallbackSLAConfig,
} from "./fallback-handler.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/core test -- fallback-handler`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: implement FallbackHandler for partial bundle graceful degradation"
```

---

### Task 10: Lifecycle Deps Factory + API Routes

**Files:**

- Create: `apps/api/src/bootstrap/lifecycle-deps.ts`
- Create: `apps/api/src/routes/lifecycle.ts`
- Modify: `apps/api/src/app.ts`

**IMPORTANT:** `app.ts` is currently at 599/600 lines (the ESLint `max-lines` error threshold). Before adding lifecycle wiring, you MUST extract existing code to make room. Follow the same pattern used for `session-bootstrap.ts`.

- [ ] **Step 0: Extract code from app.ts to make room**

Identify a 30-50 line block in `app.ts` that can be extracted into a separate bootstrap file (e.g., operator or scheduler wiring). Move it to a new file like `apps/api/src/bootstrap/operator-bootstrap.ts` or similar. Verify `app.ts` drops to ~560 lines. Run `pnpm typecheck` to confirm.

- [ ] **Step 1: Create lifecycle-deps.ts**

Factory function `buildLifecycleDeps()` that creates `ContactLifecycleService` + `FallbackHandler` from Prisma stores. Follow the pattern from `apps/api/src/bootstrap/workflow-deps.ts`.

- [ ] **Step 2: Create lifecycle.ts routes**

**IMPORTANT:** The lifecycle routes are where `StageAdvancementResult.advancementData` gets wrapped into a `RoutedEventEnvelope` using `createEventEnvelope()` from `@switchboard/agents`. This is the correct layer for this — apps can import from any package. Similarly, `RevenueRecordedData` gets wrapped into a `"revenue.recorded"` event here.

REST endpoints:

- `POST /api/lifecycle/contacts` — create contact
- `GET /api/lifecycle/contacts/:id` — get contact with opportunities
- `POST /api/lifecycle/opportunities` — create opportunity
- `POST /api/lifecycle/opportunities/:id/advance` — advance stage (body: `{ toStage, advancedBy }`)
- `POST /api/lifecycle/revenue` — record revenue event
- `GET /api/lifecycle/pipeline` — get pipeline snapshot
- `GET /api/lifecycle/tasks` — get pending owner tasks
- `POST /api/lifecycle/tasks/:id/status` — update task status

All routes enforce org-scoping via `requireOrganizationScope()`.

- [ ] **Step 3: Wire into app.ts**

Add lifecycle route registration + dependency wiring. Follow existing pattern for workflow/scheduler/operator routes.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add lifecycle API routes and dependency factory"
```

---

### Task 11: Update ConversationRouter for Opportunity-Based Routing

**Files:**

- Modify: `packages/agents/src/conversation-router.ts`
- Modify: `packages/agents/src/lifecycle.ts`
- Modify: `packages/agents/src/events.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Add opportunity.stage_advanced to AGENT_EVENT_TYPES**

In `packages/agents/src/events.ts`, add `"opportunity.stage_advanced"` to the array.

- [ ] **Step 2: Add agentForOpportunityStage to lifecycle.ts**

Re-export `agentForOpportunityStage` from `@switchboard/core` in `packages/agents/src/lifecycle.ts`, or add a thin wrapper that uses the core function.

- [ ] **Step 3: Update ConversationRouter.transform()**

Add a new code path that uses opportunity-based routing when a `ContactLifecycleService` is available (injected via config). Falls back to existing thread-based routing when not available (backward compatibility during migration).

- [ ] **Step 4: Update conversation.ts route**

In `apps/api/src/routes/conversation.ts`, replace the `escalateToOwner` dead-end with `FallbackHandler.handleUnrouted()` call.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/agents test && pnpm --filter @switchboard/api test`
Expected: PASS (existing tests still work, new routing is opt-in)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: update ConversationRouter for opportunity-based routing with fallback"
```

---

### Task 12: Vertical Skin Extensions

**Files:**

- Modify: `packages/schemas/src/skin.ts`
- Modify: `skins/clinic.json`
- Modify: `skins/gym.json`
- Modify: `skins/commerce.json`
- Modify: `skins/generic.json`

- [ ] **Step 1: Add lifecycle fields to SkinManifestSchema**

In `packages/schemas/src/skin.ts`, add optional fields:

```typescript
stageDefinitions: z.record(OpportunityStageSchema, z.object({
  label: z.string(),
  criteria: z.string(),
  typicalDuration: z.string().optional(),
})).optional(),
dormancyThresholdDays: z.number().int().positive().optional(),
reopenWindowDays: z.number().int().positive().optional(),
fallbackSLA: z.record(TaskPrioritySchema, z.object({
  dueDurationHours: z.number().positive(),
})).optional(),
```

- [ ] **Step 2: Add stageDefinitions to each skin**

Update each skin JSON with vertical-appropriate labels and thresholds per the spec Section 7.2 table.

- [ ] **Step 3: Run typecheck + existing skin tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add lifecycle stage definitions to vertical skin configs"
```

---

## Phase 3: Agent Migration + Cutover (Tasks 13-15)

### Task 13: Update Agents to Use Opportunity Stages

**Files:**

- Modify: `packages/agents/src/agents/lead-responder/handler.ts` (or `types.ts`)
- Modify: `packages/agents/src/agents/sales-closer/index.ts`
- Modify: `packages/agents/src/agents/nurture/handler.ts`
- Modify: `packages/agents/src/agents/revenue-tracker/handler.ts`
- Modify: `packages/agents/src/agents/ad-optimizer/handler.ts`

This task updates each agent to read `opportunity.stage` from event metadata and call `advanceOpportunityStage()` instead of updating thread stage directly. The changes are agent-specific and should follow the mapping in spec Section 6.4.

- [ ] **Step 1: Update LeadResponder**

Read opportunity stage from event metadata. When qualification complete, call `advanceOpportunityStage("qualified")` instead of updating thread stage.

- [ ] **Step 2: Update SalesCloser**

Handle opportunities in `qualified`/`quoted` stages. Call `advanceOpportunityStage("booked")` on booking confirmation.

- [ ] **Step 3: Update Nurture**

Handle opportunities in `nurturing`. Call `reopenOpportunity()` on re-engagement.

- [ ] **Step 4: Update RevenueTracker**

Listen for `opportunity.stage_advanced` events. Call `recordRevenue()` on payment confirmation.

- [ ] **Step 5: Update AdOptimizer**

Listen for `revenue.recorded` events. Use Contact attribution for campaign feedback.

- [ ] **Step 6: Update agent port declarations**

Update `inboundEvents` in each agent's port to include `"opportunity.stage_advanced"` where relevant.

- [ ] **Step 7: Run all agent tests**

Run: `pnpm --filter @switchboard/agents test`
Expected: PASS (update test mocks as needed)

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: migrate agents to opportunity-based stage management"
```

---

### Task 14: ConversationThread Schema Migration

**Files:**

- Modify: `packages/schemas/src/conversation-thread.ts`
- Modify: `packages/core/src/conversations/thread-store.ts`
- Modify: `packages/core/src/conversations/thread.ts`
- Modify: `packages/db/src/stores/prisma-thread-store.ts`

- [ ] **Step 1: Add ThreadStatus to conversation-thread.ts**

Add `ThreadStatusSchema` import from lifecycle schemas. Add `threadStatus` field to `ConversationThreadSchema`. Keep `stage` field for now (deprecated, removed in Task 15).

- [ ] **Step 2: Update ConversationThreadStore interface**

Add `threadStatus` to the `update()` method's accepted fields.

- [ ] **Step 3: Update createDefaultThread()**

Set `threadStatus: "open"` in default thread creation.

- [ ] **Step 4: Update PrismaConversationThreadStore**

Support reading/writing `threadStatus` field.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/core test -- thread && pnpm --filter @switchboard/db test -- thread`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add threadStatus to ConversationThread, deprecate stage field"
```

---

### Task 15: Cleanup + Deprecation

**Files:**

- Modify: `packages/agents/src/lifecycle.ts`
- Modify: `packages/agents/src/conversation-router.ts`

- [ ] **Step 1: Mark old functions as deprecated**

In `packages/agents/src/lifecycle.ts`:

- Add `/** @deprecated Use agentForOpportunityStage from @switchboard/core */` to `agentForThreadStage()` and `agentForStage()`
- Keep them functional for backward compatibility

- [ ] **Step 2: Update ConversationRouter to prefer opportunity routing**

Make opportunity-based routing the default path. Thread-based routing becomes the fallback (used only when lifecycle service is not configured).

- [ ] **Step 3: Run full test suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: deprecate thread-stage routing, prefer opportunity-based routing"
```

---

## Summary

| Phase                     | Tasks                                                                                                                              | What It Delivers                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Phase 1** (Tasks 1-8)   | Schemas, transition validator, stage deriver, store interfaces, stage handler map, Prisma models, Prisma stores, lifecycle service | Core data layer — Contact, Opportunity, RevenueEvent, OwnerTask fully operational |
| **Phase 2** (Tasks 9-12)  | Fallback handler, API routes, conversation router update, skin extensions                                                          | Wiring layer — fallback works, routing uses opportunities, verticals configured   |
| **Phase 3** (Tasks 13-15) | Agent migration, thread schema changes, deprecation cleanup                                                                        | Integration layer — agents use new model, old model deprecated                    |

**Total: 15 tasks, ~45-60 steps**

After Phase 1: you can create contacts, opportunities, record revenue, and query pipeline via API.
After Phase 2: partial bundles work gracefully, routing uses opportunity stages, skins have lifecycle config.
After Phase 3: agents read/write opportunity stages, thread stage deprecated.

**Data migration** (backfilling existing ConversationThread + LeadProfile data into Contact + Opportunity) is a follow-up task after Phase 3 is stable. Migration script maps thread stages to opportunity stages per the spec Section 9 mapping table.
