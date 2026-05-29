# AI Infrastructure Improvement Audit

**Date:** 2026-05-16
**Branch:** `docs-ai-infra-improvement-audit`
**Author:** Claude Opus 4.7 (1M context), at user request
**Scope:** Independent, codebase-first audit of AI infrastructure improvements. Distinct from the [Architecture & Codebase Cleanup Audit (2026-05-15)](./2026-05-15-architecture-cleanup-audit.md), which is structural (ingress, audit trail, DLQ, type safety). This audit targets the LLM runtime + memory + eval + compliance layer.

---

## 1. Methodology

Eight parallel `Explore` subagents mapped independent subsystems, each constrained to facts + `file:line` citations only (no recommendations, no analysis):

| Lane                               | Scope                                                                                                                                                                                                        | Cross-checked against              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| A. Orchestration / runtime         | PlatformIngress, modes, skill-runtime, hooks, model-router, idempotency, circuit-breaker                                                                                                                     | doctrine invariants 1, 4, 6        |
| B. Memory / context                | Prisma memory tables, ConversationCompoundingService, ContextBuilder, knowledge-store, embeddings, prompt caching, sessions                                                                                  | PR-3 / PR-3.1 / PR-3.2 design docs |
| C. Eval / observability            | Telemetry, LLM usage logger, cost tracking, Promptfoo, judges, outcome attribution, Sentry, `/metrics`, audit ledger, demo mode                                                                              | architecture cleanup audit         |
| D. Channels / voice                | ChannelGateway, adapters (TG/WA/Slack/IG), consent gates, banned phrases, voice (none), bypass paths, dedup, cross-channel identity                                                                          | PR #596 memory                     |
| E. Creative pipeline               | Inngest jobs, providers (DALL-E/Kling/ElevenLabs/Whisper/HeyGen/Runway/Seedance), FFmpeg assembly, UGC phases, character/product consistency, lineage, compliance gates                                      | doctrine invariant 7               |
| F. Ad optimizer + Riley            | Meta CAPI, Google offline, recommendation engine, outcome attribution dispatch+worker, learning phase guard, statistical confidence, multi-platform, signal-health                                           | PR #538 / #577 memories            |
| G. Compliance / governance / audit | Consent service, claim classifier, banned phrases, jurisdiction rules (SG/MY), verdict store, audit ledger, halt provider, PII redaction, delegation, bilingual handling                                     | PR #596, doctrine invariants 4, 8  |
| H. Deployment / production         | Env vars, secrets, CI workflows, local readiness, dashboard build in CI, db migrations, worktree-init, Vercel, Render, Inngest, Sentry per app, rollback, smoke, feature flags, pooling, rate limiting, CORS | local-readiness-phase-2 PRs        |

**Materials read before forming hypotheses:** `CLAUDE.md`, `docs/DOCTRINE.md`, `docs/ARCHITECTURE.md`, `.agent/RESOLVER.md`, `.agent/conventions/{architecture-invariants,source-of-truth}.md`, `.agent/memory/semantic/{DECISIONS,INVARIANTS,LESSONS}.md`, `MEMORY.md`, `project_consent_enforcement_pr596_shipped.md`, last 10 specs + last 60 commits.

**Materials deliberately excluded from Step 4 reasoning:** the architecture cleanup audit's ranked backlog (used only for cross-check in Steps 5–6, not as a source of hypotheses).

**Note on theses:** The user referenced two external architecture theses (~10K words each) to be cross-referenced in Step 5. The actual content was not pasted in this session; only placeholders (`[paste thesis 1]` / `[paste thesis 2]`) were present. Step 5 below evaluates against the **themes the user pre-summarized** (per-tenant unit economics, eval-driven development, compliance moat, closed-loop measurement, single-threaded writes/multi-agent reads, prompt caching, HIPAA→PDPA translation) but cannot evaluate specific recommendations the theses may have made.

---

## 2. Current-State Map

### A. Orchestration / runtime

- **PlatformIngress.submit()** at `packages/core/src/platform/platform-ingress.ts:83` — 10-stage pipeline: idempotency → intent lookup → entitlement → trigger validation → deployment+mode resolution → governance gate → decision handling.
- **Modes** registered via `ExecutionModeRegistry`: `skill` (`platform/modes/skill-mode.ts:17`), `cartridge` (`cartridge-mode.ts:24`), `workflow` (`workflow-mode.ts:38`), `operator_mutation`.
- **Skill executor** at `packages/core/src/skill-runtime/skill-executor.ts:197-424` — iterates tool_use blocks **sequentially** (`for (const toolUse of toolUseBlocks)` at line 337). No streaming, no parallel tools. `maxLlmTurns:6`, `maxToolCalls:5`, `maxTotalTokens:64_000`, `maxRuntimeMs:30_000` (`types.ts:290-317`).
- **Hooks** (`skill-runtime/types.ts:275-284`): `beforeSkill`, `afterSkill`, `beforeLlmCall`, `afterLlmCall`, `beforeToolCall`, `afterToolCall`, `onError`. Invoked sequentially with short-circuit on `proceed=false` (`hook-runner.ts:12-89`).
- **EffectCategory** enum (`governance-types.ts:1-8`): `read`, `propose`, `simulate`, `write`, `external_send`, `external_mutation`, `irreversible`.
- **Model router** (`packages/core/src/model-router.ts:42-109`): 3 tiers + embedding. Models: `claude-haiku-4-5-20251001` (default), `claude-sonnet-4-6` (premium), `claude-opus-4-6` (critical). Deterministic rules: greeting/no-tools → default; previous-turn-escalated → critical; previous-turn-used-tools → premium; high-risk-tools → premium.
- **Prompt caching** — `cache_control: { type: "ephemeral" }` used **only** at `packages/core/src/governance/classifier/anthropic-classifier.ts:76,82` (system text + last tool def). **Not used anywhere in agent-runtime / skill-runtime.**
- **Anthropic Batch API** — `grep` for `batch.*messages.create` / `messageBatches` returns zero hits in `packages/core/src/llm/`.
- **Idempotency** — `packages/core/src/idempotency/guard.ts:44-104`. Key = SHA256(principalId+actionType+JSON(parameters)); TTL default 5 min; enforced at ingress step 0.
- **Circuit breaker** — `packages/core/src/skill-runtime/circuit-breaker.ts:10-34`. `maxFailuresInWindow:5`, `windowMs:3_600_000`.

