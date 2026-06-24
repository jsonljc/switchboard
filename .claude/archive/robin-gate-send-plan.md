# S2 plan — Robin governed send capability (the mass-outbound gate + no-show reconversion send)

Slice: Robin v1 S2. ONE coherent PR (the spec's S2/S3/S4 merged; flag/intent are inert without the
cron/send, so they ship together). Consumes spec #1163. Branch: feat/robin-recovery-send off FRESH
origin/main. Worktree .claude/worktrees/robin-recovery (built; switch to the new branch).
Built by two sequential subagents on the SAME branch: Layer A (data+governance), then Layer B (app
executor+cron+send). One PR. WILL SURFACE (trips governance/ingress/consent/send/schema stop-globs).

GROUND-TRUTH PRECEDENTS (verified 2026-06-18, mirror these exactly):

- Workflow-send intent reg + handler: contained-workflows.ts (workflowIntents array ~575; handlers Map
  ~408; modeRegistry.register(new WorkflowMode({handlers, services}))). WorkflowMode.execute resolves
  handler by workUnit.intent (workflow-mode.ts:48); deployment NOT required for workflow-mode (falls
  back). WhatsApp send: conversation-reminder-send-workflow.ts:126-152 (graph.facebook.com/v21.0/
  {phoneNumberId}/messages, Bearer token via resolveWhatsAppSendToken(), template payload).
- Seed allow+require_approval PAIR: riley-budget-governance.ts / riley-pause-governance.ts (allow
  priority 50 effect:"allow"; require_approval priority 40 effect:"require_approval"
  approvalRequirement:"mandatory"; both rule.conditions=[{field:"actionType", operator:"matches",
  value:"^<intent>$"}], org-scoped; both-or-neither upsert by id). Seeded in the org-provision tx
  (provision-org-agents.ts -> seed-riley-ad-optimizer-deployment.ts pattern).
- Cron submit + park branch: riley-pause-submitter.ts:36-68 (submit {organizationId, actor:{id:"system",
  type:"system"}, intent, parameters, trigger:"schedule", surface:{surface:"api"}, idempotencyKey,
  targetHint?}; THEN `if ("approvalRequired" in res && res.approvalRequired) {parked}` BEFORE reading
  res.result; else if res.result.outcome==="failed" {denied}). The ingress pending_approval branch lesson.
- Dedup model: ScheduledReminder (id, organizationId, contactId, bookingId, status default "pending",
  dedupeKey @unique, sentAt, skipReason, lastError, createdAt, updatedAt, @@index). Store iface in core,
  PrismaStore in db, bootstrap binding in inngest.ts. Migration: prisma/migrations/<YYYYMMDDHHMMSS>\_
  <snake_name>/migration.sql (hand-write, Postgres down; CI validates). Example:
  20260614170000_add_receipted_booking/migration.sql (CREATE TABLE + CREATE UNIQUE INDEX + CREATE INDEX).
- Consent gate: evaluateProactiveSendEligibility(input) (proactive-eligibility.ts:39-88) -> {eligible:
  true,template}|{eligible:false,reason}; org-scoped ContactConsentReader.read(orgId,contactId).
- Read base: S1's countNoShowsInWindow (prisma-booking-store.ts) -> extend to a LIST read.

DESIGN DECISIONS (pinned):

- recovery.mode = governanceConfig.recovery.mode, REUSE GovernanceModeSchema (off/observe/enforce,
  default off). resolveRecoveryConfig mirrors resolveConsentStateConfig (governance-config.ts:84-87).
- Campaign intent robin.recovery_campaign.send = WORKFLOW mode (defaultMode/allowedModes ["workflow"],
  executor {mode:"workflow", workflowId:"robin.recovery_campaign.send"}), mutationClass "write",
  NON-financial (no outbound spend; not on FINANCIAL_AUTO_APPROVE_DENYLIST), idempotent:false,
  retryable:true, allowedTriggers ["schedule"], timeoutMs 300_000. approvalMode OMITTED (-> "policy",
  so it PARKS; MUST NOT be system_auto_approved). approvalPolicy field is decorative (not gate-consumed)
  -> set to match Riley's intent reg (verify Riley's value; "none" or "always", document it is the
  SEEDED policy that gates, not this field).
- The GATE = the seeded allow+require_approval policy pair for ^robin\.recovery_campaign\.send$,
  seeded per-org in provision-org-agents.ts (so it exists for every org; flag default off keeps it
  inert until flipped). This is producer-population in the same PR.
- Campaign payload carries the FROZEN candidate cohort (array of {bookingId, contactId, phone,
  leadName, service, startsAt}) so approval freezes exactly who is contacted. Executor re-validates
  consent per recipient AT DISPATCH (consent can change between submit and approval), never bypasses.
