# Agent Production Hardening & Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all critical/important audit findings in the agent orchestration layer and wire it into the running apps so agents can receive and process real events.

**Architecture:** Three phases — (1) fix bugs and harden handlers with payload validation, (2) fix infrastructure issues (Promise.allSettled, memory management, listener safety), (3) wire the agent system into `apps/api` via ConversionBusBridge and EventLoop bootstrap. Each phase is independently shippable.

**Tech Stack:** TypeScript, Vitest, Zod (from `@switchboard/schemas`), pnpm monorepo

---

## Phase 1: Handler Bug Fixes & Payload Validation

### Task 1: Add shared payload validation utility

**Files:**

- Create: `packages/agents/src/validate-payload.ts`
- Create: `packages/agents/src/__tests__/validate-payload.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/agents/src/__tests__/validate-payload.test.ts
import { describe, it, expect } from "vitest";
import { validatePayload, PayloadValidationError } from "../validate-payload.js";

describe("validatePayload", () => {
  it("returns validated fields when all required fields present", () => {
    const payload = { contactId: "c1", amount: 100 };
    const result = validatePayload(payload, {
      contactId: "string",
      amount: "number",
    });
    expect(result).toEqual({ contactId: "c1", amount: 100 });
  });

  it("throws PayloadValidationError when required string field is missing", () => {
    const payload = { amount: 100 };
    expect(() => validatePayload(payload, { contactId: "string", amount: "number" })).toThrow(
      PayloadValidationError,
    );
  });

  it("throws PayloadValidationError when field has wrong type", () => {
    const payload = { contactId: "c1", amount: "not-a-number" };
    expect(() => validatePayload(payload, { contactId: "string", amount: "number" })).toThrow(
      PayloadValidationError,
    );
  });

  it("handles optional fields with ? suffix", () => {
    const payload = { contactId: "c1" };
    const result = validatePayload(payload, {
      contactId: "string",
      notes: "string?",
    });
    expect(result).toEqual({ contactId: "c1" });
  });

  it("includes agent context in error message", () => {
    const payload = {};
    try {
      validatePayload(payload, { contactId: "string" }, "lead-responder");
    } catch (err) {
      expect((err as PayloadValidationError).message).toContain("lead-responder");
      expect((err as PayloadValidationError).message).toContain("contactId");
    }
  });

  it("handles null/undefined payload gracefully", () => {
    expect(() => validatePayload(null, { contactId: "string" })).toThrow(PayloadValidationError);

    expect(() => validatePayload(undefined, { contactId: "string" })).toThrow(
      PayloadValidationError,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/agents test -- validate-payload`
Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

```typescript
// packages/agents/src/validate-payload.ts
export class PayloadValidationError extends Error {
  constructor(
    public readonly agentId: string | undefined,
    public readonly missingFields: string[],
    public readonly wrongTypeFields: string[],
  ) {
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`missing required fields: ${missingFields.join(", ")}`);
    }
    if (wrongTypeFields.length > 0) {
      parts.push(`wrong type fields: ${wrongTypeFields.join(", ")}`);
    }
    const prefix = agentId ? `[${agentId}] ` : "";
    super(`${prefix}Invalid event payload: ${parts.join("; ")}`);
    this.name = "PayloadValidationError";
  }
}

type FieldType = "string" | "number" | "boolean" | "string?" | "number?" | "boolean?";

/**
 * Validates that a payload contains all required fields with correct types.
 * Returns the payload cast to Record<string, unknown> on success.
 * Throws PayloadValidationError on failure.
 */
export function validatePayload(
  payload: unknown,
  schema: Record<string, FieldType>,
  agentId?: string,
): Record<string, unknown> {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    throw new PayloadValidationError(agentId, ["(payload is not an object)"], []);
  }

  const record = payload as Record<string, unknown>;
  const missingFields: string[] = [];
  const wrongTypeFields: string[] = [];

  for (const [field, type] of Object.entries(schema)) {
    const isOptional = type.endsWith("?");
    const baseType = isOptional ? type.slice(0, -1) : type;
    const value = record[field];

    if (value === undefined || value === null) {
      if (!isOptional) {
        missingFields.push(field);
      }
      continue;
    }

    if (typeof value !== baseType) {
      wrongTypeFields.push(field);
    }
  }

  if (missingFields.length > 0 || wrongTypeFields.length > 0) {
    throw new PayloadValidationError(agentId, missingFields, wrongTypeFields);
  }

  return record;
}
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/agents test -- validate-payload`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/validate-payload.ts packages/agents/src/__tests__/validate-payload.test.ts
git commit -m "feat(agents): add shared payload validation utility"
```

---

### Task 2: Add payload validation to Lead Responder handler

**Files:**

- Modify: `packages/agents/src/agents/lead-responder/handler.ts:24-25`
- Modify: `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Add to the existing test file `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`:

