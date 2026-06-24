## Agent/skill runtime, operator controls, execution APIs & persistence

This is the "engine room" of Switchboard: the layer that turns an inbound message or a cron tick into a governed, audited, possibly human-approved action. The transferable idea is that **autonomous LLM work is never trusted blindly**, every action a model proposes flows through a deterministic policy gate, gets persisted as an immutable audit row, and (for risky effects) parks for a human to approve before it touches the outside world. Below, each concept is presented as the general engineering pattern first, then the concrete Switchboard implementation, then the runtime path, then the sharp edges.

A useful mental model before diving in: there are two layers. The **platform layer** (`packages/core/src/platform/*`) decides _whether_ a unit of work runs (governance gate, approval parking, audit trace). The **skill runtime** (`packages/core/src/skill-runtime/*`) decides _how_ an LLM-driven skill executes (the tool-calling loop, per-tool governance, telemetry). The platform calls into the skill runtime via an "execution mode."

---

### Agent Manifest (SDK)

**Concept.** A _manifest_ is declarative metadata describing a plugin's identity, what it can do, and how much autonomy it starts with. Validating it with a schema (instead of trusting free-form config) means a malformed agent fails at registration, not at runtime in front of a customer.

**In Switchboard.** `AgentManifestSchema` is a Zod object at [packages/sdk/src/manifest.ts:15](packages/sdk/src/manifest.ts). It enforces a kebab-case `slug`, semver `version`, capability and connection requirements, and crucially a **starting autonomy level**:

```ts
governance: z.object({
  startingAutonomy: z.enum(["supervised", "guided", "autonomous"]).default("supervised"),
  escalateWhen: z.array(z.string()).default([]),
}).default({ startingAutonomy: "supervised", escalateWhen: [] }),
```

The three-value autonomy enum (`supervised` / `guided` / `autonomous`) is the **same vocabulary** the governance policy matrix uses downstream (see Governance Policy Matrix). That is the load-bearing detail: the manifest declares a _starting_ trust level, and that level later indexes into the policy table that decides which tool calls auto-approve versus require a human.

**How it's used at runtime.** Loaded and validated when an agent is registered; the default `supervised` means a brand-new agent's writes and external sends are blocked or queued until an operator promotes it.

**Gotchas.** Note the safe default is the _most_ restrictive level, not the least. Also, `escalateWhen` is just an array of strings here, it is a declaration, not enforcement. The actual escalation behavior lives in skill hooks, so do not assume listing a trigger in the manifest wires anything up.

---

### Agent Handler Interface & Agent Context (SDK)

**Concept.** A _handler interface_ is a contract: agent code implements lifecycle hooks (`onMessage`, `onTask`, etc.), and the runtime supplies a _context object_ full of capabilities (state, chat, LLM, files). This is dependency injection at the agent boundary, the agent never constructs its own DB client or HTTP sender, so the runtime stays in control of every side effect.

**In Switchboard.** `AgentHandler` ([packages/sdk/src/handler.ts:3](packages/sdk/src/handler.ts)) is five optional async methods, each taking an `AgentContext` and returning `Promise<void>`. `AgentContext` ([packages/sdk/src/context.ts:45](packages/sdk/src/context.ts)) bundles injected providers plus trust metadata:

```ts
export interface AgentContext {
  state: StateStore;
  chat: ChatProvider;
  files: FileProvider;
  browser: BrowserProvider;
  llm: LLMProvider;
  notify: (message: string | StructuredNotification) => Promise<void>;
  handoff: (agentSlug: string, payload: Omit<HandoffPayload, "fromAgent">) => Promise<void>;
  persona: AgentPersona;
  trust: { score: number; level: "supervised" | "guided" | "autonomous" };
}
```

`trust.level` reuses the manifest enum, closing the loop: capabilities are injected, but what they may _do_ is gated by `trust`.

**How it's used at runtime.** This is the **SDK-era** contract. In production the medspa agent "Alex" is actually a `SKILL.md` file executed by the skill runtime (below), not a hand-written `AgentHandler`. Treat the SDK interface as the conceptual surface; the skill runtime is the real engine.

