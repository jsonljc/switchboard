/* eslint-disable max-lines */
// Legacy-debt marker (arch-check honors this to downgrade the >600 error to a
// warn). The T2.3 per-call abort/deadline machinery (callAdapterWithDeadline +
// AbortError normalization) tipped this already-consolidated executor — LLM loop,
// governance, budget/cache accounting, qualification sidecar, intent parsing, and
// the isolated trace recorder — just over 600 lines. The per-call invocation is
// already extracted into a helper; the remaining headroom needs a structural split
// (e.g. lift parseIntentTag to its own module), tracked as separate cleanup rather
// than folded into a timeout/abort change.
import type {
  SkillExecutionParams,
  SkillExecutionResult,
  SkillExecutor,
  ToolCallRecord,
  SkillTool,
  SkillToolFactory,
  SkillHook,
  SkillHookContext,
  ResolvedModelProfile,
  SkillRuntimePolicy,
  SkillRequestContext,
} from "./types.js";
import { SkillExecutionBudgetError, DEFAULT_SKILL_RUNTIME_POLICY } from "./types.js";
import type { GovernanceLogEntry } from "./governance.js";
import { interpolate } from "./template-engine.js";
import { getGovernanceConstraints } from "./governance-injector.js";
import { composeSkillRequestContext } from "./skill-request-context.js";
import { denied, pendingApproval, fail, ok } from "./tool-result.js";
import type { ToolResult } from "./tool-result.js";
import { filterForReinjection, DEFAULT_REINJECTION_POLICY } from "./reinjection-filter.js";
import type { SkillToolOperation } from "./types.js";
import { validateToolInput, redactInputForLog } from "./input-schema-validator.js";
import type {
  LLMTextBlock,
  LLMToolUseBlock,
  LLMMessage,
  LLMToolDefinition,
  LLMToolResultBlock,
  LLMResponse,
  ToolCallingLLMAdapter,
} from "./llm-types.js";
import type { ModelRouter, DialogueStage } from "../model-router.js";
import { buildTierContext } from "./skill-tier-context-builder.js";
import { classifyEmotionalSignal } from "../dialogue/emotional-classifier.js";
import { emotionalSignalToStage } from "../dialogue/dialogue-stage.js";
import { GovernanceHook } from "./hooks/governance-hook.js";
import {
  runBeforeLlmCallHooks,
  runAfterLlmCallHooks,
  runBeforeToolCallHooks,
  runAfterToolCallHooks,
  runAfterSkillHooks,
} from "./hook-runner.js";
import { IntentClassSchema, type IntentClass } from "@switchboard/schemas";
import { parseQualificationSidecar } from "./qualification-sidecar-parser.js";
import type { QualificationEvaluationHook } from "../conversation-lifecycle/event-hooks/qualification-evaluation-hook.js";
import type {
  ExecutionTraceRecorder,
  ExecutionTracePartial,
} from "./hooks/trace-persistence-hook.js";

// Global match — captures every <intent>...</intent> occurrence in the response.
// Whitespace around the inner value is allowed; the tag itself must be closed.
const INTENT_TAG_GLOBAL_RE = /<intent>\s*([a-z-]+)\s*<\/intent>/gi;

/**
 * Parse + strip `<intent>...</intent>` tags from an LLM response.
 *
 * Rules:
 *   - 0 valid tags                  → text trimmed, intentClass = null
 *   - 1 valid trailing tag          → strip the tag, intentClass = parsed value
 *   - 1 unknown-value tag           → strip the tag, intentClass = null
 *   - 2+ tags (any validity mix)    → strip ALL tags, intentClass = null
 *   - malformed (unclosed) tag      → left in place, intentClass = null
 *                                     (treated as if no tag matched)
 *
 * Strip + null on ambiguous input prevents the LLM's hidden / internal-looking text
 * from leaking to the customer and also prevents misclassification when the model
 * accidentally emits two intents.
 */
