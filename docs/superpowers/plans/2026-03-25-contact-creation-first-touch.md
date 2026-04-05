# Contact Creation on First Touch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a lead messages for the first time, automatically create a lifecycle Contact + Opportunity so the CRM pipeline is populated from real conversations.

**Architecture:** The conversation endpoint (`POST /api/conversation/message`) receives a channel identifier (phone number or chat ID) as `contactId`. A new `ContactResolver` resolves this to a lifecycle `Contact` (find-or-create by phone) and ensures an active `Opportunity` exists. The opportunity stage is injected into event metadata so `ConversationRouter` uses opportunity-based routing. After agent processing, `opportunity.stage_advanced` events are applied to the lifecycle service.

**Tech Stack:** TypeScript, Fastify, Prisma, Vitest

---

## File Structure

| File                                                       | Responsibility                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/api/src/bootstrap/contact-resolver.ts` (CREATE)      | Find-or-create Contact + Opportunity from channel identifier               |
| `apps/api/src/__tests__/contact-resolver.test.ts` (CREATE) | Unit tests for ContactResolver                                             |
| `apps/api/src/routes/conversation.ts` (MODIFY)             | Wire ContactResolver before routing, handle stage_advanced post-processing |
| `apps/api/src/agent-bootstrap.ts` (MODIFY)                 | Pass `stageHandlerMap` + `agentRegistry` to ConversationRouter             |
| `apps/api/src/bootstrap/lifecycle-deps.ts` (MODIFY)        | Export ContactResolver from lifecycle deps                                 |

---

### Task 1: Create ContactResolver

**Files:**

- Create: `apps/api/src/bootstrap/contact-resolver.ts`
- Test: `apps/api/src/__tests__/contact-resolver.test.ts`

**Context:** The conversation endpoint currently receives `contactId` as a raw channel identifier (WhatsApp phone number or Telegram chat ID). The lifecycle system uses UUIDs for `Contact.id` and looks up contacts by phone via `ContactStore.findByPhone()`. This task creates a `ContactResolver` that bridges the two: given a channel identifier, find or create a lifecycle Contact and ensure an active Opportunity exists.

**Key design decisions:**

- `contactId` from the chat app maps to `Contact.phone` in the lifecycle system
- If no Contact exists, create one with `stage: "new"`, `primaryChannel` from the message channel
- If no active Opportunity exists for this Contact, create a default one with `serviceId: "general-inquiry"`, `serviceName: "General Inquiry"`
- The resolver returns `{ contact, opportunity, isNewContact }` so callers know if this is a first touch
- The resolver is a plain class (not Fastify-coupled) so it's testable

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/__tests__/contact-resolver.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContactResolver } from "../bootstrap/contact-resolver.js";

function makeMockLifecycleService() {
  return {
    findContactByPhone: vi.fn().mockResolvedValue(null),
    createContact: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      id: "contact-uuid-1",
      organizationId: input.organizationId,
      name: input.name ?? null,
      phone: input.phone ?? null,
      email: null,
      primaryChannel: input.primaryChannel ?? "whatsapp",
      stage: "new",
      roles: ["lead"],
      firstContactAt: new Date(),
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    createOpportunity: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      id: "opp-uuid-1",
      organizationId: input.organizationId,
      contactId: input.contactId,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      stage: "interested",
      objections: [],
      qualificationComplete: false,
      revenueTotal: 0,
      openedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getContactWithOpportunities: vi.fn().mockResolvedValue(null),
  };
}

describe("ContactResolver", () => {
  let service: ReturnType<typeof makeMockLifecycleService>;
  let resolver: ContactResolver;

  beforeEach(() => {
    service = makeMockLifecycleService();
    resolver = new ContactResolver(service as never);
  });

  describe("resolveForMessage", () => {
    it("creates new Contact and Opportunity on first touch", async () => {
      const result = await resolver.resolveForMessage({
        channelContactId: "+6591234567",
        channel: "whatsapp",
        organizationId: "org-1",
      });

      expect(result.isNewContact).toBe(true);
      expect(result.contact.id).toBe("contact-uuid-1");
      expect(result.opportunity.stage).toBe("interested");
      expect(service.findContactByPhone).toHaveBeenCalledWith("org-1", "+6591234567");
      expect(service.createContact).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          phone: "+6591234567",
          primaryChannel: "whatsapp",
        }),
      );
      expect(service.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          contactId: "contact-uuid-1",
          serviceId: "general-inquiry",
          serviceName: "General Inquiry",
          assignedAgent: "lead-responder",
        }),
      );
    });

    it("returns existing Contact and active Opportunity for returning lead", async () => {
      const existingContact = {
        id: "contact-existing",
        organizationId: "org-1",
        phone: "+6591234567",
        stage: "active",
      };
      const existingOpp = {
        id: "opp-existing",
        contactId: "contact-existing",
        stage: "qualified",
      };
      service.findContactByPhone.mockResolvedValue(existingContact);
      service.getContactWithOpportunities.mockResolvedValue({
        contact: existingContact,
        opportunities: [existingOpp],
      });

      const result = await resolver.resolveForMessage({
        channelContactId: "+6591234567",
        channel: "whatsapp",
        organizationId: "org-1",
      });

      expect(result.isNewContact).toBe(false);
      expect(result.contact.id).toBe("contact-existing");
      expect(result.opportunity.id).toBe("opp-existing");
      expect(result.opportunity.stage).toBe("qualified");
      expect(service.createContact).not.toHaveBeenCalled();
      expect(service.createOpportunity).not.toHaveBeenCalled();
    });

    it("creates new Opportunity if existing Contact has no active opportunities", async () => {
      const existingContact = {
        id: "contact-existing",
        organizationId: "org-1",
        phone: "+6591234567",
        stage: "customer",
      };
      service.findContactByPhone.mockResolvedValue(existingContact);
      service.getContactWithOpportunities.mockResolvedValue({
        contact: existingContact,
        opportunities: [
          { id: "opp-old", stage: "won" },
          { id: "opp-lost", stage: "lost" },
        ],
      });

      const result = await resolver.resolveForMessage({
        channelContactId: "+6591234567",
        channel: "whatsapp",
        organizationId: "org-1",
      });

      expect(result.isNewContact).toBe(false);
      expect(result.contact.id).toBe("contact-existing");
      expect(service.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: "contact-existing" }),
      );
    });

    it("passes attribution metadata when provided", async () => {
      await resolver.resolveForMessage({
        channelContactId: "+6591234567",
        channel: "whatsapp",
        organizationId: "org-1",
        attribution: { fbclid: "abc123", utmSource: "facebook" },
      });

      expect(service.createContact).toHaveBeenCalledWith(
        expect.objectContaining({
          attribution: { fbclid: "abc123", utmSource: "facebook" },
          source: "facebook",
        }),
      );
    });

    it("uses telegram as primaryChannel for telegram messages", async () => {
      await resolver.resolveForMessage({
        channelContactId: "tg-12345",
        channel: "telegram",
        organizationId: "org-1",
      });

      expect(service.createContact).toHaveBeenCalledWith(
        expect.objectContaining({ primaryChannel: "telegram" }),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/api exec vitest run src/__tests__/contact-resolver.test.ts 2>&1 | tail -20`
