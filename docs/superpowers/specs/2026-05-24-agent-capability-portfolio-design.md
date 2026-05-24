# Agent-Capability Portfolio — Revenue-Driving AI Improvements

**Date:** 2026-05-24
**Branch:** `docs/agent-capability-portfolio`
**Author:** Claude Opus 4.7 (1M context), at user request
**Status:** Portfolio spec (a ranked list of spec-worthy workstreams). Each item below gets its own brainstorm → spec → plan cycle. This document does **not** itself authorize implementation.

**Scope:** Improvements that make the AI agents (Alex, Riley) measurably *better at driving revenue* — not dashboard/attribution plumbing, not infra hygiene. Those remain valid but live in a separate track (see §6).

---

## 1. Provenance

This portfolio is the grounded output of a multi-step analysis:

1. Three Anthropic workshop talks (Routines/proactive agents; agent decomposition / thin-harness-fat-skills; memory + "dreaming") were digested for transferable ideas.
2. A concept catalog was compiled from four parallel research sweeps — see `docs/research/2026-05-24-agent-patterns-catalog.md`.
3. The catalog was filtered against a grounded `file:line` audit of `packages/core` (agent loop, governance, WorkTrace, memory, evals, tools, prompt caching, PII).
4. The lens was then narrowed to **revenue driving**, and a second grounded pass traced the actual revenue mechanics (lead-in → agent → booking → attribution) plus four AI-capability audits (Alex SDR competence; learning loop + memory; re-engagement + Riley intelligence; bilingual).

Two assumptions were **corrected by grounding** and dropped from the list (see §6): speed-to-lead is already instant; cross-session contact continuity already exists.

This portfolio supersedes nothing in the prior **2026-05-16 AI-infra improvement audit**; it is the *agent-capability layer* on top of it. Where they overlap (bilingual), this doc extends that audit's Rec 4 from the classifier to the agent's conversation.

---

## 2. Operating principle

> The machinery to *drive* revenue is largely built. What's missing is the agent intelligence that converts better, the loop that compounds it, and the proactive reach that recovers lost revenue.

So every item below is judged by: **does it make Alex or Riley measurably better at producing bookings / ad ROI?** Display, attribution surfacing, caching, and cost ceilings are explicitly *out of scope here* — they are enablers, not agent-capability.

---

## 3. Alignment with wider direction (binding constraints)

This portfolio must comply with the following. Each item in §5 carries the specific guardrails it triggers.

