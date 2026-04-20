import type { ModelRouter, ModelSlot, ModelConfig, ResolveOptions } from "./model-router.js";
import type { ContextBudget, ContextBudgetLimits } from "./context-budget.js";
import { DEFAULT_CONTEXT_BUDGET_LIMITS } from "./context-budget.js";
import { ContextAssembler } from "./context-assembler.js";

export interface LlmCallResult {
  reply: string;
  confidence: number;
}

export type LlmCallFn = (
  modelConfig: ModelConfig,
  input: Record<string, unknown>,
) => Promise<LlmCallResult>;

export interface UsageInfo {
  orgId: string;
  model: string;
  taskType: string;
  durationMs: number;
  error?: string;
}

export interface LlmCallWrapperConfig {
  router: ModelRouter;
  callFn: LlmCallFn;
  /** Assembler used to build the prompt from a ContextBudget. Defaults to `new ContextAssembler()` if not provided. */
  assembler?: ContextAssembler;
  maxRetries?: number;
  failSafe?: LlmCallResult;
  onUsage?: (info: UsageInfo) => void;
}

export interface CallOptions extends ResolveOptions {
  /**
   * Raw prompt string. Used as-is when `budget` is not provided.
   * Ignored when `budget` is present — pass `""` as a conventional placeholder.
   */
  prompt: string;
  /** When provided, the prompt is assembled via ContextAssembler from these budget layers. */
  budget?: ContextBudget;
  limits?: ContextBudgetLimits;
  orgId?: string;
  taskType?: string;
  [key: string]: unknown;
}

export class LlmCallWrapper {
  private router: ModelRouter;
  private callFn: LlmCallFn;
  private readonly assembler: ContextAssembler;
  private maxRetries: number;
  private failSafe?: LlmCallResult;
  private onUsage?: (info: UsageInfo) => void;

  constructor(config: LlmCallWrapperConfig) {
    this.router = config.router;
    this.callFn = config.callFn;
    this.assembler = config.assembler ?? new ContextAssembler();
    this.maxRetries = config.maxRetries ?? 1;
    this.failSafe = config.failSafe;
    this.onUsage = config.onUsage;
  }

  async call(slot: ModelSlot, options: CallOptions): Promise<LlmCallResult> {
    const modelConfig = this.router.resolve(slot, options);
    const start = Date.now();

    // Resolve prompt from budget if provided
    const resolvedPrompt = options.budget
      ? this.assembler.assemble(options.budget, options.limits ?? DEFAULT_CONTEXT_BUDGET_LIMITS)
      : options.prompt;
    const resolvedOptions = { ...options, prompt: resolvedPrompt };

    // Try primary model with retries
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.callWithTimeout(modelConfig, resolvedOptions);
        this.reportUsage(options, modelConfig, start);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // Try fallback slot if available
    if (modelConfig.fallbackSlot) {
      const fallbackConfig = this.router.resolve(modelConfig.fallbackSlot, options);
      try {
        const result = await this.callWithTimeout(fallbackConfig, resolvedOptions);
        this.reportUsage(options, fallbackConfig, start);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // Return fail-safe or throw
    this.reportUsage(options, modelConfig, start, lastError?.message);

    if (this.failSafe) {
      return this.failSafe;
    }

    throw lastError ?? new Error("LLM call failed");
  }

  private async callWithTimeout(
    config: ModelConfig,
    input: Record<string, unknown>,
  ): Promise<LlmCallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      return await this.callFn(config, { ...input, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private reportUsage(
    options: CallOptions,
    config: ModelConfig,
    startMs: number,
    error?: string,
  ): void {
    if (!this.onUsage) return;
    try {
      this.onUsage({
        orgId: options.orgId ?? options.budget?.orgId ?? "unknown",
        model: config.modelId,
        taskType: options.taskType ?? options.budget?.taskType ?? "unknown",
        durationMs: Date.now() - startMs,
        error,
      });
    } catch {
      // usage reporting must never block
    }
  }
}
