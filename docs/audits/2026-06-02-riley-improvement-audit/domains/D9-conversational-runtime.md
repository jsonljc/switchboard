# D9 — Riley's Conversational/Agent Runtime (skill, tools, prompt, model-routing, identity)

> Raw domain audit. `file:line` against `main`. Synthesis: [`../FINDINGS.md`](../FINDINGS.md).

## 1. CURRENT STATE (verified)

**Headline: Riley has NO live conversational surface. It is unwired.**

**Riley's skill manifest is a batch-audit prompt, not a chat agent.** `skills/ad-optimizer.md` (169 lines) is a one-shot JSON-producing weekly-audit prompt; parameters are pre-fetched batch data (`CAMPAIGN_INSIGHTS`, `PREVIOUS_INSIGHTS`, `ACCOUNT_SUMMARY`, `CRM_FUNNEL`, `BENCHMARKS`, `DEPLOYMENT_CONFIG`, `:12-62`); NO persona/voice/multi-turn flow; output is fixed JSON (`:158-167`). Compare Alex: `skills/alex/` is a directory — `SKILL.md` (341 lines, 2×) with Voice, local tone, multi-phase flow, escalation, delegation, qualification — plus a `references/` tree. Riley has zero references.

**The "interactive" Riley code exists but is dead/orphaned.** `apps/api/src/tools/ad-optimizer/ads-data.ts` (122) + `ads-analytics.ts` (162) define rich SkillTools; `ads-analytics` exposes the full analyzer suite — `diagnose`, `compare-periods`, `analyze-funnel`, `check-learning-phase`, `detect-saturation`, `analyze-creatives` (`:24-159`) — i.e. **the orphaned analyzers ARE reachable through these tools.** `builders/ad-optimizer-interactive.ts` (24) is a dedicated interactive parameter builder. **But:** `createAdsDataTool`/`createAdsAnalyticsTool` are imported by NOTHING outside their own files (grep); `adOptimizerInteractiveBuilder` is exported but `builderRegistry.register("ad-optimizer", …)` is never called. Dead since #252.

**The live SkillMode bootstrap loads ONLY Alex.** `skill-mode.ts:121-122` `loadSkill("alex")`; `skillsBySlug` = alex only. `:562` registers only the alex builder. `:316-321` tool factories = crm-query/calendar-book/crm-write/escalate (+delegate) — no ads-data/ads-analytics. `SkillMode.execute()` (`platform/modes/skill-mode.ts:48-51`) does `skillsBySlug.get(slug)` → returns `SKILL_NOT_FOUND` for any `ad-optimizer` slug. **A user literally cannot reach Riley conversationally.** The chat app confirms: `apps/chat/src/` references `@switchboard/ad-optimizer` only for `CtwaAdapter`, never to route a conversation to Riley.

**The `ad-optimizer` slug is consumed only by the cron, which uses no LLM.** `inngest.ts:201` `findBySlug("ad-optimizer")` → `createWeeklyAuditCron(adOptimizerDeps, …)` (`:761`). `audit-runner.ts` has zero anthropic/claude/LLM/skill refs — pure heuristics. `BatchSkillHandler` is instantiated NOWHERE. So `skills/ad-optimizer.md`, despite `minimumModelTier:premium` (`:67`), is **fully dead at runtime** — neither cron nor chat loads it.