**Gotchas.** Two parallel agent models coexist (`AgentHandler` vs skills). When tracing real behavior, follow the skill runtime, not `handler.ts`. The capability providers in `context.ts` are interfaces with no enforcement of their own, enforcement is the governance hook around tool calls.

---

### Action Request schema (SDK)

**Concept.** Modeling an action as a _state machine row_ (proposed -> approved -> executed/blocked) lets you persist and reason about pending side effects instead of firing them inline.

**In Switchboard.** `ActionRequestSchema` ([packages/sdk/src/action-request.ts:15](packages/sdk/src/action-request.ts)) tracks `status` through `ActionStatus = pending | approved | rejected | executed | blocked` and `type` through `ActionType = send_message | browse_url | read_file | write_file | api_call`. It carries `governanceResult`, `reviewedBy/At`, and `executedAt`.

**How it's used at runtime / Gotchas.** This is the _legacy_ action-tracking shape. The modern platform supersedes it with `WorkUnit` + `WorkTrace` + `ApprovalLifecycle`. If you see `ActionRequest`, you are looking at the older path; the canonical persisted object today is `WorkTrace`.

---

### Skill Definition & Skill Loader (Core Runtime)

**Concept.** Defining agent behavior as a **markdown file with YAML frontmatter** ("prompt-as-code") makes the prompt, its declared parameters, and its allowed tools versionable and lintable. The loader is a compiler: parse, validate, fail loudly on drift.

**In Switchboard.** `loadSkill` reads `skills/<slug>/SKILL.md`, splits frontmatter from body, and validates against `SkillFrontmatterSchema` ([packages/core/src/skill-runtime/skill-loader.ts:28](packages/core/src/skill-runtime/skill-loader.ts)). It produces a `SkillDefinition` ([packages/core/src/skill-runtime/types.ts:44](packages/core/src/skill-runtime/types.ts)) with `parameters[]`, `tools[]`, `body`, and `context[]` requirements. Two validations matter:

```ts
function validateToolReferences(body, declaredTools) {
  const toolRefPattern = /\b([a-z][\w-]*)\.\w+\.\w+/g; // e.g. crm-write.stage.update
  // ...flags tools used in the body but not declared in frontmatter
}
```

So the frontmatter `tools:` list is a declared allowlist, and the loader cross-checks it against `tool.operation.x` references in the prompt body. It also rejects duplicate parameter names and enum parameters with empty `values`.

**How it's used at runtime.** Called once at bootstrap. The resulting `SkillDefinition.body` becomes the system prompt; `tools[]` is resolved against the Tool Registry to build the LLM's tool list.

**Gotchas.** That regex `([a-z][\w-]*)\.\w+\.\w+` matters: a _dotted-triple_ in the body that is not a real tool will be treated as a tool reference and can break boot validation. The frontmatter `slug` is the runtime identity and must equal the deployment's `skillSlug`; the directory name is cosmetic.

---

### Skill Tool, Tool Registry & Tool Factories (Core Runtime)

**Concept.** A _tool_ is a typed function the LLM may call. Two safety patterns appear here: (1) each operation declares an **effect category** (read vs write vs irreversible) so a policy layer can reason about risk without understanding the operation; (2) tools are built by **factories that close over trusted identity** so the model cannot supply `orgId`/`contactId` itself (prompt-injection defense).

**In Switchboard.** `SkillTool` is `{ id, operations }` where each `SkillToolOperation` carries `effectCategory`, `inputSchema`, `idempotent`, and `execute()` ([packages/core/src/skill-runtime/types.ts:206](packages/core/src/skill-runtime/types.ts)). The `EffectCategory` set is `read | propose | simulate | write | external_send | external_mutation | irreversible`. The `ToolRegistry` ([packages/core/src/skill-runtime/tool-registry.ts:3](packages/core/src/skill-runtime/tool-registry.ts)) enforces that every operation has an `effectCategory` at registration and that every skill-declared tool is registered:

```ts
for (const id of declaredToolIds)
  if (!registeredToolIds.has(id))
    throw new Error(`Skill declares tool "${id}" but it is not registered`);
```

