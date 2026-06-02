# D6 — Cross-agent Collaboration & Propagation (Riley→Mira→Alex)

> Raw domain audit. `file:line` against `main`. Synthesis: [`../FINDINGS.md`](../FINDINGS.md).

## 1. CURRENT STATE (verified)

**The delegation primitive (the only agent→agent seam).**
- **`delegate` tool** — `skill-runtime/tools/delegate.ts:40-118`. `createDelegateToolFactory(deps)` exposes one operation per allowlisted target (`:46-47`), `effectCategory:"propose"` (`:49`). On execute: depth guard (`:53-59`), requires `ctx.workUnitId` (`:60-69`), builds child params with `__delegationDepth` (`:70-73`), deterministic idempotency key (`:74`), `submitter.submitChildWork(...)` with `actor.type:"agent"` + `parentWorkUnitId` (`:75-82`).
- **Port** — `skill-runtime/delegation-port.ts` (`DelegationTarget`: operation/intent/description/inputSchema/mapInput). Layer-clean.
- **Wiring** — `bootstrap/skill-mode.ts:267-271,322,338` construct/register the factory; `ChildWorkSubmitter` in `delegation-submitter.ts:48` over `submitChildWork` (the PlatformIngress.submit closure).

**The ONE target (Alex→Mira, draft-only).** `bootstrap/delegation-targets.ts:7-45` — `CREATIVE_CONCEPT_TARGET`: `operation:"creative_concept"`, `intent:"creative.concept.draft"`. `inputSchema` requires only `productDescription`+`targetAudience` (`:16-29`); `DELEGATION_TARGETS` = a one-element allowlist. Handler `creative-concept-draft-workflow.ts:52-148` gates on Mira `OrgAgentEnablement`, creates `AgentTask`+`CreativeJob`, and **never fires the pipeline** (`:140`).

**Riley's outputs today (the SOURCE, all human-facing).** Autonomous audit → `diagnose()` (`audit-runner.ts:362`) → `generateRecommendations()` (`:400`) → `runRecommendationSink()` (`:531`). `metric-diagnostician.ts` emits the exact cross-agent triggers: `creative_fatigue` (`:37`), `audience_saturation` (`:90`), and three junk-lead patterns — `lead_quality_issue` (`:78`), `lead_quality_degradation` (`:115`), `ctwa_drive_by_clickers` (`:128`). `recommendation-engine.ts:231-262` turns fatigue/saturation into a `refresh_creative` rec whose rationale literally reads **"Trigger PCD for fresh creative", "Replace fatigued creatives"** (`:240,:258`). `recommendation-sink.ts:126-127,210,240` classifies these as informational operator cards — **operator cards on /riley, not a route to Mira.** The richer modules (`saturation-detector`, `creative-analyzer`, `trend-engine.projectBreach`) are **not called by `audit-runner`** (only `compareSources` is imported, `:37`).

**Mira's read-model target (`desk-model.ts`).** `buildMiraDeskModel` (`:88-117`) buckets jobs into `inProduction`/`readyToReviewCount`/`keptDrafts` — a Riley draft lands in `inProduction` automatically. **`desk-model.ts:8-16` is the load-bearing evidence of the planned-but-unbuilt loop:** states `sent_to_riley`, `in_use`, `learning`, `winner`, `fatigued` are *"intentionally NOT members — they must be unrepresentable in Phase 2."* `CreativeJob.pastPerformance` is a free `Record<string,unknown>` slot threaded end-to-end (`creative-job.ts:191`, store `:69`) — **the natural slot for Riley's decaying-metric evidence — populated by no caller today.**

## 2. GAPS / WEAKNESSES
1. **No Riley→anything handoff exists.** `packages/ad-optimizer/src/**` has zero `delegate`/`handoff`/`submitChildWork`/`Mira`/`creative.concept` references. Riley isn't an LLM/skill agent — it's a deterministic cron pipeline, so no `SkillExecutor` loop, no `ctx.workUnitId`, no tool surface. **The `delegate` tool is unreachable from Riley** without a non-tool entry point.
2. **The single delegation target is hardcoded to Alex's use-case** (only `productDescription`/`targetAudience`). A Riley brief needs campaign id + fatigue evidence — a *new target*.
3. **Riley's clearest cross-agent signal is computed then thrown to a human** (`refresh_creative`, engine `:231-262`).
4. **The two purest junk-lead diagnoses produce no output at all.** `lead_quality_issue`/`lead_quality_degradation` are detected (`metric-diagnostician.ts:78,115`) but the engine has **no branch** and the 14-value `AdRecommendationActionSchema` has no `tighten_targeting`/`flag_lead_quality`. Detected and dropped.
5. **No reverse Mira→Riley edge, by design** (`desk-model.ts:8-16`).
6. **Riley Phase-1 explicitly defers this** (§2 non-goal "Mira handoff"). Net-new, not on the critical path — but the moat-audit's named OPEN gap.
7. **Synchronous-child constraint vs Riley's batch cadence** — a fatigue handoff per campaign must be fire-and-record, aligning with the draft-only (no-pipeline) target design.

