# AI Engineering Landscape for Switchboard (June 2026)

**Date:** 2026-06-19
**Method:** Deep multi-source research workflow (35 agents, ~2.25M tokens). 10 parallel search angles across Anthropic/Claude docs, OpenAI, X/Twitter, Reddit, GitHub, and AI engineering books (Chip Huyen). 64 raw findings, triaged to 23, each adversarially skeptic-verified (23 held up, 0 rejected). Then reconciled against the actual Switchboard codebase via two read-only scout agents plus direct file verification.
**Raw verified output (full caveats + corrected claims per finding):** `/private/tmp/claude-501/-Users-jasonli-switchboard/30e06b0b-5100-4067-8c09-9ebfd87510c8/tasks/wjgw71mz4.output`

The generic research synthesis is in Part 3. The high-value layer is Part 1: where the latest external guidance is already done, already wrong, or already half-built in our code. Read that first.

---

## Part 1: Reconciliation against the actual codebase

Eight corrections and confirmations, each grounded in a real file. These change what to actually do.

### 1. Prompt caching is ALREADY wired. Reframe from "do" to "harden + instrument."

The report's top move is "turn on prompt caching." We already cache the static prefix in three adapters:

- `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts:143-144` (last-tool `cache_control: ephemeral`) and `:162` (system block cached).
- `packages/core/src/governance/classifier/anthropic-classifier.ts` (system + tool cached, forced `tool_choice`).
- `packages/core/src/agent-runtime/anthropic-adapter.ts` (base system cached; RAG + instructions left as a dynamic tail).

The remaining work is the engineering discipline from finding f2, not the switch:

- **Verify deterministic tool serialization.** Caching is a strict byte-level prefix match. If tool registration order can vary across boots, the cached prefix silently busts. Sort tools by name before building the manifest, and assert it.
- **Instrument cache hit-rate.** Read `usage.cache_read_input_tokens` and alert on zero across identical prefixes (a silent invalidator). We do not appear to track this today.
- **Min cacheable prefix is model-specific.** On `claude-opus-4-6` (our current critical tier) the minimum is 4096 tokens; on `claude-opus-4-8` it drops to 1024. Below the minimum, caching no-ops with no error. Confirm our system+tool prefix clears the floor per tier.
- **Conversation history is uncached by design** (dynamic tail). For long multi-turn Alex/Robin sessions we re-pay full input on the growing history every turn. Consider an incremental conversation breakpoint with the 20-block lookback rule (an intermediate breakpoint roughly every ~15 blocks).

### 2. The model-bump migration hazard is REAL, and it is `temperature`, not `budget_tokens`.

