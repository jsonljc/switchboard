# Phase 6: Agent Orchestration Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the double-execution problem with a read/write split, add agent state tracking for the dashboard UI, complete the Sales Closer, and build the three remaining agents (Nurture, Ad Optimizer, Revenue Tracker) to enable the full closed-loop funnel.

**Architecture:** Agent handlers call read/compute functions directly via dependency injection (no governance needed). Write operations emit action requests that go through the orchestrator → policy engine → cartridge execution. The existing event bus chains agents together — each agent's outbound events trigger downstream agents.

**Tech Stack:** TypeScript, Vitest, existing `AgentPort`/`AgentHandler` interfaces, `createEventEnvelope`, cartridge functions via DI

**Design doc:** `docs/plans/2026-03-18-phase6-agent-orchestration-design.md`
**Agent map:** `docs/plans/agent-cartridge-map.md`

---

## Phase 6A: Architecture Fixes

### Task 1: Remove Double Execution from Lead Responder

The Lead Responder currently emits a `customer-engagement.lead.qualify` action request, which re-scores the lead through the cartridge. Scoring is a read — remove the redundant action request.

**Files:**

- Modify: `packages/agents/src/agents/lead-responder/handler.ts`
- Modify: `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`

**Step 1: Update the test — remove qualify action assertion, add no-write-for-reads assertion**

In `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`, find the test `"returns qualify_lead action request"` and replace it:

```typescript
it("does not emit action requests for read-only scoring", async () => {
  const deps = makeDeps();
  const handler = new LeadResponderHandler(deps);

  const event = makeLeadEvent();
  const response = await handler.handle(event, {}, { organizationId: "org-1" });

  // Scoring is a read — no action requests for it
  const qualifyActions = response.actions.filter(
    (a) => a.actionType === "customer-engagement.lead.qualify",
  );
  expect(qualifyActions).toHaveLength(0);
});
```

**Step 2: Run tests to see the assertion fail**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL — the handler still emits the qualify action request

**Step 3: Update handler — remove the qualify action request**

In `packages/agents/src/agents/lead-responder/handler.ts`, replace the `actions` array construction (around lines 48-60):

Before:

```typescript
// Build action request for cartridge execution
const actions = [
  {
    actionType: "customer-engagement.lead.qualify",
    parameters: {
      contactId,
      ...payload,
      sourceAdId: event.attribution?.sourceAdId,
      sourceCampaignId: event.attribution?.sourceCampaignId,
    },
  },
];
```

After:

```typescript
// No action request for scoring — it's a read, already done via deps.scoreLead()
// Only writes (booking, sending messages, etc.) produce action requests
const actions: Array<{ actionType: string; parameters: Record<string, unknown> }> = [];
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS — also update `"passes event payload to scoreLead"` test if it asserts on actions count

**Step 5: Commit**

```bash
git add packages/agents/src/agents/lead-responder/handler.ts packages/agents/src/agents/lead-responder/__tests__/handler.test.ts
git commit -m "fix(agents): remove double-execution from Lead Responder scoring

Scoring is a read operation — the agent calls deps.scoreLead() directly.
Remove the redundant customer-engagement.lead.qualify action request
that re-scored the lead through the cartridge."
```

---

### Task 2: Add AgentStateTracker

The dashboard UI shows each agent's activity status (`idle`, `working`, `analyzing`, `waiting_approval`, `error`), current task, and last action summary. Add a state tracker that agents update as they process events.

**Files:**

- Create: `packages/agents/src/agent-state.ts`
- Create: `packages/agents/src/__tests__/agent-state.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/agent-state.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentStateTracker, type AgentActivityState } from "../agent-state.js";

