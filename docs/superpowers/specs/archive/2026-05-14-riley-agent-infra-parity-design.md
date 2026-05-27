# Riley Agent-Infra Parity — Wave B Doctrine Spec

**Date:** 2026-05-14
**Status:** Acceptance-criteria spec — no slicing yet (a future brainstorm produces Wave B PR slicing)
**Parent:** [Riley Cockpit — Wave A Slicing Design](./2026-05-14-riley-cockpit-wave-a-slicing-design.md)
**Sibling target:** [Riley Cockpit Home — Design Spec](./2026-05-13-riley-cockpit-home-design.md)
**Conceptual parallel:** [Alex agent-infra-parity workstream](./2026-05-13-agent-infra-parity-design.md) (PR-3 merged 2026-05-14, PR-3.1 in review, PR-3.2 scoped 2026-05-14)

---

## Summary

Defines what **Riley must satisfy to be "agent-complete"** in the Switchboard operating-layer doctrine, mirroring the parity work Alex has gone through. This spec is **acceptance-criteria only** — it does not define PR slicing, rollout strategy, or implementation order. Those land in a future brainstorm after the Wave A cockpit ships and we can observe whether Riley's recommendation activity warrants the doctrine investment in full or in part.

Wave B is **not a precondition for the Wave A cockpit**. The cockpit ships first on Riley's current `Recommendation + AuditEntry` substrate (Wave A); Wave B closes the operational-doctrine gap underneath without changing cockpit UI components, by virtue of the Wave A adapter boundary.

---

## Verdict from the agent-readiness audit

A pre-brainstorming audit compared Riley to Alex along the operating-layer dimensions that make something a "proper AI agent" in the Switchboard doctrine, not just a backend job. Result:

**Riley is currently a scheduled analytics pipeline with first-class identity but missing operational-doctrine integration.** First-class identity exists (AgentRoster row, AgentKey enum, greeting endpoint with role-appropriate config); doctrine integration does not (no skill handler, no PlatformIngress route for emissions, no WorkTrace persistence, no learning loop, parallel approval system).

### Dimension-by-dimension verdict

| Dimension                                        | Alex state                                                                                              | Riley state                                                                                                                                                 | Verdict                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| AgentRoster row / `agentRole` / display identity | First-class (`lead-to-speed`)                                                                           | First-class (`ad-optimizer`)                                                                                                                                | ✅ Parity                                     |
| Skill / handler / SDK manifest                   | Fat skill at `packages/core/src/skills/alex-medspa/` + `SKILL.md`, `SkillHandler` produces `WorkUnit`   | None — lives in `packages/ad-optimizer/` as engine + cron                                                                                                   | ❌ Missing                                    |
| `PlatformIngress.submit()` flow                  | Skill `WorkUnit` enters ingress with entitlement + governance + routing                                 | Recs route via `recommendation-sink → emitRecommendation` directly to `Recommendation` table                                                                | ❌ Missing                                    |
| `WorkTrace` persistence                          | Canonical for every skill execution + approval decision                                                 | None — split across `Recommendation` + `AuditEntry`; activity translator reads `Recommendation` + `AuditEntry` for Riley while reading `WorkTrace` for Alex | ❌ Missing                                    |
| Approval lifecycle                               | `ApprovalLifecycle` rows; Mercury `PendingApproval` hook                                                | Parallel `Recommendation.status` (`pending → acted/dismissed/confirmed`); separate operator queue                                                           | ⚠ Parallel system                             |
| Audit event types                                | `action.executed`/`approved`/`rejected`/`denied` taxonomy with `workUnitId`, `envelopeId`, `approvalId` | Generic `action.*` with `recommendationId` snapshot; no Riley-specific event types                                                                          | ⚠ Partial                                     |
| Governance / safety gates                        | `deterministic-safety-gate.ts` integrated as `SkillHook`; claim classifier in Phase 1b-2                | `learning-phase-guard.ts` exists in `packages/ad-optimizer/` but standalone — not a `SkillHook`, not composable with future gates                           | ⚠ Partial                                     |
| Conversation surface                             | WhatsApp/Telegram via `ConversationThread`                                                              | None — operator IS the user, by design (advisory-only posture)                                                                                              | ⚠ Different model — **acceptable**, not a gap |
| Greeting / mission / `useAgentGreeting`          | Endpoint at `/api/dashboard/agents/alex/greeting` with `GreetingProjection`                             | Same endpoint, Riley config registered with role-appropriate (`busyThreshold: 4`, `countNoun: "ad sets"`)                                                   | ✅ Parity                                     |
| Agent-infra parity workstream (PR-3 / 3.1 / 3.2) | In scope — outcome-informed context injection, booking-backed attribution, learning-quality controls    | Out of scope; explicitly Alex-only in the current parity spec                                                                                               | ❌ Missing — this spec scopes the catch-up    |

**The four "❌ missing" rows are the structural gap.** This spec defines the acceptance criteria that close them.

