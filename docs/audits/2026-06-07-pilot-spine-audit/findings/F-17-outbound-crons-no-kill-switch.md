# F-17: The two customer-facing outbound crons have no granular outbound-messaging stop lever — org-wide halt works via governance lock, not deployment pause

- **Severity:** embarrasses-pilot (nice-to-have — the org halt kill-switch EXISTS and DOES stop the crons via governance-profile lock; the residual gap is a mental-model mismatch and the absence of a granular "pause outbound only" lever, not a missing kill-switch)
- **Journey/step:** J7-S1
- **Verdict:** DORMANT-at-prod-defaults for the SEND (gate default-denies a fresh org per F-16, so nothing is actually sent). The structural gaps are: (1) no granular outbound-messaging pause lever — only an org-wide governance lock (emergency-halt) or entitlement revocation can stop these crons; (2) an operator who "pauses the agent" via the deployment status UI will find it has NO effect on these crons, because they stop via the governance-profile lock, not via deployment pause — a mental-model mismatch worth a targeted control.
- **Location (verified against `main`, worktree `audit/pilot-spine`, 2026-06-08):**
  - `apps/api/src/bootstrap/inngest.ts:1180-1181` — `createScheduledFollowUpDispatchCron(...)` and `createAppointmentReminderDispatchCron(...)` are registered UNCONDITIONALLY in the `functions:[...]` array. (The Mira/Riley crons at `:437`, `:951`, `:989`, `:1036` are each wrapped in `process.env[...] === "true" ? [...] : []`; these two are not — they always register.)
  - `apps/api/src/services/cron/appointment-reminder-dispatch.ts:126` — `triggers: [{ cron: "0 * * * *" }]` (hourly), `riskCategory: "high"` (`:131`).
  - `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts:139` — `triggers: [{ cron: "*/15 * * * *" }]` (every 15 min), `riskCategory: "high"` (`:143`).
  - **How org-wide halt DOES stop them (via governance-profile lock, not deployment pause):** `POST /api/governance/emergency-halt` (`apps/api/src/routes/governance.ts:162`) does two things: calls `haltAll` (sets `AgentDeployment.status` → `paused`) AND calls `governanceProfileStore.set(orgId, "locked")` (`:189`). The `GovernanceGate` reads the org's stored profile on EVERY submit via `getGovernanceProfile` (`governance-gate.ts:124`), wired at `app.ts:526-528`, independent of deployment context. A `"locked"` profile resolves to posture `"critical"` (`profile.ts:19-20`), which forces `approvalReq="mandatory"` for ALL actions (`policy-engine.ts:425-426`). The cron submits go through this gate (`platform-ingress.ts:256`), so after emergency-halt they become parked/mandatory-approval — i.e. NOT sent. The halt works.
  - **Why deployment pause alone does NOT stop them:** The cron submit path resolves context via `resolveDeploymentForIntent(resolver, org, "conversation.reminder.send" | "conversation.followup.send")` (`apps/api/src/bootstrap/contained-workflows.ts:514-523`). `resolveDeploymentForIntent` (`apps/api/src/utils/resolve-deployment.ts:9,20-30`) derives `skillSlug = "conversation"`, calls `resolver.resolveByOrgAndSlug(org, "conversation")`, which is active-only and throws when no row matches (`packages/core/src/platform/prisma-deployment-resolver.ts:73-80`) — there is no `"conversation"` deployment seed. The `catch` returns `deploymentId:"api-direct"`. So `AgentDeployment.status` is irrelevant to these submits; `haltAll` (deployment-status flip) alone would have zero effect. Only the governance-profile lock portion of emergency-halt stops them.
  - **Env-gate registration mechanism distinction:** All Mira/Riley crons self-gate via `process.env[...] === "true" ? [...] : []` at registration. The two outbound crons are not wrapped at all. This means they register regardless of any env flag, and their only runtime stop is the governance path or entitlement. The Mira/Riley crons also have internal `readEnabledFlag` deps, but the relevant distinction here is registration-time env wrapping vs. not.
  - No messaging-level pause flag exists. Grep for `messagingPaused`/`proactivePaused`/`outboundPaused`/`sendingEnabled`/`REMINDER_*`/`FOLLOWUP_DISPATCH*` over `packages/` + `apps/api/src` returns 0 producers/consumers.
