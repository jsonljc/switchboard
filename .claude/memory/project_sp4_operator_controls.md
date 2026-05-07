---
name: SP4 Full Operator Controls
description: Controlled Beta Remediation SP4 — conversation browser, override with runtime enforcement, rich escalation inbox. Spec approved 2026-04-24.
type: project
originSessionId: b0b745ea-51a2-44bb-b036-f7770aefc2fb
---

SP4 is the 4th sub-project in the Controlled Beta Remediation program (7 SPs).

**Status:** Spec approved, plan written, starting implementation 2026-04-24.

**What ships:**

1. Conversation browser page (`/conversations`) — list + inline expansion
2. Conversation override UI — take over + release
3. Runtime override enforcement — guard in `ChannelGateway.handleIncoming()` after message persistence, before skill dispatch
4. Rich escalation inbox — transcript + resolution notes (resolve ≠ reply)

**Key architectural finding:** Gateway uses `GatewayConversationStore` (ConversationThread tables) but override status lives on `ConversationState` (separate table). Added `getConversationStatus?(sessionId)` to the interface to bridge this.

**Both inbound paths verified:** `managed-webhook.ts` and `widget-messages.ts` both converge on `ChannelGateway.handleIncoming()`.

**Why:** Moves Step 8 (Operator Intervention) from Pass with friction → Pass.

**How to apply:** Spec at `docs/superpowers/specs/2026-04-24-sp4-full-operator-controls-design.md`, plan at `docs/superpowers/plans/2026-04-24-sp4-full-operator-controls.md`.