**3.1 Doctrine invariants (`docs/DOCTRINE.md`).**
- **One control plane (Inv. 1):** any new agent action — especially proactive re-engagement (#3) — enters via `PlatformIngress.submit()`. No direct `proactive-sender` / orchestrator / notifier calls. (The audit confirmed `proactive-sender.ts` is a known bypass; #3 must *use the gated path*, not perpetuate the bypass.)
- **One persistence truth (Inv. 3):** all capability work records through `WorkTrace`. #2's learning loop reads `WorkTrace.injectedPatternIds` / `DeploymentMemoryEvidence` — no parallel store.
- **Governance runs once (Inv. 4)** and **idempotency at ingress (Inv. 6):** re-engagement sends (#3) and the new follow-up tool (#1) get ingress idempotency keys to prevent double-sends; tools never re-run governance.
- **Tools are strict, auditable, idempotent (Inv. 9):** #1's follow-up-scheduling tool is a product surface with a declared schema and WorkTrace audit — not a utility.
- **"Agent" is a product/UX metaphor only:** capability lives in **skill markdown + tool declarations + model-router + deployment config** — not new `Agent*` types in `packages/core`.

**3.2 Governance deprioritization sprint (in flight).**
Operator-facing governance UX is being stripped for SMB; Alex/Riley now **auto-allow** via `trustLevelOverride`, and enforcement/legal plumbing is kept. Implication: with **less operator oversight**, agent **competence (#1)**, **measured learning (#2)**, and the **enforcement layer (consent gate, claim classifier — #3/#5)** *are* the safety net. This portfolio adds **no operator-facing governance UX**.

**3.3 Customer UX overhaul (brainstorm in flight — `project_customer_ux_overhaul_blueprint.md`).**
- Per-agent cockpits (`/alex`, `/riley`) are being **deleted** as destinations. Capability value must surface through the unified **Home · Inbox · Team** IA, never a cockpit. Examples: #2 lift → "Today's Score" / Results; #3 re-engagement → a "Work in Progress" card ("Alex is following up with 8 consultation leads"); #1 better objection handling is invisible infra that improves Inbox conversations.
- **HARD vocab rule:** every customer-visible label names an **outcome, not a concept**. Internal names (playbooks, model routing, learning loop, ROAS) stay backend; surfaced metrics use outcome language.
- **Modes, not knobs:** #3 cadence and #1 assertiveness ship as **modes** (Conservative/Balanced/Aggressive), never exposed tuning knobs.
- **Safety dependency:** the overhaul audit found **Halt/Pause is localStorage-only and never calls the server** — "pause" is currently an illusion; agents keep running. **#3 (proactive outbound) is BLOCKED on a real server-backed halt** (UX-overhaul Foundation phase). Do not ship agent-initiated outbound while halt is a no-op.

**3.4 Claim-classifier eval bake (in flight, review ≥ 2026-06-06).**
Do **not** change classifier input shape or prompt mid-bake. #5 (bilingual classifier) and the confidence half of #4 sequence **after** the bake closes. The eval harness that shipped is the regression gate that makes those changes safe.

**3.5 Vertical lock.** Medspa / aesthetic clinics (SG/MY). All playbooks, objections, and language work target this vertical.

---

## 4. Grounded current state (audit verdicts)

| Area | Verdict | Key evidence |
|---|---|---|
| Alex SDR competence | **Thin playbook** — objection & qualification slots render **empty** (`{{PLAYBOOK_CONTEXT}}`, `{{QUALIFICATION_CONTEXT}}` → ""); objections improvised on **Haiku** | `skills/alex/SKILL.md:172`, `context-resolver.ts:196`, `model-router.ts:95`, `types.ts:305` |
| Learning loop | **Open** — patterns inject, but no service computes per-pattern conversion lift (schema + comment stage it, unimplemented) | `outcome-pattern-extractor.ts`, `work-trace-hash.ts:17`, `DeploymentMemoryEvidence` |
| Cross-session memory | **Already present** (contact continuity) — `ConversationThread.getByContact` + injected summaries; only unused `AgentStateStore` missing | `thread-store.ts:14`, `context-builder.ts:152` |
| Proactive re-engagement | **Detect-only** — `lifecycle-stalled-sweep` labels "stalled" but nothing acts; no follow-up/nurture | `lifecycle-stalled-sweep.ts`, `stalled-sweep.ts` |
| Riley intelligence | **Rules + point-deltas** — CPA-only, **ROAS collected but unused**, no statistical confidence | `recommendation-engine.ts:184`, `period-comparator.ts:21`, `audit-runner.ts:128` |
| Bilingual | Agent **~5%** (language detected, never propagated → replies English); classifier **0%** (English-only; zh/ms claims slip governance) | `naturalness-assembler.ts`, `classifier/prompt.ts:16`, `banned-phrases/{sg,my}.ts` |

**Cross-cutting enabler (E0): an Alex conversation eval harness.** Today only the *classifier* has evals; Alex's conversation does not. #1 cannot be hill-climbed safely and #2's lift cannot be trusted without a small offline conversation eval set (objection/qualification/close trajectories). E0 underpins #1 and #2 and should be scoped alongside #1's first slice.

---

## 5. The portfolio (ranked by grounded revenue leverage)

### #1 — Give Alex a real selling brain *(Talk 2: fat skills + eval hill-climbing)*
**Capability gap.** Objection handling is 100% model-improvised on Haiku because the playbook slots are literally empty; high-stakes turns never escalate; consultative depth is truncated (`maxLlmTurns:6`, 30s); "let me think about it" forces a human handoff (no follow-up tool).
**Revenue mechanism.** Lifts conversion on **every** lead immediately — no data-accumulation wait. Highest base-rate lever.
**Scope sketch.** (a) Author objection-handling + qualification-framework reference files (medspa price/safety/results). (b) Stage-aware model routing (objection/close → Sonnet/Opus). (c) Loosen consultative limits within budget. (d) Add a strict/idempotent follow-up-scheduling tool (Inv. 9, via ingress). (e) E0 conversation eval set to hill-climb against.
**Guardrails.** Capability = skill files + tool + router, not core `Agent*` types. Follow-up tool routes through ingress + consent gate. Assertiveness as a mode, not knobs.
**Dependencies.** E0 (built in-slice).

### #2 — Close the conversion-learning loop *(Talk 3: memory + dreaming)*
**Capability gap.** Patterns inject into Alex and `injectedPatternIds` persist, but **no service measures per-pattern conversion lift** — the loop is open; `work-trace-hash.ts:17` explicitly stages the data for "conversion-lift queries" that don't exist.
**Revenue mechanism.** The compounder + the provable retention story ("your team learned your playbook and lifted bookings X%"). Also the production signal that proves #1 worked.
**Scope sketch.** Lift-measurement service (`unnest(injectedPatternIds)` JOIN `ConversionRecord`/`Booking`) → reinforce high-lift patterns → consolidate via a gated background "dreaming" pass (sleeper/serve split; advisory→trusted only past an evidence threshold + classifier review).
**Guardrails.** Memory is **advisory/governed**, written through audited paths (CoALA trust tiers; see research doc). Consolidation runs in background jobs, never in the live serve path. Surfaced metric uses outcome vocab.
**Dependencies.** Benefits from #1 (better patterns to learn) but independent; depends on conversion records being populated.

### #3 — Proactive re-engagement of dormant leads *(Talk 1: routines / proactive triggers)*
**Capability gap.** Dormancy is **detected** (`lifecycle-stalled-sweep` → "stalled") but **nothing acts**; no multi-touch follow-up exists. Pairs with #1's missing follow-up tool.
**Revenue mechanism.** Recovers bookings otherwise silently lost — the classic SDR follow-up lever.
**Scope sketch.** Wire stalled-detection → agent-composed re-engagement message, dispatched through `PlatformIngress.submit()` + `runConsentEnforcementGate`, with ingress idempotency. Cadence as a mode.
**Guardrails (critical).** Must enter via ingress (not `proactive-sender` bypass). Must pass the consent gate (PDPA) — ties to the prior audit's open consent-bypass closure (its Rec 3). **BLOCKED on a real server-backed halt** (UX-overhaul fake-pause fix) — agent-initiated outbound cannot ship while "pause" is a localStorage no-op. Re-engagement surfaces as a "Work in Progress" card.
**Dependencies.** Server-backed halt; consent-bypass closure; #1's follow-up tool.

### #4 — Riley: ROAS-aware, confidence-gated recommendations
**Capability gap.** Riley **collects ROAS but never uses it** — every pause/scale is CPA-only and fires on raw point-deltas with **no statistical confidence**.
**Revenue mechanism.** Revenue-aware ad decisions = better client ROI = retention/upsell. Confidence-gating removes noisy recommendations that erode trust.
**Scope sketch.** Add ROAS to the decision logic (revenue-aware pause/scale); gate recommendations on minimum sample / confidence. Keep the backend surface-agnostic.
**Guardrails.** ROAS-awareness ships independently and now. Statistical-confidence work waits on the Riley bake gate (≥2 weeks + ≥100 emissions, per existing memory) and must not pre-empt signal-floor calibration.
**Dependencies.** ROAS half: none. Confidence half: Riley bake.

### #5 — Bilingual capability (agent + classifier)
**Capability gap.** Language is detected (`localMarker`) but never propagated — Alex always replies in English; the classifier is English-only, so a Mandarin/Bahasa medical claim **slips governance entirely** (a compliance hole *and* lost in-language conversion).
**Revenue mechanism.** Sell in-language to SG/MY clinics (expanded addressable conversations) **and** close the zh/ms governance hole (market access in a regulated vertical).
**Scope sketch.** Propagate detected language into Alex's generation; extend the classifier (prompt + banned phrases + rewrite templates) to zh/ms; expand the eval golden set per language.
**Guardrails.** **Post-bake only** (≥ 2026-06-06) — do not change the classifier mid-bake. Extends the 2026-05-16 audit's Rec 4. Use the shipped eval harness as the regression gate.
**Dependencies.** Classifier eval bake closed.

---

## 6. Sequencing, drop-offs, and parallel track

**Lead pair:** **#1 + #2** — #1 raises the conversion floor now; #2 compounds it and proves it. E0 (conversation eval) is built inside #1.
**Then:** **#3** (reuses #1's follow-up tool; gated on server-backed halt + consent closure).
**Parallel independent tracks:** **#4 ROAS** (now) and **#5 + #4-confidence** (after their respective bakes).

```
E0 (Alex eval) ─┐
                ├─> #1 selling brain ──> #2 learning loop ──> #3 re-engagement
                                                              (needs: real halt,
                                                               consent closure,
                                                               #1 follow-up tool)
#4a ROAS (now) ─────────────────────────────────────────────  (independent)
#4b confidence / #5 bilingual ────── after bakes (≥2026-06-06) (independent)
```

**Dropped after grounding (do NOT spec here):** speed-to-lead (already instant/event-triggered), cross-session contact memory (already wired via `ConversationThread`).

**Parallel track — enablers / hygiene, not agent-capability (tracked in the 2026-05-16 AI-infra audit, still valid):** reports-live + trustworthy attribution (renewal surface), agent-runtime prompt caching (margin), per-tenant cost ceiling (margin), consent-bypass closure (compliance — note this is a *hard dependency* for #3). These are real and should proceed, but on the product/infra track, not this one.

---

## 7. Next step

Per the brainstorming workflow, each item becomes its own brainstorm → spec → plan. Recommended first: **#1 (Alex's selling brain), with E0 in the same effort** — highest base-rate revenue lever, no upstream dependency, and it produces the eval substrate #2 needs.