export function parseIntentTag(text: string): { text: string; intentClass: IntentClass | null } {
  const matches = Array.from(text.matchAll(INTENT_TAG_GLOBAL_RE));
  if (matches.length === 0) {
    return { text: text.trim(), intentClass: null };
  }

  const strippedText = text.replace(INTENT_TAG_GLOBAL_RE, "").replace(/\s+/g, " ").trim();

  if (matches.length > 1) {
    return { text: strippedText, intentClass: null };
  }

  const parsed = IntentClassSchema.safeParse(matches[0]?.[1]);
  return {
    text: strippedText,
    intentClass: parsed.success ? parsed.data : null,
  };
}

const FALLBACK_READ_OP: SkillToolOperation = {
  description: "",
  inputSchema: {},
  effectCategory: "read",
  execute: async () => ok(),
};

// Generic name check (NOT an SDK-type import — core must not depend on the
// Anthropic SDK). Covers the race where the SDK's own per-request `timeout`
// rejects a hair before the executor's same-deadline `abort()` fires: the SDK
// timeout error (e.g. `APIConnectionTimeoutError`) must still normalize to the
// budget error rather than leak as a generic failure.
function isTimeoutLikeError(err: unknown): boolean {
  return err instanceof Error && /timeout|abort/i.test(err.name);
}

// Escape sentinel-confusable substrings so tool output can't close the wrapper
// early. Replaces the ASCII angle brackets in `<|` / `|>` with Unicode
// mathematical angle brackets (U+27E8/U+27E9) — distinct glyphs to the model.
function escapeSentinel(value: string): string {
  return value.replaceAll("<|", "⟨|").replaceAll("|>", "|⟩");
}

/**
 * Coarse, key-order-sensitive grouping fingerprint of the invocation's input
 * parameters (djb2 over JSON.stringify), stamped onto the execution trace for
 * telemetry grouping. NOT a uniqueness key — the trace id is a cuid; this only
 * buckets like-shaped invocations and is not a security primitive. Returns up to
 * 8 lowercase hex chars (`(h >>> 0).toString(16)` is not zero-padded, so shorter
 * for small hash values).
 */
