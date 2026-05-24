# Agent-Capability Portfolio — Revenue-Driving AI Improvements

**Date:** 2026-05-24
**Branch:** `docs/agent-capability-portfolio`
**Author:** Claude Opus 4.7 (1M context), at user request
**Status:** Portfolio spec (a ranked set of tracks/slices). Approved as **direction**, not yet as an implementation plan. Each slice gets its own brainstorm → spec → plan cycle. This document does **not** authorize implementation.
**Revised:** 2026-05-24 after review — split the over-broad lead item into discrete slices, added a concrete medspa selling corpus, reframed the learning loop as measurement-first, promoted Riley ROAS to an immediate parallel track, split bilingual into reply-propagation vs classifier expansion, and added a hard-gates callout. **Rev-2 (2026-05-24, second review):** B1 made explicitly read-only-first with sample-thresholded labels; D1 language softened to "revenue-aware recommendations"; A0 must test sales judgment (messy turns); A1 must encode medical/safety language boundaries; C3 must be reason-based.

**Scope:** Improvements that make the AI agents (Alex, Riley) measurably *better at driving revenue* — not dashboard/attribution plumbing, not infra hygiene. Those remain valid but live in a separate track (see §7).

---

## 1. Provenance

This portfolio is the grounded output of a multi-step analysis:

1. Three Anthropic workshop talks (Routines/proactive agents; agent decomposition / thin-harness-fat-skills; memory + "dreaming") were digested for transferable ideas.
2. A concept catalog was compiled from four parallel research sweeps — see `docs/research/2026-05-24-agent-patterns-catalog.md`.
3. The catalog was filtered against a grounded `file:line` audit of `packages/core` (agent loop, governance, WorkTrace, memory, evals, tools, prompt caching, PII).
4. The lens was then narrowed to **revenue driving**, and a second grounded pass traced the actual revenue mechanics (lead-in → agent → booking → attribution) plus four AI-capability audits (Alex SDR competence; learning loop + memory; re-engagement + Riley intelligence; bilingual).

Two assumptions were **corrected by grounding** and dropped (see §7): speed-to-lead is already instant; cross-session contact continuity already exists.

This portfolio supersedes nothing in the prior **2026-05-16 AI-infra improvement audit**; it is the *agent-capability layer* on top of it. Where they overlap (bilingual), this doc extends that audit's Rec 4 from the classifier to the agent's conversation.

---

## 2. Operating principle

> The machinery to *drive* revenue is largely built. What's missing is the agent intelligence that converts better, the loop that compounds it, and the proactive reach that recovers lost revenue.

Every slice is judged by: **does it make Alex or Riley measurably better at producing bookings / ad ROI?** Display, attribution surfacing, caching, and cost ceilings are explicitly *out of scope here* — enablers, not agent-capability.

**Anti-sprawl rule (added in review):** no slice bundles new tool authority + model routing + proactive flow + governance plumbing at once. One capability change per slice; tool-authority surfaces are separated from live-selling competence.

---

## 3. Alignment with wider direction (binding constraints)

**3.1 Doctrine invariants (`docs/DOCTRINE.md`).**
- **One control plane (Inv. 1):** any new agent action — especially proactive re-engagement (Track C) — enters via `PlatformIngress.submit()`. No direct `proactive-sender` / orchestrator / notifier calls. (The audit confirmed `proactive-sender.ts` is a known bypass; Track C must *use the gated path*.)
- **One persistence truth (Inv. 3):** all capability work records through `WorkTrace`. Track B reads `WorkTrace.injectedPatternIds` / `DeploymentMemoryEvidence` — no parallel store.
- **Governance runs once (Inv. 4)** + **idempotency at ingress (Inv. 6):** re-engagement sends (C3) and the follow-up tool (A3) get ingress idempotency keys to prevent double-sends; tools never re-run governance.
- **Tools are strict, auditable, idempotent (Inv. 9):** A3's follow-up tool is a product surface with a declared schema and WorkTrace audit — not a utility.
- **"Agent" is a product/UX metaphor only:** capability lives in **skill markdown + tool declarations + model-router + deployment config** — not new `Agent*` types in `packages/core`.

