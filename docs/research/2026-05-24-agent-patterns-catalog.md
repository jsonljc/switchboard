# Agent-Engineering Patterns Catalog + Switchboard Audit

> Research date: 2026-05-24. Compiled from four parallel research sweeps (Anthropic's
> published canon, agent-memory/self-improvement literature, eval/reliability/safety
> patterns, and orchestration/context-management patterns) plus a grounded audit of the
> Switchboard codebase. This is a **reference** document — the decision matrix in Part 3
> is the actionable output; Parts 1–2 are the supporting catalog and current-state map.

Anchor question that started this: _"dreaming" (offline memory consolidation) and "thin
harness / fat skills" are two points in a larger design space — what else is in that
space, and which points are worth adopting for a governed, audited, regulated agent
platform?_

---

## Part 1 — Concept Catalog

Grouped by theme. Each concept: what it is, source, the actionable principle.

### 1.1 Memory is a design space (where dreaming lives)

| Concept                                           | What it is                                                                                                                                                                                     | Source                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **CoALA taxonomy**                                | Split memory into **episodic** (events), **semantic** (facts), **procedural** (skills). Each store gets different trust/write/retrieval rules.                                                 | https://arxiv.org/abs/2309.02427                                                                 |
| **Sleep-time compute** (Letta)                    | A _sleeper_ agent consolidates during idle time; the live _serve_ agent answers fast. Only the sleeper edits memory.                                                                           | https://arxiv.org/abs/2504.13171 · https://docs.letta.com/guides/agents/architectures/sleeptime/ |
| **MemGPT memory hierarchy**                       | Core (in-context) / recall (searchable history) / archival (cold store) tiers with explicit paging tools; agent self-edits memory.                                                             | https://arxiv.org/abs/2310.08560                                                                 |
| **Generative Agents**                             | Memory stream + retrieval scored by recency × importance × relevance; periodic **reflection** synthesizes higher-level inferences.                                                             | https://arxiv.org/abs/2304.03442                                                                 |
| **Reflexion**                                     | Actor acts → Evaluator scores → self-reflection writes a verbal critique into an episodic buffer prepended next attempt. No fine-tuning.                                                       | https://arxiv.org/abs/2303.11366                                                                 |
| **Voyager skill library**                         | Store learned competence as verified, named, executable code skills — composable and inspectable.                                                                                              | https://arxiv.org/abs/2305.16291                                                                 |
| **ExpeL**                                         | Mine a corpus of past runs into compact natural-language "insights" + exemplar bank; cross-task generalization without weight updates.                                                         | https://arxiv.org/abs/2308.10144                                                                 |
| **Agent Workflow Memory (AWM)**                   | Induce reusable multi-step _workflows_ from past trajectories; inject relevant ones to guide future actions.                                                                                   | https://arxiv.org/abs/2409.07429                                                                 |
| **"Dreaming" / evidence-threshold consolidation** | Offline reflective pass that cleans/reorganizes/promotes memory; a consolidated insight enters _advisory_ and only graduates to _trusted_ after crossing an evidence threshold + verification. | Anthropic context-engineering post (below); ADM counterfactual-verification variant              |
| **Memory Tool + Context Editing** (Anthropic API) | Client-implemented cross-session memory directory + server-side stale-tool-result clearing. Internal: +39% agentic search, 84% token reduction paired.                                         | platform.claude.com memory-tool / context-editing docs                                           |

**Governance rule that recurs across all of these:** any memory that _synthesizes a fact_
or _changes behavior_ must enter as `advisory/pending`, pass the same gates as a mutation,
and emit an audit event — never become a silent trusted source.

### 1.2 Orchestration & state