```typescript
import { PayloadValidationError } from "../../../validate-payload.js";

// Add this test block:
describe("payload validation", () => {
  it("throws PayloadValidationError when contactId is missing", async () => {
    const event = createEvent({ score: 80 }); // no contactId
    await expect(handler.handle(event, {}, baseContext)).rejects.toThrow(PayloadValidationError);
  });

  it("includes agent name in validation error", async () => {
    const event = createEvent({});
    try {
      await handler.handle(event, {}, baseContext);
    } catch (err) {
      expect((err as PayloadValidationError).message).toContain("lead-responder");
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/agents test -- lead-responder/.*handler`
Expected: FAIL (handler doesn't throw on missing contactId)

**Step 3: Modify the handler**

In `packages/agents/src/agents/lead-responder/handler.ts`, replace lines 24-25:

```typescript
// Before:
const payload = event.payload as Record<string, unknown>;
const contactId = payload.contactId as string;

// After:
import { validatePayload } from "../../validate-payload.js";

const payload = validatePayload(event.payload, { contactId: "string" }, "lead-responder");
const contactId = payload.contactId as string;
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/agents test -- lead-responder/.*handler`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/lead-responder/handler.ts packages/agents/src/agents/lead-responder/__tests__/handler.test.ts
git commit -m "fix(agents): add payload validation to Lead Responder"
```

---

### Task 3: Add payload validation to Sales Closer handler

**Files:**

- Modify: `packages/agents/src/agents/sales-closer/handler.ts:19-20`
- Modify: `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Add to `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`:

```typescript
import { PayloadValidationError } from "../../../validate-payload.js";

describe("payload validation", () => {
  it("throws PayloadValidationError when contactId is missing", async () => {
    const event = createEvent({}); // no contactId
    await expect(handler.handle(event, {}, contextWithBooking)).rejects.toThrow(
      PayloadValidationError,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/agents test -- sales-closer/.*handler`
Expected: FAIL

**Step 3: Modify the handler**

In `packages/agents/src/agents/sales-closer/handler.ts`, add import and replace lines 19-20:

```typescript
import { validatePayload } from "../../validate-payload.js";

// In handle(), replace:
const payload = event.payload as Record<string, unknown>;
const contactId = payload.contactId as string;

// With:
const payload = validatePayload(event.payload, { contactId: "string" }, "sales-closer");
const contactId = payload.contactId as string;
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/agents test -- sales-closer/.*handler`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/sales-closer/handler.ts packages/agents/src/agents/sales-closer/__tests__/handler.test.ts
git commit -m "fix(agents): add payload validation to Sales Closer"
```

---

### Task 4: Add payload validation to Nurture handler

**Files:**

- Modify: `packages/agents/src/agents/nurture/handler.ts:23-25,71-72,104-106`
- Modify: `packages/agents/src/agents/nurture/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Add to `packages/agents/src/agents/nurture/__tests__/handler.test.ts`:

```typescript
import { PayloadValidationError } from "../../../validate-payload.js";

describe("payload validation", () => {
  it("throws PayloadValidationError when contactId is missing from stage.advanced", async () => {
    const event = makeEvent("stage.advanced", { stage: "booking_initiated" });
    await expect(handler.handle(event, {}, contextWithNurture)).rejects.toThrow(
      PayloadValidationError,
    );
  });

  it("throws PayloadValidationError when contactId is missing from lead.disqualified", async () => {
    const event = makeEvent("lead.disqualified", {});
    await expect(handler.handle(event, {}, contextWithNurture)).rejects.toThrow(
      PayloadValidationError,
    );
  });

  it("throws PayloadValidationError when contactId is missing from revenue.recorded", async () => {
    const event = makeEvent("revenue.recorded", {});
    await expect(handler.handle(event, {}, contextWithNurture)).rejects.toThrow(
      PayloadValidationError,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/agents test -- nurture/.*handler`
Expected: FAIL

**Step 3: Modify the handler**

In `packages/agents/src/agents/nurture/handler.ts`, add import and replace all three payload extraction blocks:

```typescript
import { validatePayload } from "../../validate-payload.js";

// In handle() for stage.advanced (line 23-25):
const payload = validatePayload(event.payload, { contactId: "string", stage: "string" }, "nurture");
const contactId = payload.contactId as string;
const stage = payload.stage as string;

// In handleRevenueRecorded() (line 71-72):
const payload = validatePayload(event.payload, { contactId: "string" }, "nurture");
const contactId = payload.contactId as string;

// In handleDisqualified() (line 104-106):
const payload = validatePayload(event.payload, { contactId: "string" }, "nurture");
const contactId = payload.contactId as string;
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/agents test -- nurture/.*handler`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/nurture/handler.ts packages/agents/src/agents/nurture/__tests__/handler.test.ts
git commit -m "fix(agents): add payload validation to Nurture handler"
```

---

### Task 5: Add payload validation to Ad Optimizer handler

**Files:**

- Modify: `packages/agents/src/agents/ad-optimizer/handler.ts:31-33,57-60`
- Modify: `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Add to `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts`:

```typescript
import { PayloadValidationError } from "../../../validate-payload.js";

describe("payload validation", () => {
  it("throws PayloadValidationError when campaignId is missing from anomaly event", async () => {
    const event = makeEvent("ad.anomaly_detected", { platform: "meta", metric: "cpc" });
    await expect(handler.handle(event, {}, contextWithAds)).rejects.toThrow(PayloadValidationError);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/agents test -- ad-optimizer/.*handler`
Expected: FAIL

**Step 3: Modify the handler**

In `packages/agents/src/agents/ad-optimizer/handler.ts`:

```typescript
import { validatePayload } from "../../validate-payload.js";

// In handleAttribution() (line 31-33):
const payload = validatePayload(
  event.payload,
  { amount: "number", campaignId: "string?" },
  "ad-optimizer",
);

// In handleAnomaly() (line 57-60):
const payload = validatePayload(
  event.payload,
  { campaignId: "string", platform: "string", metric: "string", dropPercent: "number?" },
  "ad-optimizer",
);
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/agents test -- ad-optimizer/.*handler`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/ad-optimizer/handler.ts packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts
git commit -m "fix(agents): add payload validation to Ad Optimizer handler"
```

---

### Task 6: Add payload validation to Revenue Tracker handler

**Files:**

- Modify: `packages/agents/src/agents/revenue-tracker/handler.ts:31-34,100-102`
- Modify: `packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Add to `packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts`:

```typescript
import { PayloadValidationError } from "../../../validate-payload.js";

describe("payload validation", () => {
  it("throws PayloadValidationError when contactId missing from revenue.recorded", async () => {
    const event = makeEvent("revenue.recorded", { amount: 100 });
    await expect(handler.handle(event, {}, contextWithRevenue)).rejects.toThrow(
      PayloadValidationError,
    );
  });

  it("throws PayloadValidationError when amount missing from revenue.recorded", async () => {
    const event = makeEvent("revenue.recorded", { contactId: "c1" });
    await expect(handler.handle(event, {}, contextWithRevenue)).rejects.toThrow(
      PayloadValidationError,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/agents test -- revenue-tracker/.*handler`
Expected: FAIL

**Step 3: Modify the handler**

In `packages/agents/src/agents/revenue-tracker/handler.ts`:

```typescript
import { validatePayload } from "../../validate-payload.js";

// In handleRevenue() (line 31-34):
const payload = validatePayload(
  event.payload,
  { contactId: "string", amount: "number", currency: "string?" },
  "revenue-tracker",
);
const contactId = payload.contactId as string;
const amount = payload.amount as number;
const currency = (payload.currency as string) ?? "USD";

// In handleStage() (line 100-102):
const payload = validatePayload(
  event.payload,
  { contactId: "string", stage: "string" },
  "revenue-tracker",
);
const contactId = payload.contactId as string;
const stage = payload.stage as string;
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/agents test -- revenue-tracker/.*handler`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/revenue-tracker/handler.ts packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts
git commit -m "fix(agents): add payload validation to Revenue Tracker handler"
```

---

### Task 7: Fix port/handler mismatches

**Files:**

- Modify: `packages/agents/src/agents/sales-closer/port.ts:11`
- Modify: `packages/agents/src/agents/nurture/port.ts:11`

**Step 1: Write the failing test**

Add to `packages/agents/src/agents/sales-closer/__tests__/port.test.ts` (or create if needed):

```typescript
import { describe, it, expect } from "vitest";
import { SALES_CLOSER_PORT } from "../port.js";

describe("SALES_CLOSER_PORT", () => {
  it("declares only events the handler actually emits", () => {
    // Handler emits: stage.advanced, conversation.escalated
    // Handler does NOT emit: revenue.recorded
    expect(SALES_CLOSER_PORT.outboundEvents).toContain("stage.advanced");
    expect(SALES_CLOSER_PORT.outboundEvents).toContain("conversation.escalated");
    expect(SALES_CLOSER_PORT.outboundEvents).not.toContain("revenue.recorded");
  });
});
```

Add to `packages/agents/src/agents/nurture/__tests__/port.test.ts` (or create if needed):

```typescript
import { describe, it, expect } from "vitest";
import { NURTURE_AGENT_PORT } from "../port.js";

describe("NURTURE_AGENT_PORT", () => {
  it("declares only events the handler actually emits", () => {
    // Handler emits: lead.qualified, conversation.escalated
    // Handler does NOT emit: stage.advanced
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("lead.qualified");
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("conversation.escalated");
    expect(NURTURE_AGENT_PORT.outboundEvents).not.toContain("stage.advanced");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @switchboard/agents test -- port.test`
Expected: FAIL (ports still declare events the handler doesn't emit)

**Step 3: Fix the port declarations**

In `packages/agents/src/agents/sales-closer/port.ts` line 11, change:

```typescript
// Before:
outboundEvents: ["stage.advanced", "revenue.recorded", "conversation.escalated"],
// After:
outboundEvents: ["stage.advanced", "conversation.escalated"],
```

In `packages/agents/src/agents/nurture/port.ts` line 11, change:

```typescript
// Before:
outboundEvents: ["stage.advanced", "lead.qualified"],
// After:
outboundEvents: ["lead.qualified", "conversation.escalated"],
```

**Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @switchboard/agents test -- port.test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/sales-closer/port.ts packages/agents/src/agents/nurture/port.ts packages/agents/src/agents/sales-closer/__tests__/port.test.ts packages/agents/src/agents/nurture/__tests__/port.test.ts
git commit -m "fix(agents): correct port/handler outbound event mismatches"
```

---

### Task 8: Fix Ad Optimizer bugs (dropPercent undefined, missing contactId in escalation, wall-clock timestamp)

**Files:**

- Modify: `packages/agents/src/agents/ad-optimizer/handler.ts:50,69-73,162`
- Modify: `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts`

**Step 1: Write the failing tests**

Add to `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts`:

```typescript
describe("bug fixes", () => {
  it("does NOT auto-pause when dropPercent is undefined", async () => {
    const event = makeEvent("ad.anomaly_detected", {
      campaignId: "c1",
      platform: "meta",
      metric: "cpc",
      // dropPercent intentionally omitted
    });
    const result = await handler.handle(event, {}, contextWithAds);
    // Should escalate rather than auto-pause
    expect(result.events[0]!.eventType).toBe("conversation.escalated");
    expect(result.actions).toHaveLength(0);
  });

  it("includes contactId in escalation payload when available", async () => {
    const event = makeEvent("ad.anomaly_detected", {
      campaignId: "c1",
      platform: "meta",
      metric: "cpc",
      contactId: "contact-1",
    });
    // No ads config => escalation
    const result = await handler.handle(event, {}, { organizationId: "org-1" });
    const escalation = result.events[0]!;
    expect((escalation.payload as Record<string, unknown>).contactId).toBe("contact-1");
  });

  it("uses event occurredAt instead of wall clock for attribution timestamp", async () => {
    const event = makeEvent("revenue.attributed", {
      campaignId: "c1",
      amount: 100,
    });
    event.occurredAt = "2026-01-01T00:00:00.000Z";
    const result = await handler.handle(event, {}, contextWithAds);
    const state = result.state as Record<string, unknown>;
    const lastAttribution = state.lastAttribution as Record<string, unknown>;
    expect(lastAttribution.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @switchboard/agents test -- ad-optimizer/.*handler`
Expected: FAIL

**Step 3: Fix the bugs**

In `packages/agents/src/agents/ad-optimizer/handler.ts`:

1. **Line 50** — Replace `new Date().toISOString()` with `event.occurredAt`:

```typescript
timestamp: event.occurredAt,
```

2. **Lines 69-73** — Change the `dropPercent` check to escalate when undefined:

```typescript
// Before:
if (dropPercent !== undefined && dropPercent < anomalyThreshold) {
  return { events: [], actions: [] };
}

// After:
if (dropPercent === undefined) {
  return this.escalate(event, context, "missing_drop_percent");
}
if (dropPercent < anomalyThreshold) {
  return { events: [], actions: [] };
}
```

3. **Line 162** — Add `contactId` to escalation payload:

```typescript
// Before:
payload: { reason },

// After:
payload: {
  contactId: ((event.payload as Record<string, unknown>).contactId as string) ?? null,
  reason,
},
```

**Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @switchboard/agents test -- ad-optimizer/.*handler`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/ad-optimizer/handler.ts packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts
git commit -m "fix(agents): fix dropPercent undefined bug, add contactId to escalation, use event timestamp"
```

---

### Task 9: Export validate-payload from barrel

**Files:**

- Modify: `packages/agents/src/index.ts`

**Step 1: Add export**

Add to `packages/agents/src/index.ts`:

```typescript
export { validatePayload, PayloadValidationError } from "./validate-payload.js";
```

**Step 2: Run typecheck**

Run: `corepack pnpm --filter @switchboard/agents typecheck`
Expected: PASS (no errors)

**Step 3: Run all tests**

Run: `corepack pnpm --filter @switchboard/agents test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add packages/agents/src/index.ts
git commit -m "feat(agents): export validatePayload from barrel"
```

---

## Phase 2: Infrastructure Hardening

### Task 10: Replace Promise.all with Promise.allSettled in Dispatcher

**Files:**

- Modify: `packages/agents/src/dispatcher.ts:43-52`
- Modify: `packages/agents/src/__tests__/dispatcher.test.ts`

**Step 1: Write the failing test**

Add to `packages/agents/src/__tests__/dispatcher.test.ts`:

```typescript
describe("resilience", () => {
  it("continues dispatching when one destination handler throws", async () => {
    let callCount = 0;
    const failingHandler: DestinationHandler = async () => {
      callCount++;
      if (callCount === 1) throw new Error("handler boom");
      return { success: true };
    };

    const dispatcher = new Dispatcher({
      deliveryStore: new InMemoryDeliveryStore(),
      policyBridge: new PolicyBridge(null),
      handlers: { agent: failingHandler },
    });

    const plan: RoutePlan = {
      event: makeEvent(),
      destinations: [
        { type: "agent", id: "agent-1", criticality: "required", sequencing: "parallel" },
        { type: "agent", id: "agent-2", criticality: "required", sequencing: "parallel" },
      ],
    };

    const results = await dispatcher.execute(plan);
    // Both should have results — one failed, one succeeded
    expect(results).toHaveLength(2);
    expect(results.filter((r) => r.status === "failed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "succeeded")).toHaveLength(1);
  });

  it("returns results even when delivery store throws", async () => {
    const brokenStore: DeliveryStore = {
      record: async () => {
        throw new Error("store boom");
      },
      update: async () => {
        throw new Error("store boom");
      },
      getByEvent: async () => [],
      listRetryable: async () => [],
    };

    const dispatcher = new Dispatcher({
      deliveryStore: brokenStore,
      policyBridge: new PolicyBridge(null),
      handlers: { agent: async () => ({ success: true }) },
    });

    const plan: RoutePlan = {
      event: makeEvent(),
      destinations: [
        { type: "agent", id: "agent-1", criticality: "required", sequencing: "parallel" },
      ],
    };

    const results = await dispatcher.execute(plan);
    // Should still get a result even if store failed
    expect(results).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/agents test -- dispatcher`
Expected: FAIL (Promise.all rejects on first failure)

**Step 3: Modify the Dispatcher**

In `packages/agents/src/dispatcher.ts`, replace the `execute` method (lines 43-53):

```typescript
async execute(plan: RoutePlan): Promise<DispatchResult[]> {
  const promises: Promise<DispatchResult>[] = [];

  for (const dest of plan.destinations) {
    if (dest.sequencing === "parallel") {
      promises.push(
        this.dispatchOne(plan.event, dest.type, dest.id, dest.criticality).catch(
          (err): DispatchResult => ({
            destinationId: dest.id,
            destinationType: dest.type,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
    }
  }

  return Promise.all(promises);
}
```

Also wrap `this.store.record()` calls inside `dispatchOne` in try-catch so a store failure doesn't crash the dispatch:

```typescript
// Wrap each store.record call:
try {
  await this.store.record({ ... });
} catch {
  // Store failure should not crash the dispatch
}
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/agents test -- dispatcher`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/dispatcher.ts packages/agents/src/__tests__/dispatcher.test.ts
git commit -m "fix(agents): use Promise.allSettled pattern in Dispatcher to prevent cascading failures"
```

---

### Task 11: Add memory management to AgentStateTracker

**Files:**

- Modify: `packages/agents/src/agent-state.ts`
- Modify: `packages/agents/src/__tests__/agent-state.test.ts`

**Step 1: Write the failing tests**

Add to `packages/agents/src/__tests__/agent-state.test.ts`:

```typescript
describe("memory management", () => {
  it("removes agent state for a specific org+agent", () => {
    const tracker = new AgentStateTracker();
    tracker.startProcessing("org-1", "agent-1", "task");
    tracker.completeProcessing("org-1", "agent-1", "done");
    expect(tracker.get("org-1", "agent-1")).toBeDefined();

    tracker.remove("org-1", "agent-1");
    expect(tracker.get("org-1", "agent-1")).toBeUndefined();
  });

  it("clears all state for an organization", () => {
    const tracker = new AgentStateTracker();
    tracker.startProcessing("org-1", "agent-1", "task");
    tracker.startProcessing("org-1", "agent-2", "task");
    tracker.startProcessing("org-2", "agent-1", "task");

    tracker.clearOrg("org-1");
    expect(tracker.listForOrg("org-1")).toHaveLength(0);
    expect(tracker.listForOrg("org-2")).toHaveLength(1);
  });

  it("returns unsubscribe function from onStateChange", () => {
    const tracker = new AgentStateTracker();
    const calls: string[] = [];
    const unsub = tracker.onStateChange((_org, agentId) => {
      calls.push(agentId);
    });

    tracker.startProcessing("org-1", "agent-1", "task");
    expect(calls).toEqual(["agent-1"]);

    unsub();
    tracker.startProcessing("org-1", "agent-2", "task");
    expect(calls).toEqual(["agent-1"]); // no new call
  });

  it("wraps listener errors so they don't crash state updates", () => {
    const tracker = new AgentStateTracker();
    const calls: string[] = [];

    tracker.onStateChange(() => {
      throw new Error("listener boom");
    });
    tracker.onStateChange((_org, agentId) => {
      calls.push(agentId);
    });

    // Should not throw, and second listener should still fire
    expect(() => tracker.startProcessing("org-1", "agent-1", "task")).not.toThrow();
    expect(calls).toEqual(["agent-1"]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @switchboard/agents test -- agent-state`
Expected: FAIL

**Step 3: Modify AgentStateTracker**

In `packages/agents/src/agent-state.ts`:

```typescript
// Add remove() method:
remove(organizationId: string, agentId: string): void {
  this.states.get(organizationId)?.delete(agentId);
}

// Add clearOrg() method:
clearOrg(organizationId: string): void {
  this.states.delete(organizationId);
}

// Change onStateChange to return unsubscribe function:
onStateChange(listener: StateChangeListener): () => void {
  this.listeners.push(listener);
  return () => {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) {
      this.listeners.splice(idx, 1);
    }
  };
}

// Wrap listener calls in update() (lines 103-105):
private update(
  organizationId: string,
  agentId: string,
  partial: Partial<AgentActivityState>,
): void {
  const state = this.getOrCreate(organizationId, agentId);
  Object.assign(state, partial);
  for (const listener of this.listeners) {
    try {
      listener(organizationId, agentId, state);
    } catch {
      // Listener errors must not crash state updates
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @switchboard/agents test -- agent-state`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agent-state.ts packages/agents/src/__tests__/agent-state.test.ts
git commit -m "fix(agents): add memory management and listener safety to AgentStateTracker"
```

---

## Phase 3: App Integration

### Task 12: Add @switchboard/agents as dependency to apps/api

**Files:**

- Modify: `apps/api/package.json`

**Step 1: Add dependency**

Run:

```bash
cd /Users/jasonljc/switchboard && corepack pnpm --filter @switchboard/api add @switchboard/agents@workspace:*
```

**Step 2: Verify it resolves**

Run: `corepack pnpm install`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add @switchboard/agents dependency"
```

---

### Task 13: Create agent bootstrap module in apps/api

**Files:**

- Create: `apps/api/src/agent-bootstrap.ts`
- Create: `apps/api/src/__tests__/agent-bootstrap.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/src/__tests__/agent-bootstrap.test.ts
import { describe, it, expect } from "vitest";
import { bootstrapAgentSystem } from "../agent-bootstrap.js";
import type { ConversionBus } from "@switchboard/core";

describe("bootstrapAgentSystem", () => {
  it("returns an initialized agent system with all components", () => {
    const system = bootstrapAgentSystem();
    expect(system.registry).toBeDefined();
    expect(system.handlerRegistry).toBeDefined();
    expect(system.eventLoop).toBeDefined();
    expect(system.stateTracker).toBeDefined();
    expect(system.scheduledRunner).toBeDefined();
  });

  it("registers all 5 agent handlers", () => {
    const system = bootstrapAgentSystem();
    const registered = system.handlerRegistry.listRegistered();
    expect(registered).toContain("lead-responder");
    expect(registered).toContain("sales-closer");
    expect(registered).toContain("nurture");
    expect(registered).toContain("ad-optimizer");
    expect(registered).toContain("revenue-tracker");
  });

  it("wires ConversionBusBridge when conversionBus provided", () => {
    const subscriptions: Array<{ type: string }> = [];
    const mockBus = {
      subscribe: (type: string, _handler: unknown) => {
        subscriptions.push({ type });
      },
    } as unknown as ConversionBus;

    bootstrapAgentSystem({ conversionBus: mockBus });
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.type).toBe("*");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/api test -- agent-bootstrap`
Expected: FAIL (module not found)

**Step 3: Write the bootstrap module**

```typescript
// apps/api/src/agent-bootstrap.ts
import {
  AgentRegistry,
  AgentRouter,
  AgentStateTracker,
  ConversionBusBridge,
  EventLoop,
  HandlerRegistry,
  ActionExecutor,
  InMemoryDeliveryStore,
  PolicyBridge,
  ScheduledRunner,
  LeadResponderHandler,
  SalesCloserHandler,
  NurtureAgentHandler,
  AdOptimizerHandler,
  RevenueTrackerHandler,
  LEAD_RESPONDER_PORT,
  SALES_CLOSER_PORT,
  NURTURE_AGENT_PORT,
  AD_OPTIMIZER_PORT,
  REVENUE_TRACKER_PORT,
} from "@switchboard/agents";
import type { ConversionBus } from "@switchboard/core";
import type { AgentPort } from "@switchboard/agents";

export interface AgentSystemOptions {
  conversionBus?: ConversionBus;
}

export interface AgentSystem {
  registry: AgentRegistry;
  handlerRegistry: HandlerRegistry;
  eventLoop: EventLoop;
  stateTracker: AgentStateTracker;
  scheduledRunner: ScheduledRunner;
  actionExecutor: ActionExecutor;
}

const DEFAULT_LEAD_SCORER = (params: Record<string, unknown>) => ({
  score: 50,
  tier: "warm" as const,
  factors: [{ factor: "default", contribution: 50 }],
});

export function bootstrapAgentSystem(options: AgentSystemOptions = {}): AgentSystem {
  const registry = new AgentRegistry();
  const handlerRegistry = new HandlerRegistry();
  const stateTracker = new AgentStateTracker();
  const deliveryStore = new InMemoryDeliveryStore();
  const policyBridge = new PolicyBridge(null); // pass-through until policy adapter built
  const actionExecutor = new ActionExecutor();

  // Register handlers
  handlerRegistry.register(
    "lead-responder",
    new LeadResponderHandler({ scoreLead: DEFAULT_LEAD_SCORER }),
  );
  handlerRegistry.register("sales-closer", new SalesCloserHandler());
  handlerRegistry.register("nurture", new NurtureAgentHandler());
  handlerRegistry.register("ad-optimizer", new AdOptimizerHandler());
  handlerRegistry.register("revenue-tracker", new RevenueTrackerHandler());

  // Build router and event loop
  const router = new AgentRouter(registry);
  const eventLoop = new EventLoop({
    router,
    registry,
    handlers: handlerRegistry,
    actionExecutor,
    policyBridge,
    deliveryStore,
    stateTracker,
  });

  const scheduledRunner = new ScheduledRunner({ registry, eventLoop });

  // Wire ConversionBusBridge if bus provided
  if (options.conversionBus) {
    const bridge = new ConversionBusBridge({
      onEvent: (envelope) => {
        const context = { organizationId: envelope.organizationId };
        eventLoop.process(envelope, context).catch((err) => {
          console.error("[agent-system] EventLoop error:", err);
        });
      },
    });
    bridge.register(options.conversionBus);
  }

  return {
    registry,
    handlerRegistry,
    eventLoop,
    stateTracker,
    scheduledRunner,
    actionExecutor,
  };
}

/**
 * Register all agents for an organization.
 * Call this during org setup or on first request.
 */
export function registerAgentsForOrg(registry: AgentRegistry, organizationId: string): void {
  const ports: AgentPort[] = [
    LEAD_RESPONDER_PORT,
    SALES_CLOSER_PORT,
    NURTURE_AGENT_PORT,
    AD_OPTIMIZER_PORT,
    REVENUE_TRACKER_PORT,
  ];

  for (const port of ports) {
    registry.register(organizationId, {
      agentId: port.agentId,
      version: port.version,
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: port.inboundEvents,
        emits: port.outboundEvents,
        tools: port.tools.map((t) => t.name),
      },
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/api test -- agent-bootstrap`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/agent-bootstrap.ts apps/api/src/__tests__/agent-bootstrap.test.ts
git commit -m "feat(api): add agent system bootstrap module"
```

---

### Task 14: Wire agent bootstrap into apps/api startup

**Files:**

- Modify: `apps/api/src/app.ts` (add agent bootstrap call near the end of the setup, after ConversionBus creation)

**Step 1: Read the current app.ts to find the right insertion point**

The file creates an `InMemoryConversionBus` instance. Find that line and insert the agent bootstrap after it.

**Step 2: Add the wiring**

Add import at top of `apps/api/src/app.ts`:

```typescript
import { bootstrapAgentSystem, registerAgentsForOrg } from "./agent-bootstrap.js";
```

After the `InMemoryConversionBus` is created, add:

```typescript
// Bootstrap agent system and connect to conversion bus
const agentSystem = bootstrapAgentSystem({ conversionBus: conversionBus });
```

This is the minimal wiring. The `ConversionBusBridge` will subscribe to `*` on the conversion bus and feed events into the agent `EventLoop`.

**Step 3: Run typecheck**

Run: `corepack pnpm --filter @switchboard/api typecheck`
Expected: PASS

**Step 4: Run all api tests**

Run: `corepack pnpm --filter @switchboard/api test`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): wire agent system into app startup via ConversionBusBridge"
```

---

### Task 15: Final verification — run all tests and typecheck

**Step 1: Run full typecheck**

Run: `corepack pnpm typecheck`
Expected: PASS across all packages

**Step 2: Run full test suite**

Run: `corepack pnpm test`
Expected: All tests pass

**Step 3: Run lint**

Run: `corepack pnpm lint`
Expected: PASS

**Step 4: Commit any fixes**

If any lint/type issues found, fix and commit:

```bash
git commit -m "chore: fix lint/type issues from agent hardening"
```

---

## Summary of What Each Task Fixes

| Task    | Audit Finding                                                                                         | Severity             |
| ------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| T1      | No payload validation utility                                                                         | CRITICAL (enabler)   |
| T2-T6   | No input validation in any handler                                                                    | CRITICAL             |
| T7      | Port/handler outbound event mismatches                                                                | IMPORTANT            |
| T8      | Ad Optimizer: dropPercent undefined auto-pause, missing contactId in escalation, wall-clock timestamp | CRITICAL + IMPORTANT |
| T9      | Export new utility from barrel                                                                        | MINOR                |
| T10     | Promise.all cascading failure in Dispatcher                                                           | CRITICAL             |
| T11     | Unbounded memory growth, unsafe listeners in AgentStateTracker                                        | CRITICAL             |
| T12-T14 | Agent system not wired into any app (orphaned)                                                        | CRITICAL             |
| T15     | Full verification                                                                                     | —                    |

**Not addressed (deferred to future plan):**

- Persistent stores (database-backed Registry, DeliveryStore, StateTracker) — requires Prisma schema changes
- PolicyEngine adapter to core governance — requires core refactoring
- Retry logic for failed deliveries — needs persistent store first
- Config vs profile standardization — larger refactor across all handlers