**Model routing (#783/#784).** `model-router.ts:95-114` `resolveTier()` is **agent-agnostic** (keys off messageIndex/toolCount/hasHighRiskTools/previousTurnEscalated/minimumModelTier). NO "alex" gate. Tiers: default=Haiku-4.5, premium=Sonnet-4.6, critical=Opus-4.6. Injected into `SkillExecutorImpl` as optional `router?` (`skill-executor.ts:100`). **But live wiring (`skill-mode.ts:547`) constructs the executor with `undefined` router.** So ModelRouter is currently OFF for ALL skills — Alex included. Riley isn't "gated out"; tiering simply isn't on for anyone, and Riley has no wired skill to tier. The literal `ALEX_MODEL_ROUTER_ENABLED` string does not appear in code — gating is structural (router passed or not).

**PII pass (#775).** `skill-runtime/pii.ts` `sanitizeContactForPrompt()` is used by exactly 3 sites: `tools/crm-query.ts`, `builders/alex.ts`, `builders/sales-pipeline.ts`. The dead ad-optimizer interactive builder doesn't use it. Riley's funnel/CRM data can carry lead-level PII, so an activated chat Riley would need a projection it lacks.

**Identity/cockpit/greeting.** `greeting.ts` treats Riley as first-class (config `:90-95`, `countNoun:"ad sets"`, distinct voice strings, e.g. `:168` "I'll alert you when I see drift"; voice "direct, numerical" `:13-16`) — solid, consistent with Alex/Mira. `metrics-riley.ts` is thin/self-undermining for an _ad_ optimizer: CTR hardcoded unavailable (`:69-74,92`); ROI bar **always** `degraded:true` (`:123-152`); hero "leads" with `qualifiedPct=0` (`:56-57`); `targetCpbCents` reinterpreted as cost-per-lead (`:100-108`).

## 2. GAPS / WEAKNESSES

1. **Riley cannot be asked anything.** No conversational runtime path → `SKILL_NOT_FOUND`. The interactive-trust surface (the North Star) is absent. Dominant gap.
2. **The Phase-1 spec assumes a chat path that doesn't exist** (§1.3 "analyzers only run if Riley is invoked as a chat tool" — that invocation path is unwired; today they run in neither cron nor chat).
3. **Conversationally under-invested vs Alex** (169-line batch prompt vs 341-line SKILL + references; no persona/voice/Q&A patterns).
4. **`skills/ad-optimizer.md` is dead but looks alive** (declares tools + premium tier; nothing loads it).
5. **No PII projection for an activated Riley.**
6. **Cockpit metrics signal "blind"** (hardcoded-unavailable CTR, always-degraded ROI).
7. _(Caveat tempering "Alex is richer")_ Alex's `references/` are loaded but **never injected** by `SkillExecutorImpl` (grep), so Alex's reference advantage is partly latent too — but Alex's SKILL body is still far richer.

## 3. RANKED RECOMMENDATIONS

**R1 — Wire a real interactive Riley skill into SkillMode (the keystone).** Author a conversational `skills/ad-optimizer-interactive/SKILL.md` with Riley persona + Q&A flow; load into `skillsBySlug`; register `adOptimizerInteractiveBuilder`; add `ads-data`/`ads-analytics` to the executor's tool/factory maps; route the Riley intent. `skill-mode.ts:121-122,316-321,562`; tools/builder already exist. Effort M-L, risk M (live LLM agent + governance/consent hooks; `send-conversion-event` is `external_mutation` and needs approval gating). Aligns best AFTER PR1/PR2. _TAG: net-new conversational surface — the missing "Mouth/Ears" companion to the spec's "Eyes/Target/Brain"._

**R2 — Expose the weekly-audit findings conversationally.** A read tool over persisted audit/recommendation records (`saveAuditReport`, `inngest.ts:242-258`; recs via `rileyRecommendationEmitter`) so Riley narrates the latest audit, explains each rec's rationale/evidence/tier, answers follow-ups. Effort M, risk L (read-only). Deps R1; better after PR2/PR3 richer rationale. _TAG: net-new (surfaces existing outputs)._

**R3 — Author Riley persona/voice + advisor references; fix executor to inject `SkillDefinition.references`** (currently loaded-but-unused — also benefits Alex). Effort S-M. Deps R1. _TAG: net-new persona + shared-runtime fix._

**R4 — Turn on ModelRouter tiering; set Riley's floor to premium.** Pass a `ModelRouter` into `SkillExecutorImpl` (`skill-mode.ts:547`), behind the existing default-off posture; set interactive Riley `minimumModelTier:premium` (Sonnet) so ad-analysis isn't answered by Haiku. Effort S, risk M (flipping affects Alex too). Deps R1; same activation pending for Alex (#783/#784). _TAG: shared with Alex A2 — Riley rides the same activation._

**R5 — PII projection on the interactive ad-optimizer path** (port Alex #775). `pii.ts`; ad-optimizer tools/builder. Effort S. Deps R1. _TAG: port of #775._

**R6 — Fix Riley's cockpit instrumentation (CTR/ROI).** Wire real CTR + non-degraded ROI/CAC bar (`metrics-riley.ts:69-74,92,100-152`). Largely subsumed by PR2 but CTR-unavailable/always-degraded-ROI are separate cockpit defects. Effort M. _TAG: overlaps PR2._

## 4. VERIFICATION LOG

Read `skills/ad-optimizer.md` (169, batch, no persona, `minimumModelTier:premium` `:67`); `skills/alex/SKILL.md` (341) + `references/` dir; only 3 non-Alex skills exist. Read `ads-data.ts`+`ads-analytics.ts` (full analyzer exposure). Grep `createAdsDataTool|createAdsAnalyticsTool` → only definitions (orphaned). Read `skill-mode.ts` in full (alex-only load/register; tool factories crm/calendar/escalate/delegate; `undefined` router `:547`). Read `platform/modes/skill-mode.ts:48-51` (`SKILL_NOT_FOUND` on miss). Read `model-router.ts` (agent-agnostic; no `ROUTER_ENABLED` literal). Read `skill-executor.ts:100,142-164`. Read `pii.ts` + usage (3 sites). Read `greeting.ts`+`metrics-riley.ts` (Riley identity present; metrics thin). Read `inngest.ts` (cron uses heuristic `CronDependencies`). `audit-runner.ts` grep LLM/skill → empty. `BatchSkillHandler` grep → not instantiated. `seed-marketplace.ts` (`ad-optimizer` listing/deployment `skillSlug:"ad-optimizer"`, cron-consumed). `apps/chat/src/` grep → only `CtwaAdapter`.
