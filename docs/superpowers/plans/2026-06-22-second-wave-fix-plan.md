# Second-Wave Fix Plan (A15+)

PR-sized slices for the 38 gaps in
[`docs/audits/2026-06-22-second-wave-gap-eval/README.md`](../../audits/2026-06-22-second-wave-gap-eval/README.md).
These are net-new beyond the 2026-06-20 A1-A14 plan. **No new product scope is invented here -
every slice closes a verified, independently-reviewed gap.** Fix corrections from the code
review are already baked into each slice.

## Build-loop protocol

- **One slice per fresh session, off `main`, in a new worktree:** `git worktree add
  .claude/worktrees/<slug> -b <branch> main && cd .claude/worktrees/<slug> && pnpm worktree:init`.
- **Process:** brainstorm only if the design is genuinely open (most slices below have a
  determined design and can go straight to a short plan); then TDD execute; then request an
  independent code review; then verify; then merge clean (squash, conventional commit,
  `--delete-branch`), confirm required `gh pr checks` are green, ff-sync `main`, remove the
  worktree.
- **Money-adjacent / multi-tenant / governance slices SURFACE before merge** (human merge call):
  A15, A16, A17, A18, A19, A22.
- **Per-commit hygiene:** `pnpm --filter <pkg> exec tsc --noEmit` per touched package (pre-commit
  is eslint+prettier only); rebuild each lower package's `dist` after its task so api/chat tsc
  and the eval see new types; `pnpm format:check` before push; hand-author migrations +
  `pnpm db:check-drift`.

## Slice ledger

| Slice | Gaps | Severity | Status |
|---|---|---|---|
| A15 | P1-1 + P1-2 (agentNotifier multi-tenant) | P1 | not started |
| A16 | P1-4 (API approver-role floor) | P1 | not started |
| A17 | P1-3 (weekly-report recipient isolation) | P1 | not started |
| A18 | P1-5 + P1-7 (consent: CTWA opt-in + reuse re-greeting) | P1 | not started |
| A19 | P1-6 (booking-consent resolver-error fail-closed) | P1 | not started |
| A20 | P1-8 (Mira measured-signal over full cohort) | P1 | not started |
| A21 | P1-9 (Riley config coercion) | P1 | not started |
| A22 | P2-1 (payments-webhook entitlement carve-out) | P2 (high-leverage) | not started |
| A23+ | remaining P2 (P2-2..P2-21) | P2 | backlog (table below) |
| A24+ | P3 (P3-1..P3-8) | P3 | backlog (table below) |

**Recommended order:** A15 -> A16 -> A17 -> A18 -> A19 -> A21 -> A20 -> A22, then the P2/P3
backlog. A15-A17 are the multi-tenant / four-eyes go-live blockers; do them before tenant #2.
A18-A19 are consent correctness; do before WhatsApp templates flip on. A20-A21 gate Mira/Riley
effectiveness once those agents are provisioned.

**Coordination:** A7 (`fix/proof-chain-integrity-a7`) and A8 are in flight in their own
worktrees - A22, P2-18 (cancel-receipt-void) and P3-7 (paidVisitsByCampaign) touch the same
proof-chain/receipt files, so rebase onto their merges and re-verify the receipt seam. A12 (#1250)
already merged.

---

## A15 - Per-org WhatsApp send + window gate on the operator/escalation reply path (P1-1 + P1-2)

**Highest-leverage slice.** Closes the multi-tenant leak on the two human-reply routes.

- **Files:** `apps/api/src/app.ts:423-442`; `apps/api/src/routes/conversations.ts:341`;
  `apps/api/src/routes/escalations.ts:367`; `apps/api/src/notifications/proactive-sender.ts`;
  reuse `apps/api/src/lib/whatsapp-send-creds.ts` (`resolveOrgWhatsAppSendCreds`, the A1 helper).
- **Fix:**
  1. Resolve per-org send creds for the reply path via `resolveOrgWhatsAppSendCreds(connectionStore, orgId)`,
     mirroring the four `contained-workflows.ts` sends. Pass creds through a **single**
     `ProactiveSender` (a creds-parameterized send) - do NOT construct a fresh per-request
     sender (it resets the in-memory daily-rate-limit map and defeats `MAX_DAILY_MESSAGES`).
  2. Add `organizationId` to `isWithinWindow` and pass the route's in-scope `orgId` (the auth
     org), NOT `storeResult.organizationId` (absent on the result types). Treat null-org rows as
     non-matching (fail closed).
  3. Converge the window source: the reply path reads `ConversationState.lastInboundAt` while the
     workflow path reads `ConversationThread.lastWhatsAppInboundAt` - pick one and document it.