### B. Memory / context

- **Prisma memory tables**: `ConversationState` (`schema.prisma:128-148`), `ConversationMessage` (899-911), `ConversationThread` (926-953), `ConversationLifecycleSnapshot` (955-971), `ConversationLifecycleTransition` (973+), `KnowledgeChunk` (647-667, embedding column = `vector(1024)`), `DeploymentMemory` (687-705), `DeploymentMemoryEvidence` (707-721), `RecommendationOutcome` (578-614), `Booking` (1879-1906), `KnowledgeEntry` (1785-1800).
- **No** `OperatorCorrection` model; corrections live in `KnowledgeChunk.sourceType="correction"`.
- **Embedding adapters**: `claude-embedding-adapter.ts` ("claude-embed-1", 1024 dims) and `voyage-embedding-adapter.ts` ("voyage-3-large", 1024 dims, POST `api.voyageai.com/v1/embeddings`). Persisted in pgvector — no Pinecone, no in-memory fallback.
- **ConversationCompoundingService** (`memory/compounding-service.ts:191-237`): writes `fact`, `faq`, `pattern` categories via similarity → `incrementConfidence` path. Threshold `SIMILARITY_THRESHOLD=0.92`. FAQ auto-promotes at threshold of 3.
- **Confidence formula** (`schemas/src/deployment-memory.ts:62-73`): `Math.min(0.95, 0.5 + 0.15 * Math.log(sourceCount))`; surfacing threshold `sourceCount≥3 AND confidence≥0.66`. Pilot-mode relaxes to `sourceCount≥2 AND confidence≥0.6`.
- **ContextBuilder** (`memory/context-builder.ts:125-231`): retrieval-chunks → learned-facts → recent-summaries → outcome-patterns. Output-patterns rendered as `<outcome-patterns><pattern id="…">…</pattern></outcome-patterns>` envelope (`memory/outcome-pattern-extractor.ts:138-172`).
- **Pattern injection** into Alex skill prompt at `skill-runtime/builders/alex.ts:99-118` via `{{OUTCOME_PATTERNS}}` template parameter.

### C. Eval / observability

- **No Promptfoo / golden sets / eval CI gate.** `find … -name "promptfoo*" -o -name "*.eval.ts"` returns zero. `.github/workflows/ci.yml` has no eval step.
- **No LLM-as-judge** beyond the claim classifier itself. No compliance judge regression harness, no outcome verifier judge.
- **LLM usage logger** (`packages/core/src/llm-usage-logger.ts`): fields = `orgId`, `model`, `inputTokens`, `outputTokens`, `taskType`, `durationMs?`, `error?`. **Cache hit / cache read tokens not logged.** Prisma model `LlmUsageLog`, indexed `(orgId, createdAt)` + `(model)`.
- **Cost tracking** (`telemetry/llm-costs.ts`): USD-per-1K table for Opus/Sonnet/Haiku/GPT-4o/4o-mini, computed in memory; **not persisted** in `LlmUsageLog`, **no per-tenant ceiling**, **no run-rate alerting**.
- **Telemetry** (`telemetry/tracing.ts`): OpenTelemetry abstraction with no-op fallback; real tracer wired at app entry. Attributes include `deploymentId`, `attributionTier`, `reason` (rejection), `canonicalCategory`. No `orgId`, no `modelTier` spans on LLM calls.
- **Outcome attribution** (`recommendations/outcome-attribution*` + `apps/api/src/services/cron/riley-outcome-attribution.ts:61-69`): daily 07:00 UTC dispatch; allowlisted directional copy templates (4 only): `pause.spend.{fell,changed}`, `refresh.ctr.{rose,changed}` (`schemas/recommendation-outcome-copy.ts:14-19`); kill-switch `RILEY_OUTCOME_ATTRIBUTION_ENABLED=true`.
- **Sentry**: api (`apps/api/src/bootstrap/sentry.ts:13-24`), chat (`apps/chat/src/bootstrap/sentry.ts:3-14`), dashboard (`sentry.{server,client}.config.ts`). **MCP server: not initialised** (still flagged in architecture cleanup audit).
- **/metrics** (`apps/api/src/metrics.ts`): Prometheus counters for proposals, approvals, executions, circuit breaker trips, outcome-pattern lifecycle; latency histograms for proposal/approval/execution/policy-engine.

### D. Channels / voice

- **ChannelGateway** at `packages/core/src/channel-gateway/channel-gateway.ts:25-116`. PR #596 wired `runConsentEnforcementGate` immediately before `replySink.send` (line 72-97).
- **Adapters**: Telegram (30/sec, secret-token timing-safe), WhatsApp (80/sec, HMAC-SHA256 `x-hub-signature-256`, 24h template-window enforcement at `apps/chat/src/adapters/whatsapp.ts:59-92`), Slack (~1/sec Tier-1, HMAC `v0:timestamp:body`, 5-min drift), Instagram/Messenger (200/sec, same Meta HMAC scheme).
- **Outbound bypass paths (PDPA holes)** — confirmed:
  - `packages/core/src/notifications/proactive-sender.ts:82-160`, callers `apps/api/src/routes/conversations.ts:374` and `escalations.ts:245`. **No consent gate.** Operator can dashboard-send to a revoked contact.
  - `apps/api/src/services/workflows/meta-lead-greeting-workflow.ts:22`. CTWA template fetch direct to Graph API. **No consent gate.**
  - `apps/api/src/routes/whatsapp-send-test.ts:202`. Operator-initiated QA send. Mitigated by allowlist but no consent gate.
