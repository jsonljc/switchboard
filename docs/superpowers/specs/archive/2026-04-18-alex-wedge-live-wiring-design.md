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

**Phase B — Wire Alex booking wedge:** 4. Fix deployment connection loading to include WhatsApp (hard blocker — without this, no WhatsApp deployment comes online) 5. Register `createCalendarBookTool` in the tools map 6. Update Alex skill prompt for slots → select → book (with deterministic selection + failure handling) 7. Seed org business hours in `OrganizationConfig`

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

**Startup contract:** Fail fast on invalid skill definitions. If the Alex skill cannot load (missing file, malformed frontmatter, undeclared tool), the API server must crash at startup rather than silently omitting the skill. A running server with no skill registrations is worse than a crashed server — it silently routes everything to CartridgeMode.

### A2. Route skill-backed deployments to SkillMode

Ensure that execute requests for skill-backed deployments deterministically resolve to skill mode before `modeRegistry.dispatch()`.

**Current routing:** `ExecutionModeRegistry` selects the mode by `modeName` on the intent registration. All cartridge intents register with `mode: "cartridge"`. No skill intents are registered.

**The real question:** When a `SubmitWorkRequest` arrives at PlatformIngress (either from the chat gateway or the API execute route), does it carry enough deployment context for the intent resolver to know this is a skill-backed deployment? The `ChannelGateway` already builds intents as `${skillSlug}.respond` (e.g., `alex.respond`). The API execute route receives intent strings from callers.

**Change:** Register skill intents alongside cartridge intents with `mode: "skill"`. New function `registerSkillIntents(intentRegistry, skillsBySlug)` iterates skill definitions and registers `{slug}.respond` with `mode: "skill"`. This is the minimum routing rule — it does not require interpreting deployment metadata at dispatch time, just matching the intent string.

**Debugging contract:** If a skill-backed execution does not reach SkillMode, the failure point is either (a) the intent string does not match a registered skill intent, or (b) the execute request never reaches PlatformIngress. Log the resolved intent and mode at dispatch time.

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

### B4. Fix deployment connection loading (hard blocker)

**File:** `apps/chat/src/managed/runtime-registry.ts` (line ~163)

Currently hardcoded to `type: "telegram"`. This means no WhatsApp deployment can come online through the gateway path, regardless of everything else in this spec.

Change to load all active connections:

```typescript
const connections = await prisma.deploymentConnection.findMany({
  where: { status: "active" },
});
```

Then filter by channel type when creating the appropriate adapter. This is not a WhatsApp-specific tweak — it's a general fix to channel connection discovery.

**This must be done first in Phase B.** Without it, the wedge cannot attach to any live WhatsApp deployment.

### B5. Register createCalendarBookTool

**File:** `packages/core/src/skill-runtime/tools/index.ts`

Add export:

```typescript
export { createCalendarBookTool } from "./calendar-book.js";
```

The tool is already implemented. It just needs to be exported from the barrel and wired into the tools map (done in A1).

### B6. Update Alex skill prompt

**File:** `skills/alex.md`

**Frontmatter change:** Add `calendar-book` to the tools array:

```yaml
tools:
  - crm-query
  - crm-write
  - calendar-book
```

**Book phase change:** Replace the booking link delivery with tool-based booking:

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
3. **Slot selection rules:**
   - If reply is a single digit 1-5, treat as slot index
   - If reply clearly names a specific offered time, match it
   - If reply is ambiguous ("the later one", "morning"),
     ask a disambiguation question — do NOT guess
4. Call `calendar-book.booking.create` with the confirmed slot
5. Confirm the booking naturally:
   "You're all set! I've booked you in for [service] on [date]
   at [time]. You'll receive a calendar invite shortly."

**If slots.query or booking.create fails:**

- Apologize briefly: "I wasn't able to book that just now."
- Offer to have someone confirm a time shortly
- Log a CRM activity noting the failed booking attempt
- Do NOT retry silently or make up availability
```

Remove the `{{PERSONA_CONFIG.bookingLink}}` references entirely.

### B7. Seed org business hours

**Availability contract:** Business hours define the allowed candidate window. The Google Calendar FreeBusy API defines actual free/busy within that window. Slots are only offered where both conditions are met — business hours say "open" AND calendar says "free." Business hours alone are never sufficient to claim availability.

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

## Observability (required for wedge debugging)

Three log statements minimum — without these, debugging the first live conversations is guesswork:

1. **Deployment resolved:** `deployment resolved to skillSlug=${slug}` — logged when `PrismaDeploymentResolver` resolves a deployment from a channel token
2. **Mode selected:** `execution mode selected = skill` — logged when `ExecutionModeRegistry` dispatches to SkillMode
3. **Tool calls:** `tool call: calendar-book.slots.query` / `tool call: calendar-book.booking.create` — logged by SkillExecutor when a tool_use block is processed

These answer the 4 critical questions for any failed conversation:

- Did the message hit skill mode?
- Did Alex call the tool?
- What args were passed?
- Did the booking succeed or fail?

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

- Modify: `apps/chat/src/managed/runtime-registry.ts` — load all channel types (hard blocker)
- Modify: `packages/core/src/skill-runtime/tools/index.ts` — export createCalendarBookTool
- Modify: `skills/alex.md` — add calendar-book tool, slot selection rules, failure handling
- Modify: `packages/db/prisma/schema.prisma` — add businessHours to OrganizationConfig
- Modify: `packages/db/prisma/seed-marketplace.ts` — seed demo org business hours

## Implementation Order

```
B4 (WhatsApp connections — hard blocker, do first)
  ↓
A1 (SkillMode + tools + skills loaded at startup)
  ↓
A2 (skill intent routing — deterministic dispatch)
  ↓
A3 (chat delegates to API execution)
  ↓
B5 (export calendar tool) + B6 (Alex prompt) + B7 (business hours)
  ↓
end-to-end live test
```

B4 first because without WhatsApp deployment discovery, the wedge is dead. A1-A3 in sequence. B5-B7 in parallel after A-phase.