function stableParamsHash(parameters: unknown): string {
  const s = JSON.stringify(parameters ?? {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export class SkillExecutorImpl implements SkillExecutor {
  constructor(
    private adapter: ToolCallingLLMAdapter,
    private tools: Map<string, SkillTool>,
    private router?: ModelRouter,
    private hooks: SkillHook[] = [],
    private policy: SkillRuntimePolicy = DEFAULT_SKILL_RUNTIME_POLICY,
    /**
     * Per-request tool factories. When a tool id is present here, the executor
     * materializes a fresh `SkillTool` for each `execute()` call with a trusted
     * `SkillRequestContext` closed in. This is the canonical path; the
     * `tools` map is retained for schema-only registration (`buildToolDefinitions`)
     * and for tools with no per-request trust context.
     */
    private toolFactories: Map<string, SkillToolFactory> = new Map(),
    /**
     * Phase 3b: optional qualification evaluation hook. When provided, the
     * executor fires `onSidecarEmitted` after the parser yields a validated
     * qualification payload. Hook failures are log-and-swallow — must not
     * break the response path. When omitted the executor skips the hook call.
     */
    private qualificationEvaluationHook?: QualificationEvaluationHook,
    /**
     * Optional execution-trace recorder, invoked at the success-return and on a
     * thrown turn. Mirrors `qualificationEvaluationHook`: a SEPARATE arg (not in
     * the `hooks` array) so it cannot activate the governance afterSkill gates.
     * Invoked FIRE-AND-FORGET (not awaited) on both paths so a slow trace write
     * never delays the lead-visible response; failures are log-and-swallow.
     */
    private executionTraceHook?: ExecutionTraceRecorder,
  ) {}

  /**
   * Materialize the per-request tool map. Factories override schema-only
   * registrations on the same id. The returned map is what tool execution
   * dispatches against — never `this.tools` directly.
   */
  private materializeRuntimeTools(ctx: SkillRequestContext): Map<string, SkillTool> {
    const runtime = new Map<string, SkillTool>(this.tools);
    for (const [id, factory] of this.toolFactories.entries()) {
      runtime.set(id, factory(ctx));
    }
    return runtime;
  }

  private buildRequestContext(params: SkillExecutionParams): SkillRequestContext {
    return composeSkillRequestContext(params);
  }

  private resolveProfile(
    params: SkillExecutionParams,
    turnCount: number,
    conversationDepth: number,
    toolCallRecords: ToolCallRecord[],
    currentStage: DialogueStage | undefined,
    governanceHook?: GovernanceHook,
  ): ResolvedModelProfile | undefined {
    if (!this.router) return undefined;

    const logs: GovernanceLogEntry[] = governanceHook?.getGovernanceLogs() ?? [];
    const tierCtx = buildTierContext({
      conversationDepth,
      declaredToolIds: params.skill.tools,
      tools: this.tools,
      previousTurnHadToolUse: turnCount > 1 && toolCallRecords.length > 0,
      previousTurnEscalated: logs.some(
        (log) => log.decision === "require-approval" || log.decision === "deny",
      ),
      minimumModelTier: params.skill.minimumModelTier,
      currentStage,
    });
    const slot = this.router.resolveTier(tierCtx);
    const modelConfig = this.router.resolve(slot);
    return {
      model: modelConfig.modelId,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
      timeoutMs: modelConfig.timeoutMs,
    };
  }

  /**
   * Derive the coarse dialogue stage from the latest user message using the
   * LLM-free emotional classifier (pure/sync regex). Defensive: returns
   * `undefined` when there is no user message or its text is empty, so tiering
   * silently falls back to the previous-turn rules. Called once per `execute()`
   * (guarded by `this.router`), since the stage is a property of the customer's
   * current message and is constant across the internal tool-loop turns.
   */
  private deriveCurrentStage(
    messages: SkillExecutionParams["messages"],
  ): DialogueStage | undefined {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.content.trim();
    if (!text) return undefined;
    return emotionalSignalToStage(classifyEmotionalSignal({ message: text }));
  }

  // One LLM call bounded by `perCallMs`. On deadline it `controller.abort()`s
  // (CANCELS the in-flight request — stops the token-burn leak) AND rejects as a
  // race BACKSTOP so an adapter ignoring the signal still unblocks `execute()`. A
  // cooperative adapter's resulting AbortError is normalized to the budget error
  // (spec §4.3.2). Extracted from `execute()` to stay under the 600-line
  // arch-check and to lower `execute()`'s cyclomatic complexity.
  private async callAdapterWithDeadline(
    // The adapter call shape minus `signal` (owned here by the deadline controller).
    callParams: Omit<Parameters<ToolCallingLLMAdapter["chatWithTools"]>[0], "signal">,
    perCallMs: number,
  ): Promise<LLMResponse> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const overDeadline = new SkillExecutionBudgetError(
      `Exceeded ${Math.round(perCallMs / 1000)}s per-call limit`,
    );
    try {
      return await Promise.race([
        this.adapter.chatWithTools({ ...callParams, signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort(); // cancel the in-flight request, then back-stop the race
            reject(overDeadline);
          }, perCallMs);
        }),
      ]);
    } catch (err) {
      // Surface the budget error when EITHER (a) we aborted — even if the adapter's
      // AbortError (or a downstream rejection) won the race over the backstop
      // reject — or (b) the error is timeout-like by name, covering the race where
      // the SDK's own per-request timeout rejects a hair before our abort() fires.
      if (controller.signal.aborted || isTimeoutLikeError(err)) throw overDeadline;
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async execute(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const governanceHook = this.hooks.find((h): h is GovernanceHook => h.name === "governance") as
      | GovernanceHook
      | undefined;

    const interpolated = interpolate(params.skill.body, params.parameters, params.skill.parameters);

    const system = `${interpolated}\n\n${getGovernanceConstraints()}`;

    const toolDefinitions = this.buildToolDefinitions(params.skill.tools);

    // Materialize per-request tools with trusted SkillRequestContext closed in.
    // Tool factories produce a fresh SkillTool per execution so trust-bound
    // identifiers (orgId, deploymentId, sessionId) cannot be supplied by the LLM.
    const requestCtx = this.buildRequestContext(params);
    const runtimeTools = this.materializeRuntimeTools(requestCtx);

    // Hook context shared by the afterSkill governance gates (run via runAfterSkillHooks
    // at the success-return seam) and the isolated execution-trace recorder (a separate
    // arg, invoked directly at the success-return / on a thrown turn — not via the runner).
    const hookCtx: SkillHookContext = {
      deploymentId: params.deploymentId,
      orgId: params.orgId,
      skillSlug: params.skill.slug,
      skillVersion: params.skill.version,
      sessionId: requestCtx.sessionId,
      trustLevel: params.trustLevel,
      trustScore: params.trustScore,
      inputParametersHash: stableParamsHash(params.parameters),
    };

    const messages: LLMMessage[] = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const toolCallRecords: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let lastModel: string | undefined;
    let turnCount = 0;
    const startTime = Date.now();

    // The dialogue stage is a property of the customer's latest message, which is
    // constant across this execution's internal tool-loop turns — derive it once.
    // Guarded by `this.router` so there is zero overhead when routing is disabled.
    const currentStage = this.router ? this.deriveCurrentStage(params.messages) : undefined;

    // Conversation depth ≈ how deep the back-and-forth is. Derived ONCE from the
    // immutable inbound transcript (NEVER the executor-local `messages` array,
    // which grows during the tool loop and would re-contaminate the tier). Feeds
    // resolveProfile, which short-circuits when the router is off — so this is
    // unused (and harmless) on the router-OFF path.
    const conversationDepth = params.messages.length;

    try {
      while (turnCount < this.policy.maxLlmTurns) {
        turnCount++;

        const profile = this.resolveProfile(
          params,
          turnCount,
          conversationDepth,
          toolCallRecords,
          currentStage,
          governanceHook,
        );

        const llmCtx = {
          turnCount,
          totalInputTokens,
          totalOutputTokens,
          elapsedMs: Date.now() - startTime,
          profile,
        };
        const hookResult = await runBeforeLlmCallHooks(this.hooks, llmCtx);
        if (!hookResult.proceed) {
          throw new SkillExecutionBudgetError(hookResult.reason ?? "Aborted by hook");
        }
        const resolvedCtx = hookResult.ctx ?? llmCtx;

        // Guard the whole-conversation budget before starting the call (time may
        // have expired in the hook or a prior long tool turn); callAdapterWithDeadline
        // bounds the call itself. Per-call deadline = min(model timeout when router
        // ON, policy per-call ceiling), clamped to the remaining budget; router OFF →
        // `profile` undefined → maxLlmCallMs (the abort still applies — intended).
        const remainingMs = this.policy.maxRuntimeMs - (Date.now() - startTime);
        if (remainingMs <= 0) {
          throw new SkillExecutionBudgetError(`Exceeded ${this.policy.maxRuntimeMs / 1000}s limit`);
        }
        const perCallMs = Math.min(profile?.timeoutMs ?? this.policy.maxLlmCallMs, remainingMs);
        const response = await this.callAdapterWithDeadline(
          { system, messages, tools: toolDefinitions, profile },
          perCallMs,
        );

        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
        totalCacheReadTokens += response.usage.cacheReadTokens ?? 0;
        totalCacheCreationTokens += response.usage.cacheCreationTokens ?? 0;
        if (response.model) lastModel = response.model;

        // Hard budget gates on full-price (uncached) tokens only. Anthropic reports
        // cache reads/creations separately from input_tokens, so a large cached prefix
        // re-read every turn is near-free and must NOT exhaust the token budget.
        const billableTokens = totalInputTokens + totalOutputTokens;
        if (billableTokens > this.policy.maxTotalTokens) {
          throw new SkillExecutionBudgetError(
            `Exceeded token budget (${billableTokens} > ${this.policy.maxTotalTokens})`,
          );
        }

        await runAfterLlmCallHooks(this.hooks, resolvedCtx, {
          content: response.content,
          stopReason: response.stopReason,
          usage: response.usage,
        });

        if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
          const rawResponseText = response.content
            .filter((b): b is LLMTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");

          // Phase 3b: parse + strip qualification sidecar. Always-on — no flag check.
          // visibleResponse replaces rawResponseText for ALL downstream consumers.
          const sidecar = parseQualificationSidecar(rawResponseText);
          const visibleResponse = sidecar.visibleResponse;

          // Phase 3b: fire qualification evaluation hook when a valid sidecar is present.
          // Hook failures are log-and-swallow — must not interrupt the response path.
          if (
            this.qualificationEvaluationHook !== undefined &&
            sidecar.persisted?.validationStatus === "ok"
          ) {
            this.qualificationEvaluationHook
              .onSidecarEmitted({
                organizationId: params.orgId,
                conversationThreadId: requestCtx.sessionId,
                signals: sidecar.persisted.payload,
                // TODO(3c): plumb the real WorkTrace.id here. The WorkTrace row is
                // persisted by PlatformIngress after execute() returns, so its id is
                // not available inside the executor. Passing null is better than
                // passing sessionId (which is a chat session identifier, not a trace row id).
                workTraceId: null,
              })
              .catch((err: unknown) => {
                console.warn(
                  "[SkillExecutor] qualification-evaluation-hook failed (swallowed):",
                  err instanceof Error ? err.message : String(err),
                );
              });
          }

          const { text: responseText, intentClass } = parseIntentTag(visibleResponse);

          const result: SkillExecutionResult = {
            response: responseText,
            toolCalls: toolCallRecords,
            tokenUsage: {
              input: totalInputTokens,
              output: totalOutputTokens,
              cacheRead: totalCacheReadTokens,
              cacheCreation: totalCacheCreationTokens,
            },
            trace: {
              durationMs: Date.now() - startTime,
              turnCount,
              status: "success" as const,
              responseSummary: responseText.slice(0, 500),
              writeCount: toolCallRecords.filter((tc) => {
                const tool = runtimeTools.get(tc.toolId);
                const opDef = tool?.operations[tc.operation];
                return (
                  opDef?.effectCategory === "write" ||
                  opDef?.effectCategory === "external_send" ||
                  opDef?.effectCategory === "external_mutation"
                );
              }).length,
              governanceDecisions: governanceHook?.getGovernanceLogs() ?? [],
              qualificationSignals: sidecar.persisted,
              ...(lastModel ? { model: lastModel } : {}),
            },
            ...(intentClass ? { intentClass } : {}),
            ...(sidecar.persisted?.validationStatus === "ok"
              ? { qualificationSignals: sidecar.persisted.payload }
              : {}),
          };

          // Governance afterSkill gates (banned-phrase / claim / PDPA / WhatsApp-window).
          // Wired here — AFTER result assembly, BEFORE the isolated trace recorder — so any
          // in-place result.response mutation (enforce-mode block/rewrite/handoff) is reflected
          // in the returned reply AND every downstream trace consumer, preserving the
          // "trace never sees pre-block unsafe text" invariant the bootstrap relies on.
          //
          // FAIL-CLOSED: this is deliberately NOT wrapped in a swallowing try/catch. An
          // unexpected gate throw propagates to the turn's error path (the catch below re-throws
          // the original error), so skill-mode emits the neutral fallback and the lead NEVER
          // receives ungated text. Swallowing here could leak pre-block text if a gate threw
          // mid-decision in enforce mode. The gates already fail CLOSED internally (posture cache)
          // for the resolver-unavailable case, so an escaping throw is a genuine logic bug and
          // failing the turn is the safe response. With no governanceConfig seeded today every
          // gate early-returns → inert in prod (byte-identical).
          await runAfterSkillHooks(this.hooks, hookCtx, result);

          // Keep the canonical WorkTrace summary consistent with any in-place gate mutation:
          // skill-mode persists result.trace.responseSummary (stamped pre-gate above), so a
          // blocked/rewritten turn must refresh it or the canonical trace records pre-block text.
          // No-op when no gate mutated (it already equals result.response.slice(0, 500)).
          result.trace.responseSummary = result.response.slice(0, 500);

          // Isolated telemetry recorder — a SEPARATE arg (not in the `hooks` array), invoked
          // directly AFTER the governance gates above so it records the post-gate result.
          // FIRE-AND-FORGET: NOT awaited, so a slow ExecutionTrace DB write never delays the
          // lead-visible response. Log-and-swallow on the floating promise; apps/api is a
          // long-running Fastify server, so it settles safely after we return.
          if (this.executionTraceHook?.afterSkill) {
            void this.executionTraceHook.afterSkill(hookCtx, result).catch((e: unknown) => {
              console.warn(
                "[SkillExecutor] trace hook afterSkill failed (swallowed):",
                e instanceof Error ? e.message : String(e),
              );
            });
          }

          return result;
        }

        const toolUseBlocks = response.content.filter(
          (b): b is LLMToolUseBlock => b.type === "tool_use",
        );

        messages.push({ role: "assistant", content: response.content });

        const toolResults: LLMToolResultBlock[] = [];

        for (const toolUse of toolUseBlocks) {
          if (toolCallRecords.length >= this.policy.maxToolCalls) {
            throw new SkillExecutionBudgetError(
              `Exceeded maximum tool calls (${this.policy.maxToolCalls})`,
            );
          }

          console.warn(
            `[SkillExecutor] tool_call: ${toolUse.name} args=${JSON.stringify(toolUse.input).slice(0, 200)}`,
          );

          const start = Date.now();
          const [toolId, ...opParts] = toolUse.name.split(".");
          const operation = opParts.join(".");
          const tool = runtimeTools.get(toolId!);
          const op = tool?.operations[operation];

          const toolCtx = {
            toolId: toolId!,
            operation,
            params: toolUse.input,
            effectCategory: op?.effectCategory ?? ("read" as const),
            trustLevel: params.trustLevel,
          };
          const toolHookResult = await runBeforeToolCallHooks(this.hooks, toolCtx);

          let result: ToolResult;
          let governanceOutcome: string;

          if (!toolHookResult.proceed) {
            if (toolHookResult.substituteResult) {
              if (toolHookResult.decision) {
                throw new Error(
                  `Hook invariant violated: substituteResult and decision are mutually exclusive (got decision=${toolHookResult.decision})`,
                );
              }
              result = toolHookResult.substituteResult;
              governanceOutcome = "simulated";
            } else if (toolHookResult.decision === "pending_approval") {
              result = pendingApproval(
                toolHookResult.reason ?? "Requires approval",
                toolHookResult.payload,
              );
              governanceOutcome = "require-approval";
            } else {
              result = denied(toolHookResult.reason ?? "Denied by policy");
              governanceOutcome = "denied";
            }
          } else if (op) {
            // Defense-in-depth: validate LLM-supplied input against the tool's
            // declared inputSchema BEFORE invoking execute(). If validation fails
            // we surface a structured INVALID_TOOL_INPUT result and skip the
            // tool. The factory-with-context pattern is the primary safeguard;
            // this guard catches accidental schema drift / leftover fields.
            const validation = validateToolInput(op.inputSchema, toolUse.input);
            if (!validation.ok) {
              console.warn(
                `[SkillExecutor] tool_input_invalid: ${toolUse.name} issues=${validation.issues
                  .join("; ")
                  .slice(0, 200)} redacted=${redactInputForLog(toolUse.input)}`,
              );
              result = fail(
                "execution",
                "INVALID_TOOL_INPUT",
                `Tool input did not match declared schema: ${validation.issues.join("; ")}`,
                {
                  modelRemediation:
                    "Re-issue the tool call with input matching the declared inputSchema. Do not include trust-bound identifiers (orgId, deploymentId, contactId) — those are injected by the runtime.",
                  retryable: false,
                },
              );
              governanceOutcome = "auto-approved";
            } else {
              result = await op.execute(toolUse.input);
              governanceOutcome = "auto-approved";
            }
          } else {
            const availableTools = params.skill.tools
              .flatMap((tid) => {
                const t = runtimeTools.get(tid);
                return t ? Object.keys(t.operations).map((opN) => `${tid}.${opN}`) : [];
              })
              .join(", ");
            result = fail("execution", "TOOL_NOT_FOUND", `Unknown tool: ${toolUse.name}`, {
              modelRemediation: `Available tools for this skill: ${availableTools}`,
              retryable: false,
            });
            governanceOutcome = "auto-approved";
          }

          await runAfterToolCallHooks(this.hooks, toolCtx, result);

          toolCallRecords.push({
            toolId: toolId!,
            operation,
            params: toolUse.input,
            result,
            durationMs: Date.now() - start,
            governanceDecision: governanceOutcome as ToolCallRecord["governanceDecision"],
          });

          const decision = filterForReinjection(
            result,
            op ?? FALLBACK_READ_OP,
            DEFAULT_REINJECTION_POLICY,
          );
          // Defense-in-depth: wrap re-injected tool output in sentinels so the
          // model treats untrusted tool content as data, not instructions.
          // Escape sentinel-confusable substrings inside the payload so
          // attacker-controlled tool content can't close the wrapper early.
          const wrappedContent = `<|tool-output|>\n${escapeSentinel(decision.content)}\n<|/tool-output|>`;
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: wrappedContent,
          });
        }

        messages.push({ role: "user", content: toolResults });
      }

      throw new SkillExecutionBudgetError(
        `Exceeded maximum LLM turns (${this.policy.maxLlmTurns})`,
      );
    } catch (err) {
      // Isolated telemetry recorder for the error path — FIRE-AND-FORGET (NOT
      // awaited), then re-throw the ORIGINAL error immediately so a slow trace write
      // never delays surfacing the failure. This is the SEPARATE trace-recorder arg
      // (invoked directly, not via runAfterSkillHooks) — a throwing afterSkill gate
      // reaches this catch and re-throws, so skill-mode emits the neutral fallback.
      // The partial threads the burned tokens/latency so a budget-busting turn is
      // recorded with real cost, not a zero fallback.
      if (this.executionTraceHook?.onError) {
        const partial: ExecutionTracePartial = {
          tokenUsage: {
            input: totalInputTokens,
            output: totalOutputTokens,
            cacheRead: totalCacheReadTokens,
            cacheCreation: totalCacheCreationTokens,
          },
          durationMs: Date.now() - startTime,
          turnCount,
          ...(lastModel ? { model: lastModel } : {}),
        };
        void this.executionTraceHook
          .onError(hookCtx, err instanceof Error ? err : new Error(String(err)), partial)
          .catch((e: unknown) => {
            console.warn(
              "[SkillExecutor] trace hook onError failed (swallowed):",
              e instanceof Error ? e.message : String(e),
            );
          });
      }
      throw err;
    }
  }

  private buildToolDefinitions(toolIds: string[]): LLMToolDefinition[] {
    const result: LLMToolDefinition[] = [];
    for (const toolId of toolIds) {
      const tool = this.tools.get(toolId);
      if (!tool) continue;
      for (const [opName, op] of Object.entries(tool.operations)) {
        result.push({
          name: `${toolId}.${opName}`,
          description: op.description,
          input_schema: op.inputSchema,
        });
      }
    }
    return result;
  }
}