| Concept                               | What it is                                                                                                                                                                                                                                                                                                                                               | Source                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **12-Factor Agents**                  | Production-reliability manifesto. Key factors: F3 own your context window, F4 tools = structured outputs, F5 unify execution+business state, F6 launch/pause/resume APIs, F7 human escalation as a tool call, F9 compact errors into context, F10 small focused agents, F11 trigger from anywhere, **F12 stateless reducer** (`agent = reduce(events)`). | https://github.com/humanlayer/12-factor-agents                          |
| **Orchestrator-worker**               | Lead agent decomposes & spawns subagents in isolated contexts returning condensed summaries (+90.2% over single-agent on breadth-first research, ~15× token cost).                                                                                                                                                                                       | https://www.anthropic.com/engineering/built-multi-agent-research-system |
| **Typed handoff contract**            | A delegation/handoff is a typed contract — objective + output schema + boundaries — validated at the boundary. Vague prose handoffs cause duplicated work, gaps, payload drift.                                                                                                                                                                          | (same as above)                                                         |
| **When NOT multi-agent**              | Avoid when token efficiency matters, tasks share context / interdepend, or need tight coordination. Default single-agent.                                                                                                                                                                                                                                | (same as above)                                                         |
| **Durable execution / checkpointing** | Persist execution as replayable event history; pause indefinitely for human approval, resume from last checkpoint. App-level (LangGraph) vs infra-level (Temporal).                                                                                                                                                                                      | https://docs.langchain.com/oss/python/langgraph/durable-execution       |
| **ReAct / Plan-then-Execute**         | ReAct re-plans each step from fresh observations (dynamic envs); Plan-then-Execute fixes a reviewable plan upfront (cheaper, auditable, predictable workflows).                                                                                                                                                                                          | https://arxiv.org/abs/2210.03629                                        |

### 1.3 Context engineering

| Concept                                 | What it is                                                                                                                                       | Source                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Context rot**                         | More tokens → lower recall/attention. Context is a finite, depleting resource.                                                                   | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents   |
| **Just-in-time retrieval**              | Pass lightweight identifiers (IDs, paths, queries); fetch full data via tools at runtime.                                                        | (same)                                                                              |
| **Compaction / context editing**        | Summarize history near window limit and reinitialize; clear stale raw tool results first (cheapest, safest).                                     | (same) + context-editing docs                                                       |
| **Structured note-taking / offloading** | Agent writes durable state to files/store; keeps only restorable references in context.                                                          | (same)                                                                              |
| **KV-cache stability** (Manus)          | Cache hit rate is the #1 production metric. Stable prefix (no per-call timestamps), append-only context, deterministic JSON ordering.            | https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus |
| **Mask, don't remove**                  | Don't mutate the tool set mid-run (busts cache); constrain _which_ tools are selectable via logit masking / state machine.                       | (same)                                                                              |
| **PII tokenization**                    | Tokenize sensitive data at the harness boundary (`email → [EMAIL_1]`) so the model never sees raw PII; untokenize when calling downstream tools. | https://www.anthropic.com/engineering/code-execution-with-mcp                       |

### 1.4 Tools & skills