The injection defense is visible in `createCrmQueryToolFactory` ([packages/core/src/skill-runtime/tools/crm-query.ts:15](packages/core/src/skill-runtime/tools/crm-query.ts)). The factory takes stores, returns `(ctx: SkillRequestContext) => SkillTool`, and `contact.get` reads `ctx.contactId`, never a model-supplied argument:

```ts
execute: async (_params: unknown) => {
  if (!ctx.contactId) return fail("MISSING_CONTACT", ...);
  const contact = await contactStore.findById(ctx.orgId, ctx.contactId);
  return ok(sanitizeContactForPrompt(contact)); // PII-scrubbed before returning to LLM
}
```

`createCrmWriteToolFactory` ([packages/core/src/skill-runtime/tools/crm-write.ts:31](packages/core/src/skill-runtime/tools/crm-write.ts)) similarly closes over `ctx.orgId` and marks `stage.update` as `effectCategory: "write"` (gated) and validates the stage against an enum in `inputSchema`.

**How it's used at runtime.** Registered at bootstrap. The executor materializes a _fresh_ tool instance per request via the factory + `SkillRequestContext`, so trusted IDs are bound for that invocation only.

**Gotchas.** Reading data still scrubs PII before it reaches the model (`sanitizeContactForPrompt`, dropping free-text `description`). The trust boundary is "the LLM can choose _which operation_ and the _non-identity_ params, never the org/contact identity." Study `SkillRequestContext` ([packages/core/src/skill-runtime/types.ts:419](packages/core/src/skill-runtime/types.ts)) to see exactly which fields are server-authoritative.

---

### Governance Policy Matrix & Governance Hook (Skill Runtime)

**Concept.** Separate _what an action is_ (effect category) from _who is allowed to do it_ (trust level), and express the decision as a **lookup table**. A table is auditable, testable, and hard to bypass accidentally, far safer than scattered `if` checks.

**In Switchboard.** `GOVERNANCE_POLICY` ([packages/core/src/skill-runtime/governance.ts:19](packages/core/src/skill-runtime/governance.ts)) is `Record<EffectCategory, Record<TrustLevel, GovernanceDecision>>`:

```ts
write:             { supervised: "require-approval", guided: "auto-approve",    autonomous: "auto-approve" },
external_send:     { supervised: "require-approval", guided: "require-approval", autonomous: "auto-approve" },
irreversible:      { supervised: "deny",             guided: "require-approval", autonomous: "require-approval" },
```

`getToolGovernanceDecision(op, trustLevel)` first checks `op.governanceOverride?.[trustLevel]`, then falls back to the matrix. The `GovernanceHook` ([packages/core/src/skill-runtime/hooks/governance-hook.ts:6](packages/core/src/skill-runtime/hooks/governance-hook.ts)) fires `beforeToolCall`, computes the decision, logs it, and returns a proceed flag with a discriminated outcome:

```ts
if (decision === "deny") return { proceed: false, reason: "...", decision: "denied" };
if (decision === "require-approval")
  return { proceed: false, reason: "...", decision: "pending_approval" };
return { proceed: true };
```

**How it's used at runtime.** Registered in the executor's hook chain; runs before _every_ tool call. `proceed: false` halts that tool and surfaces `denied` or `pending_approval` back into the loop.

**Gotchas.** `irreversible` at `supervised` is a hard `deny`, not a queue, there is no "ask a human" escape for the most dangerous category at the lowest trust. Per-operation `governanceOverride` lets a tool be stricter or looser than the matrix; always check it before assuming the table is the final word.

---

### Skill Executor (Core Runtime)

**Concept.** The _agent loop_: call the LLM, parse tool-use blocks, run each tool (through governance), feed results back, repeat until done or a budget is hit. Bounding the loop (turns, tokens, wall-clock) is what separates a production agent from a runaway one.