- **Cross-channel identity**: `channel-gateway/resolve-contact-identity.ts:15-36` keys contacts on `phone` for WhatsApp only; **other channels return `contactId: null`**. No phone-as-primary linkage table.
- **Voice**: zero integration. Grep for `twilio|elevenlabs|vapi|retell|voip|tts|stt|speech` returns only unrelated style/payment hits.
- **Inbound dedup**: in-memory `Map<messageId, timestamp>` in `apps/chat/src/adapters/security.ts:18-87`, optional Redis fallback. Per-adapter extractors at lines 229-429.

### E. Creative pipeline

- **Modes**: polished (`creative-job-runner.ts:119-135`, 5 stages: trends → hooks → scripts → storyboard → production) and UGC (`ugc-job-runner.ts:338-350`, 4 phases: planning → scripting → production → **delivery (no-op stub)**).
- **Providers**: OpenAI DALL-E 3 (`stages/image-generator.ts:24-30`), Kling (`kling-client.ts:40-41`), ElevenLabs (`elevenlabs-client.ts:6`), Whisper, HeyGen/Runway/Seedance (**stub adapters only**).
- **Video assembly** via FFmpeg subprocess (`video-assembler.ts:40-180`), Pro tier only. SSRF guard on clip URLs (`util/safe-url.ts`).
- **Character / product consistency**: `CreativeJob.productIdentityId` + `creatorIdentityId` columns exist (`schema.prisma:1307-1314`), but pipeline **does not read or enforce** them. UGC treats creator pool as filterable list, not consistency-locked.
- **Compliance gates on creative output**: `realism-scorer.ts:53-120` and `minimal-qa.ts:20` produce `pass|review|fail` based on artifact flags (face_drift, hand_warp, product_warp, text_illegible, etc.). **No brand-safety check, no claim filter, no regulatory-ad-review.** Assets reach `approvalState="ready"` without ever passing the claim classifier.
- **Connection to ad-optimizer**: **none**. No grep hits for meta/google/optimizer in creative-pipeline; production phase writes to `assetStore` only.
- **Cost tracking**: estimates only (`cost-estimator.ts:7-68`); real per-generation cost deduction not implemented (marked "SP7").
- **Inngest `onFailure`**: missing from `mode-dispatcher.ts:44-56`, `creative-job-runner.ts:119-135`, `ugc-job-runner.ts:338-350`.

### F. Ad optimizer / Riley

