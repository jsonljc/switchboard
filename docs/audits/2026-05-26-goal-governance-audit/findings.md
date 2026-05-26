# Goal-First Governance Gap Audit — 2026-05-26

> Fresh, greenfield re-derivation. **Not** a continuation of the Cat-1..5 framing
> from the Wave-2 cleanup audit. Audited against one goal, six invariants.

## The goal

Make it **structurally impossible** for an agent action to take effect without being
**authorized, recorded, attributable, reversible, and tenant-isolated** — and to have
that enforced **automatically** so it can't silently erode. Concretely, for every
mutating action, with no bypass:

1. **Single ingress** — enters through `PlatformIngress.submit()`; no side doors.
2. **Canonical record** — produces a tamper-evident `WorkTrace`.
3. **Human escalation** — risky actions pause for approval/escalation as first-class state.
4. **Tenant isolation** — no cross-organization read or write, ever.
5. **Idempotency** — retries never double-apply.
6. **Self-enforcing** — guarded by automated checks (validators/CI) that block regressions.

## Method

Phase 1 fanned out 8 read-only investigation agents (one per invariant + "new mutating
surfaces since last audit" + "are the validators load-bearing or trivially bypassable")
against `origin/main` (c30bcf13; docs advanced to 3d85c9d4 during the run — no code delta).
Each traced callers before claiming reachability and distinguished real exploitability from
theoretical. Phase 2 collapsed findings, scored by **(real exploitability × blast radius) ÷
effort**, and separated (a) genuine escapes, (b) bypassable-but-guarded, (c) deferred/dead.
Every load-bearing claim and every cross-lane contradiction was re-verified against source
before scoring.

## Headline

This is a **hardening codebase, not a drifting one.** Five of six invariants are well
defended on the reachable surface; the prior waves (ingress migrations, #677 execution-throw
trace, #695/#697 transactional outbox, #594/#601/#643 store sweeps, #575/#712 idempotency
fingerprint stash, the live/blocking Route Governance Contract) hold up. The genuine escapes
cluster where the sweeps structurally did not reach:

- **Route-level authorization** (as opposed to store-level org scoping), and
- **The production approval path** (as opposed to the legacy one).

The self-enforcement layer is mostly real but has confirmed blind spots.

### Cross-lane corrections (verified against source)

- **"Ingress (#1) & approval (#3) have no blocking CI gate" — FALSE.** `local:verify:fast`
  runs `.agent/tools/check-routes` in _default mode_ (which includes `reachesIngress` +
  `findApprovalMutations`) inside the blocking `lint` job (`ci.yml:163`, no
  `continue-on-error`; `scripts/local-verify-fast.ts:44`). An apparent top-finding dissolved.
- **`reachesIngress` is a substring match, not a `.submit()` reachability proof** — real but
  minor: the gate runs and blocks; it is shallow, not absent.

---

## (a) Genuine ways an action can escape control _now_

Ranked by (exploitability × blast) ÷ effort.

### A1 — `deployment-memory.ts` cross-tenant IDOR · Invariant 4 · Exploit High / Blast High / Effort Low

All six endpoints in `apps/api/src/routes/deployment-memory.ts` (`// @route-class: control-plane`)
read `request.params.orgId` and pass it straight to the store, with **no comparison to the
authenticated org**. The in-handler "ownership verification" (`:66`, `:98`, `:116`) checks the
entry against the _same attacker-supplied_ `orgId`, so it is no check at all.

Reachable: registered at `bootstrap/routes.ts` under `/api/marketplace`; the dashboard proxies
(`faq-drafts`, `memory`) forward `orgId` from `searchParams`. The store methods scope by the
_passed_ org, so the AST write-validator sees nothing wrong.

- **Read escape:** `GET /api/marketplace/<ORG_B>/deployments/<DEP>/faq-drafts` returns org B's
  pending FAQ knowledge-chunk content.
- **Write escape:** `.../faq-drafts/<id>/approve` injects content into org B's agent retrieval
  corpus; `.../reject` deletes it; `POST/DELETE .../memory` tampers with org B's learned memory.

**Fix:** add `assertOrgAccess(request, params.orgId, reply)` per handler — the exact pattern
`organizations.ts` and `governance.ts` already apply. → **PR (TDD).**

### A2 — Self-approval on the production approval path · Invariant 3 · Exploit High / Blast High / Effort Med

The production approval path is lifecycle-backed: `approvals.ts` → `respondToApproval` →
`respondViaLifecycle` → `lifecycleService.approveLifecycle`. Verified:

- `lifecycle-service.ts:108-130` (`approveLifecycle`) performs **no** self-approval check, no
  approver-authorization — only bindingHash freshness + status + version CAS.
- The legacy `PlatformLifecycle` path _does_ guard: `preventSelfApprovalFromTrace`
  (`platform-lifecycle.ts:539`) blocks `respondedBy === trace.actor.id` on approve/patch unless
  `selfApprovalAllowed`.
- `respond-to-approval.ts:95-99` documents "caller owns authorization," but the only caller
  (`approvals.ts:59,64`) enforces same-org + anti-spoofing (`authenticatedPrincipal ===
respondedBy`) — **neither is self-approval prevention.**

So the principal who submitted a risky action that governance routed to `require_approval` can
approve their **own** action via `POST /api/approvals/:id/respond` (the `bindingHash` is returned
at submit and listed by `GET /pending`, so it is not secret). Defeats DOCTRINE §8 four-eyes.

Note: approver-authorization (`authorizeResponder`/`canApproveWithChain`) is _inert today_ —
approver lists default empty and `authorizeResponder` early-returns at `:525`. So **self-approval
is the concretely exploitable gap;** approver-authorization parity is a follow-up.

**Fix:** port self-approval prevention into `respondViaLifecycle` (originator = `trace.actor.id`,
already fetched). Verify `app.ts` does not set `selfApprovalAllowed: true`. → **PR (TDD).**

### A3 — `store-mutation-check` blind to top-level `packages/db/src/*.ts` + unscoped consent store · Invariant 4 / 6 · Exploit High / Blast High / Effort Low–Med

Verified: `STORE_SRC_RX = /^packages\/db\/src\/(stores|storage)\//` (`store-mutation-check.ts:12`)
and the error-mode globs (`check-routes.ts:239-240`) cover **only** `stores/` + `storage/`
subdirs. Stores at the _top level_ of `packages/db/src/` are never scanned:
`prisma-consent-store.ts`, `recommendation-store.ts`, `recommendation-outcome-store.ts`,
`prisma-governance-verdict-store.ts`, etc.

Live instance: `prisma-consent-store.ts` mutates `contact` by `{ id: contactId }` /
`{ id: contactId, consentRevokedAt: null }` with **no `organizationId`** (`:40,:57,:80,:104,:140`)
— consent grant/revoke/clear/disclosure, high tenant-isolation sensitivity. It carries no
suppress directive because the validator never looks.

**Fix:** broaden the scan scope to all of `packages/db/src/` (minus tests/crypto/oauth/seed),
then triage the newly-flagged mutations — scope the genuinely-tenant ones (consent), annotate
genuinely-global ones with a directive + ref. Verify whether the consent path is a live cross-org
escape or defense-in-depth (does the consent intent handler validate contact-org upstream?).
→ **PR (TDD).**

### A4 — Validator self-tests excluded from CI · Invariant 6 · Exploit Med / Blast High / Effort Low

Verified: `vitest.config.ts:8` excludes `.agent/**`; the CI `test` job's `vitest run` therefore
skips `.agent/tools/__tests__/*` (10 files, incl. `check-routes-error-mode`, `reachability`,
`store-mutation-check`, `route-class-validator`, `approval-mutations`). No other CI step runs
them — the `architecture` job _runs_ the validator (`--mode=error`) but does not _test_ it. So
the validators that enforce invariants 1/4/5 are themselves unguarded: break one and CI stays
green. This is the meta-guard for "can't silently erode."

**Fix:** add a blocking CI step (the `architecture` job already restores `.agent/tools/node_modules`)
running `cd .agent/tools && pnpm test`. → **PR.**

### A5 — `store-mutation-{global,deferred}` directives require no `#NNN` ref · Invariant 6 · Exploit Med / Blast Med-High / Effort Low

Verified: `hasSuppressDirectiveAbove` (`store-mutation-check.ts:115`) matches a bare
`// route-governance: store-mutation-(global|deferred)` token. The allowlist
(`allowlist.ts:50`) and route-class deferrals (`route-class-validator.ts:84`) both require
`#\d+`. So a real tenant-scope violation can be silenced with no tracking issue. Reassess
marginal value before fixing; likely require `#NNN` on `-deferred` (a TODO) while permitting
permanent `-global` to carry a rationale.

---

## (b) Enforcement that looks active but is bypassable

- **Route-class matrix enforces only `operator-direct` + `read-only`** (`route-class-validator.ts:188,243`).
  `dashboard-proxy`/`ingress-receiver`/`lifecycle`/`control-plane` mutating routes pass
  `--mode=error` with no org/idempotency cell checks. This is _why_ A1 slipped through.
  Explicitly "future tightening" per DOCTRINE §12 — partly tracked.
- **No automated check that a mutating handler persists a WorkTrace** — invariant 2 is only
  transitively implied via the `reachesIngress` substring match.
- **`reachesIngress` is a substring + allowlist-suppressed for non-operator-direct** — shallow
  but present and blocking.
- **`system_auto_approved` is unguarded free-text** (`governance-gate.ts:98`,
  `intent-registration.ts:33`) — flips an intent to `execute, riskScore:0` with no validator
  restricting which intents may carry it.

## (c) Deferred / unreachable / dead — do not grind

`objectHasOrgKey` nested over-accept (latent, zero instances); `app.route({})`-form header escape
(zero instances); Stripe webhook non-atomicity (all downstream idempotent); duplicate Inngest
report rows (benign); `scheduled-reports` cartridge `.execute()` (read-only diagnose only);
`/actions/:id/execute` org-guard asymmetry (pre-existing, prior-approval-gated); DOCTRINE:173
stale line (doc nit); 1.12 nullable-org columns + #707 FK sites (known-deferred, need migration);
~10 uncalled store methods. **Lane 7: no new ungoverned surface** — recent inbox/results work is
frontend-only; `operator.record_revenue` migrated _into_ ingress cleanly.

---

## Design / migration items — surfaced, not guessed

These have high value but need a design decision or migration; per audit discipline they are
written up rather than guessed at.

### D1 — Trace ↔ side-effect atomicity (Invariant 2, High blast)

`platform-ingress.ts` dispatches the handler (which commits the domain write + outbox, atomic
_with each other_) and **then** calls `persistTrace`, which swallows terminal failure and returns
success. A DB blip in that window yields a real revenue/consent/opportunity mutation with **no
WorkTrace** (only an `action.failed` audit entry). Compounding: the idempotency replay guard keys
on `getByIdempotencyKey`; with no trace persisted, a retry re-executes the handler → a second
revenue row (externalRef-less). #677 fixed only the _exception_ path; #695/#697 made revenue's
domain+outbox atomic with each other. The success-then-trace-fails window is untested and open.
**Fixing means changing the ingress persist contract** (pass a tx into the handler and persist the
trace in the same tx, or have the handler own its trace). Needs a design decision → spec.

### D2 — Cross-org READ validator (Invariant 4/6)

`store-mutation-check` covers only `update/updateMany/delete/deleteMany`. There is **no**
systematic check that `findMany/findFirst/findUnique/aggregate/groupBy` scope by org — A1 is one
reachable instance, but the _class_ is unguarded. The durable fix is a read-scope validator + a
triage of every existing read (many are legitimately global). Sweep-sized initiative → spec.

### D3 — `system_auto_approved` registration guard (Invariant 3/6)

Add a validator/test asserting `approvalMode: "system_auto_approved"` may only appear on an
explicit, reviewed allowlist of low-risk operator-direct intents (mirror the route-class
deferral-with-ref pattern). Small, but a code change is needed to exploit, so lower urgency.

### D4 — Concurrent webhook double-apply (Invariant 5)

Meta Leads webhook redelivery under concurrency can double-send the (billable, customer-visible)
WhatsApp greeting + double-write the `lead_received` activity: `duplicate` is derived from a
non-atomic pre-read, and the greeting child-work carries no idempotency key. Needs an atomic claim
or a deterministic child idempotency key → design.

### D5 — Creative-pipeline ungoverned spend (Invariant 1)

`POST /api/marketplace/creative-jobs` (`lifecycle`-classed, operator-reachable) creates new work
and runs a money-spending external pipeline with no ingress/WorkTrace/governance/idempotency/**entitlement**
check. Allowlisted as a deliberate carve-out, but it violates the lifecycle-vs-new-work boundary.
Needs an intent + entitlement decision → spec.

---

## Action log (Phase 3 — shipped 2026-05-26)

Four focused, TDD'd, two-stage-reviewed PRs, squash-merged to main. Three close **live** escapes;
one closes the self-enforcement gap that protects the rest.

| Finding                                               | Outcome                                                                                    | PR   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---- |
| **A1** deployment-memory cross-tenant IDOR            | Shipped — plugin-level `assertOrgAccess` guard on all 6 endpoints                          | #719 |
| **A2** self-approval on the production lifecycle path | Shipped — `assertNotSelfApproval` in `respondToApproval`, honoring `ALLOW_SELF_APPROVAL`   | #720 |
| **A3** → consent cross-tenant **write**               | Shipped — org threaded through the 5 `ConsentStateStore` mutations; scanner-scope deferred | #721 |
| **A4** validator self-tests absent from CI            | Shipped — `Validator self-tests (.agent/tools)` step in the architecture job               | #722 |

**A3 reframing (important):** investigating the L8-F4 validator blind spot surfaced a _more
severe, live_ finding than the blind spot itself — `ConsentService` was **discarding** the
`organizationId` it received (`recordGrant`/`clearConsent` destructured it as `_organizationId`),
so an operator in org A could grant/revoke/clear consent on org B's contact (PDPA-sensitive
cross-tenant write). That live write was fixed (#721); the two-stage review additionally caught a
latent regression where the gate paths scoped by the placeholder `orgId:"system"` — fixed by
threading the real `ctx.orgId`. The original L8-F4 _scanner-scope_ broadening is deferred (below).

## Deferred — self-enforcement backlog (written up, not rushed)

Marginal value dropped below the bar for a rushed fix; these need a deliberate pass:

- **L8-F4 — broaden `store-mutation-check` scan scope.** `STORE_SRC_RX` + error-mode globs cover
  only `packages/db/src/{stores,storage}/`; top-level `packages/db/src/*.ts` stores escape.
  Broadening forces triaging every newly-flagged mutation (consent now scoped via #721;
  **`recommendation-store.applyAct`** remains — `tx.pendingActionRecord.update({where:{id,status}})`
  with no org in `applyAct`'s args, a candidate cross-tenant write on the recommendation-act path
  needing reachability analysis + a caller cascade).
- **A5 — require `#NNN` ref on `store-mutation-{global,deferred}` directives.** Unlike the allowlist
  - route-class deferrals (which require `#\d+`), `hasSuppressDirectiveAbove` matches a bare token.
    Tighten `-deferred` (a TODO → needs a tracking issue); `-global` (permanent rationale) can stay
    ref-less. Low-risk but needs a sweep of existing directive sites before flipping.
- **D1–D5** above (trace↔side-effect atomicity; cross-org READ validator; `system_auto_approved`
  registration guard; concurrent webhook double-apply; creative-pipeline entitlement).

Success is measured by _real ways an action could escape control, now closed_ — not PR count.
Phase 3 closed three live cross-tenant / human-override escapes (A1/A2/A3) and made the validator
layer self-testing (A4).