**In Switchboard.** `SkillExecutorImpl.execute()` ([packages/core/src/skill-runtime/skill-executor.ts:1](packages/core/src/skill-runtime/skill-executor.ts)) orchestrates: resolve model profile -> compose `SkillRequestContext` -> before-LLM hooks -> LLM call with tool defs -> parse `<intent>` tags ([skill-executor.ts:82](packages/core/src/skill-runtime/skill-executor.ts)) -> before-tool hooks (governance) -> execute tool -> after-tool hooks -> accumulate cost/tokens -> repeat. The budget ceilings live in `DEFAULT_SKILL_RUNTIME_POLICY` ([packages/core/src/skill-runtime/types.ts:355](packages/core/src/skill-runtime/types.ts)): `maxToolCalls: 5`, `maxLlmTurns: 6`, `maxTotalTokens: 64_000`, plus per-call (`maxLlmCallMs`) and whole-conversation (`maxRuntimeMs`) abort deadlines.

Two subtle defenses worth seeing:

```ts
function escapeSentinel(value: string): string {
  return value.replaceAll("<|", "⟨|").replaceAll("|>", "|⟩"); // tool output can't close the prompt wrapper
}
```

and intent parsing that **strips and nulls on ambiguity** (2+ `<intent>` tags -> drop all, classify nothing) so hidden model text never leaks to the customer.

**How it's used at runtime.** Invoked by `SkillMode` for every skill-mode work unit. Its output (`response`, `toolCalls`, `tokenUsage`, `trace`) is what gets persisted.

**Gotchas.** The per-call abort plus whole-conversation budget exist to stop output-token-burn leaks; a timeout-like error is normalized to a budget error rather than leaking as a generic failure (`isTimeoutLikeError`). The file carries an `eslint-disable max-lines` legacy-debt marker, a real lesson in how much an "agent loop" accretes.

---

### Trace Persistence Hook (Skill Runtime)

**Concept.** Telemetry/audit persistence must run **outside** the policy gates it records, otherwise the gate could block its own audit trail.

**In Switchboard.** `TracePersistenceHook` ([packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts:48](packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts)) implements a _narrow_ `ExecutionTraceRecorder` interface (`afterSkill` + `onError`), deliberately **not** the full `SkillHook`, so it can never be dropped into the `hooks` array and trip governance `afterSkill` gates. It computes `costUsd` from model + token breakdown, links the business outcome (`deriveLinkedOutcome`), and creates one `SkillExecutionTrace` row. The `onError` leg accepts an optional `ExecutionTracePartial` so a turn that burned tokens before failing records its _real_ cost, not zero.

**How it's used at runtime.** The executor invokes it directly as a dedicated argument after every execution (success or error).

**Gotchas.** The "not a SkillHook" decision is intentional and security-relevant; if you ever refactor it into the hook array you reintroduce the bug it was built to avoid. Error traces still record burned tokens, do not assume a failed run is free.

---

### Parameter Builder Registry (Core Runtime)

**Concept.** Skills declare _what_ parameters they need; **builders** resolve runtime state (work unit, stores, contact) into concrete values. This keeps prompts data-source-agnostic.

**In Switchboard.** `BuilderRegistry` ([packages/core/src/skill-runtime/builder-registry.ts:45](packages/core/src/skill-runtime/builder-registry.ts)) maps `skillSlug -> RegisteredBuilder`. A builder may return bare params or a _rich_ result (`isRichBuilderResult`) carrying metadata like `injectedPatternIds` (outcome-informed context).

**How it's used at runtime.** `SkillMode` looks up the builder by `deployment.skillSlug` and calls it to populate parameters before the executor runs.

**Gotchas.** `register` throws on a duplicate slug, builders are singletons per skill. The rich-vs-bare return shape is a discriminated union; consumers must branch via `isRichBuilderResult`.

---

### Batch Skill Handler (Core Runtime)

**Concept.** Cron/bulk jobs differ from chat: there is no human in the loop _during_ execution, so the right pattern is "run once, then route each proposed write through governance, and **don't stop on the first denial**."

**In Switchboard.** `BatchSkillHandler.execute()` ([packages/core/src/skill-runtime/batch-skill-handler.ts:41](packages/core/src/skill-runtime/batch-skill-handler.ts)) runs `beforeSkill` hooks (circuit breaker / blast radius), builds params, resolves knowledge context, runs the skill, parses a structured `proposedWrites[]`, then iterates:

