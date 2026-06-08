# F-07: `FOLLOWUP_ALLOW_MARKETING_TEMPLATE` empty default ⇒ follow-up cron skips marketing-category re-engagement sends

- **Severity:** decay
- **Journey/step:** inventory
- **Verdict:** DORMANT
- **Location:** reader `apps/api/src/bootstrap/contained-workflows.ts:299`; enforced `packages/core/src/notifications/proactive-eligibility.ts:83-84`; send path `apps/api/src/services/workflows/conversation-followup-send-workflow.ts:56-75` (verified against main on 2026-06-07)
- **Evidence:**
  - `contained-workflows.ts:299` `allowMarketingTemplate: process.env["FOLLOWUP_ALLOW_MARKETING_TEMPLATE"] === "true"` — empty default ⇒ `false`. (The reminder workflow `:316` hardcodes `false`.)
  - `proactive-eligibility.ts:83` `if (template.templateCategory === "marketing" && !input.allowMarketingTemplate) return { eligible:false, reason:"marketing_blocked" };`
  - `conversation-followup-send-workflow.ts:69-75` — when `!eligibility.eligible`, returns `{outcome:"completed", outputs:{sent:false, skipReason}}` (recorded skip, not a send). Utility-category templates pass and still send (`:96` onward).
  - `.env.example`: `FOLLOWUP_ALLOW_MARKETING_TEMPLATE=` empty.

## What was exercised

Read the workflow wiring, the eligibility evaluator, and the send workflow. Confirmed the empty-default behavior: the cron runs, evaluates eligibility, and skips marketing-category templates with `marketing_blocked` while still sending utility-category follow-ups.

## What happened vs expected

Expected (per the env comment): marketing re-engagement sends are intentionally off until a Meta-approved marketing template exists. Observed: matches the intended posture — the follow-up cron is live, but marketing-category re-engagement is gated off at the empty default. This is a deliberate decay risk, not a bug; the gate is correctly populated from a real producer default.

## Suggested fix scope

Flip `FOLLOWUP_ALLOW_MARKETING_TEMPLATE=true` only after a Meta-approved marketing template is wired (per the WhatsApp template roadmap). No code change; record as a launch-sequencing flag so the "no marketing follow-ups" behavior is not mistaken for a broken cron.