## 3. RANKED RECOMMENDATIONS (flywheel-propagation impact ÷ effort)

**R1 — Riley→Mira "brief a fresh creative" on detected fatigue (THE link).** Add a second `DelegationTarget` (`creative_refresh`) + a **non-tool submit path** routing Riley's audit through the same `ChildWorkSubmitter`/`submitChildWork` closure the delegate tool uses (reuse the port + governed front door, skip the tool). Carry fatigue evidence in `pastPerformance`: `{campaignId, decay, ctrTrend, frequency, weeksSaturated, sourceDiagnosis:"creative_fatigue", rileyAuditRunId}`. Reused: `delegation-submitter.ts` + `submitChildWork` + `creative.concept.draft` handler + `CreativeJob.pastPerformance` + Mira enablement gate + `buildMiraDeskModel`. New: a Riley-side emitter in `audit-runner.ts:400-531` (injected callback, layer-clean like `recommendationEmitter`), the new target, idempotency from `(auditRunId, campaignId)`. Effort M, risk MED (layering; idempotency to avoid spamming Mira's desk). **First true Riley→Mira link; closes the moat-audit gap.** *TAG: net-new (PROPAGATION leg).*

**R2 — Emit `pastPerformance` from the audit even before full handoff (de-risks R1).** Assemble the fatigue-evidence object wherever `refresh_creative` is produced; attach to rec `params`. Also improves the human card (operator sees *why*). Could finally call `projectBreach`/`detectSaturation` here. `recommendation-engine.ts:231-262`; `saturation-detector.ts:34-62`. Effort S, risk LOW. *TAG: net-new (prerequisite slice of R1).*

**R3 — Riley→Alex junk-lead signal: stop dropping `lead_quality_*`.** Min: engine branches for `lead_quality_issue`/`lead_quality_degradation` emitting an operator rec. Flywheel: a Riley→Alex signal to tighten qualification. No consuming seam exists on Alex's side; needs an action enum value + 3 exhaustive-switch branches in `recommendation-sink.ts:110-289`. `recommendation-engine.ts` (insert near `:304`); `schemas/ad-optimizer.ts:16-31`. Effort M (card) / L (true propagation), risk MED (partial add breaks the build — no fallback branch). *TAG: net-new + needs-design.*

**R4 — Make the desk-model representable for the reverse edge (Mira→Riley).** Admit `sent_to_riley`/`in_use`/`fatigued` to `MiraDeskItemState` when justified (`desk-model.ts:8-16`). Effort M, risk MED. Deps R1. *TAG: net-new / needs-design / defer.*

**R5 — Add a Riley-origin goal to the brief schema (polish for R1).** Extend `MiraBriefGoal` (`mira-brief.ts:9`) with `refresh_fatigued`. Effort S. Deps R1. *TAG: net-new / cosmetic.*

**Minimal first link (recommended):** ship **R2 → R1**. Every piece except the trigger already exists and is tested.

## 4. VERIFICATION LOG
Read both specs (handoff is Alex→Mira draft-only one-target; Riley §2 non-goal "Mira handoff"). Read `delegate.ts`/`delegation-port.ts`/`delegation-targets.ts`/`creative-concept-draft-workflow.ts` — governed-child shape + one-element allowlist. Distinguished `decisions/adapters/handoff-adapter.ts` (human-escalation UI, NOT agent→agent) from `skill-runtime/tools/delegate.ts`. Grep: `packages/ad-optimizer/src/**` has zero cross-agent refs. Read `recommendation-engine.ts:231-358` ("Trigger PCD"; no `lead_quality_*` branch). Read `metric-diagnostician.ts:30-169` (all 5 triggers detected in the autonomous path). Read `recommendation-sink.ts` (dead-ends as cards; exhaustive 3-place switch, no fallback). Read `desk-model.ts`+`creative-read-model/types.ts` (`sent_to_riley`/`fatigued` unrepresentable; Riley draft → `inProduction`). Read `mira-brief.ts` (human brief exists, hardcodes `pastPerformance:null`, no Riley goal; `CreativeJob.pastPerformance` flows end-to-end, populated by nobody).
