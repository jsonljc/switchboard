# F-19: Escalation detail reads conversation history from the wrong table — lead/agent turns never appear in the operator handoff view

- **Severity:** blocks-pilot (violates the "human escalation is first-class architecture" invariant; operator cannot see what the lead said when an escalation fires; affects the real WhatsApp pilot, not just Telegram; medspa pilot relies on human handoff as a core workflow)
- **Journey/step:** J6-S2 (seam S-11)
- **Verdict:** CONFIRMED + UPGRADED (adversarial review confirmed: affects WhatsApp inbound path which is the actual pilot channel, NOT merely a latent/Telegram-only concern)
- **Location (verified against `main`, worktree `audit/pilot-spine`, 2026-06-08):**
  - **Consumer (reads):** `apps/api/src/routes/escalations.ts:106-113` — `GET /api/escalations/:id` builds `conversationHistory` from `prisma.conversationState.findFirst({ where:{ threadId: handoff.sessionId, organizationId: orgId } }).messages` (the **`ConversationState`** table, schema ~line 128, `messages Json` field). Dashboard view model `apps/dashboard/src/hooks/use-escalation-detail.ts:16-20` reads each turn's `text` field (role `"user"`=lead, `"owner"`=operator). `apps/dashboard/src/components/escalations/handoff-detail-sheet.tsx:169` renders these turns — renders empty for a real pilot escalation.
  - **Producer of lead/agent turns on the pilot path (writes):** `apps/chat/src/gateway/gateway-conversation-store.ts:85-92` (`PrismaGatewayConversationStore.addMessage`) writes to the **`ConversationMessage`** table (schema ~line 981) with field **`content`**, keyed by `contactId`+`orgId`. Called via `channel-gateway.ts:159,211` (`addMessage`). It never writes `ConversationState.messages`.
  - **Escalate creates handoff with empty messages:** `escalate.ts:72` creates the `Handoff` row with `messages:[]` — so `conversationSummary` is ALSO empty at creation time.
  - The gateway's only `ConversationState` write is `setConversationStatus` (`apps/chat/src/gateway/gateway-bridge.ts:200-219`) — **status only**, no `messages` array.
  - The only `ConversationState.messages` writer reached on an escalation is the OPERATOR reply: `releaseEscalationToAi` appends `role:"owner"` turns (`packages/db/src/stores/prisma-conversation-state-store.ts:231-245`).
  - A second store, `PrismaConversationStore.save` (`apps/chat/src/conversation/prisma-store.ts:27-79`), DOES write `ConversationState.messages` with `text`-shaped turns (`ConversationMessage` type `apps/chat/src/conversation/state.ts:42` = `{role, text, timestamp}`) — but it is the legacy/direct chat-lifecycle store and has **no callers on the managed-channel inbound path** (grep: nothing imports `conversation/threads` from the managed path).
  - **WhatsApp impact (the actual pilot channel):** `escalate.ts:70` hardcodes `leadSnapshot.channel="whatsapp"` — the escalation tool's channel field is set to WhatsApp. WhatsApp inbound works (per earlier route-chain review; resolver uses `tokenHash`, contact always resolves), so real WhatsApp escalations hit this mismatch. This is NOT Telegram-only and NOT merely latent. The false-confidence comment at `skill-mode.ts:194-205` applies to the legacy direct-chat path, not the ChannelGateway pilot path.
- **Evidence:**
  - `evidence/j6-escalation-wiring.txt` — full producer/consumer trace.
  - Live psql (read-only): the only `ConversationState` row in the DB belongs to `org_dev` and is a seed (`packages/db/prisma/seed-marketplace.ts:946`, `text`-shaped). No gateway-produced `ConversationState` row carrying lead turns exists. `Handoff` for the audit org = 0; `EscalationRecord` (all orgs) = 0.

## What was exercised

Pure code read plus live read-only DB inspection. Escalation creation could not be driven end-to-end (blocked upstream by F-13/F-14/F-15), so the mismatch was settled by tracing the producer (where lead/agent turns are persisted on the managed path) against the consumer (which table/field the escalation detail route reads), and corroborated against the live DB (no gateway-written `ConversationState` row exists anywhere).

## What happened vs expected

- **Expected:** an operator opening a handoff sees the full lead↔Alex conversation that triggered the escalation.
- **Observed (by trace):** on the managed-channel (WhatsApp/Telegram = the pilot channel) path, lead and agent turns are persisted to `ConversationMessage.content`, but the escalation detail route reads `ConversationState.messages`, which the gateway never populates with lead/agent turns (only operator `owner` turns once a reply is sent, plus a status-only row). The `HandoffDetailSheet` `conversationHistory` will render **empty** (or operator-turns-only) for a real pilot escalation.
- This **refines and CONFIRMS seam S-11**: the original smell was a `text`-vs-`content` field rename within one table; the real defect is a **wrong-table read** — the producer the pilot path uses (`ConversationMessage`) is not the table the consumer reads (`ConversationState.messages`). The field name (`content` vs `text`) is a second-order mismatch that would also bite even if the table were corrected.

## Why it is NOT merely latent (WhatsApp pilot path)

The initial classification as "latent today" was based on Telegram being blocked by F-13/F-14/F-15. Adversarial review confirmed this is WRONG for the WhatsApp pilot path:

- `escalate.ts:70` hardcodes `leadSnapshot.channel="whatsapp"` — real WhatsApp escalations go through this code path.
- WhatsApp inbound routing is code-read sound (resolver uses `tokenHash`, contact always resolves), so WhatsApp escalations are NOT blocked by F-13/F-14.
- F-15 (`SWITCHBOARD_API_KEY` unprovisioned) is the only remaining blocker — a deploy-config fix, not a code fix.
- Once F-15 is resolved (deploy-config step on the launch checklist), WhatsApp escalations will immediately hit this defect: operator sees empty conversation history.

The medspa pilot relies on human handoff as a core workflow ("Human escalation is first-class architecture"). This defect makes that workflow blind from day one of a real WhatsApp pilot.

## Suggested fix scope

Have the escalation detail route assemble `conversationHistory` from the table the managed-channel gateway actually writes — `ConversationMessage` (keyed by the handoff's `contactId`+`orgId`, mapping `direction` inbound/outbound → role user/assistant, reading `content`) — and normalize the field to `text` for the existing view model; OR have the gateway mirror lead/agent turns into `ConversationState.messages` with the `text` shape the consumer expects. Pin with a producer→consumer test: `EscalationDetailResponse` parse over a `ConversationMessage`-sourced history for a managed-channel thread (the existing `use-escalation-detail.test.tsx` uses hand-shaped fixtures and does not exercise the real producer table). Validate by creating one real managed-channel escalation post-F-13/14/15 and confirming lead turns render.