```ts
const decision = getToolGovernanceDecision(op, this.config.trustLevel);
if (decision === "auto-approve") {
  await op.execute(write.params);
  executedWrites++;
} else if (decision === "require-approval") {
  pendingApprovalWrites++; /* queued, continue */
} else {
  deniedWrites++;
}
```

It returns counts (`executedWrites`, `deniedWrites`, `pendingApprovalWrites`).

**How it's used at runtime / Gotchas.** Auto-approved writes execute _sequentially_ and **break on the first execution error** (to avoid compounding a broken state), but a _governance_ `require-approval` only increments a counter and continues. Distinguish "execution failed -> stop" from "needs approval -> queue and keep going." The cron actor must be a seeded `system` principal or the upstream governance gate hard-denies it silently.

---

### Skill Request Context & Governance Config Resolver (Core Runtime)

**Concept.** `SkillRequestContext` is the _trusted-identity envelope_ (`orgId`, `deploymentId`, `contactId`, `sessionId`, `delegationDepth`) threaded into tool factories, already covered as the injection defense. The **config resolver** is a tri-state load of per-deployment policy that fails _safe_.

**In Switchboard.** `createAgentDeploymentGovernanceResolver` ([packages/core/src/governance/governance-config-resolver.ts:32](packages/core/src/governance/governance-config-resolver.ts)) returns `{ status: "resolved" | "missing" | "error" }`. The contract is explicit: gates treat `missing` as "governance is off" and `error` as "apply a safe fallback." `delegationDepth` in the request context guards against infinite agent-delegates-to-agent recursion.

**Gotchas.** `missing` and `error` are _not_ the same; conflating them either over-blocks or silently disables policy. The resolver never throws, it returns `error` so the caller owns the fail-safe decision.

---

### Platform Ingress (Core Platform)

**Concept.** A **single mandatory entry point** for every mutating action. Funneling all writes through one `submit()` means idempotency, entitlement, governance, and audit are enforced in _one_ place, with no bypass paths.

**In Switchboard.** `PlatformIngress.submit()` ([packages/core/src/platform/platform-ingress.ts:93](packages/core/src/platform/platform-ingress.ts)) runs, in order: idempotency lookup -> entitlement -> resolve deployment -> `normalizeWorkUnit` -> governance gate -> branch on outcome. The branches:

```ts
if (decision.outcome === "deny")            { persistTrace(...); return { ok: true, result /* failed */ }; }
if (decision.outcome === "require_approval"){ persistTrace(...); createGatedLifecycle(...); /* park */ }
// else execute via the mode registry
```

The idempotency leg is sophisticated: a prior `running` trace (an unresolved _claim_) **fails closed** with `idempotency_in_flight` rather than risk a double-apply ([platform-ingress.ts:121](packages/core/src/platform/platform-ingress.ts)). When parking, it computes a `bindingHash` over `{parameters, decisionTraceHash, contextSnapshotHash}` and creates the lifecycle atomically ([platform-ingress.ts:325](packages/core/src/platform/platform-ingress.ts)).

**How it's used at runtime.** `POST /api/actions/propose` -> `submit()`. Inbound chat, dashboard mutations, and internal callers all converge here.

**Gotchas.** Idempotency runs _before_ entitlement deliberately: a replay of an already-authorized request returns the cached result even if the org later lost entitlement (the original mutation was already authorized). The `bindingHash` is the anti-race primitive: an operator approves a _specific revision_, and a changed payload invalidates the hash.

---

### Work Unit, Work Trace & Work Trace Store (Core Platform)

**Concept.** Separate the _request_ (`WorkUnit`, actor, intent, params, deployment, trust) from the _audit record_ (`WorkTrace`, governance outcome, approval state, execution result, tokens, cost, integrity hash). The trace is canonical persistence and lineage.

**In Switchboard.** `normalizeWorkUnit` ([packages/core/src/platform/work-unit.ts:30](packages/core/src/platform/work-unit.ts)) mints the `WorkUnit` with a cuid `id` and `traceId`. `WorkTraceStore` ([packages/core/src/platform/work-trace-recorder.ts:36](packages/core/src/platform/work-trace-recorder.ts)) is the persistence contract, and `claim()` is the concurrency lock:

```ts
// Atomically insert a `running` trace BEFORE the domain mutation. Returns
// { claimed: false } when (organizationId, idempotencyKey) already exists.
claim(trace: WorkTrace): Promise<WorkTraceClaimResult>;
```

Unlike `persist()`, `claim()` must **not** swallow the unique-violation, its return value _is_ the lock that gates the claim-first execute path.

**How it's used at runtime.** Ingress claims first (locking concurrent replays), executes, then updates the trace with the result. The approvals path later re-reads the trace via `getByWorkUnitId` to verify integrity _before_ dispatch.

**Gotchas.** `claim` vs `persist` have opposite P2002 semantics, claim surfaces it (lock), persist voids it (best-effort). `update` is version-checked and has a two-shape lock behavior elsewhere in the codebase (prod returns `{ok:false}`, non-prod throws). The `contentHash`/`traceVersion` fields make the trace tamper-evident.

---

### Approval Lifecycle Service, Respond-to-Parked-Lifecycle & Dispatch (Core Platform)

**Concept.** Human approval is modeled as **lifecycle state**, not a side effect of an HTTP route. A parked work unit has an `ApprovalLifecycle` row that transitions `pending -> approved -> executing -> completed`, or `-> rejected`, or `approved -> recovery_required` if dispatch fails. This makes approval resumable, retryable, and auditable.

**In Switchboard.** `respondToParkedLifecycle` ([packages/core/src/approval/respond-to-parked-lifecycle.ts:100](packages/core/src/approval/respond-to-parked-lifecycle.ts)) retrieves the lifecycle, rejects stale/expired/already-responded states, validates the `bindingHash`, blocks self-approval (`assertNotSelfApproval`), then on approve writes the frozen payload to the trace and calls `runDispatch`:

```ts
if (lifecycle.status === "recovery_required") return retryDispatch(...); // re-approve to retry
if (lifecycle.status !== "pending") throw new ParkedLifecycleAlreadyRespondedError(...);
if (lifecycle.expiresAt <= new Date()) { await expireLifecycle(...); throw ParkedLifecycleExpiredError; }
```

Dispatch (`lifecycle-dispatch.ts`) uses an idempotency key shaped `lifecycle-dispatch:<id>:<revision>:attempt-<n>` so each retry is traceable, and transitions to `recovery_required` on failure.

**How it's used at runtime.** Operator clicks Approve -> `POST /api/approvals/:id/respond` -> `respondToParkedLifecycle` -> approve transitions state, writes the approved payload to the WorkTrace, and **dispatches inline**. Reject is terminal. A dispatch failure parks for retry (the operator sees a Retry card).

**Gotchas.** The trace is the _payload authority_: the approved frozen parameters are written to the WorkTrace _before_ dispatch, and the dispatcher reads from the trace, not from the original request. Re-approving a `recovery_required` lifecycle is the retry mechanism, there is no separate retry endpoint.

---

### Skill Mode & Execution Service (Core Platform Execution)

**Concept.** An **execution mode** is a strategy: ingress decides _whether_ to run; the mode decides _how_. `ExecutionService` is a thin facade for "propose, then execute if no approval needed."

**In Switchboard.** `SkillMode.execute()` ([packages/core/src/platform/modes/skill-mode.ts:32](packages/core/src/platform/modes/skill-mode.ts)) resolves the slug, fetches the `SkillDefinition`, resolves parameters via the builder, merges resolved knowledge context (resolved context wins on key collision, an intentional precedence), then picks the executor:

```ts
const executor = this.config.executorBySlug?.get(slug) ?? this.config.executor;
```

That `executorBySlug` override is how "mira" runs on a **zero-hook** executor for internal compose, so Alex's conversation gates never fire on an internal brief. `ExecutionService.execute()` ([packages/core/src/execution-service.ts:15](packages/core/src/execution-service.ts)) returns `DENIED` / `PENDING_APPROVAL` / `EXECUTED` based on the orchestrator result discriminant.