We are on the 4.6 generation (`model-router.ts:63,70,77`: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-6`). Current latest is Opus 4.8. The blocker on refreshing:

- `model-router.ts:65,72,79` set per-tier `temperature` (0.7 / 0.5 / 0.3), and `anthropic-tool-adapter.ts:165` passes `temperature: params.profile?.temperature ?? DEFAULT_TEMPERATURE`.
- On Opus 4.7/4.8 and Fable 5, `temperature`/`top_p`/`top_k` are rejected with a hard 400 (finding f3). `budget_tokens` is also rejected, but we never set it (no extended thinking anywhere).
- **So any route bumped to 4.7+ without stripping `temperature` will hard-400.** This is a latent break gating the model refresh, exactly the producer/consumer-mismatch class our memory already tracks.

Action: when refreshing model ids, strip `temperature`/`top_p`/`top_k` for 4.7+ routes, or keep 4.6 on routes where sampling control is load-bearing. Decide per slot.

### 3. We have an internal `Effort` abstraction, but not the API-native `effort` dial.

`model-router.ts:168 effortToSlotAndOptions` maps `low|medium|high` to a model _slot_ (Haiku / Haiku-critical / Sonnet). The API-native `output_config:{effort: low|medium|high|xhigh|max}` (finding f3, GA, default `high`) is a _second, additive_ cost/quality axis we do not use. It tunes reasoning depth within a model rather than swapping models. Adopting it gives a finer dial on top of phase-routing: `low` for mechanical sub-agents and classification, `high`/`xhigh` for Riley reallocation and Robin recovery. `xhigh` is 4.7/4.8 only, so Sonnet routes cap at `high`.

### 4. Extended/adaptive thinking is entirely unused. Real capability gap on the critical tier.

No `thinking` param exists anywhere in the call layer (`anthropic-tool-adapter.ts:156-166` has none). Our escalated turns (objection/closing/fear stages, Riley reallocation, Robin recovery) route to Opus but get zero reasoning budget. Anthropic frames `thinking:{type:"adaptive"}` with interleaved thinking between tool calls as especially effective for exactly our governance/skill-runtime loop shape (finding f3). Opt in on critical-tier routes after the 4.7/4.8 bump (adaptive is the 4.7+ shape), with `display:"summarized"` for operator-visible reasoning.

### 5. Memory writes bypass PlatformIngress. Confirmed mutating surface outside the invariant.

`packages/core/src/memory/compounding-service.ts` writes learned facts via `CompoundingDeploymentMemoryStore.create()` directly, not through `PlatformIngress.submit()`/`GovernanceGate`. Finding f16 (govern memory consolidation) lands here: memory is a mutating surface. Route writes through ingress with `source` + `confidence` + `valid-time` attached, and adopt invalidate-not-delete (we currently decay/evict, i.e. delete) so "what did the agent believe when it acted" stays queryable. This directly serves the receipt/provenance north star (Ledger).

- Nuance: we already do the _good_ half of finding f15. `DeploymentMemory` is a structured Prisma store as source of truth, with embeddings (`voyage-3-large`) used only for FAQ dedup at 0.92. That is the recommended pattern. **Do not build a vector DB.** The gap is governance/provenance on writes, not the storage model.

### 6. Governance text is end-of-system (good), but enforcement constraints never reach the executor (the real gap).

Two distinct things often conflated:

- Governance _text_ (`getGovernanceConstraints()`) is appended at `skill-executor.ts:281` (`system = interpolated + governance constraints`), so it sits at the end of the system block. That is recency-favorable within the system prompt. For very long multi-turn loops it is still far from the true end of context, so a short tail reminder of the hardest safety rules is a cheap win (finding f9/f10).
- Governance _enforcement_ constraints (spend caps, dynamic account state) do **not** reach the executor loop. `GovernanceHook` is constructed with only `toolsMap` and reads only `trustLevel` (`skill-mode.ts:696`; `governance-hook.ts`), while the `governanceConfigResolver` (`skill-mode.ts:186`) is passed to `DeterministicSafetyGateHook` but not to `GovernanceHook`. This is the recorded "two constraint regimes" gap, now pinned to specific lines.

### 7. Context exhaustion currently HARD-THROWS instead of pruning.

`skill-executor.ts:382-386` throws `SkillExecutionBudgetError` when `maxTotalTokens` is exceeded. Finding f1 (`clear_tool_uses_20250919` context editing, beta header `context-management-2025-06-27`) converts hard failures into graceful pruning for long loops, reportedly ~84% token cut and +29% task lift on a 100-turn eval (first-party, single workload, treat as directional). Caveat: clearing tool results invalidates the cached prefix below the edit point, so tune the threshold against cache hit-rate (`clear_at_least`) and have the model write durable state to memory before clearing. Beta, so account for churn.

### 8. Structured/strict output is used only in the classifier; skill tools validate post-call.

`anthropic-classifier.ts` uses `strict: true` + forced `tool_choice`. Skill tools use loose schemas plus `input-schema-validator.ts` _after_ the call, and `structured-output.ts` extracts JSON from markdown fences then Zod-validates. Finding f4: adopt `strict: true` (top-level tool field, requires `additionalProperties:false` + all fields required) or `output_config:{format:{type:"json_schema"}}` at the PlatformIngress tool boundary to get schema-valid output by construction, removing a class of malformed-call retries before GovernanceGate. Keep value-range / `Number.isFinite` checks in Zod, since strict rejects `minimum`/`maximum`/`minLength` (our recorded strict-schema gotcha) and is incompatible with citations.

### Confirmation: evals are mature. The extensions are trajectory grading, auto-promoted fixtures, and shadow-Riley.

We have four eval suites: deterministic `governance-decision` (runs the real gate), `claim-classifier` (accuracy + latency, regression gates, prompt-hash baselines), `alex-conversation` (3-tier LLM-as-judge with a versioned SHA-256-hashed rubric, fail-closed, forced `tool_choice`), and `riley-recommendation`. CI job `eval-classifier`. The upgrades from findings f7/f8/f20:

- Assert deterministic Tool Correctness and Argument Correctness on the **WorkTrace step sequence** (cheap, no LLM). This is the gate that catches "right action but bypassed an approval gate" and "fixed in N consumers, missed in N+1."
- Auto-promote every production failure (denied governance action, wrong booking, mis-attributed receipt) into a trace-level regression fixture from real WorkTraces.
- **Shadow-mode Riley's flag-dark money-path executor** (predicted vs actual, LLM-judge compares) before the real-money flip.
- The judge is already well-engineered (versioned, hashed, fail-closed). Add position-swap averaging only if a pairwise/subjective gate is introduced; today's exact-value gates should stay deterministic.

---

## Part 2: Prioritized roadmap (grounded in files)

### P0 (do first: cheap, high-certainty, or unblocks a model refresh)

1. **Instrument prompt-cache hit-rate** and assert deterministic tool-manifest serialization. `anthropic-tool-adapter.ts`, governance + agent-runtime adapters. Effort S.
2. **Strip `temperature`/`top_p`/`top_k` from 4.7+ routes** as part of the model-id refresh; this is the latent 400. `model-router.ts`, `anthropic-tool-adapter.ts:165`. Effort S.
3. **Route eval and report generation through the Message Batches API** for a flat 50% token discount (key results by `custom_id`, never array position). Eval suites in `/evals`, proof-quality report surface. Effort M.
4. **Adopt the read-vs-write split as the orchestration gate** (finding f5): fan out subagents only for read/research/audit; keep mutation and final synthesis single-threaded behind PlatformIngress; raise a single agent's `effort` before adding multi-agent complexity. Effort S (design gate).

### P1 (architectural leverage)

5. **Mid-loop approval parking via durable execution** (finding f6). `skill-executor.ts execute()` is a synchronous while-loop (332-631); `GovernanceHook` can return `pending_approval` but cannot suspend-and-resume mid-loop with state intact. Creative-pipeline already does durable pause/resume via Inngest `waitForEvent` (`creative-job-runner.ts:280`, `ugc-job-runner.ts:441`). Constraint: core (Layer 3) cannot import Inngest (Layer 2), so this is a NEW architectural integration, not a config flip. Keep idempotency keys on money/mutating tools (durable steps give exactly-once _step_ execution, not exactly-once against external APIs). Effort L.
6. **Adaptive thinking on critical-tier routes** + the API-native `effort` dial (finding f3), after the model bump. Effort S–M.
7. **`strict:true` / `output_config json_schema` at the PlatformIngress tool boundary** (finding f4). Effort M.
8. **Trajectory grading on WorkTrace + auto-promoted fixtures + shadow-Riley** (findings f7/f8). Effort M–L.
9. **Govern memory writes through PlatformIngress** with provenance + valid-time + invalidate-not-delete (finding f16). Effort M–L.

### P2 (watch / adopt when triggered)

10. **Context editing (`clear_tool_uses`)** for long loops once a loop is demonstrably context-bound (finding f1). Beta. Effort L.
11. **Tool Search (`defer_loading`)** before the tool surface outgrows the context budget (finding f11); at least one tool must stay non-deferred, and `defer_loading` cannot combine with `cache_control` on the same tool. Effort M.
12. **OTel GenAI spans derived one-directionally from WorkTrace** (finding f21), as a follow-on to the trajectory-eval work. Effort M–L.
13. **Native citations** for the receipt/provenance north star (finding f5/f23); incompatible with structured outputs, choose one per call. Effort S.
14. **Layered guardrails pre/input/output** (finding f13): we have input (`GovernanceHook`) and output (`DeterministicSafetyGateHook`); the missing stage is pre-flight blocking before the LLM call. Effort M.

---

## Part 3: Complete verified findings index (23)

Each finding survived 3-vote adversarial verification. Tier is the triage editor's leverage ranking. See the raw output for full per-finding caveats and corrected claims.

### Infra and efficiency

- **f2 (P0) Prompt caching on the stable prefix.** Cache reads ~0.1x input; min prefix model-specific (1024 on opus-4-8). https://platform.claude.com/docs/en/build-with-claude/prompt-caching , https://www.anthropic.com/news/prompt-caching
- **f3 (P0) Adaptive thinking + per-route `effort`; `budget_tokens`/`temperature` hard-400 on 4.7/4.8.** https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking , https://www.anthropic.com/news/claude-opus-4-6
- **f18 (P1) Message Batches API: flat 50% discount, results unordered (key by `custom_id`).** https://platform.claude.com/docs/en/docs/build-with-claude/batch-processing
- **f23 (P1) Token counting endpoint (free; do not use tiktoken, it undercounts Claude) + native citations for provenance.** https://platform.claude.com/docs/en/build-with-claude/token-counting , https://platform.claude.com/docs/en/build-with-claude/citations

### Context engineering

- **f9 / f10 (P0) Context is a degrading attention budget ("context rot" is empirically real); compaction, structured note-taking, sub-agent isolation, just-in-time retrieval; place safety rules near the END of context.** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents , https://research.trychroma.com/context-rot , https://simonwillison.net/2025/Jun/18/context-rot/
- **f1 (P0) Native context editing (`clear_tool_uses_20250919`) + client-side memory tool (`memory_20250818`): ~84% token cut, +39% lift on a 100-turn eval; cache-invalidation tradeoff.** https://platform.claude.com/docs/en/build-with-claude/context-editing , https://www.anthropic.com/engineering/advanced-tool-use
- **f11 (P1) Tool Search (`defer_loading`) and code-execution-with-MCP cut tool-definition + payload bloat; cache-aware.** https://www.anthropic.com/engineering/advanced-tool-use

### Agent loop and tool design

- **f4 (P0) Structured outputs + `strict:true` tool use at the mutation boundary; strict rejects numeric/length constraints, keep those in Zod.** https://openai.com/index/introducing-structured-outputs-in-the-api/
- **f12 (P1) Agent-Computer Interface rigor as the rubric for "tools are audited surfaces": poka-yoke args, namespacing, semantic ids, actionable NL errors, capped/paginated output, per-tool eval harness.** https://www.anthropic.com/engineering/writing-tools-for-agents , https://www.anthropic.com/engineering/building-effective-agents
- **f17 (P1) Workflow-before-agent: predictable code paths for mutations, open loops for reasoning; five composable patterns.** https://www.anthropic.com/research/building-effective-agents

### Multi-agent orchestration

- **f5 (P0) Read-vs-write split as the parallelization gate; budget-matched single agents match/beat multi-agent on multi-hop reasoning; raise `effort` before adding agents.** https://cognition.ai/blog/dont-build-multi-agents , https://simonwillison.net/2025/Jun/14/multi-agent-research-system/ , https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems
- **f14 (P1) MAST: 14 multi-agent failure modes (System Design 41.8%, Inter-Agent Misalignment 36.9%, Task Verification 21.3%) as a pre-merge roster review rubric.** https://openreview.net/forum?id=fAjbYBmonr , https://github.com/multi-agent-systems-failure-taxonomy/MAST

### Reliability and governance

- **f6 (P0) Durable execution + serializable pause/resume for mid-loop approval parking; Inngest `waitForEvent`, OpenAI Agents SDK `needs_approval`, 12-Factor Factor 12.** https://openai.github.io/openai-agents-python/human_in_the_loop/ , https://www.inngest.com/blog/durable-execution-key-to-harnessing-ai-agents , https://github.com/humanlayer/12-factor-agents
- **f13 (P1) Layered guardrails pre/input/output, policy-as-code, classifier thresholds (~0.7) tuned on small labeled sets.** https://developers.openai.com/cookbook/examples/partners/agentic_governance_guide/agentic_governance_cookbook
- **f22 (P1) Long-running-agent harness discipline: re-read-first progress file, passes-flagged JSON feature ledger, one feature per session, git as second memory, mandatory e2e self-verification.** https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents , https://github.com/anthropics/cwc-long-running-agents

### Evaluation and observability

- **f7 (P0) Grade trajectories, not just outcomes, using WorkTrace as the trace artifact; deterministic Tool/Argument correctness.** https://developers.openai.com/api/docs/guides/agent-evals , https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide
- **f8 (P1) Build the eval corpus from real WorkTraces; auto-promote failures to fixtures; shadow-test Riley before the money flip.** https://hamel.dev/blog/posts/evals/
- **f20 (P1) LLM-as-judge is conditional: position/self-preference/verbosity bias; swap-and-average, rubric decomposition, calibrate against human labels.** https://arxiv.org/pdf/2411.16594 , Chip Huyen, AI Engineering (2025)
- **f21 (P2) OpenTelemetry GenAI semantic conventions for portable agent telemetry, derived from WorkTrace.** https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/

### Memory

- **f15 (P0/P1) File/DB-backed memory over vector RAG by default (Letta LoCoMo 74% vs Mem0 68.5%); vectors are an optional index, not the system of record; scope with CoALA (semantic/procedural/episodic).** https://www.letta.com/blog/memory-blocks
- **f16 (P1) Govern memory consolidation: deterministic conflict resolution, provenance, bi-temporal valid-time, invalidate-not-delete (Zep/Graphiti).** https://arxiv.org/abs/2501.13956

### Skill standard

- **f19 (P2) Anthropic Agent Skills open standard (SKILL.md + progressive disclosure) as an alignment reference for our loader.** https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

---

## Part 4: Overhyped / do not build now

- **A vector DB for agent memory.** A structured Prisma/file store with deterministic tools beats vector libraries by default and fits auditability. We already do this. (f15)
- **A full bi-temporal knowledge graph (Graphiti) wholesale.** Adopt only provenance, valid-time, invalidate-not-delete on top of DeploymentMemory. (f16)
- **Code-execution-with-MCP near-term.** Powerful but collides with the no-mutating-bypass invariant; needs sandboxing + ingress-routed wrappers. Do Tool Search first. (f11)
- **LLM-as-judge gates on anything exact.** Keep tool/args/approval/serviceId checks deterministic. (f20)
- **Multi-agent fan-out for reasoning or mutation lift.** Budget-matched single agents win; raise `effort` first. (f5/f14)
- **The 2026 Dynamic Workflows runtime as a dependency.** Research preview; adopt the principle, watch the product. (f17)
- **OTel as a turnkey eval solution.** It standardizes the trace schema only; the CI-gate eval story is a separate follow-on. (f21)

---

## Part 5: Open questions

Answered by the scout:

- Governance text is appended end-of-system (`skill-executor.ts:281`); enforcement constraints do not reach the executor (`skill-mode.ts:696`).
- Memory writes bypass PlatformIngress (`compounding-service.ts`).
- Strict mode is classifier-only; skill tools validate post-call.
- We are on the 4.6 model generation and do pass `temperature`.

Still open (verify before acting):

- Is the tool manifest serialized deterministically (sorted by name), and does the prefix clear the per-tier cache minimum on the first request?
- Exact shape of `skill-mode.ts execute()` return: can a `parked`/`pending_approval` outcome be added without breaking every downstream `completed`-else-`failed` consumer?
- Where should durable parking physically live given core cannot import Inngest (Layer 2)?
- Is WorkTrace queryable as an ordered tool-call step sequence per work unit, or only as linked records (determines reconstruction cost for trajectory evals)?
- Does any production failure path already write a structured artifact that could be auto-promoted to a regression fixture?
- Does the Zod to tool-schema generation strip `min/max/minLength` for `strict:true` tools, or will strict 400 on existing schemas?