The "⚠ different model" row — Riley not being conversational — is **acceptable, not a gap**. Operators are Riley's users; making Riley conversational with leads would be solving a problem Riley does not have. This spec does not propose adding a conversational surface.

---

## Acceptance criteria — "Riley agent-complete"

Riley is **agent-complete** when all of the following are satisfied. Order matters in some places (later items depend on earlier); the order below is dependency-respecting but does not prescribe PR boundaries.

### 1. WorkTrace mirror

- Every Riley recommendation emission creates a `WorkTrace` row in the same write path that creates the `Recommendation` row.
- The `WorkTrace` row carries canonical fields: `intent` (e.g., `recommendation.pause`), `agentKey: "riley"`, `decisionPayload` (the rec details), `originContext` (cron run identifier + audit window).
- The `Recommendation` row remains as a denormalized view-cache to keep the cockpit's existing read path stable during the transition. The Wave A adapter boundary makes this transparent to the cockpit UI.
- A canonical query like "every decision Riley made in the last 30 days" becomes a single `WorkTrace` query, joined to `Recommendation` only for view-model fields the canonical record does not yet have.

### 2. PlatformIngress route

- When an operator approves a Riley recommendation, the resulting executor call (e.g., `meta-ad.pause`, `meta-ad.scale`, `meta-creative.refresh`) flows through `PlatformIngress.submit()`.
- The `PlatformIngress` envelope carries the approval lifecycle as origin context, the recommendation's `WorkTrace` reference, and the operator's actor identity.
- Entitlement checks, governance gates, idempotency tokens, and retry semantics that apply to Alex's `calendar.book` action also apply to Riley's executor calls.
- The existing `actOnRecommendation` flow becomes the operator's UI-side entry; the resulting executor call routes through ingress.

### 3. ExecutableWorkUnit materialization

- Approved Riley decisions materialize as `ExecutableWorkUnit` rows with the same shape Alex bookings get.
- Each `ExecutableWorkUnit` carries its `recommendationId` foreign key (or successor canonical reference) so outcomes can attribute back to the originating recommendation.
- `ExecutionAttempt` records the executor's interaction with Meta (or future ad platforms), including success/failure, response metadata, and timing.
- Existing reversibility semantics (1-hour Undo on `pause`) become a property of the `ExecutableWorkUnit` lifecycle, not the `Recommendation` row.

### 4. Outcome attribution

- Each executed Riley action gets an outcome record attributing measurable changes back to the action over a defined observation window.
- **Outcome records may use CAPI-confirmed conversions where available, plus Meta-reported spend, CPA/CPL, ROAS, and conversion-rate deltas where CAPI is unavailable or incomplete.** This keeps the spec realistic for accounts without complete CAPI signal.
- Observation windows are action-appropriate: `pause` measured at 7-day spend-saved; `scale` measured at 7-day spend + leads delta vs counterfactual; `refresh_creative` measured at 14-day CTR + frequency recovery; `shift_budget_to_source` measured at 14-day source-level ROAS delta.
- Outcome records are queryable per recommendation, per agent, per org, per time window — i.e., the cockpit (or any future surface) can ask "did the pauses Riley recommended last week actually save money."
- **Causal-language gating.** Until outcome attribution ships, no UI surface (including the cockpit) is permitted to claim Riley-caused improvement. Wave A's B.2 acceptance criterion (§Honest impact-language guardrail) is the live enforcement of this gate; it relaxes only after Wave B outcome attribution is in place.

### 5. Learning memory

- Riley accumulates outcome patterns via the same `OUTCOME_PATTERNS` mechanism Alex uses (the substrate built by the Alex agent-infra parity PR-3 / 3.1 / 3.2 workstream).
- Pattern keys are canonical and decay-controlled per the PR-3.2 learning-quality design (cosine similarity threshold, two-stage merge, decay cron, pattern IDs in trace for falsifiability).
- Patterns capture e.g.: "pause at CPA 3× target survives 14 days 78% of the time for medspa vertical"; "scale 20% sustains positive ROAS 65% of the time when frequency is below 1.8"; "refresh_creative on `creative_fatigue` diagnosis improves CTR 12% on average."
- Future recommendations are confidence-weighted by these patterns — the recommendation engine reads `OUTCOME_PATTERNS` context the same way Alex's conversation handler does.
- The cockpit eventually surfaces pattern provenance ("Riley recommends pause; pattern history: this action survived in 78% of similar cases over the last 90 days"). That UI is post-acceptance — this spec only requires the substrate.

### 6. Governance hook unification