describe("AgentStateTracker", () => {
  let tracker: AgentStateTracker;

  beforeEach(() => {
    tracker = new AgentStateTracker();
  });

  it("initializes agent state as idle", () => {
    const state = tracker.get("org-1", "lead-responder");
    expect(state).toBeUndefined();
  });

  it("tracks working state when agent starts processing", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring lead c1");

    const state = tracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("working");
    expect(state.currentTask).toBe("Scoring lead c1");
  });

  it("tracks completed state with summary", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring lead c1");
    tracker.completeProcessing("org-1", "lead-responder", "Qualified lead c1 (score: 75, hot)");

    const state = tracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("idle");
    expect(state.currentTask).toBeNull();
    expect(state.lastActionSummary).toBe("Qualified lead c1 (score: 75, hot)");
    expect(state.lastActiveAt).toBeDefined();
  });

  it("tracks error state", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring lead c1");
    tracker.setError("org-1", "lead-responder", "Scoring function threw");

    const state = tracker.get("org-1", "lead-responder")!;
    expect(state.activityStatus).toBe("error");
    expect(state.lastError).toBe("Scoring function threw");
  });

  it("tracks waiting_approval state", () => {
    tracker.setWaitingApproval("org-1", "sales-closer", "Booking requires approval");

    const state = tracker.get("org-1", "sales-closer")!;
    expect(state.activityStatus).toBe("waiting_approval");
    expect(state.currentTask).toBe("Booking requires approval");
  });

  it("lists all states for an org", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring");
    tracker.completeProcessing("org-1", "lead-responder", "Done");
    tracker.startProcessing("org-1", "sales-closer", "Booking");

    const states = tracker.listForOrg("org-1");
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.agentId).sort()).toEqual(["lead-responder", "sales-closer"]);
  });

  it("increments eventsProcessed on complete", () => {
    tracker.startProcessing("org-1", "lead-responder", "Scoring");
    tracker.completeProcessing("org-1", "lead-responder", "Done");
    tracker.startProcessing("org-1", "lead-responder", "Scoring again");
    tracker.completeProcessing("org-1", "lead-responder", "Done again");

    const state = tracker.get("org-1", "lead-responder")!;
    expect(state.eventsProcessed).toBe(2);
  });

  it("notifies listeners on state change", () => {
    const listener = vi.fn();
    tracker.onStateChange(listener);

    tracker.startProcessing("org-1", "lead-responder", "Scoring");
    expect(listener).toHaveBeenCalledWith(
      "org-1",
      "lead-responder",
      expect.objectContaining({ activityStatus: "working" }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/agents/src/agent-state.ts`:

```typescript
// ---------------------------------------------------------------------------
// Agent State Tracker — powers dashboard UI activity status
// ---------------------------------------------------------------------------

export type ActivityStatus = "idle" | "working" | "analyzing" | "waiting_approval" | "error";

export interface AgentActivityState {
  agentId: string;
  activityStatus: ActivityStatus;
  currentTask: string | null;
  lastActionSummary: string | null;
  lastActiveAt: string | null;
  lastError: string | null;
  eventsProcessed: number;
}

export type StateChangeListener = (
  organizationId: string,
  agentId: string,
  state: AgentActivityState,
) => void;

export class AgentStateTracker {
  private states = new Map<string, Map<string, AgentActivityState>>();
  private listeners: StateChangeListener[] = [];

  get(organizationId: string, agentId: string): AgentActivityState | undefined {
    return this.states.get(organizationId)?.get(agentId);
  }

  listForOrg(organizationId: string): AgentActivityState[] {
    const orgMap = this.states.get(organizationId);
    return orgMap ? [...orgMap.values()] : [];
  }

  startProcessing(organizationId: string, agentId: string, task: string): void {
    this.update(organizationId, agentId, {
      activityStatus: "working",
      currentTask: task,
    });
  }

  completeProcessing(organizationId: string, agentId: string, summary: string): void {
    const current = this.getOrCreate(organizationId, agentId);
    this.update(organizationId, agentId, {
      activityStatus: "idle",
      currentTask: null,
      lastActionSummary: summary,
      lastActiveAt: new Date().toISOString(),
      eventsProcessed: current.eventsProcessed + 1,
    });
  }

  setError(organizationId: string, agentId: string, error: string): void {
    this.update(organizationId, agentId, {
      activityStatus: "error",
      lastError: error,
    });
  }

  setWaitingApproval(organizationId: string, agentId: string, task: string): void {
    this.update(organizationId, agentId, {
      activityStatus: "waiting_approval",
      currentTask: task,
    });
  }

  onStateChange(listener: StateChangeListener): void {
    this.listeners.push(listener);
  }

  private getOrCreate(organizationId: string, agentId: string): AgentActivityState {
    let orgMap = this.states.get(organizationId);
    if (!orgMap) {
      orgMap = new Map();
      this.states.set(organizationId, orgMap);
    }

    let state = orgMap.get(agentId);
    if (!state) {
      state = {
        agentId,
        activityStatus: "idle",
        currentTask: null,
        lastActionSummary: null,
        lastActiveAt: null,
        lastError: null,
        eventsProcessed: 0,
      };
      orgMap.set(agentId, state);
    }

    return state;
  }

  private update(
    organizationId: string,
    agentId: string,
    partial: Partial<AgentActivityState>,
  ): void {
    const state = this.getOrCreate(organizationId, agentId);
    Object.assign(state, partial);
    for (const listener of this.listeners) {
      listener(organizationId, agentId, state);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agent-state.ts packages/agents/src/__tests__/agent-state.test.ts
git commit -m "feat(agents): add AgentStateTracker for dashboard activity status"
```

---

### Task 3: Integrate AgentStateTracker into Dispatcher

Wire the state tracker into the dispatch pipeline so agents automatically report their activity status as events flow through.

**Files:**

- Modify: `packages/agents/src/dispatcher.ts`
- Modify: `packages/agents/src/__tests__/dispatcher.test.ts`

**Step 1: Write the failing test**

Add to `packages/agents/src/__tests__/dispatcher.test.ts`:

```typescript
import { AgentStateTracker } from "../agent-state.js";

// Add to existing test suite:

it("updates agent state tracker when dispatching to agents", async () => {
  const stateTracker = new AgentStateTracker();
  const dispatcher = new Dispatcher({
    deliveryStore: new InMemoryDeliveryStore(),
    policyBridge: new PolicyBridge(alwaysApprove),
    handlers: {
      agent: vi.fn().mockResolvedValue({ success: true }),
    },
    stateTracker,
  });

  const event = createEventEnvelope({
    organizationId: "org-1",
    eventType: "lead.received",
    source: { type: "system", id: "test" },
    payload: {},
  });

  const plan: RoutePlan = {
    event,
    destinations: [
      { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
    ],
  };

  await dispatcher.execute(plan);

  const state = stateTracker.get("org-1", "lead-responder")!;
  expect(state.activityStatus).toBe("idle");
  expect(state.eventsProcessed).toBe(1);
  expect(state.lastActionSummary).toContain("lead.received");
});

it("sets error state when agent handler fails", async () => {
  const stateTracker = new AgentStateTracker();
  const dispatcher = new Dispatcher({
    deliveryStore: new InMemoryDeliveryStore(),
    policyBridge: new PolicyBridge(alwaysApprove),
    handlers: {
      agent: vi.fn().mockRejectedValue(new Error("handler crashed")),
    },
    stateTracker,
  });

  const event = createEventEnvelope({
    organizationId: "org-1",
    eventType: "lead.received",
    source: { type: "system", id: "test" },
    payload: {},
  });

  const plan: RoutePlan = {
    event,
    destinations: [
      { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
    ],
  };

  await dispatcher.execute(plan);

  const state = stateTracker.get("org-1", "lead-responder")!;
  expect(state.activityStatus).toBe("error");
  expect(state.lastError).toBe("handler crashed");
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL — `stateTracker` not recognized in DispatcherConfig

**Step 3: Update Dispatcher to accept and use stateTracker**

In `packages/agents/src/dispatcher.ts`, add the state tracker as an optional config field:

```typescript
import type { AgentStateTracker } from "./agent-state.js";

export interface DispatcherConfig {
  deliveryStore: DeliveryStore;
  policyBridge: PolicyBridge;
  handlers: Partial<Record<DestinationType, DestinationHandler>>;
  stateTracker?: AgentStateTracker;
}
```

Add a `private stateTracker?: AgentStateTracker` field in the constructor.

In the `dispatchOne` method, wrap the agent dispatch path with state tracking:

```typescript
// Before dispatching to agent handler:
if (type === "agent" && this.stateTracker) {
  this.stateTracker.startProcessing(
    event.organizationId,
    destinationId,
    `Processing ${event.eventType}`,
  );
}

// On success:
if (type === "agent" && this.stateTracker) {
  this.stateTracker.completeProcessing(
    event.organizationId,
    destinationId,
    `Processed ${event.eventType}`,
  );
}

// On failure (in catch block):
if (type === "agent" && this.stateTracker) {
  this.stateTracker.setError(event.organizationId, destinationId, error);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/dispatcher.ts packages/agents/src/__tests__/dispatcher.test.ts
git commit -m "feat(agents): integrate AgentStateTracker into Dispatcher"
```

---

### Task 4: Export AgentStateTracker from barrel

**Files:**

- Modify: `packages/agents/src/index.ts`

**Step 1: Add exports**

Add to `packages/agents/src/index.ts`:

```typescript
export {
  AgentStateTracker,
  type ActivityStatus,
  type AgentActivityState,
  type StateChangeListener,
} from "./agent-state.js";
```

**Step 2: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents typecheck`
Expected: clean

**Step 3: Commit**

```bash
git add packages/agents/src/index.ts
git commit -m "feat(agents): export AgentStateTracker from barrel"
```

---

## Phase 6B: Complete Existing Agents

### Task 5: Wire FAQ Matching into Lead Responder

The `matchFAQ` function exists in `customer-engagement` but isn't wired into the Lead Responder. Add it as an optional dependency.

**Files:**

- Modify: `packages/agents/src/agents/lead-responder/types.ts`
- Modify: `packages/agents/src/agents/lead-responder/handler.ts`
- Modify: `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Add to the handler test file:

```typescript
it("returns FAQ response when message matches FAQ", async () => {
  const deps = makeDeps({
    matchFAQ: vi.fn().mockReturnValue({
      matched: true,
      question: "Does Botox hurt?",
      answer: "Most patients report minimal discomfort.",
      confidence: 0.92,
    }),
  });
  const handler = new LeadResponderHandler(deps);

  const event = makeLeadEvent({ messageText: "Does Botox hurt?" });
  const response = await handler.handle(event, {}, { organizationId: "org-1" });

  expect(response.state?.faqResponse).toBe("Most patients report minimal discomfort.");
  expect(deps.matchFAQ).toHaveBeenCalledWith("Does Botox hurt?");
});

it("skips FAQ when no matchFAQ dep provided", async () => {
  const deps = makeDeps(); // no matchFAQ
  const handler = new LeadResponderHandler(deps);

  const event = makeLeadEvent({ messageText: "Does Botox hurt?" });
  const response = await handler.handle(event, {}, { organizationId: "org-1" });

  expect(response.state?.faqResponse).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL — `matchFAQ` not in `LeadResponderDeps`

**Step 3: Add FAQMatch type and dep to types.ts**

Add to `packages/agents/src/agents/lead-responder/types.ts`:

```typescript
/**
 * FAQ match result.
 */
export type FAQMatch =
  | { matched: true; question: string; answer: string; confidence: number }
  | { matched: false };

// Add to LeadResponderDeps interface:
export interface LeadResponderDeps {
  scoreLead: (params: Record<string, unknown>) => LeadScore;
  matchObjection?: (text: string) => ObjectionMatch;
  /** Match message text against FAQ knowledge base. */
  matchFAQ?: (text: string) => FAQMatch;
}
```

**Step 4: Update handler to use matchFAQ**

In `packages/agents/src/agents/lead-responder/handler.ts`, add FAQ handling after objection handling:

```typescript
// Handle FAQ if message text present
const messageText = payload.messageText as string | undefined;
let faqResponse: string | undefined;
if (messageText && this.deps.matchFAQ) {
  const faqResult = this.deps.matchFAQ(messageText);
  if (faqResult.matched) {
    faqResponse = faqResult.answer;
  }
}
```

Include `faqResponse` in the returned state:

```typescript
return {
  events,
  actions,
  state: {
    lastScore: scoreResult.score,
    lastTier: scoreResult.tier,
    qualified,
    ...(faqResponse ? { faqResponse } : {}),
  },
};
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 6: Update barrel export to include FAQMatch**

In `packages/agents/src/agents/lead-responder/index.ts`, add `type FAQMatch` to the type exports.

**Step 7: Commit**

```bash
git add packages/agents/src/agents/lead-responder/
git commit -m "feat(agents): wire FAQ matching into Lead Responder handler"
```

---

### Task 6: Add Sales Closer Dependency Injection

The Sales Closer handler currently has no injected deps — it reads booking config from context.profile. Add DI for calendar availability and CRM deal creation (reads), keeping booking as a write action request.

**Files:**

- Create: `packages/agents/src/agents/sales-closer/types.ts`
- Modify: `packages/agents/src/agents/sales-closer/handler.ts`
- Modify: `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`
- Modify: `packages/agents/src/agents/sales-closer/index.ts`

**Step 1: Write the types file**

Create `packages/agents/src/agents/sales-closer/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// Sales Closer — Dependency types (injected at construction time)
// ---------------------------------------------------------------------------

export interface AvailableSlot {
  startTime: string;
  endTime: string;
  providerId: string;
  providerName?: string;
}

export interface ContactInfo {
  contactId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

/**
 * Dependencies injected into the Sales Closer handler.
 * The app layer wires these from cartridge implementations.
 */
export interface SalesCloserDeps {
  /** Check available appointment slots. READ — no governance needed. */
  getAvailableSlots?: (params: {
    serviceType: string;
    durationMinutes: number;
    date?: string;
  }) => Promise<AvailableSlot[]>;

  /** Look up contact info. READ — no governance needed. */
  getContact?: (contactId: string) => Promise<ContactInfo | null>;
}
```

**Step 2: Write the failing test**

Add to `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`:

```typescript
it("checks availability before booking when dep provided", async () => {
  const deps: SalesCloserDeps = {
    getAvailableSlots: vi
      .fn()
      .mockResolvedValue([
        { startTime: "2026-03-19T10:00:00Z", endTime: "2026-03-19T11:00:00Z", providerId: "p1" },
      ]),
  };
  const handler = new SalesCloserHandler(deps);

  const event = makeQualifiedLeadEvent();
  const response = await handler.handle(
    event,
    {},
    {
      organizationId: "org-1",
      profile: { booking: { bookingUrl: "https://cal.com/demo" } },
    },
  );

  expect(deps.getAvailableSlots).toHaveBeenCalled();
  expect(response.state?.availableSlots).toBe(1);
});

it("escalates when no slots available", async () => {
  const deps: SalesCloserDeps = {
    getAvailableSlots: vi.fn().mockResolvedValue([]),
  };
  const handler = new SalesCloserHandler(deps);

  const event = makeQualifiedLeadEvent();
  const response = await handler.handle(
    event,
    {},
    {
      organizationId: "org-1",
      profile: { booking: { bookingUrl: "https://cal.com/demo" } },
    },
  );

  const escalation = response.events.find((e) => e.eventType === "conversation.escalated");
  expect(escalation).toBeDefined();
  expect(escalation!.payload).toEqual(expect.objectContaining({ reason: "no_available_slots" }));
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 4: Update handler to accept deps**

Modify `packages/agents/src/agents/sales-closer/handler.ts`:

- Add constructor that accepts `SalesCloserDeps` (optional, defaults to `{}`)
- Before emitting the booking action, check availability if `deps.getAvailableSlots` is provided
- If no slots, escalate with reason `"no_available_slots"`
- Add slot count to state

**Step 5: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 6: Update barrel exports**

In `packages/agents/src/agents/sales-closer/index.ts`:

```typescript
export { SALES_CLOSER_PORT } from "./port.js";
export { SalesCloserHandler } from "./handler.js";
export type { SalesCloserDeps, AvailableSlot, ContactInfo } from "./types.js";
```

Update `packages/agents/src/index.ts` to export the new types.

**Step 7: Commit**

```bash
git add packages/agents/src/agents/sales-closer/
git commit -m "feat(agents): add dependency injection to Sales Closer handler"
```

---

## Phase 6C: New Agents

### Task 7: Nurture Agent — Port + Types + Handler

**Files:**

- Create: `packages/agents/src/agents/nurture/port.ts`
- Create: `packages/agents/src/agents/nurture/types.ts`
- Create: `packages/agents/src/agents/nurture/handler.ts`
- Create: `packages/agents/src/agents/nurture/index.ts`
- Create: `packages/agents/src/agents/nurture/__tests__/port.test.ts`
- Create: `packages/agents/src/agents/nurture/__tests__/handler.test.ts`

**Step 1: Write port test**

```typescript
import { describe, it, expect } from "vitest";
import { NURTURE_AGENT_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Nurture Agent Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(NURTURE_AGENT_PORT);
    expect(result.valid).toBe(true);
  });

  it("accepts disqualified leads, stage advances, and revenue events", () => {
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("lead.disqualified");
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("stage.advanced");
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("revenue.recorded");
  });

  it("emits stage.advanced and lead.qualified", () => {
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("stage.advanced");
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("lead.qualified");
  });
});
```

**Step 2: Write port implementation**

```typescript
import type { AgentPort } from "../../ports.js";

export const NURTURE_AGENT_PORT: AgentPort = {
  agentId: "nurture",
  version: "0.1.0",
  inboundEvents: ["lead.disqualified", "stage.advanced", "revenue.recorded"],
  outboundEvents: ["stage.advanced", "lead.qualified"],
  tools: [
    {
      name: "start_cadence",
      description: "Start a multi-step follow-up cadence for a contact",
      parameters: { contactId: "string", cadenceType: "string" },
    },
    {
      name: "send_reminder",
      description: "Send a reminder to a contact",
      parameters: { contactId: "string", message: "string" },
    },
    {
      name: "request_review",
      description: "Send a review solicitation after completed service",
      parameters: { contactId: "string", platform: "string" },
    },
  ],
  configSchema: {
    coldNurtureCadenceId: "string",
    postServiceCadenceId: "string",
    reactivationDays: "number (default: 30)",
    reviewRequestDelay: "number (default: 24h)",
  },
};
```

**Step 3: Write types**

```typescript
export interface CadenceStatus {
  active: boolean;
  cadenceId: string;
  currentStep: number;
  totalSteps: number;
}

export interface ActivityAnalysis {
  dormantContacts: string[];
  overdueFollowUps: string[];
  unengagedLeads: string[];
}

export interface NurtureAgentDeps {
  /** Check if contact has an active cadence. READ. */
  getCadenceStatus?: (contactId: string) => CadenceStatus | null;

  /** Analyze contact activity patterns. READ. */
  analyzeActivity?: (contactId: string) => ActivityAnalysis;

  /** Score lifetime value. READ. */
  scoreLtv?: (contactId: string) => { score: number; tier: string };
}
```

**Step 4: Write handler tests**

Key test cases:

- `lead.disqualified` → starts cold nurture cadence (WRITE: `customer-engagement.cadence.start`)
- `stage.advanced` to `booked` → sends reminder (WRITE: `customer-engagement.reminder.send`)
- `revenue.recorded` → requests review after delay (WRITE: `customer-engagement.review.request`)
- Skips cadence start if contact already has active cadence (READ: `getCadenceStatus`)
- Re-qualifies lead if LTV score is high enough (emits `lead.qualified` event)

**Step 5: Write handler implementation**

Follow the same pattern as Lead Responder:

- Constructor accepts `NurtureAgentDeps`
- Reads via injected deps (no governance)
- Writes via action requests (governance)
- Emits downstream events

**Step 6: Run all tests, commit**

```bash
git commit -m "feat(agents): add Nurture Agent with cadence and review handling"
```

---

### Task 8: Ad Optimizer — Port + Types + Handler

**Files:**

- Create: `packages/agents/src/agents/ad-optimizer/port.ts`
- Create: `packages/agents/src/agents/ad-optimizer/types.ts`
- Create: `packages/agents/src/agents/ad-optimizer/handler.ts`
- Create: `packages/agents/src/agents/ad-optimizer/index.ts`
- Create: `packages/agents/src/agents/ad-optimizer/__tests__/port.test.ts`
- Create: `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts`

**Port declaration:**

```typescript
export const AD_OPTIMIZER_PORT: AgentPort = {
  agentId: "ad-optimizer",
  version: "0.1.0",
  inboundEvents: ["revenue.attributed"],
  outboundEvents: ["ad.optimized"],
  tools: [
    {
      name: "adjust_budget",
      description: "Adjust campaign budget based on ROAS data",
      parameters: { campaignId: "string", newBudget: "number" },
    },
    {
      name: "pause_campaign",
      description: "Pause an underperforming campaign",
      parameters: { campaignId: "string" },
    },
  ],
  configSchema: {
    targetROAS: "number (default: 4.0)",
    maxBudgetChangePercent: "number (default: 20)",
    minDataDays: "number (default: 7)",
  },
};
```

**Types — READ deps:**

```typescript
export interface AdOptimizerDeps {
  /** Diagnose funnel performance. READ. */
  diagnoseFunnel?: (params: {
    platform: string;
    entityId: string;
    vertical: string;
  }) => Promise<{ bottleneck: string; findings: unknown[]; roas: number }>;

  /** Fetch campaign snapshot. READ. */
  fetchSnapshot?: (params: {
    platform: string;
    entityId: string;
  }) => Promise<{ spend: number; revenue: number; conversions: number }>;

  /** Run structural analysis. READ. */
  analyzeStructure?: (params: {
    platform: string;
    entityId: string;
  }) => Promise<{ findings: unknown[] }>;
}
```

**Handler key behaviors:**

- `revenue.attributed` → reads performance data via deps
- If ROAS below target → emits WRITE action `digital-ads.campaign.adjust_budget`
- If campaign bleeding money → emits WRITE action `digital-ads.campaign.pause`
- Emits `ad.optimized` event with summary of changes

**Step: Run all tests, commit**

```bash
git commit -m "feat(agents): add Ad Optimizer agent with budget adjustment"
```

---

### Task 9: Revenue Tracker — Port + Types + Handler

**Files:**

- Create: `packages/agents/src/agents/revenue-tracker/port.ts`
- Create: `packages/agents/src/agents/revenue-tracker/types.ts`
- Create: `packages/agents/src/agents/revenue-tracker/handler.ts`
- Create: `packages/agents/src/agents/revenue-tracker/index.ts`
- Create: `packages/agents/src/agents/revenue-tracker/__tests__/port.test.ts`
- Create: `packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts`

**Port declaration:**

```typescript
export const REVENUE_TRACKER_PORT: AgentPort = {
  agentId: "revenue-tracker",
  version: "0.1.0",
  inboundEvents: ["revenue.recorded", "stage.advanced", "ad.optimized"],
  outboundEvents: ["revenue.attributed"],
  tools: [
    {
      name: "attribute_revenue",
      description: "Compute per-campaign revenue attribution",
      parameters: { organizationId: "string" },
    },
    {
      name: "send_conversion",
      description: "Send offline conversion to ad platform",
      parameters: { platform: "string", conversionData: "object" },
    },
  ],
  configSchema: {
    attributionWindow: "number (default: 28 days)",
    attributionModel: "last_click | linear | time_decay (default: last_click)",
    enabledPlatforms: "string[] (default: ['meta'])",
  },
};
```

**Types — READ deps:**

```typescript
export interface RevenueTrackerDeps {
  /** Get pipeline status for attribution context. READ. */
  getPipelineStatus?: () => Promise<{ stages: unknown[]; totalValue: number }>;

  /** Query existing attribution data. READ. */
  getAttribution?: (params: {
    campaignId: string;
  }) => Promise<{ leads: number; bookings: number; revenue: number; roas: number } | null>;

  /** Fetch ad snapshot for cross-referencing. READ. */
  fetchAdSnapshot?: (params: {
    platform: string;
    entityId: string;
  }) => Promise<{ spend: number; impressions: number; clicks: number }>;
}
```

**Handler key behaviors:**

- `revenue.recorded` → reads attribution chain from event, computes per-campaign attribution
- Emits WRITE actions for offline conversion dispatch:
  - `digital-ads.capi.dispatch` (Meta) — if `fbclid` present
  - `digital-ads.google.offline_conversion` (Google) — if `gclid` present
  - `digital-ads.tiktok.offline_conversion` (TikTok) — if `ttclid` present
- Emits `revenue.attributed` event with rollup data
- `stage.advanced` → logs stage transition for attribution context (WRITE: `crm.activity.log`)

**Step: Run all tests, commit**

```bash
git commit -m "feat(agents): add Revenue Tracker agent with attribution and conversion dispatch"
```

---

### Task 10: Add Offline Conversion Action Types to Digital Ads Manifest

The Revenue Tracker needs to send conversions back to ad platforms. These action types don't exist yet.

**Files:**

- Modify: `cartridges/digital-ads/src/cartridge/manifest/reporting-signal-actions.ts`

**Step 1: Add the new action definitions**

```typescript
{
  actionType: "digital-ads.capi.dispatch",
  name: "Send Meta CAPI Conversion",
  description: "Send an offline conversion event to Meta Conversions API for optimization.",
  parametersSchema: {
    type: "object",
    required: ["eventName", "eventTime"],
    properties: {
      eventName: { type: "string", enum: ["Purchase", "Lead", "CompleteRegistration"] },
      eventTime: { type: "string", description: "ISO 8601 timestamp" },
      userData: { type: "object", description: "Hashed user data (email, phone, fbclid)" },
      customData: { type: "object", description: "Event value, currency, content IDs" },
    },
  },
  baseRiskCategory: "medium",
  reversible: false,
},
{
  actionType: "digital-ads.google.offline_conversion",
  name: "Send Google Offline Conversion",
  description: "Upload an offline conversion to Google Ads for optimization.",
  parametersSchema: {
    type: "object",
    required: ["conversionAction", "gclid", "conversionDateTime"],
    properties: {
      conversionAction: { type: "string" },
      gclid: { type: "string" },
      conversionDateTime: { type: "string" },
      conversionValue: { type: "number" },
      currencyCode: { type: "string" },
    },
  },
  baseRiskCategory: "medium",
  reversible: false,
},
{
  actionType: "digital-ads.tiktok.offline_conversion",
  name: "Send TikTok Offline Conversion",
  description: "Send an offline conversion event to TikTok Events API.",
  parametersSchema: {
    type: "object",
    required: ["eventName", "ttclid", "timestamp"],
    properties: {
      eventName: { type: "string", enum: ["CompletePayment", "SubmitForm"] },
      ttclid: { type: "string" },
      timestamp: { type: "string" },
      properties: { type: "object", description: "Event value and currency" },
    },
  },
  baseRiskCategory: "medium",
  reversible: false,
},
```

**Step 2: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/digital-ads typecheck`
Expected: clean

**Step 3: Commit**

```bash
git add cartridges/digital-ads/src/cartridge/manifest/reporting-signal-actions.ts
git commit -m "feat(digital-ads): add offline conversion action types for CAPI, Google, TikTok"
```

---

### Task 11: Barrel Exports + Final Build Verification

**Files:**

- Modify: `packages/agents/src/index.ts`

**Step 1: Add exports for all new agents**

```typescript
export {
  NURTURE_AGENT_PORT,
  NurtureAgentHandler,
  type NurtureAgentDeps,
} from "./agents/nurture/index.js";

export {
  AD_OPTIMIZER_PORT,
  AdOptimizerHandler,
  type AdOptimizerDeps,
} from "./agents/ad-optimizer/index.js";

export {
  REVENUE_TRACKER_PORT,
  RevenueTrackerHandler,
  type RevenueTrackerDeps,
} from "./agents/revenue-tracker/index.js";
```

**Step 2: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents typecheck`
Expected: clean

**Step 3: Run full agents tests**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: ALL PASS

**Step 4: Run workspace build**

Run: `cd /Users/jasonljc/switchboard && pnpm build`
Expected: all packages build

**Step 5: Run full workspace tests**

Run: `cd /Users/jasonljc/switchboard && pnpm test`
Expected: no regressions

**Step 6: Commit**

```bash
git add packages/agents/src/index.ts
git commit -m "feat(agents): complete Phase 6 agent orchestration layer"
```

---

## Implementation Order

```
Phase 6A — Architecture Fixes
  Task 1:  Remove double execution from Lead Responder   (standalone)
  Task 2:  Add AgentStateTracker                          (standalone)
  Task 3:  Integrate state tracker into Dispatcher        (depends on Task 2)
  Task 4:  Export AgentStateTracker from barrel            (depends on Task 2)

Phase 6B — Complete Existing Agents
  Task 5:  Wire FAQ matching into Lead Responder          (standalone)
  Task 6:  Add Sales Closer dependency injection          (standalone)

Phase 6C — New Agents
  Task 7:  Nurture Agent                                  (standalone)
  Task 8:  Ad Optimizer                                   (standalone)
  Task 9:  Revenue Tracker                                (standalone)
  Task 10: Add offline conversion action types            (standalone)
  Task 11: Barrel exports + final build                   (depends on all above)
```

Tasks 1, 2, 5, 6 are independent (can be parallelized).
Tasks 7, 8, 9, 10 are independent (can be parallelized).
Task 11 is the final gate.

## Files Summary

| Action | File                                                                        | Task    |
| ------ | --------------------------------------------------------------------------- | ------- |
| MODIFY | `packages/agents/src/agents/lead-responder/handler.ts`                      | T1, T5  |
| MODIFY | `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`       | T1, T5  |
| MODIFY | `packages/agents/src/agents/lead-responder/types.ts`                        | T5      |
| MODIFY | `packages/agents/src/agents/lead-responder/index.ts`                        | T5      |
| CREATE | `packages/agents/src/agent-state.ts`                                        | T2      |
| CREATE | `packages/agents/src/__tests__/agent-state.test.ts`                         | T2      |
| MODIFY | `packages/agents/src/dispatcher.ts`                                         | T3      |
| MODIFY | `packages/agents/src/__tests__/dispatcher.test.ts`                          | T3      |
| CREATE | `packages/agents/src/agents/sales-closer/types.ts`                          | T6      |
| MODIFY | `packages/agents/src/agents/sales-closer/handler.ts`                        | T6      |
| MODIFY | `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`         | T6      |
| MODIFY | `packages/agents/src/agents/sales-closer/index.ts`                          | T6      |
| CREATE | `packages/agents/src/agents/nurture/port.ts`                                | T7      |
| CREATE | `packages/agents/src/agents/nurture/types.ts`                               | T7      |
| CREATE | `packages/agents/src/agents/nurture/handler.ts`                             | T7      |
| CREATE | `packages/agents/src/agents/nurture/index.ts`                               | T7      |
| CREATE | `packages/agents/src/agents/nurture/__tests__/port.test.ts`                 | T7      |
| CREATE | `packages/agents/src/agents/nurture/__tests__/handler.test.ts`              | T7      |
| CREATE | `packages/agents/src/agents/ad-optimizer/port.ts`                           | T8      |
| CREATE | `packages/agents/src/agents/ad-optimizer/types.ts`                          | T8      |
| CREATE | `packages/agents/src/agents/ad-optimizer/handler.ts`                        | T8      |
| CREATE | `packages/agents/src/agents/ad-optimizer/index.ts`                          | T8      |
| CREATE | `packages/agents/src/agents/ad-optimizer/__tests__/port.test.ts`            | T8      |
| CREATE | `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts`         | T8      |
| CREATE | `packages/agents/src/agents/revenue-tracker/port.ts`                        | T9      |
| CREATE | `packages/agents/src/agents/revenue-tracker/types.ts`                       | T9      |
| CREATE | `packages/agents/src/agents/revenue-tracker/handler.ts`                     | T9      |
| CREATE | `packages/agents/src/agents/revenue-tracker/index.ts`                       | T9      |
| CREATE | `packages/agents/src/agents/revenue-tracker/__tests__/port.test.ts`         | T9      |
| CREATE | `packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts`      | T9      |
| MODIFY | `cartridges/digital-ads/src/cartridge/manifest/reporting-signal-actions.ts` | T10     |
| MODIFY | `packages/agents/src/index.ts`                                              | T4, T11 |