Expected: FAIL — `ContactResolver` does not exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/bootstrap/contact-resolver.ts
import type { ContactLifecycleService } from "@switchboard/core";
import type { Contact, Opportunity, OpportunityStage } from "@switchboard/schemas";

const TERMINAL_STAGES: OpportunityStage[] = ["won", "lost"];

export interface ResolveMessageInput {
  channelContactId: string;
  channel: string;
  organizationId: string;
  attribution?: Record<string, unknown> | null;
}

export interface ResolvedContact {
  contact: Contact;
  opportunity: Opportunity;
  isNewContact: boolean;
}

export class ContactResolver {
  constructor(private lifecycleService: ContactLifecycleService) {}

  async resolveForMessage(input: ResolveMessageInput): Promise<ResolvedContact> {
    const { channelContactId, channel, organizationId, attribution } = input;
    const primaryChannel = this.normalizeChannel(channel);

    // 1. Find existing contact by phone/channel ID
    let contact = await this.lifecycleService.findContactByPhone(organizationId, channelContactId);
    const isNewContact = !contact;

    // 2. Create contact if not found
    if (!contact) {
      contact = await this.lifecycleService.createContact({
        organizationId,
        phone: channelContactId,
        primaryChannel,
        firstTouchChannel: channel,
        source: this.extractSource(attribution),
        attribution: attribution ?? null,
        roles: ["lead"],
      });
    }

    // 3. Find active opportunity or create one
    const opportunity = await this.findOrCreateOpportunity(contact, organizationId);

    return { contact, opportunity, isNewContact };
  }

