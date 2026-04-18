# Alex Wedge Live Wiring — Design Spec

**Date:** 2026-04-18
**Status:** Approved
**Scope:** Alex only, WhatsApp only, one org, one Google Calendar

## Problem

The converged skill execution path (SkillMode + SkillExecutor + PlatformIngress) exists in `packages/core` but is **never activated in the apps**. The API server registers only `CartridgeMode`. The chat app's gateway bridge has a throwing stub for `PlatformIngress`. WhatsApp messages go through a legacy `RuleBasedInterpreter` → HTTP → `CartridgeMode` path with no tool calling capability.

The `calendar-book` tool exists but is unreachable from any live conversation. Alex currently delivers a booking link as plain text — the lead must click the URL and self-serve.

## Success Criteria

A WhatsApp lead talks to Alex. Alex qualifies. Alex queries available slots. Lead selects a slot (by replying with a number). Alex books. The booked event fans out through the outbox → durable bus → CRM updater + attribution store. The ROI dashboard shows the conversion.

## Two Phases

**Phase A — Activate converged skill runtime (not Alex-specific):**

1. Register `SkillMode` in the API server's `ExecutionModeRegistry`
2. Wire real `PlatformIngress` into the chat app gateway bridge
3. Route skill-backed deployments to `SkillMode` (deployment has `skillSlug` → intent resolves to skill mode)

**Phase B — Wire Alex booking wedge:** 4. Register `createCalendarBookTool` in the tools map 5. Update Alex skill prompt for slots → select → book 6. Seed org business hours in `OrganizationConfig` 7. Fix deployment connection loading to include WhatsApp

---

## Phase A: Activate Converged Skill Runtime

### A1. Register SkillMode in the API server

**File:** `apps/api/src/app.ts` (around line 349-350)

Currently:

```typescript
const modeRegistry = new ExecutionModeRegistry();
modeRegistry.register(new CartridgeMode({ orchestrator, intentRegistry }));
```

Add `SkillMode` registration after `CartridgeMode`:

```typescript
import { SkillMode } from "@switchboard/core/platform";
import { SkillExecutorImpl } from "@switchboard/core/skill-runtime";
import { SkillLoader } from "@switchboard/core/skill-runtime";
import {
  createCrmQueryTool,
  createCrmWriteTool,
  createCalendarBookTool,
} from "@switchboard/core/skill-runtime/tools";

// Load skill definitions from skills/ directory
const skillLoader = new SkillLoader(path.join(process.cwd(), "../../skills"));
const skillsBySlug = await skillLoader.loadAll();

// Build tools map
const tools = new Map();
tools.set("crm-query", createCrmQueryTool(contactStore, activityStore));
tools.set("crm-write", createCrmWriteTool(opportunityStore, activityStore));
tools.set(
  "calendar-book",
  createCalendarBookTool({
    calendarProvider,
    bookingStore,
    opportunityStore,
    runTransaction: (fn) => prismaClient.$transaction(fn),
  }),
);

const skillExecutor = new SkillExecutorImpl(anthropicAdapter, tools, modelRouter);
modeRegistry.register(
  new SkillMode({
    executor: skillExecutor,
    skillsBySlug,
    builderRegistry,
    stores: { contactStore, opportunityStore, activityStore, personaStore },
  }),
);
```

The exact store/adapter variable names depend on what's already in scope at that point in `app.ts`. The implementation task will read the file and adapt.

### A2. Route skill-backed deployments to SkillMode

`PlatformIngress` dispatches work via `modeRegistry.dispatch(workUnit)`. The `ExecutionModeRegistry` needs to route based on the work unit's deployment. If the deployment has a `skillSlug`, route to `SkillMode`. Otherwise fall back to `CartridgeMode`.

**Current routing:** `ExecutionModeRegistry` selects the mode by `modeName` on the intent registration. All cartridge intents register with `mode: "cartridge"`.

**Change:** When registering skill-backed intents, register them with `mode: "skill"`. The `IntentRegistry` already supports this — we just need to register skill intents alongside cartridge intents.

**New function:** `registerSkillIntents(intentRegistry, skillsBySlug)` — iterates skill definitions and registers an intent per skill slug (e.g., `alex.respond`) with `mode: "skill"`.

### A3. Wire PlatformIngress into chat app gateway bridge

**File:** `apps/chat/src/main.ts` (line 87)

Currently:

```typescript
const gateway = createGatewayBridge(prisma);
```

Change to:

```typescript
const gateway = createGatewayBridge(prisma, {
  platformIngress: apiPlatformIngress,
});
```

Where `apiPlatformIngress` delegates to the API server's `POST /api/execute` endpoint via `ApiOrchestratorAdapter`. The managed runtime already uses this HTTP delegation pattern — reuse the same approach.

The simplest path: create a thin `HttpPlatformIngress` that wraps the existing `ApiOrchestratorAdapter.resolveAndPropose()` call, translating between `SubmitWorkRequest` and the API's execute format.