- Dedup: RobinRecoverySend {id, organizationId, contactId, bookingId, status, dedupeKey @unique,
  sentAt, skipReason, lastError, createdAt, updatedAt}; dedupeKey = `recovery:${orgId}:${bookingId}`
  (one recovery attempt per no-show booking). Executor checks-then-writes per recipient (P2002-safe).
- Cron (Inngest, mirror appointment-reminder-dispatch): for each org, resolveRecoveryConfig; off=noop;
  observe=assemble cohort + record count metric/log, NO submit; enforce=assemble cohort (windowed
  no-shows, selectRecoveryCandidates excludes already-rebooked) + submit ONE campaign intent via
  PlatformIngress (seeded system principal) + handle the park branch.

## PLAN-GRADE FIXES (2026-06-18, incorporated; the grade caught a CRITICAL inert-gate issue)

CRITICAL (verified in code): a workflow-mode intent submitted via PlatformIngress re-resolves its
deployment by slug at the ingress resolver (`resolveAuthoritativeDeployment`,
apps/api/src/bootstrap/platform-deployment-resolver.ts:37-39) and THROWS deployment_not_found for an
unseeded slug. The platform-direct carve-out only covers operator_mutation intents (app.ts:783-784).
robin.recovery_campaign.send is workflow-mode (slug "robin", unseeded) -> WOULD ship PROD-INERT while
every test passes (test harness wires a null resolver -> platform-direct, masking it). This is the
#1119 pattern + [[feedback_safety_gate_needs_producer_population]].

- FIX A0 (NEW, first Layer-A unit, CRITICAL): extend the platform-direct predicate at app.ts:783 to
  ALSO treat robin.recovery_campaign.send as platform-direct (it is a cron-initiated, no-agent
  capability, exactly like the operator_mutation crons). Cleanest: broaden the predicate (consider
  renaming the option to isPlatformDirectIntent and matching operator_mutation OR the recovery
  campaign intent). RED test: submitting the campaign through a resolver that THROWS for "robin" must
  NOT return deployment_not_found; it must PARK. Mirror the #1119 carve-out exactly.
- FIX (B4): the real-gate PARKS test MUST use a resolver that resolves "robin" via the carve-out (not
  the test-server null fallback, which masks the prod failure); assert the submit does NOT return
  deployment_not_found AND parks (require_approval).
- FIX (A7 seed coverage): wire seedRobinRecoveryPolicies into the ALWAYS-RUN branch of
  provisionOrgAgentDeployments (before any opts.mira early-return) so existing/day-one orgs get the
  policy (the gate default-denies without it when the flag is flipped).
- FIX (A3/A4 rebooked exclusion): add an org-scoped BATCHED read findUpcomingContactIds(orgId,
  contactIds[]) -- do NOT loop the per-contact findUpcomingByContact (N queries). Org-scope it (F12).
- FIX (A6 migration): generate the migration via `prisma migrate diff --script` for exact name/type
  match (the index name auto = RobinRecoverySend_dedupeKey_key, <=63 chars); do NOT hand-author from
  memory (db:check-drift reds on any mismatch).
- CONFIRMED NOT NEEDED: eval:governance fixture (the seeded org-policy path is not the eval harness's
  skill-runtime gate); route-allowlist (cron submits via ingress, not a route); new env var (WhatsApp
  token already allowlisted; recovery.mode is a DB governanceConfig passthrough, no migration/env).
- OUT OF SCOPE (surface separately, NOT Robin's job): the EXISTING conversation.reminder.send /
  followup / meta.lead.greeting.send workflows hit the SAME deployment_not_found gap in prod (slug
  "conversation"/"meta" unseeded; the pre-ingress try/catch returns an api-direct fallback but the
  ingress resolver re-derives + throws). A real pre-existing prod bug = proactive sends inert. Robin's
  A0 is a POINT-FIX for robin's intent only; the systemic fix (repair the reminders too, or seed those
  deployments) is its own slice for the user to prioritize.

## LAYER A (subagent 1) — data + governance plumbing (TDD, RED first each)

