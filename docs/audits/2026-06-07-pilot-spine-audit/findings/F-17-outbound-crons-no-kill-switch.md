# F-17: The two customer-facing outbound crons have NO operator-reachable kill-switch and ignore org-wide agent halt

- **Severity:** blocks-pilot (two unattended automations message real customers on a fixed schedule; the only ways to stop them are a redeploy, a blunt entitlement revocation that disables all billing, or a manual deny-Policy DB write — no operator UI/flag stops them, and org-wide "halt all agents" does NOT reach them)
- **Journey/step:** J7-S1
- **Verdict:** DORMANT-at-prod-defaults for the SEND (gate default-denies a fresh org per F-16, so nothing is actually sent), but the kill-switch GAP itself is structural and bites the moment a pilot org is provisioned with allow policies. Headline J7 safety finding.
- **Location (verified against `main`, worktree `audit/pilot-spine`, 2026-06-08):**
  - `apps/api/src/bootstrap/inngest.ts:1180-1181` — `createScheduledFollowUpDispatchCron(...)` and `createAppointmentReminderDispatchCron(...)` are registered UNCONDITIONALLY in the `functions:[...]` array. Unlike every Mira/Riley cron (`MIRA_SELF_BRIEF_ENABLED` `:1036`, `RILEY_OUTCOME_ATTRIBUTION_ENABLED` `:951`, `CREATIVE_ATTRIBUTION_ENABLED` `:989`, `RILEY_PAUSE_SELF_EXECUTION_ENABLED` `:437` — all `process.env[...] === "true" ? [...] : []` gated), these two have no env-flag wrapper.
  - `apps/api/src/services/cron/appointment-reminder-dispatch.ts:126` — `triggers: [{ cron: "0 * * * *" }]` (hourly), `riskCategory: "high"` (`:131`), `alert: true`.
  - `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts:139` — `triggers: [{ cron: "*/15 * * * *" }]` (every 15 min), `riskCategory: "high"` (`:143`), `alert: true`.
  - **Org-wide halt does not reach them.** `DeploymentLifecycleStore.haltAll` (`packages/db/src/stores/prisma-deployment-lifecycle-store.ts:40-42`) flips `AgentDeployment.status` `active → paused`. But the cron submit path does NOT depend on an agent deployment: `submitScheduledReminder`/`submitScheduledFollowUp` (`apps/api/src/bootstrap/contained-workflows.ts:514-523`) call `resolveDeploymentForIntent(resolver, org, "conversation.reminder.send" | "conversation.followup.send")`. `resolveDeploymentForIntent` (`apps/api/src/utils/resolve-deployment.ts:9,20-30`) derives `skillSlug = intent.split(".")[0]` = `"conversation"`, calls `resolver.resolveByOrgAndSlug(org, "conversation")` which is **active-only and throws when no row matches** (`packages/core/src/platform/prisma-deployment-resolver.ts:73-80`); there is no `"conversation"` deployment seed in `packages/db/src/seed/`. The `catch` returns the `deploymentId:"api-direct"` fallback. So these submits run with the `api-direct` deployment context **regardless of any AgentDeployment status** — halting/pausing/suspending all of an org's agents has zero effect on the reminder or follow-up cron.
  - No messaging-level pause flag exists. Grep for `messagingPaused`/`proactivePaused`/`outboundPaused`/`sendingEnabled`/`REMINDER_*`/`FOLLOWUP_DISPATCH*` over `packages/` + `apps/api/src` returns 0 producers/consumers.
- **The only stop levers, and why none is an operator kill-switch:**
  1. **Entitlement revocation** (`platform-ingress.ts:196-208`, step 1.5): set `OrganizationConfig.subscriptionStatus`/`entitlementOverride` so the org is unentitled → every submit 402s, including these crons. But this is billing-coupled and global to the org — it disables ALL paid actions, not just outbound messaging, and is not a messaging control any operator would reach for to "pause reminders."
  2. **Insert a deny `Policy` row** — requires a direct DB write; there is no UI/API to author a deny policy for `conversation.*.send` on an org.
  3. **Redeploy** with the function removed/flag-gated — the only true off-switch, requires a code change + deploy.
- **Evidence:** `evidence/j7-cron-registration.txt` (registration lines, schedules, riskCategory, the deployment-resolution fallback trace, and the Mira/Riley env-flag contrast).

## What was exercised

- Read both dispatchers, their bootstrap wiring, the deployment-resolution fallback, `resolveByOrgAndSlug`, `haltAll`, and the seed directory. Confirmed by code trace that org-wide halt cannot stop these crons (they ride the `api-direct` fallback) and that no env flag or messaging-pause field gates them. The live SEND leg was not exercised (no Inngest dev server running locally — see D-05 / verdict map J7-S3); the kill-switch absence is a registration/wiring fact, established by code read, independent of triggering.

## What happened vs expected

- **Expected:** a customer-facing outbound automation that messages real contacts should have a graceful, operator-reachable stop (a per-org or global "pause outbound" that the cron honors), distinct from the blunt billing kill.
- **Observed:** there is none. The org-wide "halt all agents" lifecycle action (the operator's intuitive emergency stop) does NOT cover these crons because they bypass deployment resolution. The only stops are billing revocation (over-broad) or a redeploy.
- **Why DORMANT today, not BROKEN now:** at prod defaults a fresh org has 0 Policy rows, so the gate default-denies these submits (F-16) and nothing is sent. The risk activates the moment a pilot org is provisioned with allow policies for `conversation.*.send` (the F-16 fix) — at which point the crons begin sending on schedule with no graceful off-switch.

## Suggested fix scope

- Add an env kill-switch wrapper mirroring the Mira/Riley crons (`process.env["OUTBOUND_DISPATCH_ENABLED"] === "true" ? [cron] : []`) at `inngest.ts:1180-1181`, OR (better) a per-org outbound-pause field the cron's `findUpcomingConfirmed`/`findDue` query honors, so org-wide halt and a per-org pause both stop outbound messaging without touching billing.
- Decide intentionally whether org-wide agent halt SHOULD stop these crons. If yes, resolve a real deployment for `conversation.*.send` (seed a `conversation`/`alex` slug the resolver can find) and have the cron skip orgs whose deployment is `paused`.

## Validation / test

- Add a bootstrap test asserting the dispatch crons are registered only when the kill-switch flag is on (mirror the Mira/Riley registration tests).
- Add a dispatcher test: a `paused`/halted org (or pause-flag set) yields 0 submits from `findUpcomingConfirmed`/`findDue`.
