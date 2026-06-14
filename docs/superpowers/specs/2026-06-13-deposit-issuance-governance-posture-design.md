# Deposit-link issuance governance posture (go-live decision)

Date: 2026-06-13
Status: ACCEPTED and IMPLEMENTED. The posture is pinned by tests in PR #1016 (squash-merged to
main, 069c3ab6). This design record was kept off the implementation branch and lands on main via a
focused docs PR, per branch doctrine.
Relates to: `docs/superpowers/specs/2026-06-05-close-the-revenue-loop-design.md` §8, PR #994
accepted-property, PR #1016

## 1. The decision point

The no-PMS deposit loop is code-complete and Noop-proven end to end: settlement webhook (#984),
issuance producer (#994), credential contract (#999), per-org provisioning writer (#1006), and
customer redirect URLs + public payment pages (#1015). The remaining live-flip items are
operational (provision a real Stripe account, set `PAYMENT_PUBLIC_URL`, secret-before-endpoint
ordering) EXCEPT one code-shaped question flagged as an accepted-property at #994:

> The core `deposit-link` tool (`deposit.issue`) is registered with `effectCategory: "read"`, so
> in-skill governance auto-approves it at every trust level and it "rides the booking's prior
> approval" (`apps/api/src/bootstrap/skill-mode.ts:370-373`). On Noop that is a true read. Once an
> org is flipped to the live `StripeConnectPaymentAdapter`, the agent autonomously issues a real,
> customer-facing Stripe Checkout deposit link with no per-issue human gate.

The tension: the product strategy sells a SUPERVISED co-pilot, and memory
`feedback_system_auto_approved_bypasses_spend_gates` (#931) says financial intents should require
approval. Counterweight: a deposit link is inbound collection, no money moves until the customer
actively pays, it is idempotent (`deposit_${bookingId}`), and the amount is a fixed pilot constant
(SGD 50). This document resolves the tension before the live flip.

## 2. Decision

**Keep `deposit.issue` autonomous. Do NOT add a per-issue human approval gate.** Affirm the existing
`effectCategory: "read"` posture for the go-live moment, pin it with a test that drives the REAL
governance decision, and record the rationale at the code site. Add NO env flag, NO new
intent/policy, and NO `governanceOverride`.

This is a "keep current posture, make it intentional, tested, and documented" change. There is no
production behavior change: the posture is already in code; this PR makes it deliberate and
drift-proof.

## 3. Why keep it autonomous

Four independent lines of reasoning converge, so the decision is overdetermined.

### 3.1 The codebase already distinguishes inbound collection from outbound spend

`feedback_system_auto_approved_bypasses_spend_gates` (verified on main): the F4 #978 structural
guard throws if a `spendBearing: true` intent is also `system_auto_approved`. Crucially, the marker
means **OUTBOUND spend specifically**, and "inbound recording like `revenue.record` carries an
`amount` yet stays auto-approved." So the codebase's settled doctrine is: outbound spend requires
approval; inbound recording/collection auto-approves even though it carries money.

A deposit link is a request for the CUSTOMER to pay the CLINIC. It is inbound collection, the same
category as the codebase's auto-approved inbound recording intents (the `payment.record_verified`
intent is `system_auto_approved`; `intent-registration.ts` names `revenue.record` as the doctrine's
illustrative inbound example). Keeping it auto-approve is CONSISTENT with the codebase's own
governance doctrine, not a violation of #931. #931 protects against unauthorized OUTBOUND spend
(money leaving the org); deposit issuance is the opposite direction. The coarse instinct
"financial = approval" is the wrong granularity; the codebase already encodes direction.

### 3.2 The harm is genuinely bounded by existing preconditions

Every dimension that could make autonomous issuance dangerous is already pinned in code:

- Amount: a fixed injected constant (`PILOT_DEPOSIT_AMOUNT_CENTS = 5000`, SGD 50). The LLM has no
  control over the amount (`deposit-link-wiring.ts:16`).
- Replay: idempotent. `externalReference = deposit_${bookingId}`; a replay returns the same link.
  At most one distinct link per booking, by construction.
- Precondition: the tool refuses unless `booking.status === "confirmed"` (`deposit-link.ts:83-93`).
  No link is ever issued for an unbooked or unconfirmed slot.
- Tenant: `orgId` is sourced from the trusted `SkillRequestContext`, never tool input (AI-1); a
  cross-org booking is filtered to `MISSING_BOOKING` in the wiring adapter
  (`deposit-link-wiring.ts:54-57`).
- No money movement at issue time: issuing a link moves zero money. Money moves only if the
  customer actively pays, and only that PSP-verified payment (re-fetched by id) settles.

### 3.3 It strictly rides a higher-governance-class action

The booking action `calendar.book` is `effectCategory: "external_mutation"`
(`calendar-book.ts:216`), which the policy table gates as require-approval in supervised and guided
modes and auto-approve only in autonomous. The deposit (`read`) is a LOWER governance class and is
strictly downstream of a confirmed booking. The consequential, customer-committing gate already
sits at the booking; the deposit is a bounded inbound artifact of an already-confirmed booking. If
anything, the deposit is less risky than the action it follows. The `status === "confirmed"`
precondition is the in-code embodiment of "rides the booking's prior approval."

### 3.4 A per-issue approval is UNREPRESENTABLE, so require-approval here would BREAK the loop

This is the constraint that settles the "if a gate, then where/how" fork. Verified against current
code (`skill-executor.ts:536-559`) and `feedback_skill_runtime_two_constraint_regimes`:

When a `beforeToolCall` hook returns `decision: "pending_approval"`, the executor does NOT park the
conversation. It synthesizes a `pendingApproval` ToolResult, records `governanceOutcome =
"require-approval"`, then **re-injects that result into the LLM loop and continues** (the result is
filtered, wrapped, and pushed back as tool output). There is no suspend, no human notification, no
resume-to-execute. The side effect simply does not happen and the model is told "needs approval."
The existing executor tests (`skill-executor.test.ts:309-432`) already pin this behavior.

Therefore an in-skill `require-approval` on `deposit.issue` would NOT create a
human-approve-then-issue gate. It would silently block issuance with no resume path, breaking the
deposit loop in that mode. It is a loop-breaking deny wearing an approval label, not supervision.

The ONLY mechanism that "persists a lifecycle and resumes-to-execute" is the platform
`require_approval` path (`createGatedLifecycle`). Applying it to a mid-conversation tool call
requires freezing the concrete tool-call rather than the non-deterministic `alex.respond` turn,
which the revenue-loop spec explicitly defers as "the in-skill guided-trust approval refactor ...
its own later PR" (close-the-revenue-loop §4). `feedback_skill_runtime_two_constraint_regimes`
sizes it as "a quarter-scale rebuild of the submission/WorkTrace lifecycle." That is out of scope
for the pilot, and the task explicitly says "Do not build a per-issue approval UX the pilot does
not need."

## 4. Where the deliberate human control actually lives

"Supervised co-pilot" requires a human to control whether the agent can take a consequential live
action. For deposit issuance, that control already exists at two representable altitudes, and they
are the RIGHT altitudes:

1. **Per-org go-live: provisioning.** An org issues real links only if it has a fully provisioned,
   validated Stripe Connection. Provisioning is a deliberate operator action via the root CLI
   `scripts/provision-stripe-for-org.mts` (#1006), run with a real `acct_...` and per-org
   `sk_`/`rk_` key (secret via stdin). There is deliberately NO self-serve HTTP route. The factory
   is fail-closed: an incomplete or inconsistent provision (or `creds.connectedAccountId !==
   connection.externalAccountId`) resolves to Noop with a loud error (`payment-port-factory.ts:89-146`,
   #999 guard). Disconnecting the Connection is the per-org kill switch.
2. **Per-transaction: booking confirmation.** The deposit rides a confirmed booking, and
   `calendar.book` is the higher-governance-class action it follows (§3.3).

The supervision is "the human decides which clinics go live and the bookings are governed," not
"the human approves each idempotent inbound payment-link artifact." That is the correct reading of
supervised co-pilot for a bounded inbound action.

## 5. Forks resolved

### Fork A: gate or no gate
No gate. Keep autonomous (§3). The "financial = approval" instinct does not apply to inbound
collection (§3.1), the harm is bounded (§3.2), it rides a higher-class gated action (§3.3), and the
only representable in-skill gate would break the loop (§3.4).

### Fork B: if a gate, where and how
Moot given Fork A, but evaluated and rejected on its merits:
- A true approval-park is unrepresentable in skill-mode (§3.4). Rejected: cannot be honored.
- A deterministic global env flag (live-issuance enable) was considered. Rejected: per-org
  provisioning is ALREADY the deliberate, fail-closed, reversible go-live gate (§4), so a global
  flag is redundant ceremony. It would also add a settlement-loss-on-mid-flight-flipoff wrinkle (the
  webhook 200-skips and Stripe stops retrying), and a new env var carries allowlist/maintenance
  cost. The task's guidance is "smallest correct mechanism" and "at most a minimal guardrail." The
  smallest correct mechanism is the deliberate gate that already exists.
- An explicit `governanceOverride: { ...: "auto-approve" }` on the op was considered. Rejected: it
  is redundant with the `read` policy, reads as a no-op "bypass," and silently MASKS a future
  `effectCategory` reclassification instead of forcing a re-decision. A test that asserts the real
  decision is a louder, better tripwire: a future change that flips deposit to require-approval/deny
  turns the test RED and forces the maintainer to read this rationale.

### Fork C: Noop vs live
Governance is, and should remain, **port-agnostic at decision time**. The `beforeToolCall` decision
is computed from `op.effectCategory` alone, BEFORE `execute()` resolves the port via
`paymentPortFactory(orgId)`. The governance layer structurally cannot (and must not) know whether
the resolved port is Noop or the live `StripeConnectPaymentAdapter`. Coupling governance to the
adapter type would require an async port resolution inside the hook and would not change the
correct decision (auto-approve) anyway. The live-vs-Noop distinction is the PORT FACTORY's job and
it already lives there, fail-closed (§4). On Noop the call is a frictionless true read; on live it
is the same auto-approved inbound issuance. This is proven by a test that builds the tool with a
THROWING port factory and shows the governance decision still resolves to proceed without ever
touching the port.

## 6. Proof (tests that drive the REAL governance decision)

No mock that assumes the answer. Each test builds the real tool (real `effectCategory`) and runs
the real policy function and the real hook.

1. Core `packages/core/src/skill-runtime/tools/deposit-link.test.ts`, new describe block:
   - `getToolGovernanceDecision(op, trustLevel)` returns `"auto-approve"` for supervised, guided,
     AND autonomous. Pins the decision against the real policy table.
   - A real `GovernanceHook` over a map containing the real tool returns `{ proceed: true }`
     (no `decision`, never `pending_approval`/`denied`) for `deposit.issue` at all three trust
     levels. Pins the runtime decision path.
   - Port-agnostic proof: the tool built with a THROWING `paymentPortFactory` still resolves to
     `proceed: true`, and the factory is never called at decision time. Resolves Fork C with
     executable evidence.
2. API `apps/api/src/bootstrap/__tests__/deposit-link-wiring.test.ts`, new test:
   - The WIRED tool (`buildDepositLinkToolFactory`) resolves to `proceed: true` through a real
     `GovernanceHook` at all three trust levels. Guards the integration boundary against a
     wiring-level override or reclassification (drift).

## 7. Invariants preserved

This change touches a comment and tests only. All loop, settlement, and Noop invariants are
preserved by construction (no production behavior change):
- Settlement stays webhook-only with `retrievePayment` re-fetch authority (untouched).
- The #999 credential guard, #1006 provisioning writer, and #1015 redirect wiring are untouched.
- The Noop fail-closed posture is untouched: an incomplete provision still resolves to Noop.
- The deposit amount stays the pilot constant.

## 8. Affirmation of close-the-revenue-loop §8

§8 already states: "Deposit-link issuance is an idempotent external read riding on the
already-approved booking, no new approval." This decision AFFIRMS that line for the go-live moment
and supplies the fuller rationale (inbound-collection doctrine, bounded harm, the higher-class
booking it rides, the unrepresentability of mid-loop approval, and the deliberate gates at
provisioning and booking confirmation). The durable on-main record is the strengthened code comment
in `deposit-link.ts` plus the governance tests.

## 9. Remaining live-flip list after this PR

Pure operations, no code:
1. Provision a real entitled org + Stripe Connect account via `scripts/provision-stripe-for-org.mts`.
2. Set `PAYMENT_PUBLIC_URL` (or `DASHBOARD_URL`) to the real https origin.
3. Secret-before-endpoint ordering for #984 (`STRIPE_CONNECT_WEBHOOK_SECRET` + `STRIPE_SECRET_KEY`
   set before registering the Connect endpoint; subscribe to `payment_intent.succeeded`).

The autonomous-issuance governance decision (this document) is RESOLVED.
