# F-19: Escalation detail reads conversation history from the wrong table — lead/agent turns never appear in the operator handoff view

- **Severity:** embarrasses-pilot (operator opens a handoff and sees no lead conversation; the human-in-the-loop hand-off is effectively blind on the pilot channel)
- **Journey/step:** J6-S2 (seam S-11)
- **Verdict:** CONFIRMED (static, producer/consumer table mismatch on the live managed-channel path; not exercisable end-to-end today because escalation creation is blocked by F-13/F-14/F-15, but the mismatch is unconditional)
- **Location (verified against `main`, worktree `audit/pilot-spine`, 2026-06-08):**
  - **Consumer (reads):** `apps/api/src/routes/escalations.ts:104-116` — `GET /api/escalations/:id` builds `conversationHistory` from `prisma.conversationState.findFirst({ where:{ threadId: handoff.sessionId, organizationId: orgId } }).messages` (the **`ConversationState`** table). Dashboard view model `apps/dashboard/src/hooks/use-escalation-detail.ts:16-20` reads each turn's `text` field (role `"user"`=lead, `"owner"`=operator).
  - **Producer of lead/agent turns on the pilot path (writes):** managed webhook `apps/chat/src/routes/managed-webhook.ts:73` → `ChannelGateway.handleIncoming` → `conversationStore.addMessage(conversationId, "user"|"assistant", text)` (`packages/core/src/channel-gateway/channel-gateway.ts:120,211`) → `PrismaGatewayConversationStore.addMessage` writes to the **`ConversationMessage`** table with field **`content`** (`apps/chat/src/gateway/gateway-conversation-store.ts:85-92`), keyed by `contactId`+`orgId`. It never writes `ConversationState.messages`.
  - The gateway's only `ConversationState` write is `setConversationStatus` (`apps/chat/src/gateway/gateway-bridge.ts:200-219`) — **status only**, no `messages` array.
  - The only `ConversationState.messages` writer reached on an escalation is the OPERATOR reply: `releaseEscalationToAi` appends `role:"owner"` turns (`packages/db/src/stores/prisma-conversation-state-store.ts:231-245`).
  - A second store, `PrismaConversationStore.save` (`apps/chat/src/conversation/prisma-store.ts:27-79`), DOES write `ConversationState.messages` with `text`-shaped turns (`ConversationMessage` type `apps/chat/src/conversation/state.ts:42` = `{role, text, timestamp}`) — but it is the legacy/direct chat-lifecycle store and has **no callers on the managed-channel inbound path** (grep: nothing imports `conversation/threads` from the managed path).
- **Evidence:**
  - `evidence/j6-escalation-wiring.txt` — full producer/consumer trace.
  - Live psql (read-only): the only `ConversationState` row in the DB belongs to `org_dev` and is a seed (`packages/db/prisma/seed-marketplace.ts:946`, `text`-shaped). No gateway-produced `ConversationState` row carrying lead turns exists. `Handoff` for the audit org = 0; `EscalationRecord` (all orgs) = 0.

## What was exercised

Pure code read plus live read-only DB inspection. Escalation creation could not be driven end-to-end (blocked upstream by F-13/F-14/F-15), so the mismatch was settled by tracing the producer (where lead/agent turns are persisted on the managed path) against the consumer (which table/field the escalation detail route reads), and corroborated against the live DB (no gateway-written `ConversationState` row exists anywhere).

## What happened vs expected

- **Expected:** an operator opening a handoff sees the full lead↔Alex conversation that triggered the escalation.
- **Observed (by trace):** on the managed-channel (WhatsApp/Telegram = the pilot channel) path, lead and agent turns are persisted to `ConversationMessage.content`, but the escalation detail route reads `ConversationState.messages`, which the gateway never populates with lead/agent turns (only operator `owner` turns once a reply is sent, plus a status-only row). The `HandoffDetailSheet` `conversationHistory` will render **empty** (or operator-turns-only) for a real pilot escalation.
- This **refines and CONFIRMS seam S-11**: the original smell was a `text`-vs-`content` field rename within one table; the real defect is a **wrong-table read** — the producer the pilot path uses (`ConversationMessage`) is not the table the consumer reads (`ConversationState.messages`). The field name (`content` vs `text`) is a second-order mismatch that would also bite even if the table were corrected.

## Why it is latent today (not yet customer-visible)

Escalation creation on the live product path is blocked by F-13 (Telegram routing), F-14 (Telegram contact FK), and F-15 (chat→API ingress auth). The moment those are fixed and a real managed-channel escalation is created, this becomes immediately customer-visible: the operator handoff view shows no conversation.

## Suggested fix scope

Have the escalation detail route assemble `conversationHistory` from the table the managed-channel gateway actually writes — `ConversationMessage` (keyed by the handoff's `contactId`+`orgId`, mapping `direction` inbound/outbound → role user/assistant, reading `content`) — and normalize the field to `text` for the existing view model; OR have the gateway mirror lead/agent turns into `ConversationState.messages` with the `text` shape the consumer expects. Pin with a producer→consumer test: `EscalationDetailResponse` parse over a `ConversationMessage`-sourced history for a managed-channel thread (the existing `use-escalation-detail.test.tsx` uses hand-shaped fixtures and does not exercise the real producer table). Validate by creating one real managed-channel escalation post-F-13/14/15 and confirming lead turns render.
