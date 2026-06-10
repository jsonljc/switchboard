# Riley Capability Audit — Findings & Prioritized Backlog

**Date:** 2026-06-10
**Baseline:** `origin/main` @ `84083f0c` (post-#958 / F-15 chat-ingress fix)
**Subject:** Riley = the `ad-optimizer` agent: `packages/ad-optimizer/` + its surfaces in `packages/core` (recommendations, agent-home), `packages/schemas`, `packages/db`, `apps/api` (crons, routes, pause workflow), `apps/dashboard` (agent panel), `scripts/riley-pause-flag.ts`, `evals/riley-recommendation/`.
**Prior audit:** [2026-06-02 Riley improvement audit](../2026-06-02-riley-improvement-audit/FINDINGS.md). This audit re-verifies everything against current `main`; do not read the old one as live state.
**North star:** Switchboard as a bespoke AI revenue operator. The moat is the acting-and-reallocating loop (ad $ → Alex books revenue → honest per-dollar ledger → Riley reallocates → Mira refreshes creative), per the [receipted-bookings architecture map](../2026-06-05-receipted-bookings-architecture/receipted-bookings-architecture-map.md). Next planned leg: Spec-1B, Riley's act-leg.
**Method:** 9 parallel domain auditors with mandatory `file:line` evidence → adversarial verification (2 independent lenses per P0/P1, 1 per P2; verifiers instructed to refute) → completeness critic over the whole audit → critic's P1s re-verified by hand. ~190 agents, ~8.1M tokens. Deterministic evidence gathered alongside: full build green (after `pnpm db:generate`; the chat failure was a stale Prisma client, not a main regression), `ad-optimizer` 613/613 tests, `core` 4016/4016 tests, `evals/riley-recommendation` 28/28 cases.
**Score:** 104 findings (96 domain + 8 critic). 61 of 65 verified findings confirmed, 1 refuted outright, several severity-corrected. Zero P0s.

Full per-domain evidence: [`domains/`](./domains/) — D1 decision engine · D2 perception/ops · D3 economics/attribution · D4 control plane · D5 governance · D6 cross-agent synergy · D7 learning/measurement · D8 cockpit/voice · D9 backlog reconciliation · D10 completeness critic.

---

## 1. Thesis

**Riley's machinery is now real; its production org is imaginary.** The 2026-06-02 audit's meta-finding was _computed, then discarded_: intelligence built and tested, then dropped before it reached a decision. Eight days and ~30 merged PRs later, that debt is substantially paid. The booked-CAC economic ladder drives decisions, evidence floors demote rather than silence, per-source economics fire a real reallocation rec, the Riley→Mira handoff fires through the real governance gate, the pause act-leg exists as a governed, well-tested dark path, and a deterministic CI-blocking eval pins it all. The governance spine held under adversarial review: **no bypass path, no phantom success, GovernanceGate exactly once, the baseline's `system_auto_approved` footgun verifiably avoided on every Riley intent.**

The new meta-finding is the successor pattern: **shipped, but production-inert.** Nearly every headline capability reads config that no product surface writes, governance policies that only the dev seed creates, or credentials that no production path can provision. On a real (non-`org_dev`) org today: Riley cannot be credentialed through the product (D10-1), any hand-provisioned token silently dies at ~day 60 (D10-2), the pause path is fail-closed-inert and the Mira handoff silently dead because their policies are never seeded (D4-5/D5-1/D6-2), the booked-CAC tier ladder and the fixed breach denominator silently fall back to pre-baseline CPL/aggregate behavior because nothing writes `targetCostPerBooked`/`conversionActionType` (D9-1/D3-2), and the cockpit hides the cost-per-booked line because nothing seeds the target (D8-3). The machine is built; the on-ramp for a paying org was never poured.

Second-order theme: **the perception/ops layer is the one domain rated unsound.** The weekly audit as wired cannot complete against a realistic account (60s-per-call limiter × serial calls inside one Inngest step), one failing deployment blinds every org after it, failures alert no one, and the insights request asks Meta for fields that are very likely invalid on the AdsInsights edge — which implies **the weekly audit has never been fired against a live Meta account.** Riley's brain is sound; its eyes and its plumbing would not survive first contact with a pilot.

What this means for the north star: the synergy skeleton is real (Alex's booked truth reaches Riley's economics end to end; Riley→Mira is built and governed), but the loop is still open in both learning directions — outcomes are written to an enriched ledger that nothing reads back into judgment, and Mira's creative performance never returns to Riley. Closing the loop is no longer architecture work; it is provisioning, wiring, and a handful of S/M fixes.

---

## 2. Current state (verified against `main` @ 84083f0c)

| Layer                         | State                                                                                                                                                                                                                                                                                                                                                                                                                                              | Domain |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **Decision engine**           | Sound-with-gaps. Booked-CAC tier ladder + calibrate-first invariant real and driving targets; evidence floors and measurement-trust lockouts demote rather than silence; per-source `shift_budget_to_source` fires (heavily gated, advisory). Blind spots: zero-conversion burn and non-durable breach produce _total silence_ (empirically reproduced); `lead_quality_degradation` diagnosis structurally unreachable; arbitration advisory-only. | D1     |
| **Perception / ops**          | **Unsound for pilot.** ~7+4N serial Graph calls × 60s fixed limiter in one Inngest step (~25 min at 5 campaigns); fleet-serial with first-failure halt; `alert:false` everywhere; `INSIGHT_FIELDS` likely invalid on the insights edge (never live-verified); decrypted tokens serialized into Inngest step state.                                                                                                                                 | D2     |
| **Economics / attribution**   | Sound-with-gaps and honest: cents discipline, fail-toward-abstention, corroboration predicate real. But booked _value_ is always 0 in production (count-truth, not value-truth) and the `booked_cac` tier is dormant for config reasons.                                                                                                                                                                                                           | D3     |
| **Act-leg (pause dark path)** | Real, governed, unusually well tested: ingress → seeded allow+mandatory-approval → park → approve → dispatch-or-recovery → executed-pause attribution. Flip-ready for a pilot org _once policies are seeded_; **not yet a sufficient template for Spec-1B** (guardrails declarative, no spend cap, no rollback).                                                                                                                                   | D4     |
| **Governance**                | No active bypass or phantom-success path. Human gate structurally thin: rests on one deletable Policy row; production orgs never get the policies at all.                                                                                                                                                                                                                                                                                          | D5     |
| **Cross-agent synergy**       | Skeleton live, payload thin. Alex→Riley booked truth: **live**. Riley→Mira handoff: **built, governed, seed-only in prod, response-blind, and the brief discards Riley's diagnosis**. Mira→Riley learn-back: **missing**. Riley→Alex lead-quality: **missing**.                                                                                                                                                                                    | D6     |
| **Learning / measurement**    | PROOF leg built (deterministic CI-blocking eval, enriched outcome ledger with corroboration). IMPROVE leg absent: ledger is write-only into judgment; operator verdicts discarded; attribution cron dark and covers 2 of Riley's action kinds.                                                                                                                                                                                                     | D7     |
| **Cockpit / voice**           | Seeing ~60% real (approval-moment economics genuinely wired end to end; CAC line has a wrong denominator and hides without a seeded target). Talking 0% real, regressed: a zombie Operator Chat widget on every authed page posts to an endpoint no server registers.                                                                                                                                                                              | D8     |
| **Credential lifecycle**      | **No working production path.** Manual UI writes `Connection`; Riley reads only `DeploymentConnection`; the sole producer (OAuth callback) 401s behind Bearer-only auth; refresh cron reads a field (`tokenExpiresAt`) that no producer writes (callback writes `expiresAt`).                                                                                                                                                                      | D10    |

---

## 3. The meta-finding: shipped, but production-inert

Every row below is shipped, tested code whose effect on a real org is **nothing**, because the producer that would feed it was never built. This is one theme, and it should be fixed as one workstream (a provisioning layer), not as scattered tickets.

| Shipped capability                           | Inert because                                                                                                                                       | Evidence                                                                                                                              | Finding     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Riley's entire stack (crons, pause executor) | No production path writes a `meta-ads` `DeploymentConnection`; missing row = silent per-deployment skip                                             | `apps/api/src/bootstrap/inngest.ts:393-401`; only producer `facebook-oauth.ts:129` is auth-unreachable (`middleware/auth.ts:124-140`) | D10-1       |
| Meta token refresh cron                      | Reads `creds.tokenExpiresAt`; the only flow that stores credentials writes `expiresAt`; cron warn-skips forever, token dies ~day 60, nobody alerted | `services/cron/meta-token-refresh.ts:53-60` vs `routes/facebook-oauth.ts:110-124`                                                     | D10-2       |
| Pause act-leg (both flags on)                | Allow + mandatory-approval policies exist only in the dev seed; marketplace deploy never seeds them → fail-closed inert                             | `packages/db/prisma/seed.ts:620`; `routes/marketplace.ts:208-241`                                                                     | D4-5 / D5-1 |
| Riley→Mira handoff                           | Same five-piece provisioning set is `org_dev`-seed-only; and the submitter discards the deny, so it is _silently_ dead                              | `prisma/seed.ts:95-620`; `bootstrap/inngest.ts:357-366`                                                                               | D6-2 / D6-1 |
| Booked-CAC tier ladder (#798/#829/#835)      | No producer writes `targetCostPerBooked` → every live org silently falls back to CPL                                                                | `inngest-functions.ts:183-194`                                                                                                        | D9-1 / D3-2 |
| Breach-denominator fix (Gate 1)              | No producer writes `conversionActionType` → live breach detection still judges Meta's aggregate `conversions`                                       | `inngest-functions.ts:186-200`                                                                                                        | D2-6        |
| Booked-revenue _value_ truth                 | `booked` ConversionRecord carries `value: 0` (no `Opportunity.estimatedValue` writer) → corroborated outcome arm and trueROAS dormant               | `calendar-book.ts:375`                                                                                                                | D3-1        |
| Coverage validator (Gate 0)                  | Seam exists, producer never built → audits still run on zero-data orgs                                                                              | `inngest-functions.ts:212-216`                                                                                                        | D9-4 / D1-9 |
| Outcome-attribution loop                     | Default-off flag, covers only `pause`/`review_budget` — not `shift_budget_to_source`, the north-star money move                                     | `outcome-attribution-config.ts:3`                                                                                                     | D7-5        |
| Cockpit cost-per-booked line                 | Hidden entirely unless `targetCpbCents` configured; nothing seeds it                                                                                | `agent-home/metrics-riley.ts:108`                                                                                                     | D8-3        |
| Flywheel intelligence layers                 | Five default-off env flags with no consolidated flip plan                                                                                           | `.env.example:331-354`                                                                                                                | D6-8        |

The repo's own memory predicted this failure class (`feedback_safety_gate_needs_producer_population`, `feedback_per_slice_review_misses_cross_slice_seams`): each slice shipped its consumer with tests against fixture producers, and the cross-slice question "who populates this for a real org?" had no owner. **The pilot-blocking unit of work is an org-provisioning step** (credentials + policies + economic config + flag plan), which pairs exactly with the provisioning-runbook work already on `main`.

---

## 4. What is verifiably sound (no generic praise; each re-verified adversarially)

- **Governance spine.** Every Riley mutation (pause execution, Mira handoff, operator act) enters `PlatformIngress.submit()`; GovernanceGate evaluates exactly once; claim-first idempotency holds; org-scoping on every recommendation act/transition (#801); approve ends in dispatch-or-recovery on the covered legs. Baseline 7.1 (the `system_auto_approved` financial footgun) was **avoided** on Riley's act-leg: the mandatory park survives the autonomous trust override and the #788 spend lever, pinned by real-engine tests (`contained-workflows.ts:408-438`). (D5-10, D5-11, D4-9)
- **Pause dark path.** Zod fail-closed executor, re-checked raised floor, 48h stale cap behind 24h park expiry, org-isolated credential resolution, status pre-read, double-submit and double-approve locked, executed-pause attribution anchored on execution time (#946). (D4-9)
- **Economics honesty.** Cents→major conversion exactly once; per-campaign booked-CAC projection real (`real-provider.ts:124-144`); per-source coverage floors; corroboration (#939) and stability (#948) finite-guarded; degradation is null/abstain, never fabrication. (D3-10, D7-8)
- **Measurement harness.** `evals/riley-recommendation` is deterministic, runs the real decision pipeline, includes refusal/abstention cases, and blocks CI. Verified green locally: 28/28. (D7-7)
- **Riley→Mira contract.** Handoff payload schema anchored; fired end-to-end through the _real_ ingress→gate→workflow seam in live-path tests; the 2026-06-03 synergy doc's publish blockers all landed. (D6-7)
- **Hygiene sweep.** Credential crypto (AES-256-GCM, per-row salt, mandatory key), store multi-tenancy, env-flag allowlists, migrations for all Riley tables, deterministic no-LLM decision path, no raw PII in Riley rows. (D10-8)

---

## 5. Confirmed P1 findings (all adversarially verified or hand-verified)

Grouped by the order they bite. No P0s exist: nothing moves money on fabricated data today, and the advisory posture plus fail-closed defaults contain every finding below.

### A. A pilot org cannot even start (provisioning & credentials)

| #                  | Finding                                                                                                                                                          | Evidence                                | Effort |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------ |
| D10-1              | No working production path to credential Riley (Connection vs DeploymentConnection split; OAuth legs 401)                                                        | critic table                            | S–M    |
| D10-2              | Token-refresh cron structurally inert (`tokenExpiresAt` never written; silent death ~day 60)                                                                     | `meta-token-refresh.ts:53-60`           | S      |
| D4-5 / D5-1        | Pause + handoff governance policies have no production seeding path (dev seed only; marketplace deploy seeds nothing)                                            | `seed.ts:620`, `marketplace.ts:208-241` | S      |
| D6-2               | Riley→Mira five-piece provisioning set is `org_dev`-only                                                                                                         | `seed.ts:95-620`                        | M      |
| D9-1 / D3-2 / D2-6 | Economic config producers missing (`targetCostPerBooked`, `conversionActionType`, `attributionWindows`) → ladder + denominator silently regress to CPL/aggregate | `inngest-functions.ts:178-200`          | S–M    |

### B. The audit would not survive first contact (perception/ops; D2 rated unsound)

| #     | Finding                                                                                                                                                                                                                                                   | Evidence                          | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------ |
| D2-2  | `INSIGHT_FIELDS` requests `status`/`effective_status`/`revenue` on the AdsInsights edge — very likely Graph error #100; never live-verified, no integration test. **Implication: the weekly audit has plausibly never completed against a real account.** | `audit-runner.ts:209-222`         | S      |
| D2-1  | 60s × (7+4N) serial Graph calls inside one Inngest step / one HTTP invocation — step timeout at realistic campaign counts                                                                                                                                 | `inngest-functions.ts:176-280`    | M      |
| D2-3  | One failing deployment halts the fleet's weekly audit; cred resolver ignores `needs_reauth` → a dead token poisons every subsequent org weekly, forever                                                                                                   | `inngest-functions.ts:164-281`    | M      |
| D2-4  | Decrypted Meta access tokens serialized into Inngest step state                                                                                                                                                                                           | `inngest-functions.ts:165-167`    | S      |
| D2-5  | No 429/Retry-After/backoff or error classification on the Meta client surface                                                                                                                                                                             | `meta-ads-client.ts:430-454`      | M      |
| D10-3 | `facebook-oauth` routes: zero org-scoping + unsigned `state` → cross-tenant token use today; OAuth-CSRF deployment binding once the flow is unbroken                                                                                                      | `facebook-oauth.ts:50,76,154-200` | S      |

### C. The brain's blind spots (decision correctness)

| #    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                         | Effort |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| D1-1 | **Zero-conversion burn = total silence.** $1,200 spend / 400 clicks / 0 conversions / 14-of-14 breach days → `{insights:[], watches:[], recommendations:[]}` (empirically reproduced twice, independently, via `decideForCampaign`). cpa=0 encodes as "good"; every gate is a `> multiple` test. Verifier bonus: with `targetROAS` unset it emits a _positive_ "maintained 0.0x ROAS" insight. No eval fixture covers conversions=0 with spend>0. | `recommendation-engine.ts:190-216`, `campaign-decision.ts:20-31` | S      |
| D3-1 | Booked conversion value always 0 in production → "booked-revenue truth" is booked-_count_ truth; corroborated arm inert                                                                                                                                                                                                                                                                                                                           | `calendar-book.ts:375`                                           | M      |

### D. The loop doesn't close (learning + synergy)

| #    | Finding                                                                                                                                                                                          | Evidence                                   | Effort |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------ |
| D7-1 | Outcome ledger write-only into judgment: only reader is the cockpit feed; trustDelta/causalStrength never feed `decideForCampaign`, thresholds, arbitration, or the pause floor                  | `bootstrap/routes.ts:155`                  | M      |
| D7-2 | Operator approve/reject verdicts still discarded as learning substrate (baseline 5.2, still open)                                                                                                | `recommendation-store.ts:260`              | M      |
| D9-5 | Attribution enriched but flag-off + display-only; the IMPROVE leg has no producer-consumer pair at all                                                                                           | `bootstrap/inngest.ts:919-951`             | L      |
| D6-1 | Handoff initiator discards `SubmitWorkResponse` — governance deny, entitlement miss, and _unexpected ungated execution_ all silent (the exact failure class the newer pause submitter alarms on) | `bootstrap/inngest.ts:357-366`             | S      |
| D6-3 | Riley's diagnosis discarded at the Mira brief seam: no campaignId, no evidence, no performance history → generic brief untargeted at the fatigued creative                                       | `recommendation-handoff-workflow.ts:79-87` | M      |

### E. Trust surfaces (cockpit/voice)

| #    | Finding                                                                                                                                                                                                                               | Evidence                                     | Effort             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------ |
| D8-1 | **Regression:** Operator Chat widget on every authed page advertises "pause low-performing ads" but posts to `/api/operator/command`, which no server has registered since April — every message fails                                | `dashboard/src/lib/api-client/agents.ts:209` | S (remove or wire) |
| D8-2 | Riley still has no conversational runtime (skill-mode loads alex+mira only; ads tools/builder zero consumers). One verifier argued P2 given the panel exists; kept P1 because "talk to the money agent" is a north-star trust surface | `bootstrap/skill-mode.ts:145-150`            | L                  |
| D8-3 | Panel cost-per-booked divides Meta spend by ALL org bookings (organic + Alex included) and hides entirely without a seeded target — operator sees inflated or zero economics                                                          | `agent-home/metrics-riley.ts:108`            | M                  |

### F. Structural guard for Spec-1B (before any further act-leg work)

| #    | Finding                                                                                                                                                                                                                                                                                                                     | Evidence                         | Effort |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------ |
| D5-2 | Human gate over a real Meta pause rests on one deletable per-org Policy row: intent-level `approvalPolicy` decorative, seed non-transactional, `DELETE /api/policies/:id` can strip the approval half while leaving allow (repo's own test pins "allow alone EXECUTES"); executor has no last-mile approved-lifecycle check | `contained-workflows.ts:422-438` | M      |
| D9-2 | `system_auto_approved` short-circuit still _structurally_ unguarded for financial intents (avoided by convention on every current Riley intent; one verifier suggests P2 — kept here because Spec-1B multiplies the blast radius)                                                                                           | `governance-gate.ts:97-108`      | S      |
| D4-6 | Execution floor bounds evidence quality, not blast radius; `guardrailMetrics` declarative only; no dollar/spend-share cap, no automated rollback — insufficient template for autonomous Spec-1B                                                                                                                             | `action-contract.ts:165-178`     | L      |

Notable confirmed P2s (full list in domain reports): non-durable breach silence (D1-2); NaN-blind parse boundary at the Meta client (D1-4) and NaN-blind base attribution row (D7-3/D3-3); idempotent-replay of a parked submit fires the loudest false alarm and drops park-truth (D5-3/D4-1); approve→dispatch has uncovered throw-legs that brick the lifecycle as approved (D4-2); ambiguous Meta timeout-but-applied write makes Riley's executed pause invisible to attribution (D4-3/D3-4); booked events timestamped with appointment time not booking time (D3-5); CI eval path-filter detonates on main not PRs (D7-4); `window=all` unreachable so the "since you hired" hero silently falls back to week (D8-7); internal ingress hop accepts `trigger:'internal'` + arbitrary actor on secret possession alone (D5-6).

Refuted/demoted for the record: D5-5 (marketplace `governanceSettings` passthrough) refuted to refinement — the route validates against a strict schema upstream; D8-6 demoted to refinement (parked card omits economics by design of the card family).

---

## 6. Prioritized backlog

Ranked by (north-star impact × confidence) ÷ effort. The striking property of this audit versus 2026-06-02: **almost nothing here is architecture.** It is producers, seeds, wiring, and guards.

### Tier 0 — "A pilot org exists" (the provisioning workstream; do as ONE arc)

1. **Credential Riley in production** (D10-1): cheapest is resolver fallback to org-level `Connection` `serviceId="meta-ads"`; alternatively auth-exempt the two OAuth legs _together with_ D10-3's signed-state + org-scoping fix. Then fix the `tokenExpiresAt`/`expiresAt` field mismatch (D10-2) and collapse the FACEBOOK*\*/META*\* env split (D10-4).
2. **Org-provisioning step** that seeds, per real org: pause + handoff policy pairs (D4-5/D5-1/D6-2), `targetCostPerBooked` + `conversionActionType` + attribution windows (D9-1/D2-6), cockpit `targetCpbCents` (D8-3), and a documented flag-flip plan for the five dark flags (D6-8). This belongs in the production provisioning runbook arc already on `main`.
3. **Close the OAuth tenancy hole now** (D10-3) — it is exploitable today with any tenant API key, independent of the pilot.

### Tier 1 — "The audit survives a real account" (perception/ops)

4. Live-verify and fix `INSIGHT_FIELDS` (D2-2); add one recorded-fixture integration test against the real Graph shape.
5. Fleet resilience: per-deployment isolation (no first-failure halt), `needs_reauth` consumption (D2-3); flip `onFailure alert:true` + zero-output alert (D2-9/D9-3).
6. Batch the account-level fetch (D2-7) — it deletes most of the 60s-limiter problem for free — then 429/Retry-After classification (D2-5). Keep tokens out of Inngest step state (D2-4: resolve creds inside the step that uses them).

### Tier 2 — "The brain stops missing the worst case" (engine correctness)

7. Zero-conversion-burn rule + eval fixture (D1-1); non-durable-breach watch (D1-2). Treat 0/NaN-denominator CPA as unknown-high, never good.
8. `Number.isFinite` guards at the two parse boundaries (D1-4, D7-3) — the repo already has this lesson (`feedback_nan_blind_comparison_gates`, #939).
9. Idempotent-replay marker fix at ingress so parked replays don't fire the false "executed without approval" alarm (D5-3/D4-1).

### Tier 3 — "The loop closes" (learning + synergy; the moat itself)

10. Stamp real value on `booked` (D3-1) — this single producer un-darkens trueROAS, the corroborated arm, and CAPI dispatchability.
11. First learning wire: per-org approval-rate by action kind → confidence modifier (D7-2), then outcome trustDelta → arbitration/pause-floor input (D7-1). Extend attribution coverage to `shift_budget_to_source` (D7-5).
12. Make the handoff submitter response-aware (D6-1, S effort, do with Tier 0) and thread Riley's diagnosis into the Mira brief (D6-3). Then Mira→Riley learn-back (D6-4) and the Riley→Alex junk-lead signal (D6-5) — the two still-missing flywheel edges.

### Tier 4 — Trust surfaces

13. Remove or wire the zombie Operator Chat widget (D8-1) — a broken affordance on every authed page is anti-trust.
14. Fix the CAC denominator to ad-attributed bookings and show an unconfigured-target state instead of hiding (D8-3); surface per-source economics (D8-4).
15. Conversational Riley (D8-2): wire the existing ads tools + builder into skill-mode. Large, but it is the last "voice" leg and the tools already exist.

### Tier 5 — Spec-1B prerequisites (before the act-leg grows)

16. Last-mile approved-lifecycle check in the pause executor + transactional policy seed + protect the approval policy row from lone deletion (D5-2).
17. Structural financial-intent guard on `system_auto_approved` (D9-2) — one `if` in the gate, removes a whole class of future footguns.
18. Blast-radius contract for Spec-1B: dollar/spend-share caps, monitored guardrails, automated rollback (D4-6). Do not scale the act-leg on the current evidence-quality floor alone.

---

## 7. North-star synergy verdict (Alex ↔ Riley ↔ Mira)

| Edge                            | State                                                                                  | What's missing                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Alex → Riley (booked truth)     | **Live end to end** (calendar-book → outbox → ConversionRecord → booked-CAC economics) | Value stamping (D3-1); `purchased` events carry `sourceCampaignId` but Riley reads booked-only (D6-6) |
| Riley → Mira (creative refresh) | **Built + governed; inert in prod**                                                    | Policy/provisioning seed (D6-2); response-aware submitter (D6-1); diagnosis-carrying brief (D6-3)     |
| Mira → Riley (learn-back)       | **Missing**                                                                            | Creative-attribution loop is dark and Mira-only (D6-4)                                                |
| Riley → Alex (lead quality)     | **Missing**                                                                            | `lead_quality_*` diagnoses computed, consumed by nothing (D6-5/D1-3)                                  |
| Riley → world (act-leg)         | **Dark, flip-ready for pilot pause** after Tier 0; not Spec-1B-ready                   | D4-6, D5-2, D9-2                                                                                      |

The honest one-liner for the user's north star: **the bespoke revenue operator exists in code; what doesn't exist is the path that turns a paying clinic into an org where any of it runs.** Tier 0 is therefore worth more than any new capability.

---

## 8. Verification log

- 9 domain auditors (one each D1–D9), each returning structured findings + a full evidence report (committed under `domains/`).
- Adversarial verification: every P0/P1 got 2 independent verifiers (factual-truth lens + severity lens), every P2 got 1; all instructed to refute. 61/65 confirmed, 1 refuted (D5-5), 3 severity-corrected (D8-6→refinement; split verdicts noted inline on D8-2, D9-2).
- Both D1-1 verifiers _independently re-reproduced_ the zero-conversion silence by executing `decideForCampaign` via tsx.
- Completeness critic (D10) ran over all 9 verdicts and found the un-owned credential-lifecycle axis; its three P1s (D10-1/2/3) were then re-verified by hand against `facebook-oauth.ts`, `meta-token-refresh.ts`, `middleware/auth.ts`, `marketplace.ts`, and `onboard.ts` — all three hold.
- Deterministic baseline: `pnpm build` green (chat failure = stale Prisma client in the fresh worktree, resolved by `pnpm db:generate` — matches the documented `pnpm reset` guidance, not a main regression), `ad-optimizer` 613/613, `core` 4016/4016 (2 skipped files), `evals/riley-recommendation` 28/28.
- Corrections to the 2026-06-05 receipted-bookings map: "`updateCampaignStatus` has zero production callers" is **no longer true** — the riley-pause-execution workflow is a real (flag-dark) caller; and the outcome ledger no longer keys on `status:'acted'` alone for executed pauses (#946 anchors on execution). Its P2.1 ("give Riley a reallocation that executes") remains open: the act-leg covers `pause` only, and `shift_budget_to_source` is both unexecutable and unmeasured today.

---

## 9. Open decisions

1. **Tier 0 packaging.** Fold the Riley provisioning set (credentials, policies, economic config, flags) into the existing production-provisioning-runbook arc, or ship as its own `riley-pilot-provisioning` script + runbook? (Recommendation: same arc — it is the same root cause as pilot-spine F-16, and one runbook beats two.)
2. **Credential unification.** Resolver fallback to org `Connection` (fast, keeps two stores) vs migrating Riley to one canonical store (right, larger)? (Recommendation: fallback now with a deprecation note; unify post-pilot.)
3. **D8-1 zombie widget.** Remove the Operator Chat widget, or fast-follow a minimal wire to the internal ingress? (Recommendation: remove now; conversational Riley is Tier 4 and deserves a real design, not a resurrected single-tenant relic.)
4. **Spec-1B gate.** Adopt Tier 5 (16–18) as explicit entry criteria for the Spec-1B act-leg? (Strong recommendation: yes — the audit found the act-leg _template_ safe only because it is human-gated and tiny; autonomy multiplies every thin spot.)
5. **Learning-loop scope for pilot.** Is D7-2 (approval-rate modifier) in the pilot window, or post-pilot? It is the lightest "gets better over time" proof and the pilot will generate the data either way.