**Gotchas.** `delegationDepth` is read from server-set work-unit params (`__delegationDepth`), never from LLM tool input, the `delegate` tool sets the child's depth itself. The slug lookup for the skill uses a legacy fallback while the _builder_ lookup uses `deployment.skillSlug` only; that divergence is deliberate so a legacy intent-prefix slug falls back to the default executor.

---

### Execution APIs: /api/actions, /api/approvals, and the dashboard proxies

**Concept.** Thin HTTP handlers over a rich domain core. The API does surface work (auth, org isolation, structured error mapping); all real logic lives in `packages/core`.

**In Switchboard.** `POST /api/actions/propose` ([apps/api/src/routes/actions.ts:1](apps/api/src/routes/actions.ts)) requires an `Idempotency-Key` header, enforces a per-skin tool filter, and calls `submit()`. `POST /api/approvals/:id/respond` ([apps/api/src/routes/approvals.ts:1](apps/api/src/routes/approvals.ts)) maps the lifecycle errors to precise status codes: a DB outage on lookup returns a **503 with a `code`**, never a code-less 400; missing `bindingHash` on approve is a 400; `assertOrgAccess` enforces tenancy. The dashboard never talks to Postgres for this, it proxies: `apps/dashboard/.../api/dashboard/approvals/route.ts` ([apps/dashboard/src/app/api/dashboard/approvals/route.ts:20](apps/dashboard/src/app/api/dashboard/approvals/route.ts)) extracts `approvalId` and forwards via an authenticated `SwitchboardClient`. The React hook `useWorkflowApprovalAction` ([apps/dashboard/src/hooks/use-workflow-approval-action.ts:27](apps/dashboard/src/hooks/use-workflow-approval-action.ts)) branches on structured codes:

```ts
if (body.code === "already_responded" || body.code === "expired") return { silent: true, body };
if (body.code === "stale_binding") {
  invalidate();
  return { staleBinding: true, body };
}
```

**How it's used at runtime.** Inbound message -> `/api/actions/propose` -> ingress -> gate. If parked, the dashboard Inbox lists it via `/api/dashboard/approvals` (GET), the operator approves, and the same hook POSTs back with the `bindingHash` it received, which the API hands to `respondToParkedLifecycle` for inline dispatch.

**Gotchas.** `respondedBy` is _never_ sent from the client, the API derives it from the authenticated principal (anti-spoofing). `already_responded`/`expired` are treated as **silent success** because a refetch will reconcile; only unexpected codes throw. The binding hash round-trips through the UI specifically to make approval atomic against a concurrent payload change.

---

### Persistence: Credential Encryption & stores

**Concept.** Secrets at rest must be encrypted with an authenticated cipher and a per-record salt, so a DB dump alone is useless.

**In Switchboard.** `encryptCredentials` ([packages/db/src/crypto/credentials.ts:23](packages/db/src/crypto/credentials.ts)) uses AES-256-GCM with a scrypt-derived key, random per-record salt and IV, and packs `salt(32) + iv(16) + authTag(16) + ciphertext` as base64. `decryptCredentials` reverses it; GCM's `authTag` makes tampering detectable. `isEncrypted` checks the packed-length invariant to avoid double-encrypting.

**How it's used at runtime.** The dashboard encrypts a user's API key before storing it; `getApiClient` decrypts on read to build the `SwitchboardClient`'s `Authorization` header. The `CREDENTIALS_ENCRYPTION_KEY` must be identical across api/chat/dashboard, or cross-service decryption fails.

**Gotchas.** The salt is stored _with_ the ciphertext (it must be, to re-derive the key), that is correct, not a leak; salt is not secret, the master key is. A scrypt derivation per encrypt/decrypt is intentionally slow; do not call it in a hot loop.

---

### What to study next

1. **Two enforcement regimes.** Governance is enforced in _two_ places with different shapes: the skill-runtime `GovernanceHook` (per tool call, effect-category matrix) and the platform `GovernanceGate` (per work unit, before any execution). Trace one denial through both to understand which fires when.
2. **Producer-population is the recurring trap.** Many gates are inert until a producer sets the data (trust level, approval threshold, governance config). A flag or table that is "wired" still does nothing until something populates it. When a control "should block but doesn't," suspect an unpopulated producer before suspecting the gate.
