# SP4: Full Operator Controls — Design Spec

> **Program:** Controlled Beta Remediation (7 SPs)
> **Predecessor:** SP3 (Activation Fix + Minimum Safety Controls) — merged to main
> **Successor:** SP5 (Visibility + Proof of Value)

---

## 1. Scope & Pass Condition

**Goal:** The owner can intervene in agent operations with confidence — browse
conversations, take over when needed, review escalations with full context, and
release control back to the agent.

**Pass condition:** The owner can browse conversations with transcript, take
over a conversation (agent stops outbound), release override (agent resumes),
and review escalations with the conversation transcript leading up to the
trigger. Override and release take effect reliably — the chat runtime respects
`human_override` status before routing to the skill runtime.

Specifically:

- While override is active, the agent must not send outbound messages or take
  autonomous action on that conversation
- Inbound messages during override must still be persisted to the
  transcript/history
- Release returns control to the agent for subsequent messages only

### What Ships

1. **Conversation browser page** — `/conversations` in owner navigation
2. **Conversation override UI** — take over and release controls
3. **Runtime override enforcement** — `ChannelGateway` or the
   conversation-processing path must check `human_override` status before
   routing to the skill runtime. If active, agent action is suppressed and the
   conversation remains human-controlled.
4. **Rich escalation inbox** — upgrade SP3's basic inbox with conversation
   transcript + resolution notes

### What Doesn't Ship

- Per-agent pause/disable toggle (emergency halt covers critical case)
- Owner outbound reply composer on `/conversations` page (SP4 is control-only;
  for escalated conversations use the escalation inbox reply, for non-escalated
  conversations use the original channel directly)
- Component relocation (transcript component stays in `marketplace/`)
- Notification delivery for overrides (owner checks dashboard)
- Direct message delivery to customer from escalation reply (SP3's info banner
  already communicates this limitation)

---

## 2. Architecture & Data Flow

### Principle: No New Models, No New Packages

SP4 is a control-surface upgrade, not an architecture rewrite. It uses existing
data models, existing API routes, existing dashboard proxy routes, and existing
hooks throughout.

### Existing Infrastructure SP4 Builds On

| Layer           | What exists                                           | SP4 addition                                |
| --------------- | ----------------------------------------------------- | ------------------------------------------- |
| Schema          | `ConversationStatus` includes `human_override`        | None — already there                        |
| API             | `GET/PATCH /conversations`, `GET/POST /escalations`   | `resolutionNote` on escalation resolve path |
| Dashboard proxy | `/api/dashboard/conversations/[id]/override`          | None — already wired                        |
| Hooks           | `useConversations`, `useConversationDetail`           | Add `useConversationOverride` mutation      |
| Hooks           | `useEscalationDetail` (returns `conversationHistory`) | Use existing data in upgraded UI            |
| Components      | `ConversationTranscript` (in `marketplace/`)          | Import from there, widen role type          |
| Escalation      | `EscalationList`, `useEscalations`, routes            | Upgrade card to show transcript + notes     |

### Deliverable 1: Conversation Browser Page

`apps/dashboard/src/app/(auth)/conversations/page.tsx`

- List view using `useConversations` hook (already has status filter, channel
  filter, 30s refetch)
- **UI shape: list + inline expansion.** Clicking a conversation row expands it
  in place to show the transcript (via `useConversationDetail`) and override
  controls. No separate detail route — the conversations page is a single-page
  list with expandable detail, similar to the existing escalation card pattern.
- Status pills: `active`, `human_override`, `awaiting_approval`, `completed`
- Overridden conversations with new inbound messages should remain visibly
  noticeable in the list on next refresh (e.g. bold text, unread indicator, or
  updated timestamp sort) so the owner knows the customer sent something
- Add "Conversations" tab to `OwnerTabs` nav
- SP4 does not add owner outbound send from the conversation page. Override
  only suppresses agent action and exposes transcript state.

**Updated OwnerTabs:**

| Tab           | Icon          | Badge         | Status        |
| ------------- | ------------- | ------------- | ------------- |
| Home          | Home          | —             | Existing      |
| Conversations | MessageSquare | —             | **New (SP4)** |
| Escalations   | AlertCircle   | Pending count | Existing      |
| Decide        | ShieldCheck   | Pending count | Existing      |
| Me            | User          | —             | Existing      |

Mobile nav layout must be checked to ensure the fifth tab does not degrade
usability. If it does, Conversations can be accessed from the Home page as a
fallback — but a dedicated tab is preferred for beta since this is the primary
SP4 surface.