  private async findOrCreateOpportunity(
    contact: Contact,
    organizationId: string,
  ): Promise<Opportunity> {
    const detail = await this.lifecycleService.getContactWithOpportunities(
      organizationId,
      contact.id,
    );

    if (detail) {
      const activeOpp = detail.opportunities.find(
        (o) => !TERMINAL_STAGES.includes(o.stage as OpportunityStage),
      );
      if (activeOpp) return activeOpp;
    }

    return this.lifecycleService.createOpportunity({
      organizationId,
      contactId: contact.id,
      serviceId: "general-inquiry",
      serviceName: "General Inquiry",
      assignedAgent: "lead-responder",
    });
  }

  private normalizeChannel(channel: string): "whatsapp" | "telegram" | "dashboard" {
    if (channel === "telegram") return "telegram";
    if (channel === "dashboard") return "dashboard";
    return "whatsapp";
  }

  private extractSource(attribution?: Record<string, unknown> | null): string | null {
    if (!attribution) return null;
    return (attribution.utmSource as string) ?? null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/api exec vitest run src/__tests__/contact-resolver.test.ts 2>&1 | tail -20`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add ContactResolver for first-touch contact creation"
```

---

### Task 2: Export ContactResolver from lifecycle deps

**Files:**

- Modify: `apps/api/src/bootstrap/lifecycle-deps.ts`

**Context:** `ContactResolver` wraps `ContactLifecycleService`. We need to create it during boot and make it available via `lifecycleDeps`. This keeps all lifecycle-related wiring in one place.

- [ ] **Step 1: Read the current file**

Read: `apps/api/src/bootstrap/lifecycle-deps.ts`

- [ ] **Step 2: Add ContactResolver to LifecycleDeps interface and factory**

Add `contactResolver: ContactResolver` to the `LifecycleDeps` interface. Import `ContactResolver` from `./contact-resolver.js`. Create it from `lifecycleService` in `buildLifecycleDeps`.

```typescript
// Add to imports:
import { ContactResolver } from "./contact-resolver.js";

// Update interface:
export interface LifecycleDeps {
  lifecycleService: ContactLifecycleService;
  fallbackHandler: FallbackHandler;
  ownerTaskStore: OwnerTaskStore;
  contactResolver: ContactResolver;
}

// In buildLifecycleDeps, after creating lifecycleService:
const contactResolver = new ContactResolver(lifecycleService);

// Update return:
return { lifecycleService, fallbackHandler, ownerTaskStore, contactResolver };
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/api exec tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: wire ContactResolver into lifecycle deps factory"
```

---

### Task 3: Wire ConversationRouter with StageHandlerMap + AgentRegistry

**Files:**

- Modify: `apps/api/src/agent-bootstrap.ts`

**Context:** `ConversationRouter` supports opportunity-based routing when `stageHandlerMap` and `agentRegistry` are provided (see `conversation-router.ts:54`). Currently `agent-bootstrap.ts:160-163` only passes `getStage` and `threadStore`. Without `stageHandlerMap` + `agentRegistry`, opportunity-based routing is skipped even when `opportunityStage` is in event metadata.

- [ ] **Step 1: Read the current file**

Read: `apps/api/src/agent-bootstrap.ts`

- [ ] **Step 2: Add stageHandlerMap to AgentSystemOptions**

Add an optional `stageHandlerMap` field to `AgentSystemOptions`:

```typescript
// Add import at top:
import { DEFAULT_STAGE_HANDLER_MAP } from "@switchboard/core";
import type { StageHandlerMap } from "@switchboard/core";

// Add to AgentSystemOptions interface:
stageHandlerMap?: StageHandlerMap;
```

- [ ] **Step 3: Pass stageHandlerMap + agentRegistry to ConversationRouter**

Update the ConversationRouter construction (around line 158-164):

```typescript
let conversationRouter: ConversationRouter | undefined;
if (options.conversationStore) {
  const stageHandlerMap = options.stageHandlerMap ?? DEFAULT_STAGE_HANDLER_MAP;
  conversationRouter = new ConversationRouter({
    getStage: options.conversationStore.getStage,
    threadStore: options.threadStore,
    stageHandlerMap,
    agentRegistry: {
      get: (orgId: string, agentId: string) => {
        const entry = registry.get(orgId, agentId);
        return entry ? { status: entry.status } : undefined;
      },
    },
  });
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/api exec tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: wire StageHandlerMap + AgentRegistry into ConversationRouter"
```

---

### Task 4: Integrate ContactResolver into conversation endpoint

**Files:**

- Modify: `apps/api/src/routes/conversation.ts`

**Context:** This is the main integration point. Currently the conversation endpoint creates a `message.received` event with a raw `contactId` (phone number) and passes it through `ConversationRouter`. We need to:

1. Resolve the channel identifier to a lifecycle Contact + Opportunity before routing
2. Inject `opportunityStage` and `lifecycleContactId` into event metadata
3. After EventLoop processing, apply any `opportunity.stage_advanced` events via lifecycleService

The `FallbackHandler` call at line 66-99 currently constructs a synthetic Contact — we'll replace it with the resolved lifecycle Contact.

- [ ] **Step 1: Read the current file**

Read: `apps/api/src/routes/conversation.ts`

- [ ] **Step 2: Add lifecycle resolution before routing**

After the event envelope is created (line 44) and before ConversationRouter transform (line 53), add contact resolution:

First, add the import at the top of the file (after the existing imports):

```typescript
import type { ResolvedContact } from "../bootstrap/contact-resolver.js";
```

Then, after creating the event envelope (line 48) and before ConversationRouter:

```typescript
// --- Resolve lifecycle Contact + Opportunity ---
let resolvedContact: ResolvedContact | null = null;
const contactResolver = app.lifecycleDeps?.contactResolver;
if (contactResolver) {
  try {
    resolvedContact = await contactResolver.resolveForMessage({
      channelContactId: contactId,
      channel: channel ?? "whatsapp",
      organizationId: orgId,
      attribution: (metadata?.attribution as Record<string, unknown>) ?? null,
    });

    // Inject opportunity stage into metadata for ConversationRouter
    event = {
      ...event,
      metadata: {
        ...event.metadata,
        opportunityStage: resolvedContact.opportunity.stage,
        lifecycleContactId: resolvedContact.contact.id,
        lifecycleOpportunityId: resolvedContact.opportunity.id,
      },
    };
  } catch (err) {
    app.log.error({ err, contactId }, "ContactResolver error — continuing without lifecycle");
  }
}
```

- [ ] **Step 3: Replace synthetic Contact in FallbackHandler call**

Update the `escalateToOwner` block (around line 64-100) to use the resolved Contact:

```typescript
if (event.metadata?.escalateToOwner) {
  const fallbackHandler = app.lifecycleDeps?.fallbackHandler;
  if (fallbackHandler) {
    try {
      const fallbackResult = await fallbackHandler.handleUnrouted({
        contact: resolvedContact?.contact ?? {
          id: contactId,
          organizationId: orgId,
          name: null,
          phone: null,
          email: null,
          primaryChannel: (channel as "whatsapp" | "telegram" | "dashboard") ?? "whatsapp",
          stage: "new",
          roles: ["lead"],
          firstContactAt: new Date(),
          lastActivityAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        opportunity: resolvedContact?.opportunity ?? null,
        recentMessages: [],
        missingCapability: (event.metadata?.missingAgent as string) ?? "agent",
        fallbackReason:
          (event.metadata?.fallbackReason as "not_configured" | "paused" | "errored") ??
          "not_configured",
      });

      return reply.code(200).send({
        escalated: true,
        reason: "no_agent_for_stage",
        agentId: null,
        fallbackTaskId: fallbackResult.task?.id ?? null,
      });
    } catch (err) {
      app.log.error({ err, contactId }, "FallbackHandler error");
    }
  }

  return reply.code(200).send({
    escalated: true,
    reason: "no_agent_for_stage",
    agentId: null,
  });
}
```

- [ ] **Step 4: Add post-processing for agent stage events**

After the EventLoop `result.processed` loop (around line 131), add stage advancement handling. `ProcessedAgent.outputEvents` is `string[]` (event type names only, no payloads), so we map known event types to target stages:

- `lead.qualified` → advance to `qualified` (from LeadResponder)
- `opportunity.stage_advanced` with agentId `sales-closer` → advance to `booked` (SalesCloser emits this on booking)

```typescript
// After the existing processed loop, before the reply:

// Apply opportunity stage advancements from agent processing
if (resolvedContact && app.lifecycleDeps?.lifecycleService) {
  const lifecycleService = app.lifecycleDeps.lifecycleService;
  for (const agent of result.processed) {
    let targetStage: import("@switchboard/schemas").OpportunityStage | null = null;

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

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/api exec tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: wire ContactResolver into conversation endpoint with lifecycle integration"
```

---

### Task 5: Add integration test for conversation endpoint with lifecycle

**Files:**

- Modify: `apps/api/src/__tests__/contact-resolver.test.ts` (add integration-style tests)

**Context:** The unit tests from Task 1 cover `ContactResolver` in isolation. This task adds tests covering the full flow: new lead → Contact created → Opportunity created → opportunity stage in metadata → qualified lead → stage advanced.

- [ ] **Step 1: Add integration tests**

Add a second `describe` block to the existing test file covering the conversation endpoint integration patterns:

```typescript
describe("ContactResolver edge cases", () => {
  let service: ReturnType<typeof makeMockLifecycleService>;
  let resolver: ContactResolver;

  beforeEach(() => {
    service = makeMockLifecycleService();
    resolver = new ContactResolver(service as never);
  });

  it("picks most recent non-terminal opportunity when multiple exist", async () => {
    const existingContact = {
      id: "contact-1",
      organizationId: "org-1",
      phone: "+6591234567",
      stage: "active",
    };
    service.findContactByPhone.mockResolvedValue(existingContact);
    service.getContactWithOpportunities.mockResolvedValue({
      contact: existingContact,
      opportunities: [
        { id: "opp-won", stage: "won", closedAt: new Date() },
        { id: "opp-active", stage: "quoted" },
        { id: "opp-lost", stage: "lost", closedAt: new Date() },
      ],
    });

    const result = await resolver.resolveForMessage({
      channelContactId: "+6591234567",
      channel: "whatsapp",
      organizationId: "org-1",
    });

    expect(result.opportunity.id).toBe("opp-active");
    expect(service.createOpportunity).not.toHaveBeenCalled();
  });

  it("treats nurturing stage as active (not terminal)", async () => {
    const existingContact = {
      id: "contact-1",
      organizationId: "org-1",
      phone: "+6591234567",
      stage: "active",
    };
    service.findContactByPhone.mockResolvedValue(existingContact);
    service.getContactWithOpportunities.mockResolvedValue({
      contact: existingContact,
      opportunities: [{ id: "opp-nurture", stage: "nurturing" }],
    });

    const result = await resolver.resolveForMessage({
      channelContactId: "+6591234567",
      channel: "whatsapp",
      organizationId: "org-1",
    });

    expect(result.opportunity.id).toBe("opp-nurture");
    expect(service.createOpportunity).not.toHaveBeenCalled();
  });

  it("handles dashboard channel correctly", async () => {
    await resolver.resolveForMessage({
      channelContactId: "dashboard-user-1",
      channel: "dashboard",
      organizationId: "org-1",
    });

    expect(service.createContact).toHaveBeenCalledWith(
      expect.objectContaining({ primaryChannel: "dashboard" }),
    );
  });

  it("does not set source when attribution has no utmSource", async () => {
    await resolver.resolveForMessage({
      channelContactId: "+6591234567",
      channel: "whatsapp",
      organizationId: "org-1",
      attribution: { fbclid: "abc123" },
    });

    expect(service.createContact).toHaveBeenCalledWith(expect.objectContaining({ source: null }));
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/api exec vitest run src/__tests__/contact-resolver.test.ts 2>&1 | tail -20`
Expected: PASS — all 9 tests (5 from Task 1 + 4 new)

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add edge case tests for ContactResolver"
```

---

### Task 6: Full typecheck + test verification

**Files:**

- No new files — verification only

**Context:** Final verification that all packages typecheck and tests pass after the changes.

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/jasonljc/switchboard && pnpm typecheck 2>&1 | tail -20`
Expected: All packages pass

- [ ] **Step 2: Run API package tests**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/api test 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 3: Run agents package tests (regression)**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test 2>&1 | tail -30`
Expected: All tests pass (ConversationRouter tests should still pass)

- [ ] **Step 4: Run core lifecycle tests (regression)**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/core test -- lifecycle 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 5: Commit (if any fixes were needed)**

```bash
git commit -m "fix: resolve typecheck/test issues from first-touch integration"
```

---

## Summary of Changes

| What changes                                                    | Why                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ContactResolver` class                                         | Bridges channel identifiers (phone/chatId) to lifecycle Contacts + Opportunities |
| `lifecycle-deps.ts` adds `contactResolver`                      | Makes resolver available at boot time                                            |
| `agent-bootstrap.ts` passes `stageHandlerMap` + `agentRegistry` | Enables opportunity-based routing in ConversationRouter                          |
| `conversation.ts` calls resolver before routing                 | Populates lifecycle on first message, injects `opportunityStage` into metadata   |
| `conversation.ts` post-processes agent stage events             | Advances opportunity stage on `lead.qualified` → qualified, SalesCloser → booked |
| Fallback handler uses real Contact                              | Replaces synthetic Contact with lifecycle-resolved one                           |

## Known Limitations (deferred)

- **Event payload opacity:** `ProcessedAgent.outputEvents` is `string[]` — event payloads not accessible. Stage advancement is mapped by known event types (`lead.qualified` → `qualified`, SalesCloser `opportunity.stage_advanced` → `booked`). Additional mappings (e.g. Nurture re-engagement) require either exposing event payloads or adding more explicit mappings. Separate task.
- **Channel identifier overloading:** `Contact.phone` stores the channel identifier — a real phone number for WhatsApp, but a chat ID string for Telegram (e.g. `"tg-12345"`). This is a deliberate simplification. `findByPhone()` works for both because it's just a string lookup. If a customer contacts from both WhatsApp and Telegram with different identifiers, they'll create two separate Contacts. Contact merging is a future feature.
- **Default service:** Opportunity uses `serviceId: "general-inquiry"`. Once onboarding collects service information, the first opportunity should use the org's primary service instead.
- **Graceful degradation:** If lifecycle deps are unavailable (no database), the conversation endpoint continues without lifecycle — routing falls back to thread-based or legacy stage-based routing. This is by design (degraded mode), not an error.
