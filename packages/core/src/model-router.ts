import type { Effort } from "./context-budget.js";

export type ModelSlot = "default" | "premium" | "critical" | "embedding";

/**
 * Coarse dialogue stage for the current turn, derived from the LLM-free
 * emotional classifier. Consumed by `resolveTier` to raise the model tier on
 * high-stakes moments. Absence means "no escalating signal — let the
 * previous-turn rules decide".
 */
export type DialogueStage = "objection" | "closing" | "fear";

export interface ModelConfig {
  slot: ModelSlot;
  modelId: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  fallbackSlot?: ModelSlot;
}

export interface ResolveOptions {
  critical?: boolean;
  /** Must be explicitly `true` for premium→default fallback. Defaults to no fallback. */
  degradable?: boolean;
  timeoutMs?: number;
}

export interface TierContext {
  /** Total user+assistant messages in the conversation incl. the current turn
   *  (≈ how deep the back-and-forth is). The tier baseline keys on this — NOT the
   *  intra-invocation LLM-loop counter (T2.9 fix). */
  conversationDepth: number;
  toolCount: number;
  previousTurnUsedTools: boolean;
  previousTurnEscalated: boolean;
  modelFloor?: ModelSlot;
  /**
   * Coarse dialogue stage for the current turn. Only ever raises the resolved
   * tier (never lowers it).
   */
  currentStage?: DialogueStage;
}

// Fallback when a slot config somehow lacks a per-tier timeout (defensive; every
// SLOT_CONFIGS entry now sets one explicitly). Kept Haiku-shaped intentionally.
const DEFAULT_TIMEOUT_MS = 8000;

const SLOT_RANK: Record<ModelSlot, number> = {
  default: 0,
  premium: 1,
  critical: 2,
  embedding: -1,
};

// Per-tier request timeouts (ms). Replaces the old single Haiku-shaped 8s default:
// stronger models legitimately take longer per call, so the slot carries its own
// budget. Only consulted when the router is ON (the executor passes profile.timeoutMs);
// an explicit ResolveOptions.timeoutMs still overrides the slot value.
const SLOT_CONFIGS: Record<ModelSlot, Omit<ModelConfig, "fallbackSlot">> = {
  default: {
    slot: "default",
    modelId: "claude-haiku-4-5-20251001",
    maxTokens: 1024,
    temperature: 0.7,
    timeoutMs: 15_000,
  },
  premium: {
    slot: "premium",
    modelId: "claude-sonnet-4-6",
    maxTokens: 2048,
    temperature: 0.5,
    timeoutMs: 25_000,
  },
  critical: {
    slot: "critical",
    modelId: "claude-opus-4-6",
    maxTokens: 4096,
    temperature: 0.3,
    timeoutMs: 30_000,
  },
  embedding: {
    slot: "embedding",
    modelId: "voyage-3-large",
    maxTokens: 0,
    temperature: 0,
    timeoutMs: 8_000,
  },
};

export class ModelRouter {
  resolve(slot: ModelSlot, options: ResolveOptions = {}): ModelConfig {
    const { critical = false, degradable, timeoutMs } = options;

    // Critical flag: upgrade default → premium
    const effectiveSlot: ModelSlot = critical && slot === "default" ? "premium" : slot;

    const base = SLOT_CONFIGS[effectiveSlot];
    if (!base) {
      return {
        ...SLOT_CONFIGS.default,
        timeoutMs: timeoutMs ?? SLOT_CONFIGS.default.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      };
    }

    // Determine fallback
    let fallbackSlot: ModelSlot | undefined;
    if (effectiveSlot === "default") {
      fallbackSlot = "premium";
    } else if (effectiveSlot === "premium" && degradable === true) {
      // Only degrade premium→default when explicitly marked as degradable
      fallbackSlot = "default";
    }
    // Non-degradable premium tasks (default): no fallback — will escalate instead

    return {
      ...base,
      // Explicit option wins; otherwise the per-tier slot value; DEFAULT_TIMEOUT_MS
      // is a last-resort guard (every slot config now sets timeoutMs).
      timeoutMs: timeoutMs ?? base.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fallbackSlot,
    };
  }

  resolveTier(context: TierContext): ModelSlot {
    let slot: ModelSlot;
    if (context.previousTurnEscalated)
      slot = "critical"; // escalation → strong, any depth
    else if (context.previousTurnUsedTools)
      slot = "premium"; // processing a tool result → strong
    else if (context.conversationDepth <= 1)
      slot = "default"; // first-contact greeting → cheap
    else if (context.toolCount === 0)
      slot = "default"; // tool-less skill → cheap even when deep
    else slot = "premium"; // engaged, tool-bearing conversation → strong

    // Stage-aware escalation (rank-max; only ever raises). Depth enters the
    // baseline ABOVE this merge, so a deep emotional turn still resolves strong:
    // the stage can lift the tier but never lower it, and is a no-op when absent.
    const stageSlot = this.stageToSlot(context.currentStage);
    if (stageSlot) slot = this.maxSlot(slot, stageSlot);

    return this.applyFloor(slot, context.modelFloor);
  }

  private stageToSlot(stage?: DialogueStage): ModelSlot | undefined {
    switch (stage) {
      case "fear":
        return "critical";
      case "objection":
      case "closing":
        return "premium";
      default:
        return undefined;
    }
  }

  private maxSlot(a: ModelSlot, b: ModelSlot): ModelSlot {
    return (SLOT_RANK[a] ?? 0) >= (SLOT_RANK[b] ?? 0) ? a : b;
  }

  private applyFloor(slot: ModelSlot, floor?: ModelSlot): ModelSlot {
    if (!floor) return slot;
    return (SLOT_RANK[floor] ?? 0) > (SLOT_RANK[slot] ?? 0) ? floor : slot;
  }
}

export function effortToSlotAndOptions(effort: Effort): {
  slot: ModelSlot;
  options: ResolveOptions;
} {
  switch (effort) {
    case "low":
      return { slot: "default", options: { critical: false } };
    case "medium":
      return { slot: "default", options: { critical: true } };
    case "high":
      return { slot: "premium", options: { critical: false } };
  }
}

/**
 * Default effort level per task type. Used by LlmCallWrapper when no explicit
 * `budget.effort` is provided. "high" effort is not mapped here — callers set
 * it explicitly on the ContextBudget when a task requires premium-direct routing.
 */
export const TASK_TYPE_EFFORT_MAP: Record<string, Effort> = {
  "content.draft": "medium",
  "content.revise": "medium",
  "content.publish": "low",
  "calendar.plan": "medium",
  "calendar.schedule": "low",
  "competitor.analyze": "medium",
  "performance.report": "low",
  classification: "low",
  summarisation: "low",
  retrieval: "low",
};

/** Look up effort for a task type. Falls back to "medium" if not mapped. */
export function effortForTaskType(taskType: string): Effort {
  return TASK_TYPE_EFFORT_MAP[taskType] ?? "medium";
}