- **Acceptance:** a real-producer test with two orgs sharing one customer phone asserts (a) org B's
  reply is sent from org B's `phoneNumberId`/token, and (b) the 24h window gate uses the replying
  org's inbound timestamp, not the freshest cross-org row. Per-field env fallback only for the
  single-tenant pilot. SURFACE before merge.

## A16 - Approver-role floor on the API approval surface (P1-4)

- **Files:** `apps/api/src/routes/approvals.ts:185-235`; `routes/action-lifecycle.ts:16-62`;
  `routes/internal-chat-approvals.ts`; `packages/core/src/approval/respond-to-parked-lifecycle.ts`;
  reuse `require-role.ts` and `APPROVER_ROLES` from `respond-to-channel-approval.ts:90`.
- **Fix:** add `requireRole(request, reply, 'approver','operator','admin')` to the respond and
  execute routes **and** the internal-chat-approvals bridge (so the floor is not routable-around).
  Push the `approvalScopeSnapshot.approvers` membership check into core
  (`respond-to-parked-lifecycle`) so chat and API share one spine; enforce membership only when
  the approver array is non-empty (the pilot's `defaultApprovers:[]` must not lock everyone out).
- **Acceptance:** a `requester`-only principal gets 403 on `POST /api/approvals/:id/respond`,
  `POST /api/actions/:id/execute`, and the internal bridge; self-approval stays blocked. SURFACE.

## A17 - Weekly owner-report recipient isolation (P1-3)

- **Files:** `apps/api/src/services/reports/weekly-report-recipients.ts:27-31`; `app.ts:1031`.
- **Fix:** stop using `getEscalationConfig` (and thus the process-global
  `ESCALATION_EMAIL_RECIPIENTS`) as an owner-report recipient source. Resolve only a per-org
  stored list (no env fallback), then fall through to the org's verified dashboard users.
- **Acceptance:** with `ESCALATION_EMAIL_RECIPIENTS` set and no stored config, an org-B owner
  report goes to org B's verified users (or `no_recipients`), never the env list. SURFACE.

## A18 - Consent: CTWA window-not-permanent-optin + dedup-reuse no-regreeting (P1-5 + P1-7)

These compound, so fix together.

- **Files:** `packages/core/src/intents/lead-intake-handler.ts:101-109,124,70,98,137`;
  `apps/api/src/services/workflows/meta-lead-intake-workflow.ts:139,158,173-187`.
- **Fix:** (P1-5) set `optInSource` only for `instant_form`, not `ctwa` (a genuine CTWA inbound
  rides the `lastWhatsAppInboundAt` window). (P1-7) extend `LeadIntakeResult` to a discriminated
  outcome `created | reused | idempotent-duplicate`; the orchestrator skips greeting **and** the
  inquiry-record child unless freshly created. (Prefer this over a contact-scoped greeting key.)
- **Acceptance:** a CTWA lead is greeted inside the 24h window but blocked `no_optin` after it
  closes with no fresh inbound; two distinct leadgenIds for one corroborated person yield exactly
  one greeting and one inquiry record. Verify the Instant Form actually captures an opt-in
  checkbox before trusting its durable opt-in. SURFACE.

## A19 - Booking-consent resolver-error fail-closed (P1-6)

- **Files:** `apps/api/src/bootstrap/skill-mode.ts:343-347,544`;
  `packages/core/src/skill-runtime/tools/calendar-book-consent.ts:97-112`.
- **Fix:** in `resolveMode`, on `status === "error"` return `"enforce"` when
  `consentPostureCache.lastKnown(deploymentId)?.mode === "enforce"` (reusing the existing
  read-error fail-closed path), `"off"` on `"missing"`. Emit a resolver-error counter.
- **Acceptance:** a unit test drives the real `resolveMode` adapter with `{status:"error"}` + a
  warm enforce posture and asserts `"enforce"`; cold cache returns `"off"`. SURFACE.

## A20 - Mira measured-signal over the full cohort (P1-8)

- **Files:** `packages/core/src/creative-read-model/build-read-model.ts:80`; `types.ts` (counts);
  `apps/api/src/services/cron/mira-self-brief.ts:148-163`.
- **Fix:** add `measuredCount`/`hasMeasured` to `MiraCreativeCounts` computed over the full
  `FETCH_CAP` cohort (like `inFlight`); worker reads `counts.hasMeasured`; update the worker's
  inline read-model dep type.
- **Acceptance:** a worker test with > 5 jobs where the measured row is not in the newest 5
  asserts the floor passes and the brief renders.

## A21 - Riley weekly-audit config coercion (P1-9)

- **Files:** `packages/ad-optimizer/src/inngest-functions.ts:228,244-246`; reuse
  `resolveAdOptimizerConfig` from `@switchboard/schemas`.
- **Fix:** route the whole `deployment.inputConfig` through `resolveAdOptimizerConfig` once and
  read all numeric fields (`targetCPA`, `targetROAS`, `targetCostPerBooked`) off the parsed
  result.
- **Acceptance:** a cron-audit test with the seeder's string shape (`targetCPA:"30"`) asserts the
  resolved `AuditConfig.targetCPA === 30` (number) and no throw in `budget-analyzer`.

## A22 - payments-webhook entitlement carve-out (P2-1, highest-leverage P2)

- **Files:** `apps/api/src/routes/payments-webhook.ts:140-143`; `platform-ingress.ts:206-221`.
- **Fix:** recording an already-settled payment is revenue PROOF, not an outbound action - carve
  `payment.record_verified` out of the entitlement check (service-only + PSP-reverified), or
  branch on `result.error.type` and return 200 + a reconciliation alert instead of a blanket 500.
- **Acceptance:** the entitlement-blocked path returns 200, emits a reconciliation signal, and the
  T1 receipt + revenue event are not lost. Coordinate with A7 (proof-chain). SURFACE.

## P2 backlog (A23+)

P2-2..P2-21 from the audit README. Group by file family into PR-sized slices when picked up:
Alex tools (P2-2 booking date validation, P2-3 afterSkill ordering, P2-6 crm-write turn-kill,
P2-7 crm-query cross-deployment, P2-8 web-scanner SSRF, P2-9 escalate empty handoff); intake
observability (P2-4 CTWA `{ok:false}`, P2-5 health-checker token fallback); Riley/Mira
(P2-10 corroboration origin, P2-11 revenue_proven cap, P2-12 DALL-E dormant); Robin
(P2-13 orphan row, P2-14 cohort getSendContext); consent (P2-15 STOP-window); Quinn
(P2-16 strand-approved, P2-17 expiry-no-caller); proof-chain (P2-18 cancel-receipt-void,
P2-19 ROI agentDeploymentId); crons (P2-20 reconciliation false-failing, P2-21 lifecycle-sweep
starvation).

## P3 backlog (A24+)

P3-1..P3-8 from the audit README (contract-honesty + polish): reallocate docstring, capability-flag
audit ordering, reschedule/cancel supervised override, CTWA-referral-on-unsupported-type, Robin
retry config-gap classification, Mira concept.draft dial, paidVisitsByCampaign first-wins,
DASHBOARD_URL default.