- **Meta CAPI** (`meta-capi-dispatcher.ts:109-121`): POST to `v21.0/{pixelId}/events`; deduplication via `event_id` (either caller-supplied or deterministic SHA256(`contactId\x1Fkind\x1FbookingId\x1FoccurredAt`) at `outcome-dispatcher.ts:70-89`).
- **Google offline conversions**: implemented (`google-offline-dispatcher.ts:1-54`). Currency hardcoded "SGD" at line 44.
- **TikTok**: not found.
- **Riley weekly audit cron**: `inngest-functions.ts:163-175`, schedule `"0 9 * * 1"` (Mon 09:00 UTC), id `ad-optimizer-weekly-audit`. **No `onFailure`.**
- **Riley outcome attribution dispatch** (`inngest-functions.ts:336-351`, daily 07:00 UTC) + worker (`apps/api/src/services/cron/riley-outcome-attribution.ts:61-69`); kill-switch read at `apps/api/src/bootstrap/inngest.ts:644`.
- **Learning phase guard** (`learning-phase-guard.ts`): v1 thresholds `LEARNING_DAYS=7`, `LEARNING_EVENTS_REQUIRED=50` (lines 15-16); v2 has frequency/spend states.
- **Pacing, budget allocator, spend forecast, anomaly detection**: **none found** (grep returns zero in `packages/ad-optimizer/src/`).
- **Statistical confidence**: **none found**. No chi-squared, t-test, proportion-test, Wilson interval. Riley recommendations fire on point-delta thresholds, not statistical significance.
- **CompetenceStore feedback**: **not wired**. Riley emits but does not feed back into Switchboard trust scores.
- **Coverage thresholds** (vitest.config.ts:7-15): 90/80/90/90 (already configured, contradicting cleanup audit's pre-PR claim).
- **Signal-health monitoring** (`signal-health-checker.ts:1-17`): pixel-dead >24h, freshness <1h, server-to-browser ratio thresholds, dedup ratio thresholds. Daily 07:00 UTC cron at `inngest-functions.ts:236-250`.

### G. Compliance / governance / audit

- **ConsentService** (`packages/core/src/consent/consent-service.ts:82-325`): jurisdiction stamping (immutable once set), grant/revocation/cycle-reset, verdict emission, posture-cache fail-closed.
- **Revocation keywords**: per-jurisdiction at `consent/revocation-keywords/{sg,my}.ts` + loader.
- **Claim classifier** (`skill-runtime/hooks/claim-classifier.ts:59-404`): LLM-as-judge on Haiku 4.5; 9 claim types (`schemas/claim-classifier.ts:12-22`); prompt caching used (`anthropic-classifier.ts:72-83`); prompt version `claim-classifier@1.0.0` stamped into verdicts; modes `off|observe|enforce`; substantiation cache for approved claims.
- **Classifier prompt** at `packages/core/src/governance/classifier/prompt.ts:17-32`: **hardcoded English-only**. Targets "medical aesthetic and beauty spa marketing copy in Singapore and Malaysia" but the prompt body and example claim types are English. No Mandarin or Bahasa Malay handling. Bilingual handler at `dialogue/bilingual-handler.ts:8-73` covers `en|zh|ms` for dialogue rendering but is **not wired into the classifier**.
- **Banned phrases**: 5 SG (`governance/banned-phrases/sg.ts:3-45`) + 5 MY (`my.ts:3-44`) entries, categorized superlative/guarantee/medical_claim/urgency/testimonial, severity block-or-rewrite.
- **Regulatory sources**: SG (`regulatory-sources/sg.ts:5-101`, HSA/MOH/SMC/HCSA — approved devices Thermage/Ultherapy/PicoSure, clinic claims, doctor credentials, certifications) + MY (`my.ts:5-107`, KKM/MDA/MMC/MAB equivalents).
- **GovernanceVerdict schema** (`schemas/governance-verdict.ts:15-76`): sourceGuard ∈ {banned_phrase_scanner, claim_classifier, escalation_trigger, consent_gate, whatsapp_window}; reasonCode covers 20+ codes including `consent_revoked`, `contact_resolution_missing` (added in PR #596); auditLevel ∈ {info, warning, critical}; action ∈ {allow, rewrite, block, escalate, template_required}.
- **Audit ledger** (`audit/ledger.ts:83-200`): hash-chained, PG advisory lock `900_001` (`prisma-ledger-storage.ts:6,54`), `verifyChain()` exists at `audit/canonical-hash.ts:34-70` but **no scheduled cron invokes it**. Chain-break would go undetected until next on-demand call.
- **PII redaction** (`audit/redaction.ts:1-97`): regex for email, phone, API tokens, credit card; field-paths for credentials/password/secret/apiKey/accessToken/refreshToken. **No SSN, DOB, insurance number, or medication-name patterns** (relevant for medspa).
- **Halt provider**: `deployment-lifecycle-store.ts:4-48`, dashboard-wired at `/api/dashboard/governance/halt/route.ts:1-19`.
- **Delegation chain** (`approval/chain.ts:16-135`): max depth 5, scope narrowing only, BFS, cycle detection via `visited` set.
- **Cockpit copy hygiene test** (`apps/dashboard/src/__tests__/cockpit-copy-hygiene.test.ts`) scans for tenant-generic strings (PR #589).

### H. Deployment / production

- **Env**: ~80 vars in `.env.example`. Required: `DATABASE_URL`, `CREDENTIALS_ENCRYPTION_KEY` (hard-fail in production, `apps/api/src/app.ts:182-194`), `NEXTAUTH_SECRET`, `ANTHROPIC_API_KEY`.
- **Feature flags**: `NEXT_PUBLIC_{CONTACTS,AUTOMATIONS,ACTIVITY,REPORTS,APPROVALS}_LIVE`, `RILEY_OUTCOME_ATTRIBUTION_ENABLED`, `ALLOW_SELF_APPROVAL`, `ALLOW_FIXTURE_DATA_MODE`, `DEV_BYPASS_AUTH`. Drift detected by `scripts/check-live-flag-manifest.ts`.
- **CI** (`.github/workflows/ci.yml`): setup → typecheck + lint + test + secrets + security + architecture + docker, all parallel. Dashboard `next build` runs in test job (line 217). gitleaks, `pnpm audit`, `arch:check`, dependency-cruiser. **No eval step.**
- **Local readiness**: `pnpm local:verify:fast` runs env-completeness, live-flag-manifest, arch:check, route-ingress, seed-counts, dashboard-typecheck (`scripts/local-verify-fast.ts:1-107`).
- **Render**: `render.yaml:1-178` defines `switchboard-{api,chat,redis,postgres}`. `CREDENTIALS_ENCRYPTION_KEY` set `sync: false`.
- **Vercel** (dashboard): no `vercel.json`; web-UI configured. Per launch checklist, `SWITCHBOARD_API_URL` points to Render api.
- **Inngest functions registered** (`apps/api/src/bootstrap/inngest.ts`): ~14 crons including `dailyPatternDecayCron` (07:00), Riley outcome dispatch (07:00), Riley weekly audit (Mon 09:00), Meta token refresh, Stripe reconciliation, lead retry, lifecycle stalled sweep. **None have `onFailure` handlers** — grep for `onFailure` in `apps/api/src/` and `packages/{core,creative-pipeline,ad-optimizer}/src/` returns hits only in circuit-breaker (unrelated).
- **Migrations**: 10+ recent in `packages/db/prisma/migrations/`. Drift check via `pnpm db:check-drift`.
- **Health**: `/health` shallow on every app; `/api/health/deep` on api+chat. **MCP server has no Sentry init.**

---

## 3. Independent Hypotheses (formed before any thesis cross-reference)

Eleven hypotheses surfaced from the audit. Ranked by leverage × tractability × launch-criticality.

| #   | Hypothesis                                                                                                                                                                                                                                                 | Category                                   | Evidence                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------- | ------ | -------------------------------------------------- |
| H1  | **Eval-driven CI gate for the claim classifier.** No Promptfoo, no golden set, no regression test on the LLM-as-judge that gates every outbound message. A single prompt edit can silently degrade compliance coverage.                                    | Compliance + capability                    | `governance/classifier/prompt.ts` is hand-edited; CI has no eval step; `CLASSIFIER_PROMPT_HASH` exists but no harness consumes it                            |
| H2  | **Prompt caching on agent-runtime + RAG chunks.** `cache_control` is used in the classifier (2 spots) but **not anywhere in skill-runtime, agent-runtime, or context-builder**. Every Alex/Riley turn re-bills the full system prompt.                     | Cost / margin                              | `anthropic-classifier.ts:76,82` are the only cache_control hits; `skill-runtime/skill-executor.ts:197-251` builds messages with no cache markers             |
| H3  | **Close the 3 consent-enforcement bypass paths from PR #596 follow-ups.** ProactiveSender (operator dashboard sends), meta-lead-greeting-workflow (CTWA template), whatsapp-send-test (QA). All can deliver to a revoked contact.                          | Compliance (launch-blocker)                | `proactive-sender.ts:82-160`, `meta-lead-greeting-workflow.ts:22`, `whatsapp-send-test.ts:202`; documented in `project_consent_enforcement_pr596_shipped.md` |
| H4  | **Bilingual (zh + ms) extension of the claim classifier.** SG (~76% ethnic Chinese, often bilingual) and MY (~62% Bumiputera, Malay-speaking) markets routinely produce non-English copy. A Bahasa or Mandarin medical claim violation is invisible today. | Vertical depth + compliance                | `governance/classifier/prompt.ts:17-32` is English-only; `dialogue/bilingual-handler.ts:8-73` supports en/zh/ms but is **not wired** into classifier         |
| H5  | **Per-tenant LLM cost ceiling + run-rate alerting.** Tokens are logged but no ceiling enforced. A runaway tenant (prompt-injection loop, abusive operator, broken cron) can rack up unbounded cost.                                                        | Margin / reliability                       | `llm-usage-logger.ts` has no aggregation; `telemetry/llm-costs.ts` computes in-memory only                                                                   |
| H6  | **Audit-chain verification cron + alert on `valid:false`.** `verifyChain()` is on-demand only; a chain break would not be detected until next manual call.                                                                                                 | Compliance / reliability                   | `audit/canonical-hash.ts:34-70`; no scheduled call site in `apps/api/src/bootstrap/inngest.ts`                                                               |
| H7  | **Statistical confidence + minimum sample sizes on Riley recommendations.** Riley fires "pause" / "refresh" on point deltas; no chi-squared / Wilson / t-test. A noise-driven recommendation = trust regression.                                           | Wedge defensibility                        | grep for `chi-squared                                                                                                                                        | t-test | proportion-test | wilson | significance`in`packages/ad-optimizer/src/` = zero |
| H8  | **Inngest `onFailure` + DLQ on all 14 cron functions.** Doctrine invariant 7 ("dead-letter for every async path") is violated by every async function in api+core+creative+ad-optimizer.                                                                   | Reliability / doctrine                     | Architecture cleanup audit already flagged; confirmed via grep                                                                                               |
| H9  | **Brand-safety / claim-filter gate on creative-pipeline outputs.** Generated DALL-E images / UGC video text overlays / scripts can carry non-compliant claims and reach Meta Ads without traversing the claim classifier.                                  | Compliance (when creative→ads link exists) | `phases/production.ts:146-166` gates on realism QA only; no claim classifier invocation                                                                      |
| H10 | **MCP-server Sentry init.** Trivial, one-line — but still flagged.                                                                                                                                                                                         | Reliability                                | `apps/mcp-server/src/main.ts` lacks Sentry; api/chat/dashboard all have it                                                                                   |
| H11 | **`cacheReadTokens` field in LLM usage logger + cache-hit metric.** Without observability, prompt-caching wins (H2) are invisible and unverifiable.                                                                                                        | Observability                              | `llm-usage-logger.ts` fields don't include `cacheReadTokens`; `Llm­UsageLog` model has no cache columns                                                      |

---

## 4. Thesis Recommendations Evaluated

The two architecture theses the user referenced were not pasted in this session (placeholders only). The user's pre-summary of likely thesis themes is evaluated against the codebase below:

| Thesis theme (user-summarized)                            | Codebase status                                                                                                                                                                                                        | Verdict                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Single-threaded writes / multi-agent reads pattern        | Skill-executor iterates tools sequentially (`skill-executor.ts:337`); read-only tools also serialized. PR-2 (parallel safe reads) deferred per `2026-05-13-agent-infra-parity-design.md`.                              | **Directionally correct, deferred consciously.** Revisit when Alex's tool surface grows beyond current handful.             |
| Compliance as a moat                                      | Substantial: 9-claim-type classifier with prompt caching, 5 SG + 5 MY banned phrases, full SG/MY regulatory sources, hash-chained audit ledger with PG advisory lock, consent service with PDPA jurisdiction stamping. | **Already shipped at depth.** Gaps: classifier is English-only (H4), no eval CI (H1), audit verifyChain not scheduled (H6). |
| Closed-loop measurement (creative ↔ optimizer ↔ outcomes) | Outcome attribution loop (Riley PR-3 #577) lives between optimizer and bookings. **Creative pipeline does not connect to optimizer or outcomes** — no handoff path.                                                    | **Half-shipped.** Riley→outcome closed; Creative→Riley open.                                                                |
| Eval-driven development                                   | **Not present.** No Promptfoo, no golden sets, no eval CI gate.                                                                                                                                                        | **Net-new and highest-leverage gap.** (H1)                                                                                  |
| Per-tenant unit economics                                 | Tokens logged per org; **no aggregation, no ceiling, no alerts**.                                                                                                                                                      | **Half-shipped.** (H5)                                                                                                      |
| Prompt caching as cost lever                              | Used in classifier only; not in skill runtime where 99% of token-spend lives.                                                                                                                                          | **Net-new gap.** (H2)                                                                                                       |
| HIPAA-style isolation → PDPA                              | PDPA consent service is comprehensive; `HIPAARedactor` from the legacy customer-engagement cartridge doc no longer present; PII redaction patterns omit medication-name / DOB / insurance-number (medspa-relevant).    | **Mostly shipped + small extension.**                                                                                       |

**Filter applied to candidate thesis recommendations:**

- **Wrong-stack rejects (preemptive):** Pydantic AI, Temporal, DBOS, Mastra — Switchboard is TS-only; rewrites would cost months and would not improve any of H1–H11.
- **Wrong-jurisdiction rejects:** US TCPA/FCC/FDA/FTC/AmSpa/GHL — replace with SG MOH/HSA/SMC/HCSA/PHFSA + MY KKM/MMC/MAB/MDA, all of which are **already encoded** in `regulatory-sources/{sg,my}.ts`.
- **Premature rejects:** Bayesian MMM, Thompson sampling, BG/NBD LTV — Switchboard has <10 pilot clinics; these need 6–12 months of stable cohort data.
- **Cargo-cult rejects:** Higgsfield Soul ID, Arcads, Hedra branding — interchangeable with Kling/HeyGen/Runway already in the pipeline; vendor swap is a config change, not architecture.

---

## 5. Recommended Actions (5)

### Rec 1 — Eval CI gate + bilingual golden sets for the claim classifier

**Gap.** The claim classifier (Haiku 4.5 with prompt caching) is the single LLM call most tightly coupled to launch viability. The system prompt at `packages/core/src/governance/classifier/prompt.ts:17-32` is English-only; the 9 claim categories are enumerated in `schemas/claim-classifier.ts:12-22`; verdicts stamp `CLASSIFIER_PROMPT_VERSION` and `CLASSIFIER_PROMPT_HASH` (`prompt.ts:9,57`). Yet **CI has no eval step** and **no golden set exists**.

**Why it matters.** Without a regression harness, a one-line prompt edit can quietly degrade detection of urgency claims, miss a guarantee, or mis-classify a credential. The compliance moat decays silently. Once an MOH or KKM auditor opens an inquiry, the eval record (or its absence) is your defense.

**Scope.** 3 PRs, ≈800 LOC + ≈300 golden examples.

- **PR-1 (eval harness):** add `evals/claim-classifier/` directory with Promptfoo (or hand-rolled vitest harness reading from JSONL) running against the existing classifier. ≈250 LOC + Promptfoo config.
- **PR-2 (golden set v1):** author ≈30 SG + ≈30 MY English-only examples covering each of the 9 claim types (positive + adversarial + edge). Score against published prompt; lock baseline metrics (precision/recall per claim type).
- **PR-3 (CI gate):** add `pnpm eval:classifier` to `.github/workflows/ci.yml` as a required check. Fail on regression vs locked baseline.

**Why now.** Compounding. Every future prompt change becomes safer; the regression cost of staying without eval grows with classifier confidence in the field.

**Conflicts / unblocks.** Unblocks Rec 4 (bilingual classifier — needs eval before adding language axes). Unblocks safe iteration on classifier prompt under user feedback.

**First step.** Capture the existing classifier prompt + claim-type enum + 2 example outputs to a JSONL fixture. Run the existing classifier against it in a vitest test to lock the baseline behaviour byte-identically. From there, the harness expands by hand-authoring 30 SG examples.

---

### Rec 2 — Prompt caching on agent-runtime + skill-runtime + RAG chunks

**Gap.** `cache_control: { type: "ephemeral" }` is used **only** at `packages/core/src/governance/classifier/anthropic-classifier.ts:76,82`. The agent-runtime + skill-runtime path that handles every Alex/Riley conversation turn (`skill-runtime/skill-executor.ts:197-424`, `skill-runtime/builders/alex.ts:99-118`) builds messages with no cache markers. Every turn re-bills the full system prompt + tool definitions.

**Why it matters.** At pilot scale (≈10 clinics × ≈50 Alex turns/day × ≈6000-token system prompt), uncached system tokens ≈ 3M/day on Sonnet ≈ $9/day; cached ≈ $0.90/day. That's a ~10× margin compression on the largest token bucket. As clinics scale, the gap widens linearly.

**Scope.** 1 PR, ≈300 LOC.

- Insert `cache_control: { type: "ephemeral" }` at the cache breakpoint between (a) static system text + tool definitions and (b) per-turn dynamic context (last user message, conversation tail, outcome patterns).
- Extend `LlmUsageEntry` (`packages/core/src/llm-usage-logger.ts`) with `cacheCreationInputTokens` + `cacheReadInputTokens` + Prisma columns on `LlmUsageLog` (H11 folded in).
- Add a Prometheus counter `switchboard_llm_cache_hit_ratio` at `apps/api/src/metrics.ts`.

**Why now.** Direct margin; tractable; independent of every other rec. Sentry-level observability change (H11) is folded in so the cache wins are verifiable.

**Conflicts / unblocks.** None. Pure additive.

**First step.** Add `cache_control` markers on tool definitions in `Alex.ts` builder (smallest behavioural change), verify a measurable cache-read-tokens count appears via `llm-usage-logger` after one local Alex turn replay, then extend to the system prompt.

---

### Rec 3 — Close the 3 consent-enforcement bypass paths (deferred from PR #596)

**Gap.** PR #596 wired the consent enforcement gate at `ChannelGateway.dispatchResponse` but the discovery in the PR memory flagged 3 non-gateway egress paths that bypass the gate:

1. `ProactiveSender` at `packages/core/src/notifications/proactive-sender.ts:82-160`, called from `apps/api/src/routes/conversations.ts:374` and `escalations.ts:245` (operator dashboard sends).
2. `meta-lead-greeting-workflow` at `apps/api/src/services/workflows/meta-lead-greeting-workflow.ts:22` (CTWA template direct Graph API fetch).
3. `whatsapp-send-test.ts:202` (operator QA send; mitigated by allowlist).

**Why it matters.** These are **active SG/MY PDPA holes** for non-agent outbound. An operator can send to a contact who has STOP'd. The repository's own memory tags this as `[[feedback-ship-clean-not-followup]]`-violating — exactly the doctrine warning about "follow-up issues" rotting into TODO trails.

**Scope.** 3 PRs, ≈400 LOC total.

- **PR-A (ProactiveSender — highest priority):** gate at the route handler before `app.agentNotifier.sendProactive(...)`. `orgId` from auth context, `contactId` from conversation record. Verdict emission via existing `verdictStore.save`.
- **PR-B (meta-lead-greeting):** inject `consentStore` into `buildMetaLeadGreetingWorkflow` factory (`apps/api/src/bootstrap/contained-workflows.ts:123`); call `runConsentEnforcementGate` before the Graph API fetch.
- **PR-C (whatsapp-send-test):** either gate or document acceptance and harden the allowlist. Lowest priority.

**Why now.** Compliance / launch-blocking. PDPA breach via operator dashboard is a real-world risk pattern: an operator types "fyi we have a new promo" in the cockpit, hits send, and the gate doesn't fire.

**Conflicts / unblocks.** None. Path-by-path independent.

**First step.** PR-A: add a small helper `gateOutboundForOperator(orgId, contactId, channel, text)` in `apps/api/src/services/consent-egress-gate.ts` that wraps `runConsentEnforcementGate` with a route-friendly shape; call from `conversations.ts:374` first.

---

### Rec 4 — Bilingual (zh + ms) extension of the claim classifier

**Gap.** The classifier system prompt at `packages/core/src/governance/classifier/prompt.ts:17-32` is hardcoded English. Alex and Riley deployments will be operating in markets where customer-facing copy is routinely Mandarin (SG ethnic Chinese majority) or Bahasa Malay (MY Bumiputera majority). The bilingual handler at `packages/core/src/dialogue/bilingual-handler.ts:8-73` already supports `en|zh|ms` for dialogue rendering — but **it is not wired into the classifier path**.

**Why it matters.** A Bahasa medical claim violation ("**Pasti** hilangkan parut!") or Mandarin urgency ("**仅限今天**") is not flagged by the current classifier. This is the difference between a compliance moat that works on test fixtures and one that holds up under SG MOH or MY KKM audit when operator copy is in the actual market language.

**Scope.** 1 PR (after Rec 1 lands), ≈250 LOC + ≈40 golden examples per language.

- Modify `CLASSIFIER_SYSTEM_PROMPT` to be language-aware: explicit instruction to detect language and classify in source language; keep claim-type vocabulary in English.
- Add `messageLanguage` parameter to `ClaimClassifierHook` and propagate from `dialogue/bilingual-handler.ts::resolveLanguage`.
- Bump `CLASSIFIER_PROMPT_VERSION` to `claim-classifier@2.0.0` (the hash version handles the prompt content delta; the version is the deliberate-intent stamp).
- Expand the eval golden set (Rec 1) with 30 zh + 30 ms examples per jurisdiction.

**Why now.** Vertical depth. Without this, the compliance moat works only on English copy, and an operator who writes Mandarin/Bahasa marketing copy gets no governance.

**Conflicts / unblocks.** **Gated by Rec 1.** Without an eval harness, you cannot safely change the classifier prompt — there's no regression signal.

**First step.** Author ≈10 Bahasa examples by hand (one per claim type) and run them through the current English-only classifier to measure baseline coverage. Score the gap, then change the prompt.

---

### Rec 5 — Per-tenant LLM cost ceiling + daily run-rate alerting

**Gap.** `LlmUsageLog` records every LLM call per org (`packages/db/prisma/schema.prisma` `LlmUsageLog` model, indexed `(orgId, createdAt)`). Cost is computed via `packages/core/src/telemetry/llm-costs.ts` in-memory but **not persisted**, **not aggregated per tenant**, **no ceiling enforced**, **no alert path**. A runaway tenant (prompt-injection loop, abusive operator, broken cron emitting 10x recommendations) can rack up unbounded cost.

**Why it matters.** Per-tenant unit economics is the core of the pilot pricing model. The 30-second runtime budget in skill-runtime + the per-skill `maxTotalTokens: 64_000` guard protect any single execution; nothing protects an aggregate spike. At <$300/mo pilot pricing, a 10x cost spike on one tenant kills the contribution margin.

**Scope.** 2 PRs, ≈600 LOC.

- **PR-1 (cost persistence + budget config):** add `OrgLlmBudget` Prisma model (`organizationId`, `dailyTokensIn`, `dailyTokensOut`, `dailyTokensCached`, `dailyCostCents`, `dailyCostCentsCeiling`, `monthlyCostCentsCeiling`, `enforcementMode` ∈ `observe|warn|deny`). Extend `LlmUsageLog` with `costCents` column. Aggregation cron at 5-minute cadence.
- **PR-2 (alerting + enforcement):** OperatorAlerter dispatch at 50%/80%/100% of daily ceiling per org; hard-deny at 100% in `enforce` mode (return verdict `reasonCode: "org_budget_exceeded"`, `auditLevel: "critical"`, `action: "block"` at PlatformIngress step 1.5 or skill-runtime hook); Sentry breadcrumb on every breach.

**Why now.** Margin protection at pilot scale. Without it, one bug → emergency pager + manual SQL fix. The seed budget can be conservative (e.g. $5/day/org) and operators can raise on request.

**Conflicts / unblocks.** Synergistic with Rec 2 (caching brings baseline cost down; ceiling caps tail risk).

**First step.** Add a vitest test against `LlmUsageLog` aggregating tokens-per-org-per-day, then build the Prisma model around the shape that test expects.

---

## 6. Rejected Candidates (with reasoning)

| Candidate                                                                                                                           | Why rejected                                                                                                                                                                                                   | Revisit when                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic Batch API for offline workloads** (Riley daily attribution, knowledge re-embedding, conversation summarization cohorts) | Real margin lever (50% off) but at <10 pilot clinics the absolute spend is small. Rec 2 (prompt caching) eats most of the savings without API-shape changes.                                                   | After Rec 2 lands and absolute monthly LLM spend > $5K/mo, or when batch-friendly workloads grow.                                     |
| **Statistical confidence on Riley recommendations** (chi-squared / Wilson intervals)                                                | Real wedge defensibility, but Riley is still in PR-1 bake period (≥2 weeks + ≥100 emissions gate per `project_riley_wave_b_pr1_shipped.md`). Adding stats before signal-floor calibration would over-engineer. | After Riley PR-2 gate clears + ≥100 emissions observed.                                                                               |
| **Audit-chain verification cron** (H6)                                                                                              | Small but worth doing; the chain has never broken yet, and `verifyChain()` works on demand. Bundle with the next audit-system follow-up rather than as a standalone rec.                                       | Bundle with next audit-system PR.                                                                                                     |
| **MCP-server Sentry init** (H10)                                                                                                    | Trivial one-line fix; already in the architecture cleanup audit's Phase A mechanical pile. Not worth a top-5 slot.                                                                                             | Bundle with next maintenance batch.                                                                                                   |
| **Cross-channel contact identity linkage**                                                                                          | Capability gap — useful for unified contact view across WA+TG+IG, but no pilot clinic uses >1 channel today.                                                                                                   | When a pilot reports needing it, or when Riley/Alex need cross-channel attribution.                                                   |
| **Voice integration** (Twilio / ElevenLabs phone)                                                                                   | Zero infrastructure today. Pilot clinics receive phone bookings, but routing them through Switchboard is a 4-6 week build with vendor lock-in choices. Not the marginal blocker.                               | When a pilot specifically asks for phone-as-channel; or when the message-side wedge is proven and ready to extend.                    |
| **Parallel safe tool calls in skill runtime** (PR-2 from agent-infra-parity)                                                        | Already designed and consciously deferred. Latency from serialized read-only tools has not been observed as a pilot-scale bottleneck.                                                                          | When Alex's tool repertoire grows past the current ≈5 tools, or when tail latency on read-heavy turns becomes a measurable complaint. |
| **Creative-pipeline → ad-optimizer handoff**                                                                                        | The creative pipeline produces assets; no clinic-facing creative→ads loop is in launch scope. Adding the handoff without launch demand creates compounding maintenance burden on Inngest job graph.            | When a pilot specifically uses the creative pipeline to produce a campaign that needs auto-publish to Meta.                           |
| **Brand-safety / claim filter gate on creative-pipeline outputs** (H9)                                                              | Important once creative→ads is wired (above). Today, generated creative goes to `assetStore` only; nothing reaches Meta automatically.                                                                         | Synced with creative→ads handoff.                                                                                                     |
| **HIPAA→PDPA-aware medication/DOB/insurance PII redaction extension**                                                               | The current `audit/redaction.ts:1-97` patterns cover email/phone/tokens/cards. Medspa-relevant fields (medication names, DOB) are not redacted. Real but not yet observed as a problem.                        | When an audit consumer or operator raises it, or when bookings contain free-text medication history.                                  |
| **Cartridge-sdk wind-down**                                                                                                         | Structural cleanup, already in architecture cleanup audit Wave 2 backlog. Out of scope for an AI-infra audit.                                                                                                  | Already tracked.                                                                                                                      |
| **OpenTelemetry orgId/modelTier spans on LLM calls**                                                                                | Marginal observability improvement. Folded into Rec 2's cache-hit-ratio metric work for efficiency.                                                                                                            | Bundled with Rec 2 PR.                                                                                                                |

---

## 7. Sequencing

```
                                        ┌─────────────────┐
                                        │ Rec 3 (consent  │
                                        │  bypass closure)│  ← Launch-blocking; ship first
                                        │  3 PRs, ~400LOC │
                                        └────────┬────────┘
                                                 │ independent
                                                 ▼
            ┌─────────────────┐        ┌─────────────────┐
            │ Rec 1 (eval CI) │  ←───  │ Rec 2 (prompt   │
            │  3 PRs, ~800LOC │  ind.  │  caching + obs.)│  ← Direct margin; independent
            │  +300 examples  │        │  1 PR, ~300LOC  │
            └────────┬────────┘        └────────┬────────┘
                     │ unblocks                 │ independent
                     ▼                          ▼
            ┌─────────────────┐        ┌─────────────────┐
            │ Rec 4 (zh+ms    │        │ Rec 5 (cost     │
            │  classifier)    │        │  ceiling + alert)│
            │  1 PR + ~80 ex. │        │  2 PRs, ~600LOC │
            └─────────────────┘        └─────────────────┘
```

**Recommended order:**

1. **Rec 3 first** (consent bypass) — launch-blocking PDPA; smallest blast radius; three independent paths means 3 PRs that can ship in series within a week.
2. **Rec 2 in parallel with Rec 3** (prompt caching) — direct margin lever; no dependency on anything else; observability folded in (`cacheReadTokens` field) so wins are verifiable.
3. **Rec 1 next** (eval CI) — compounding; once landed, makes every future classifier change safe.
4. **Rec 4 after Rec 1** (bilingual classifier) — gated by eval harness existence; vertical-depth wedge for SG/MY markets.
5. **Rec 5 last** (cost ceiling) — margin protection; lower urgency at <10 clinics scale; benefits from Rec 2 (baseline cost down) being in place.

**What unblocks what:**

- Rec 1 unblocks Rec 4 (no safe prompt iteration without eval).
- Rec 2's observability change (`cacheReadTokens`) feeds Rec 5's per-tenant cost aggregation directly.
- Rec 3 is independent of everything else but is the one with the most concrete external (regulatory) consequence.

**What this audit deliberately does not sequence:**

- Architecture-cleanup audit Wave 2 items (idempotency middleware, audit-trail on routes, Inngest DLQ, file-size splits, etc.) — see `2026-05-15-architecture-cleanup-audit.md`. Those are structural; this audit is capability/cost/compliance-coverage.

---

## Appendix — Cross-cutting observations not in the rec set

- **Doctrine invariant 7 ("dead-letter for every async path") is broadly violated.** 14 Inngest functions lack `onFailure` handlers (already in the cleanup audit backlog at CRITICAL #3). Worth bundling all 14 into one DLQ pattern PR.
- **`HIPAARedactor` referenced in `docs/ARCHITECTURE.md` §5 cartridge documentation no longer exists** in the repo (matches LESSONS.md "cartridges deleted"). Doc drift.
- **`packages/ad-optimizer/vitest.config.ts:7-15` has coverage thresholds (90/80/90/90)** — contradicts the architecture cleanup audit's CRITICAL #6 which claimed "no thresholds configured". Audit finding is stale; thresholds were added before or alongside the audit.
- **`OperatorCorrection` model is referenced in PR-3 design but does not exist.** Corrections live in `KnowledgeChunk.sourceType = "correction"`. Update prose-only design docs.
- **`schemas/ad-optimizer-types.ts` Google offline conversions hardcodes `currency = "SGD"`** at `google-offline-dispatcher.ts:44`. MY pilot clinics may need MYR. Single-line config when needed.