**Chosen approach:** Since the chat app's managed runtime already calls `POST /api/execute` → `PlatformIngress.submit()` on the API side, and the API side will now route skill intents to `SkillMode`, the existing HTTP delegation path already works. Create a thin `HttpPlatformIngressAdapter` that implements the `PlatformIngress` interface by calling the API server's execute endpoint. This avoids duplicating SkillMode construction in the chat process and keeps one authoritative skill execution path.

---

## Phase B: Wire Alex Booking Wedge

### B4. Register createCalendarBookTool

**File:** `packages/core/src/skill-runtime/tools/index.ts`

Add export:

```typescript
export { createCalendarBookTool } from "./calendar-book.js";
```

The tool is already implemented. It just needs to be exported from the barrel and wired into the tools map (done in A1).

### B5. Update Alex skill prompt

**File:** `skills/alex.md`

**Frontmatter change:** Add `calendar-book` to the tools array:

```yaml
tools:
  - crm-query
  - crm-write
  - calendar-book
```

**Book phase change:** Replace the booking link delivery (lines 128-131) with tool-based booking:

```markdown
**Phase 4: Book**
When the lead is ready to book:

1. Call `calendar-book.slots.query` with:
   - dateFrom: today's date
   - dateTo: 3 business days from now
   - durationMinutes: from business config or default 30
   - service: the service they're interested in
   - timezone: from business config
2. Present 3-5 available slots as numbered options:
   "Great! Here are some times that work:
   1. Monday 10:00 AM
   2. Monday 2:30 PM
   3. Tuesday 9:00 AM
      Which works best for you?"
3. When the lead replies with a number or time reference, call `calendar-book.booking.create` with:
   - orgId: from context
   - contactId: from context
   - service: the discussed service
   - slotStart/slotEnd: from the selected slot
   - calendarId: "primary"
   - attendeeName: from lead profile
   - attendeeEmail: from lead profile (if available)
4. Confirm the booking naturally:
   "You're all set! I've booked you in for [service] on [date] at [time].
   You'll receive a calendar invite shortly."
```

Remove the `{{PERSONA_CONFIG.bookingLink}}` references entirely.

### B6. Seed org business hours

**File:** `packages/db/prisma/schema.prisma` — add `businessHours` JSON field to `OrganizationConfig`:

```prisma
businessHours    Json?
```

**File:** `packages/db/prisma/seed-marketplace.ts` — seed the demo org with:

```typescript
businessHours: {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "09:00", close: "17:00" },
    { day: 2, open: "09:00", close: "17:00" },
    { day: 3, open: "09:00", close: "17:00" },
    { day: 4, open: "09:00", close: "17:00" },
    { day: 5, open: "09:00", close: "17:00" },
  ],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
}
```

**Where it's read:** The `GoogleCalendarAdapter` constructor takes `businessHours: BusinessHoursConfig`. When constructing the adapter (in A1's tool wiring), read from `OrganizationConfig.businessHours` for the deployment's org. Fall back to default Mon-Fri 9-5 SGT if not set.

### B7. Fix deployment connection loading for WhatsApp

**File:** `apps/chat/src/managed/runtime-registry.ts` (line ~163)

Currently:

```typescript
const connections = await prisma.deploymentConnection.findMany({
  where: { type: "telegram", status: "active" },
});
```

Change to accept the channel type as a parameter or load all active connections:

```typescript
const connections = await prisma.deploymentConnection.findMany({
  where: { status: "active" },
});
```

Then filter by channel type when creating the appropriate adapter. This is a general fix, not a WhatsApp-specific hack.

---

## What's NOT in scope

- No new Prisma models (business hours uses existing `OrganizationConfig` JSON field)
- No interactive buttons/list messages (plain text numbered slots work for v1)
- No multi-calendar, multi-org, or multi-agent support
- No cancel/reschedule flows
- No generalized tool wiring framework
- No rollout to other agents or channels
- No booking link fallback path

## New/Modified Files Summary

### Phase A (runtime activation):

- Modify: `apps/api/src/app.ts` — register SkillMode + skill intents + tools map
- Create: `packages/core/src/platform/register-skill-intents.ts` — intent registration for skills
- Modify: `apps/chat/src/main.ts` — pass PlatformIngress to gateway bridge
- Modify: `apps/chat/src/gateway/gateway-bridge.ts` — remove throwing stub (already accepts option)

### Phase B (Alex booking):

- Modify: `packages/core/src/skill-runtime/tools/index.ts` — export createCalendarBookTool
- Modify: `skills/alex.md` — add calendar-book tool, replace link with slot-based booking
- Modify: `packages/db/prisma/schema.prisma` — add businessHours to OrganizationConfig
- Modify: `packages/db/prisma/seed-marketplace.ts` — seed demo org business hours
- Modify: `apps/chat/src/managed/runtime-registry.ts` — load all channel types, not just Telegram

## Dependency Order

```
A1 (SkillMode registration) → A2 (skill intent routing) → A3 (chat PlatformIngress wiring)
                                                                    ↓
B4 (export calendar tool) → B5 (Alex prompt) → B6 (business hours) → B7 (WhatsApp connections)
```

A1-A3 must complete before B4-B7 can be tested end-to-end, but B4-B7 can be implemented in parallel with A-phase code.