**3.2 Governance deprioritization sprint (in flight).** Alex/Riley now **auto-allow** via `trustLevelOverride`, with enforcement/legal plumbing kept. With **less operator oversight**, agent **competence (A)**, **measured learning (B)**, and the **enforcement layer (consent gate, claim classifier)** *are* the safety net. This portfolio adds **no operator-facing governance UX**.

**3.3 Customer UX overhaul (brainstorm in flight).** Per-agent cockpits are being **deleted**; value surfaces through the unified **Home · Inbox · Team** IA. **HARD vocab rule:** customer-visible labels name an **outcome, not a concept** (internal names — playbooks, routing, learning loop, ROAS — stay backend). **Modes, not knobs:** C3 cadence and A-track assertiveness ship as modes (Conservative/Balanced/Aggressive). **Safety dependency:** Halt/Pause is currently localStorage-only and never calls the server — see Track C hard gate.

**3.4 Claim-classifier eval bake (in flight, review ≥ 2026-06-06).** Do **not** change classifier input/prompt mid-bake. E2 (classifier zh/ms) and D2 (Riley confidence) sequence **after** the bake closes; the shipped eval harness is their regression gate.

**3.5 Vertical lock.** Medspa / aesthetic clinics (SG/MY).

---

## 4. Grounded current state (audit verdicts)

| Area | Verdict | Key evidence |
|---|---|---|
| Alex SDR competence | **Thin playbook** — objection & qualification slots render **empty**; objections improvised on **Haiku** | `skills/alex/SKILL.md:172`, `context-resolver.ts:196`, `model-router.ts:95`, `types.ts:305` |
| Learning loop | **Open** — patterns inject, but no service computes per-pattern conversion lift | `outcome-pattern-extractor.ts`, `work-trace-hash.ts:17`, `DeploymentMemoryEvidence` |
| Cross-session memory | **Already present** (contact continuity); only unused `AgentStateStore` missing | `thread-store.ts:14`, `context-builder.ts:152` |
| Proactive re-engagement | **Detect-only** — `lifecycle-stalled-sweep` labels "stalled" but nothing acts | `lifecycle-stalled-sweep.ts`, `stalled-sweep.ts` |
| Riley intelligence | **Rules + point-deltas** — CPA-only, **ROAS collected but unused**, no statistical confidence | `recommendation-engine.ts:184`, `period-comparator.ts:21`, `audit-runner.ts:128` |
| Bilingual | Agent **~5%** (detected, never propagated → replies English); classifier **0%** (English-only) | `naturalness-assembler.ts`, `classifier/prompt.ts:16`, `banned-phrases/{sg,my}.ts` |

---

## 5. Tracks & slices

Each slice is its own future brainstorm → spec → plan. Lettered tracks run in parallel where dependencies allow (see §6).

### Track A — Alex revenue engine *(Talk 2: fat skills + eval hill-climbing)* — **LEAD**

**A0 — Conversation eval harness.** Small offline medspa conversation set (the regression gate for every Alex change). Trajectories: price objection, safety/downtime concern, results skepticism, hesitation, qualification, close. The set must test **sales judgment, not polite answers** — include messy turns: asks for a discount then goes quiet; asks an unsafe medical-claim question; mixes English + Mandarin; vague goal ("just want to look fresher"); asks price before sharing a concern; resists booking ("send me info first"). *Today only the classifier has evals; Alex's conversation has none — A0 is the prerequisite that makes A1 and Track B safe and trustworthy.*

**A1 — Alex Sales Skill Pack.** Author the reference files that today render empty (`{{PLAYBOOK_CONTEXT}}`, `{{QUALIFICATION_CONTEXT}}`) and hill-climb against A0. **No new tools, no routing changes in this slice.** Minimum corpus:

| Skill area | Must cover |
|---|---|
| Price objection | "too expensive", "can I get a discount", "I'll compare first" |
| Safety concern | side effects, downtime, risk, suitability |
| Results skepticism | "will it work for me", "how long before results" |
| Urgency / hesitation | "let me think", "maybe later", "I'm not ready" |
| Qualification | treatment goal, timeline, prior experience, budget comfort |
| Close | consult booking, soft next step, no pressure |

**Hard language boundaries (A1 must encode):** explain generally and recommend a consultation; **never** diagnose, guarantee outcomes, assert "safe for you," or promise before/after certainty. Objection handling sits adjacent to regulated medical territory — these boundaries are part of the skill pack, not an afterthought, and are exactly what the claim classifier enforces.

→ **PR-1 = A0 + A1 together** (the skill pack must be hill-climbed against the harness). Highest base-rate revenue lever; no upstream dependency.

**A2 — Stage-aware model routing.** Escalate objection / close / safety-sensitive turns to a stronger model (today they run on Haiku; `model-router.ts:95` escalates only on the *previous* turn's tool/escalation). Tune consultative limits (`maxLlmTurns:6`, 30s) within budget. *Separate slice.*

**A3 — Follow-up scheduling tool.** A strict, idempotent, consent-aware, ingress-routed tool so a hesitant lead ("let me think") gets a governed follow-up instead of a forced human handoff. *A distinct tool-authority surface — kept separate from live-selling competence (A1).*

### Track B — Learning loop *(Talk 3: memory + dreaming)*

**B1 — Pattern lift measurement (MVP, read-only).** Read `injectedPatternIds` → JOIN `Booking`/`ConversionRecord` → conversion rate by pattern. **Read-only at first: computes pattern-level conversion association and emits internal diagnostics only — it does NOT alter memory injection, suppress patterns, or surface lift claims** until minimum-sample thresholds and attribution quality are verified. Label rules (only past minimum sample): below threshold → *insufficient signal*; enough sample, no clear difference → *neutral*; directionally/statistically positive → *promising*; directionally negative with enough sample → *harmful*. **No automatic memory rewrite.** Closes the measurement half the audit found missing (`work-trace-hash.ts:17`). Build now so signal accumulates.

**B2 — Pattern reinforcement.** Promote high-lift patterns past a sample threshold; suppress "harmful" ones from injection. *Pilot-scale caveat: per-pattern signal is thin at <10 clinics — won't fire meaningfully for weeks.*

**B3 — Background consolidation ("dreaming").** Only after B1/B2 *and* after B1's read-only diagnostics have proven attribution quality. Gated sleeper job (serve/sleeper split); advisory → trusted only past an evidence threshold + claim-classifier review. Memory stays advisory/governed (CoALA tiers; see research doc).

### Track C — Recovery (proactive re-engagement) *(Talk 1: routines)*

**C1 — Server-backed Halt.** **Hard prerequisite.** Today Halt is localStorage-only and never calls the server — "pause" is an illusion. No agent-initiated outbound may ship while this is a no-op. (Owned by the UX-overhaul Foundation phase.)

**C2 — Consent-bypass closure.** **Hard prerequisite.** Close the known non-gateway egress paths (`proactive-sender`, CTWA greeting, QA send) so proactive outbound can't reach a revoked contact. (= prior audit's Rec 3.)

**C3 — Dormant-lead re-engagement.** Wire `lifecycle-stalled-sweep` detection → agent-composed re-engagement, dispatched via `PlatformIngress.submit()` + `runConsentEnforcementGate` + ingress idempotency. Cadence as a mode. Surfaces as a "Work in Progress" card. Re-engagement must be **reason-based, not generic** — keyed to *why* the lead stalled (price hesitation, safety hesitation, timing, no-show / incomplete booking, asked-for-info, cold-after-quote) — or it becomes spam. **Gated on C1 + C2 + A3.**

### Track D — Riley