- **The actual stop levers:**
  1. **Emergency-halt governance lock** (`POST /api/governance/emergency-halt`, `governance.ts:189`): sets `governanceProfile="locked"` → gate forces mandatory-approval on all submits → cron sends are parked, not sent. This IS a real operator kill-switch. Downside: it is all-or-nothing for the whole org — it also blocks all other governed actions, not just outbound messaging.
  2. **Entitlement revocation** (`platform-ingress.ts:196-208`): set org unentitled → every submit 402s including these crons. Also global and billing-coupled; not a messaging control.
  3. **A deny `Policy` row** — requires a direct DB write; no UI/API to author one.
  4. **Redeploy** with the function removed/flag-gated — the only env-level off-switch, requires a code change.
- **What is missing:** A granular "pause outbound messaging" lever (e.g. per-org `outboundPaused` flag the cron queries honor, or env-flag registration wrapper matching the Mira/Riley pattern) that an operator can reach for without triggering a full org governance lock. Also: the deployment-status "pause agent" UI action silently has zero effect on these crons — that mental-model mismatch should be documented or corrected via a targeted control.
- **Evidence:** `evidence/j7-cron-registration.txt` (registration lines, schedules, riskCategory, the deployment-resolution fallback trace, and the Mira/Riley env-flag contrast).

## What was exercised

- Read both dispatchers, their bootstrap wiring, the deployment-resolution fallback, `resolveByOrgAndSlug`, `haltAll`, the governance-profile lock path (`governance.ts:162-189`, `governance-gate.ts:124`, `profile.ts:19-20`, `policy-engine.ts:425-426`), and the seed directory. The live SEND leg was not exercised (no Inngest dev server running locally — see D-05 / verdict map J7-S3); the structural facts are established by code read.

## What happened vs expected

- **Expected:** a customer-facing outbound automation should have a graceful, operator-reachable stop distinct from an org-wide governance lock, and pausing an agent deployment should intuitively stop its associated outbound crons.
- **Observed:** the org-wide emergency-halt (governance-profile lock) DOES stop the crons. However: (a) it is a blunt all-or-nothing org lock, not a targeted outbound-messaging pause; (b) the deployment-pause action that operators reach for to "pause the agent" has zero effect on these crons because they ride the `api-direct` fallback — a mental-model gap.
- **Why DORMANT today:** at prod defaults a fresh org has 0 Policy rows, so the gate default-denies these submits (F-16) and nothing is sent. The control gap is felt only once a pilot org has allow policies provisioned.

## Suggested fix scope

- Add an env kill-switch wrapper mirroring the Mira/Riley crons (`process.env["OUTBOUND_DISPATCH_ENABLED"] === "true" ? [cron] : []`) at `inngest.ts:1180-1181` — gives a granular deployment-time off-switch.
- OR (better for runtime control): add a per-org `outboundPaused` field the cron's `findUpcomingConfirmed`/`findDue` query filters on, so operators can pause outbound messaging without triggering a full org governance lock.
- Document (or fix) the deployment-pause/cron disconnect: if the intent is that "pause agent" covers outbound crons, resolve a real deployment for `conversation.*.send` and have the cron skip orgs whose deployment is `paused`.

## Validation / test

- Add a bootstrap test asserting the dispatch crons are registered only when the kill-switch flag is on (mirror the Mira/Riley registration tests).
- Add a dispatcher test: a `outboundPaused=true` org (or pause-flag set) yields 0 submits from `findUpcomingConfirmed`/`findDue`.