- `learning-phase-guard` is refactored to implement the `SkillHook` interface (same shape as Alex's `deterministic-safety-gate`).
- Hook composition becomes possible: future per-org guards (e.g., "max paused-spend per week," "no scale recommendations after Thursday in Q4," "block all recommendations during freeze windows") plug into the same hook chain.
- The hook chain runs at the same point in the decision lifecycle for Riley as for Alex: pre-emission for advisory recs, pre-execution for approved actions.
- Existing `LearningPhaseGuardV2` behavior is preserved — refactor is signature-only, not semantic.

### 7. Unified approval lifecycle

- `Recommendation.status` becomes a denormalized projection of the canonical `ApprovalLifecycle.status`.
- One write target: when an operator approves or declines a Riley rec, the write goes to `ApprovalLifecycle`; the `Recommendation` row's status field is updated as a denormalization.
- Queries like "show me everything Riley did this week with outcomes," "operator approval SLA across all agents," "approval volume by urgency band" become single-table joins instead of two-system unions.
- The Wave A cockpit's read path (via adapters) is unaffected by this transition by construction.

### 8. No new bulk-mutation paths until canonical

Reaffirms the Wave A B.1 constraint, now as a Wave B principle:

- Bulk operations on Riley decisions (e.g., "dismiss all signal-health breaches for this pixel," "approve all `scale` recs that meet criteria") must not introduce hidden fan-out mutations.
- Bulk affordances become available **only** once the unified approval lifecycle (item 7) provides a single-write canonical surface that can absorb the bulk action with the same governance, audit, and reversibility semantics as single-row actions.

---

## What this spec explicitly does NOT do

- **Define PR slicing or implementation order.** A future brainstorm produces Wave B PR slicing once we observe whether Wave A's signal is enough to prioritize all eight items together, or whether some are independently shippable.
- **Define rollout strategy.** Rollout depends on whether the cockpit has shipped, whether Riley has live ad spend across multiple orgs, whether outcomes are observable in production data.
- **Touch the cockpit UI.** By construction. Layer 5 (UI) and most of layer 4 (hooks) remain unchanged across Wave B. Layer 3 adapters change their source from `Recommendation` to `WorkTrace`-backed; layer 2 adds a new canonical-source hook.
- **Re-design the Riley recommendation engine.** The engine in `packages/ad-optimizer/src/recommendation-engine.ts` continues to produce `RecommendationOutput[]`. Its outputs become inputs to the canonical doctrine layer rather than direct writes to the `Recommendation` table.
- **Make Riley conversational.** Riley's advisory-only posture is acceptable, not a gap. The operator is Riley's user. No conversational surface is in scope.

---

## Preconditions before Wave B can sensibly start

1. **Wave A B.1 has shipped.** Riley cockpit is live; the adapter boundary is enforced; the substrate-replacement contract is verifiable.
2. **Alex agent-infra parity PR-3 / 3.1 / 3.2 substrate is live.** Wave B Riley work reuses the `OUTCOME_PATTERNS` mechanism, the conversation-lifecycle bus, and the pattern decay infrastructure built for Alex. Riley work depends on this substrate existing, not on Alex specifically being live.
3. **Meta `meta-campaign-insights-provider` daily data is reliable.** Outcome attribution (item 4) measures against post-execution metric deltas; the provider must populate consistently for outcome windows to be observable.
4. **Real Riley recommendation volume.** Wave B's learning memory (item 5) requires sample size. Pattern detection needs at least dozens of executed actions of each type across multiple orgs. If Riley is shipping recommendations rarely in production, the learning memory work is premature.

---

## Open questions (resolved in future brainstorm, not here)

- Does Wave B ship as one large workstream or as a phased sequence mirroring Alex's PR-3 / 3.1 / 3.2 split (correctness → attribution → learning quality)?
- Does the WorkTrace mirror (item 1) ship as a dual-write transition with `Recommendation` as the primary read source, or does cockpit's adapter immediately switch source to `WorkTrace`?
- Does outcome attribution (item 4) need a CAPI-quality preflight that gates which actions are eligible for outcome learning, or does the system absorb messy outcomes and decay-weight them?
- How does the unified approval lifecycle (item 7) handle the migration of historical `Recommendation` rows? Is there a backfill, or is the canonical-lifecycle cutover prospective-only?
- Do governance hooks (item 6) become per-agent or are they universal (composable across Alex + Riley + future agents)?

These are slicing-time questions — capture them now; resolve them in the Wave B implementation brainstorm.

---

## What Wave B does NOT change about Wave A

By construction of the adapter boundary in `apps/dashboard/src/lib/cockpit/riley/`:

- No cockpit UI component changes.
- No cockpit shell type changes (`ApprovalView`, `ActivityRow`, `CockpitStatus` already accommodate the future substrate).
- No cockpit hook signature changes (`useRileyApprovals`, `useRileyStatus`, `useAgentActivity` continue to return view-models).
- Adapter file count stays roughly the same; their internal source-of-truth swaps from `Recommendation` to canonical `WorkTrace`.

The cleanest signal that Wave B is doing its job: the cockpit's view continues to work without modification during the Wave B transition. If the cockpit needs a UI change to accommodate Wave B, the Wave A adapter boundary leaked and that leak must be fixed before the substrate swap proceeds.
