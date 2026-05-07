---
name: Revenue Loop Closure Sub-Project
description: Next sub-project after ingress convergence — calendar booking, durable ConversionBus, attribution completion, ROI dashboard
type: project
originSessionId: a7cafa96-6945-4c27-9a7f-60a9f3820859
---

Revenue Loop Closure is the next highest-value move after ingress convergence. Decided 2026-04-18.

**Why:** The hard platform pieces (typed action layer, orchestrated runtime, observability, memory) are built. The biggest remaining weakness is the last mile to ROI — leads are captured and qualified but can't be booked, attribution is partial, and value isn't visible.

**Sequence (user-specified):**

1. Calendar / booking integration (actual slot lookup, hold/reschedule/cancel, booking → CRM/state)
2. Durable ConversionBus (replace in-memory, reliable outcome event propagation)
3. Attribution completion (Google Offline Conversions, reconciliation jobs, per-campaign attribution service)
4. ROI dashboard (lead → qualified → booked → revenue, by source/campaign/channel/agent)

**Rationale:** Booking creates the outcome. Durable bus preserves the outcome. Attribution connects the outcome to spend. Dashboard makes the value legible.

**Status:** SHIPPED 2026-04-18 (PR #209, squash-merged to main as 3c29f6b3). 21 commits, all tests passing.

**How to apply:** Every design decision should be evaluated by whether it accelerates the path from lead capture to provable booked revenue. No side quests.