A1. schemas: governanceConfig.recovery.mode (reuse GovernanceModeSchema, default off) +
resolveRecoveryConfig (mirror resolveConsentStateConfig). RED test: default off; parses observe/enforce.
A2. schemas: RobinRecoveryCampaignParams (the intent payload: candidates[] cohort + window meta) Zod
schema. RED test: validates a cohort, rejects malformed.
A3. db: PrismaBookingStore.findNoShowRecoveryCandidates({orgId, from, to}) -> rows (bookingId,
contactId, service, startsAt + attendeeName/phone via contact join). Org-scoped, attendance="no_show",
startsAt in [from,to). RED test (mocked Prisma): asserts org-scoped where + the join select.
A4. core: pure selectRecoveryCandidates(candidates, {existingFutureBookingContactIds}) -> filtered
cohort (exclude contacts with a future booking). NaN-safe, pure. RED test.
A5. core: register robin.recovery_campaign.send in the intent registry (workflow mode, NOT
system_auto_approved). RED test: registry lookup returns it with approvalMode != system_auto_approved.
A6. db: RobinRecoverySend model + hand-written migration (mirror ScheduledReminder + the migration SQL
convention) + PrismaRobinRecoverySendStore (create/findByDedupeKey/markSent/markSkipped/markFailed) + the store interface in core. RED test (mocked Prisma) for the store. db:check-drift will be
CI-validated (Postgres down locally; hand-write the migration to MATCH the schema exactly,
incl. the 63-char index-name cap).
A7. db: seed robin-recovery-governance.ts (allow priority 50 + require_approval priority 40 mandatory,
anchored ^robin\.recovery_campaign\.send$, org-scoped, both-or-neither upsert) + WIRE
seedRobinRecoveryPolicies into provision-org-agents.ts (the org-provision tx, alongside Riley's).
RED test: both policies seeded (mirror the riley seed test). PRODUCER-POPULATION: this is what makes
the gate non-inert; ship it here.
A8. core+db: widen any structural store provider (the bookings store interface, the new
RobinRecoverySendStore) -> fan-out to stubs (the ReportStores/store fan-out lesson; grep all providers).

## LAYER B (subagent 2, same branch) — executor + cron + consent-gated send (TDD, RED first each)

B1. apps/api: the workflow handler robinRecoveryCampaignSendHandler (WorkflowHandler.execute): iterate
the FROZEN candidate cohort; for EACH recipient call evaluateProactiveSendEligibility (consent +
24h window + approved template) -> ineligible: record skip reason, continue; eligible: check dedup
(findByDedupeKey) -> already-sent: skip; else send WhatsApp template (mirror reminder send) + write
RobinRecoverySend (markSent) + WorkTrace. NaN-safe, org-scoped, never bypass consent. RED test: a
revoked-consent recipient is skipped (not sent); an eligible recipient sends + dedups; a re-run does
not re-send (dedup). Register the handler in the contained-workflows handlers Map + workflowIntents.
B2. apps/api: the Inngest recovery cron (mirror appointment-reminder-dispatch): for each org,
resolveRecoveryConfig; off=noop; observe=assemble cohort (findNoShowRecoveryCandidates over a recent
window + selectRecoveryCandidates) + record candidate count (metric/log) + NO submit; enforce=assemble + submit ONE robin.recovery_campaign.send via PlatformIngress (actor {id:"system",type:"system"},
trigger:"schedule", idempotencyKey per ISO-week+org) + handle `"approvalRequired" in res` (parked,
log) / outcome==="failed" (denied, log). RED test: off=no submit; observe=no submit + count recorded;
enforce=submits + handles parked. The cohort selection needs the "future booking contactIds" -> a
helper read (findUpcomingByContact exists per-contact; or a batched read) to exclude rebooked.
B3. apps/api: bootstrap wiring (construct PrismaRobinRecoverySendStore + the cron deps + register the
cron in inngest.ts). Verify the cron is registered + the handler resolves.
B4. integration test (buildTestServer, mirror revenue-ingress.test pattern): submit
robin.recovery_campaign.send through REAL ingress->governance->seeded-policy and assert it PARKS
(require_approval). THE REAL-GATE PARKS TEST (the spec's pinned requirement; proves the gate works).

## GATES (full suite, from the worktree)

typecheck (FULL); test + --filter @switchboard/api test + --filter @switchboard/db test (mocked Prisma);
lint; format:check; arch:check; CI=1 npx tsx scripts/local-verify-fast.ts (catches new mutating-route /
env-var allowlist debt -- the cron/route may need allowlist entries); security pnpm audit; pnpm build
if app pkgs; db:check-drift (schema change -> Postgres needed; if down, hand-validate the migration vs
schema + note CI will run it); pnpm eval:governance (ALWAYS; the seeded policy + the gate are governance
-- ADD/EXTEND a governance eval fixture for the parked campaign if the engine path is exercised);
em-dash grep on the FULL diff (incl CSS/comments). Three-dot diff; confirm every stop-glob touched is
expected. NO new mutating route without a route-allowlist entry (the cron submits via ingress, not a
route, so likely no route-allowlist; verify with local-verify-fast).

## DISPOSITION

Trips governance/ingress/consent/external-send/schema-migration stop-globs -> SURFACE merge-ready (human
merge call). Independent fresh-context opus review (zero >=warn) before surfacing. This is the 2nd
consecutive surface (S1 was 1st) -> after surfacing, STOP the loop + final report.