**D1 — Revenue-aware recommendations.** **Now, parallel, independent.** Riley collects ROAS but decides CPA-only (`audit-runner.ts:128`); make recommendations *revenue-aware* (not just CPA). Conservative thresholds until volume builds — keep the language "revenue-aware recommendations," **not** "revenue-optimized decisions" (avoid implying statistical certainty the data doesn't yet support). Customer story: "Riley now weighs revenue, not just cost."

**D2 — Confidence-gated recommendations.** After the Riley bake / signal-floor calibration. Minimum sample / confidence so noisy point-delta recommendations don't erode trust.

### Track E — Bilingual

**E1 — Reply-language propagation.** Propagate detected language so Alex replies in zh/ms (today `naturalness-assembler` ignores `localMarker`). Build independently of the classifier bake — **but its production enablement is GATED on E2** (see hard gate below).

**E2 — Classifier zh/ms expansion.** Post classifier-bake only (≥ 2026-06-06): classifier prompt + banned phrases + rewrite templates for zh/ms. Extends the 2026-05-16 audit's Rec 4.

**E3 — Multilingual eval set.** zh, ms, Singlish/English-mix golden examples; the regression gate for E1+E2.

---

## 6. Hard gates (do not violate) & sequencing

**Hard gates:**
- **C3 ⟸ C1 + C2** — no proactive outbound until Halt is server-backed and consent bypasses are closed.
- **E1-in-production ⟸ E2** — do not enable zh/ms *replies* in prod before zh/ms *governance* exists, or the agent speaks a language the classifier can't check (reopens the exact hole #5 closes). Build E1 dark; flip on with E2.
- **E2, D2 ⟸ classifier/Riley bakes** (≥ 2026-06-06 for classifier).
- **All proactive sends & tools ⟸ ingress + consent gate + idempotency** (Inv. 1/6/9).
- **Memory writes are advisory/governed** — never a silent trusted source (Track B).

**Sequencing:**
```
Track A (lead):  A0+A1 (PR-1) ──> A2 routing ──> A3 follow-up tool
Track B:         B1 measure (start now) ──> B2 reinforce ──> B3 consolidate
Track C:         C1 halt ─┐
                 C2 consent ─┴─(+A3)─> C3 re-engagement
Track D:         D1 ROAS (now, parallel) ······ D2 confidence (post-bake)
Track E:         E1 reply-propagation (build now, ship dark) ──[E2]──> E1 live
                 E2 classifier zh/ms (post-bake) ; E3 multilingual eval
```
**Immediate parallel starts:** PR-1 (A0+A1), B1 (measurement), D1 (Riley ROAS). Everything else is gated as above.

---

## 7. Drop-offs & parallel track

**Dropped after grounding (do NOT spec here):** speed-to-lead (already instant), cross-session contact memory (already wired via `ConversationThread`).

**Parallel track — enablers / hygiene, not agent-capability (tracked in the 2026-05-16 AI-infra audit):** reports-live + trustworthy attribution (renewal surface), agent-runtime prompt caching (margin), per-tenant cost ceiling (margin), consent-bypass closure (= C2, a hard dependency for Track C). Real and worth doing — on the product/infra track, not this one.

---

## 8. Next step

Per the brainstorming workflow, each slice becomes its own brainstorm → spec → plan. **Recommended first: PR-1 = A0 (conversation eval harness) + A1 (Alex Sales Skill Pack).** No new tool authority, no routing, no proactive flow, no learning-loop complexity — the fastest path to better bookings, and it produces the eval substrate Track B needs.

**PR-1 spec must cover:** eval-harness shape (reuse the `evals/claim-classifier/` pattern); the medspa conversation golden set (corpus above + the messy turns); skill reference-file structure + how `{{PLAYBOOK_CONTEXT}}` / `{{QUALIFICATION_CONTEXT}}` resolve and get populated; required objection categories; medical/safety language boundaries; pass/fail rubric (deterministic + LLM-judge); a regression test proving the previously-empty slots are now populated; and an explicit **no routing / no tool / no proactive** scope fence.