| Concept                                   | What it is                                                                                                                                                            | Source                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Agent-Computer Interface (ACI)**        | Tool defs/docs are an interface deserving HCI-grade engineering; tool optimization often beats prompt optimization.                                                   | https://www.anthropic.com/engineering/building-effective-agents                             |
| **Poka-yoke tool arguments**              | Redesign args so misuse is structurally impossible (e.g., require fully-qualified IDs).                                                                               | (same)                                                                                      |
| **Agent Skills + progressive disclosure** | Folders of instructions/scripts/resources discovered on demand; 3 levels (name → SKILL.md → bundled files). Put deterministic logic in scripts, not token generation. | https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills |
| **Tool Search Tool / deferred loading**   | Mark rare tools `defer_loading`; ~85% token reduction + accuracy gains. (This is how _this_ environment's deferred tools work.)                                       | https://www.anthropic.com/engineering/advanced-tool-use                                     |
| **Workflows vs agents**                   | Most "agentic" needs are workflows (predefined code paths). Reserve true agents for open-ended problems. Add complexity only when evals justify.                      | https://www.anthropic.com/engineering/building-effective-agents                             |

### 1.5 Evaluation & reliability

| Concept                                     | What it is                                                                                                                                                    | Source                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Eval-driven development / hill climbing** | Author the eval first; keep one north-star score per workstream; every change must move it.                                                                   | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents |
| **Capability vs regression evals**          | Capability starts hard/low; regression sits near 100% and is a hard merge gate. Graduate saturated capability cases into regression.                          | (same)                                                                 |
| **Trajectory vs outcome eval**              | Outcome-only "passes agents that got lucky." For high-stakes mutations, assert the _trajectory_ (was the required gate invoked?), not just the end state.     | https://arxiv.org/pdf/2510.02837                                       |
| **pass@k vs pass^k**                        | `pass@k` = ≥1 success in k (capability); `pass^k` = all k succeed (reliability). Gate safety-critical work on `pass^k`.                                       | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents |
| **LLM-as-judge + bias taxonomy**            | Calibrate judge vs human labels; one rubric dimension per call; allow "Unknown." Mitigate position/verbosity/self-preference bias via order-swap/permutation. | (same) + https://hamel.dev/blog/posts/evals-faq/                       |
| **Process vs outcome reward (PRM/ORM)**     | Outcome-only rewards "right answer, wrong reasoning." Verify steps for correctness-critical work.                                                             | https://arxiv.org/pdf/2410.08146                                       |
| **Reward hacking via agent-as-judge**       | Iterative optimization against a single learned judge games it and diverges from real quality — hold out human-labeled checks.                                | https://arxiv.org/pdf/2407.04549                                       |

### 1.6 Safety / governance / security

| Concept                                                                | What it is                                                                                                                                                                      | Source                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Constitutional Classifiers**                                         | Express policy as a written "constitution," auto-generate classifier training data, give the gate full-conversation (not single-turn) context. Held over 3,000+ red-team hours. | https://arxiv.org/pdf/2501.18837                                  |
| **Runtime interception verdicts**                                      | Deterministic layer between agent and tools emits allow / warn / block / review per call.                                                                                       | https://arxiv.org/abs/2605.04785                                  |
| **Human-in-the-loop verbs**                                            | Pause before side-effecting call; support approve / **edit** / reject / respond, not just approve/reject; durable state survives the pause.                                     | https://docs.langchain.com/oss/python/langchain/human-in-the-loop |
| **Lethal trifecta**                                                    | Private data + untrusted content + external comms = unconditional prompt-injection vulnerability. Only reliable defense is removing one leg.                                    | https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/        |
| **Tool output is untrusted input**                                     | LLMs can't separate instructions from data; tool/channel output can carry injected instructions. No tool result may short-circuit into a mutation without re-entering the gate. | (same)                                                            |
| **Dual-LLM / Action-Selector / Plan-then-Execute (security patterns)** | Constrain the agent to a bounded action space; keep the component reading untrusted content separate from the one authorized to propose mutations.                              | https://arxiv.org/pdf/2506.08837                                  |
| **Idempotency keys**                                                   | Derive a deterministic key per mutating call; dedupe server-side; never rely on the agent not to retry.                                                                         | —                                                                 |
| **OTel GenAI semantic conventions**                                    | Vendor-neutral span schema for agent telemetry (tool calls, tokens, finish reasons) → portable, replayable traces.                                                              | https://opentelemetry.io/blog/2026/genai-observability/           |

---

## Part 2 — Switchboard Current-State Audit (2026-05-24)

Grounded in code. Maturity verdict per area; see cited files for detail.

| #   | Area                                                     | Maturity                                                                                                                                                                                                                                                                                                                         | Evidence (file:line)                                                                                                                |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Agent loop / orchestration**                           | Partial — imperative 7-step pipeline, not event-sourced reduction                                                                                                                                                                                                                                                                | `packages/core/src/platform/platform-ingress.ts:83-311`                                                                             |
| 2   | **WorkTrace**                                            | Strong — append-only, hash-integrity, idempotency lookups; **NOT** a `reduce(events)→state` engine (state rebuilt inline, persisted _after_ execution)                                                                                                                                                                           | `platform/work-trace.ts`, `work-trace-recorder.ts`, `work-trace-lock.ts`                                                            |
| 3   | **Orchestrator↔approval payload contract (Critical #3)** | Partial — `ToolResult.error.payload` and `ApprovalRequest` typed separately; binding hash bridges the _lifecycle_ but does **not** include the approval payload, and there is no schema validation at the orchestrator seam                                                                                                      | `skill-runtime/tool-result.ts:5-24`, `skill-executor.ts:375-379`, `approval/binding.ts:4-22`, `platform-ingress.ts:252-259`         |
| 4   | **Governance decision shape**                            | Clear but split — platform union `execute \| require_approval \| deny`; skill enum `auto-approve \| require-approval \| deny`. No `warn`/`review`/`audit-only` (note: `require_approval` already ≈ "review")                                                                                                                     | `platform/governance-types.ts:19-40`, `skill-runtime/governance-types.ts:1-24`                                                      |
| 5   | **Cross-session memory**                                 | Absent at session level, but **infra exists**: per-deployment `AgentStateStore` (`state-provider.ts:3-32`) + `deploymentMemoryStore` with learned facts / outcome patterns / interaction summaries (`memory/context-builder.ts:125-231`). All per-deployment/contact, not per-session; WorkTrace not replayed into agent beliefs | `agent-runtime/agent-runtime.ts:46-93`, `agent-runtime/state-provider.ts`                                                           |
| 6   | **Claim classifier**                                     | Well-architected — Anthropic tool-use, strict schema, **prompt caching already on** (`cache_control: ephemeral`), versioned prompt+hash. Gaps: **single-sentence** input (no conversation context), policy embedded in prompt (not a separate constitution), evals **outcome-only** (no trajectory/gate-traversal assertion)     | `governance/classifier/anthropic-classifier.ts:31-112`, `governance/classifier/prompt.ts`, `evals/claim-classifier/score.ts:15-110` |
| 7   | **Untrusted-input separation**                           | Partial — channel read **is** separated from mutation authorization (ingress is the only auth point); pre-input escalation gate runs before the executor; **tool output already sentinel-wrapped + escaped** (`<\|tool-output\|>`). Gap: PII flows raw; no Dual-LLM split for the proposing component                            | `channel-gateway/channel-gateway.ts:121-324`, `pre-input-gate.ts:32-80`, `skill-executor.ts:444-452`                                |
| 8   | **Idempotency**                                          | Good at ingress (`idempotencyKey` → WorkTrace lookup), **optional**; binding hash guards parameter drift. No tool-level dedup (relies on tools being idempotent by invariant)                                                                                                                                                    | `platform-ingress.ts:87-127`, `approval/binding.ts`                                                                                 |
| 9   | **Prompt/context caching**                               | Minimal — classifier cached; **agent loop NOT cached** (`buildSystemContent` concatenates a fresh string per call; dynamic retrieved-context interpolation busts reuse)                                                                                                                                                          | `agent-runtime/anthropic-adapter.ts:8-49`, `skill-executor.ts:174-176`                                                              |
| 10  | **PII in context**                                       | Exposed — raw `contactId` + `phone` passed into intent parameters; no tokenization/reference layer; tool-call args logged (truncated)                                                                                                                                                                                            | `channel-gateway.ts:288-299`, `skill-executor.ts:344-346`                                                                           |

---

## Part 3 — Decision Matrix (the actionable output)

Ranked by **leverage × low cost × fit with invariants**. Status: **IMPLEMENT** (do next),
**QUEUE** (worth doing, gated/needs brainstorm), **SKIP** (not now / conflicts).

### IMPLEMENT

1. **Typed handoff contract for the approval payload (closes Critical #3).**
   The literature names this exact bug (unspecified delegation contract). Bridge
   `ToolResult.error.payload` → `ApprovalRequest` at the orchestrator boundary with a
   Zod-validated `PendingApprovalPayload`; consider folding the payload schema version into
   the binding-hash inputs so shape can't silently drift. _Already partial; clear fix._

2. **Trajectory + `pass^k` eval for gate traversal.**
   Extend the eval harness so it asserts the governance gate appears in the WorkTrace
   trajectory before any mutation — making "no mutating bypass paths" a CI guard rather than
   a code-review convention. Add a `pass^k` reliability metric for the classifier (cheap
   change in `score.ts`) since regulated health claims must be right _every_ run.

3. **Prompt caching in the agent loop.**
   The classifier already shows the pattern. Restructure `buildSystemContent` into structured
   blocks — static persona/instructions/governance-constraints marked `cache_control: ephemeral`,
   dynamic retrieved-context as a separate trailing block. Ensure no per-call timestamps in the
   stable prefix (KV-cache stability). Direct, measurable cost win.

4. **PII tokenization at the channel→agent boundary.**
   Tokenize `phone`/`contactId` before they enter intent parameters / model context;
   untokenize only when an audited tool needs the real value. Serves PDPA obligations and
   shrinks the prompt-injection exfil surface. (Medium cost; compliance value.)

### QUEUE (do, but gated or needs a brainstorm first)

5. **Memory posture, designed via CoALA + dreaming-done-safely.**
   Biggest net-new capability, but needs a brainstorm/spec, not a direct edit. Target the
   _existing_ `deploymentMemoryStore` (learned facts / outcome patterns). Shape:
   sleeper/serve write split (consolidation only in gated background jobs — you already run
   weekly emission + daily attribution), evidence-threshold graduation (advisory → trusted
   after threshold + classifier/human review), and a Reflexion-style written critique per
   recommendation outcome. **Gate:** brainstorm before any code; honest-impact + claim
   classifier must wrap any consolidated output.

6. **Constitutional-classifier reframing + full-conversation context.**
   Express the medspa claim policy as a separate written constitution; feed the classifier
   full-exchange context instead of single sentences. **Gate:** the 14-day bake is in flight
   (started 2026-05-23, review ≥2026-06-06). Do NOT change classifier input shape mid-bake —
   queue for after promotion.

7. **Lethal-trifecta audit pass + Dual-LLM consideration.**
   Cheap focused security review of Alex/Riley: confirm no tool result can short-circuit into
   a mutation without re-entering the gate (mostly already true), and evaluate separating the
   component that _reads_ untrusted inbound content from the one _authorized to propose_
   mutations. Sentinel-wrapping is already done — this is the next layer.

8. **HITL `edit` verb + tool-level idempotency (small).**
   Add `edit` to the approve/reject approval verbs if product wants it. Tool-level idempotency
   keys only matter where a tool's side effects aren't already idempotent — low priority given
   the existing invariant.

### SKIP (not now / conflicts with invariants)

- **Event-sourcing reducer refactor (12-Factor F12).** High architectural appeal but a real
  refactor (state is rebuilt inline, WorkTrace persisted after execution). The replay/audit
  value is _partly_ already served by WorkTrace. Long-term aspiration, not a near-term task.
- **Code-execution-with-MCP as an action channel.** Conflicts with "no mutating bypass paths."
  The _principle_ (filter tool results before context) is fine; arbitrary code as an action
  path is not. (MCP server was deliberately removed in #639.)
- **Multi-agent swarms / orchestrator-worker for Alex/Riley.** ~15× token cost + coordination
  failures; their flows are tightly governed and interdependent. Keep single-agent.
- **Temporal / external durable-execution engine.** WorkTrace + Inngest step durability already
  cover the HITL-pause/resume case.
- **MemGPT-style agent self-editing core memory.** Unaudited mutation path — violates invariants.
- **GraphRAG.** Heavy; revisit only if claim-provenance becomes a hard product requirement.

### Suggested sequence

Critical #3 contract (1) → trajectory/`pass^k` evals (2) → agent-loop caching (3) → PII
tokenization (4), then brainstorm memory posture (5) and, after the classifier bake closes,
the constitutional reframing (6).

---

## Sources (primary)

- Anthropic: [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system) · [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) · [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) · [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) · [Constitutional Classifiers](https://arxiv.org/pdf/2501.18837)
- [12-Factor Agents](https://github.com/humanlayer/12-factor-agents) · [Manus context engineering](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) · [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- Memory: [CoALA](https://arxiv.org/abs/2309.02427) · [Sleep-time compute](https://arxiv.org/abs/2504.13171) · [MemGPT](https://arxiv.org/abs/2310.08560) · [Generative Agents](https://arxiv.org/abs/2304.03442) · [Reflexion](https://arxiv.org/abs/2303.11366) · [Voyager](https://arxiv.org/abs/2305.16291) · [ExpeL](https://arxiv.org/abs/2308.10144) · [AWM](https://arxiv.org/abs/2409.07429)
- Eval/safety: [Trajectory eval](https://arxiv.org/pdf/2510.02837) · [Hamel evals FAQ](https://hamel.dev/blog/posts/evals-faq/) · [Securing LLM agents](https://arxiv.org/pdf/2506.08837) · [OTel GenAI](https://opentelemetry.io/blog/2026/genai-observability/)