### Deliverable 2: Conversation Override UI

Lives on conversation detail within the `/conversations` page.

- **Take Over** button visible when status is `active` → calls
  `PATCH /conversations/:threadId/override` with `{ override: true }`
- **Override banner** when status is `human_override`: "You are controlling
  this conversation" with a **Release** button
- **Release** → calls same endpoint with `{ override: false }` → status
  returns to `active`
- Optimistic update via React Query invalidation (detail hook already refetches
  every 15s)

### Deliverable 3: Runtime Override Enforcement

The critical gap: the `PATCH /conversations/:threadId/override` route sets
`status: "human_override"` in the DB, but the `ChannelGateway` never checks
this status before processing inbound messages. Override is currently cosmetic.

**Guard behavior:**

The guard is placed in `ChannelGateway.handleIncoming()` — the single method
through which all channel inbound messages flow (called by both
`managed-webhook.ts` and `widget-messages.ts`). The check goes after step 3
(message persistence via `conversationStore.addMessage`) but before step 6
(building the `CanonicalSubmitRequest`).

The gateway already has a precedent for this pattern: `DeploymentInactiveError`
handling (lines 18-33) persists the message and returns early without skill
dispatch.

**Guard behavior:**

After persisting the inbound message via `conversationStore.addMessage()`, the
gateway checks the conversation status:

- If `human_override`:
  - Inbound message is already persisted to `conversationStore` (step 3
    completed before the guard)
  - Skip skill runtime dispatch entirely (do not build or submit
    `CanonicalSubmitRequest`)
  - Send no outbound reply — no agent action, no automated acknowledgment
  - Return normally so the webhook path treats the message as successfully
    ingested, not failed. This prevents retries or error surfacing for
    intentionally held human-controlled conversations.
- If any other status: proceed normally

This is a guard at the gateway level, not a new subsystem. Both inbound
channel paths (`managed-webhook.ts` and `widget-messages.ts`) converge on
`ChannelGateway.handleIncoming()`, so a single guard covers all supported
inbound channel paths.

**Override data flow:**

```
Owner clicks "Take Over"
  → PATCH /api/dashboard/conversations/:id/override { override: true }
  → proxy → PATCH /api/conversations/:threadId/override
  → sets conversationState.status = "human_override"

Customer sends message while overridden
  → WhatsApp webhook → ChannelGateway.handleIncoming()
  → gateway persists message via conversationStore.addMessage() (step 3)
  → gateway checks conversation status, sees "human_override"
  → skips CanonicalSubmitRequest build + platformIngress.submit() (steps 6-8)
  → returns normally (no retry, no error)
  → (no agent outbound)

Owner clicks "Release"
  → PATCH with { override: false }
  → sets status = "active"
  → next inbound message routes normally through skill runtime
```

### Deliverable 4: Rich Escalation Inbox

Upgrade existing `EscalationList` and `EscalationCard` components.

**Transcript view:**

- On expand, use `useEscalationDetail` (already exists, already returns
  `conversationHistory` from the backend)
- Render transcript using `ConversationTranscript` from
  `marketplace/conversation-transcript.tsx`
- The transcript component currently types roles as `"lead" | "agent"`. SP4
  widens this to `"lead" | "agent" | "owner"`:
  - `owner` messages render with distinct visual treatment (different background
    color, "You" label)
  - Existing messages with `"lead"` or `"agent"` roles render unchanged
  - SP3's escalation reply already writes `{ role: "owner" }` to the messages
    array — this just makes the transcript component render it properly
- Older messages remain backward compatible — the widened type is additive

**Resolution notes:**

- Resolution notes are attached when marking an escalation resolved, not on
  every reply. "Reply" and "resolve with note" are distinct actions:
  - **Reply** (existing SP3): sends owner message, releases escalation
  - **Resolve with note** (new SP4): marks escalation resolved with an
    owner-facing note for record-keeping
- Resolution notes are owner-facing only — never sent to the customer
- Resolution notes are visible in escalation history when viewing resolved
  escalations
- Show resolution history on resolved escalation cards

---

## 3. Schema Changes

### Handoff Model

Add two nullable fields:

```prisma
model Handoff {
  // ... existing fields ...
  resolutionNote  String?
  resolvedAt      DateTime?
}
```

**Backward compatibility:** Existing handoffs remain valid and unresolved by
default. No backfill required for beta. The fields are nullable — the migration
is additive only.

### ConversationTranscript Component Type

Widen the `Message` interface role union:

```typescript
// Before
interface Message {
  role: "lead" | "agent";
  text: string;
  timestamp: string;
}

// After
interface Message {
  role: "lead" | "agent" | "owner";
  text: string;
  timestamp: string;
}
```

This is a component-level type change, not a schema migration. The
`conversationState.messages` JSON column already stores arbitrary role strings.

---

## 4. Files Touched

### New Files

| File                                                             | Purpose                            |
| ---------------------------------------------------------------- | ---------------------------------- |
| `apps/dashboard/src/app/(auth)/conversations/page.tsx`           | Conversation browser page          |
| `apps/dashboard/src/hooks/use-conversation-override.ts`          | Override/release mutation hook     |
| `packages/db/prisma/migrations/YYYYMMDD_add_handoff_resolution/` | Add `resolutionNote`, `resolvedAt` |

### Modified Files

| File                                                                    | Change                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/src/channel-gateway/channel-gateway.ts`                  | Add `human_override` guard before skill dispatch                   |
| `apps/dashboard/src/components/layout/owner-tabs.tsx`                   | Add Conversations tab (MessageSquare icon)                         |
| `apps/dashboard/src/components/escalations/escalation-list.tsx`         | Add transcript view + resolution notes on expand                   |
| `apps/dashboard/src/components/marketplace/conversation-transcript.tsx` | Widen role type to include `"owner"`, add owner message styling    |
| `apps/api/src/routes/escalations.ts`                                    | Accept `resolutionNote` on resolve, return in responses            |
| `packages/db/prisma/schema.prisma`                                      | Add `resolutionNote String?` and `resolvedAt DateTime?` to Handoff |

### Not Touched

| File                                                  | Reason                                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/conversations.ts`                | Already complete                                                                                                              |
| `apps/dashboard/src/app/api/dashboard/conversations/` | Proxy routes already wired                                                                                                    |
| `apps/dashboard/src/hooks/use-conversations.ts`       | Already has list + detail hooks. Minor adjustments (e.g. status pill mapping) are acceptable if needed during implementation. |
| `apps/dashboard/src/hooks/use-escalations.ts`         | `useEscalationDetail` exists, returns `conversationHistory` — SP4 uses existing data in upgraded UI                           |

---

## 5. Tests

| Test                                                                  | What it validates           |
| --------------------------------------------------------------------- | --------------------------- |
| Override sets `human_override` status and returns updated state       | API contract                |
| Release sets status back to `active`                                  | API contract                |
| Gateway skips skill dispatch when status is `human_override`          | **Runtime enforcement**     |
| Gateway persists inbound message to transcript during override        | Message not lost            |
| Gateway sends no outbound reply during override                       | No agent action             |
| Gateway returns handled/no-op result during override (no retry)       | Webhook ingestion semantics |
| Override on non-existent conversation returns 404                     | Error case                  |
| Override on conversation from different org returns 403/404           | Auth boundary               |
| Escalation detail returns conversation history                        | Existing behavior, verify   |
| Resolution note persists to handoff record on resolve                 | New field                   |
| Resolution note visible in escalation history                         | Read-back                   |
| Resolve without note works (field is nullable)                        | Backward compat             |
| Conversation list returns correct status for overridden conversations | UI data                     |
| ConversationTranscript renders owner messages with distinct styling   | Component                   |
| ConversationTranscript renders legacy lead/agent messages unchanged   | Backward compat             |

---

## 6. Audit Steps Addressed

| Audit Step                     | Before (after SP3) | After SP4 |
| ------------------------------ | ------------------ | --------- |
| Step 8 (Operator Intervention) | Pass with friction | **Pass**  |

SP4 closes the gap by giving the owner:

- A conversation browser to see what the agent is doing
- Real override control that is enforced at the runtime level
- Full escalation context with transcript and resolution notes
- Explicit release semantics to return control to the agent

---

## 7. Risks

| Risk                                                       | Mitigation                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Override flag not checked in all message-processing paths  | Guard is in `ChannelGateway.handleIncoming()`, which both `managed-webhook.ts` and `widget-messages.ts` call. Verified as the single convergence point for all channel inbound messages. |
| Five-tab mobile nav too crowded                            | Check layout during implementation; fallback is Home-page link instead of dedicated tab                                                                                                  |
| Owner forgets to release override, conversation goes stale | Show override duration on the banner; future SP could add auto-release after N hours                                                                                                     |
| Resolution note confused with reply-to-customer            | UI clearly labels "Internal note" with no send-to-customer affordance                                                                                                                    |
| Transcript component role widening breaks existing renders | Additive change; existing `"lead"` and `"agent"` roles are unaffected                                                                                                                    |
