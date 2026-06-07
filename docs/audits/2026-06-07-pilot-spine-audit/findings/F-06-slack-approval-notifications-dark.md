# F-06: Parked-approval Slack notifications are dark until `SLACK_BOT_TOKEN` + `SLACK_APPROVAL_CHANNEL` are set

- **Severity:** embarrasses-pilot
- **Journey/step:** inventory
- **Verdict:** DORMANT
- **Location:** `apps/api/src/bootstrap/approval-notifier.ts:22-32` (builder) (verified against main on 2026-06-07)
- **Evidence:**
  - `approval-notifier.ts:22` `if (!env.slackBotToken || !env.slackApprovalChannel) { logger.info("Approval notifications: off ...") ; return undefined; }` — both env vars are required; otherwise the notifier `PlatformIngress` fires is `undefined` (no-op).
  - Prod defaults (`.env.example`): `SLACK_BOT_TOKEN=` empty, `SLACK_APPROVAL_CHANNEL=` empty.
  - Constraint noted in-file (`:28`): the bot token must belong to the SAME Slack app as the org's managed Slack channel or button taps reach the wrong interactivity URL.

## What was exercised

Read the notifier builder. Confirmed the both-required gate and the empty prod defaults.

## What happened vs expected

Expected: when a submission parks as a gated lifecycle, operators are notified in Slack with Approve/Reject controls. Observed: at prod defaults the notifier is `undefined`, so parked approvals are created but no Slack notification is sent — the human-in-the-loop surface is dark. The approval still exists (in the dashboard), so this is a notification gap rather than a lost approval.

## Suggested fix scope

Set `SLACK_BOT_TOKEN` (the managed-channel app's bot token) and `SLACK_APPROVAL_CHANNEL` in the deployment env per the spec's flip checklist; verify interactivity routes to the managed webhook. Launch-checklist item, no code change.
