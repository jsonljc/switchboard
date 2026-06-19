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

interface ClaudeGeneration {
  family: "haiku" | "sonnet" | "opus" | "fable";
  major: number;
  minor: number;
}

// Parse the family + major.minor generation out of a Claude model id. Handles
// the current "claude-<family>-<major>-<minor>[-<date>]" shape (e.g.
// "claude-opus-4-6", "claude-haiku-4-5-20251001", "claude-fable-5") and a
// provider-prefixed form ("us.anthropic.claude-opus-4-8-v1:0"). The family is
// anchored immediately after "claude-" so the legacy "claude-3-5-sonnet" order
// (version-before-family) does not false-match. A trailing date suffix is left
// unmatched (minor reads the first numeric segment). Returns null when the id is
// not a recognizable Claude generation; the caller then preserves current
// behavior rather than guessing.
function parseClaudeGeneration(modelId: string): ClaudeGeneration | null {
  const match = /(?:^|[./])claude-(haiku|sonnet|opus|fable)-(\d+)(?:-(\d+))?/.exec(modelId);
  if (!match) return null;
  const family = match[1] as ClaudeGeneration["family"];
  const major = Number(match[2]);
  const minor = match[3] !== undefined ? Number(match[3]) : 0;
  return { family, major, minor };
}

/**
 * Whether a Claude model accepts the sampling params `temperature`/`top_p`/`top_k`.
 *
 * Claude generations 4.7 and newer (Opus 4.7/4.8, Fable 5, ...) reject those
 * params with a hard 400; 4.6 and earlier accept them. Adapters call this to
 * include `temperature` only when the target model supports it, which makes a
 * future model-id bump (e.g. router slots -> 4.8) a no-op instead of a latent
 * 400. Today's 4.5/4.6 routes return true, so this is behavior-preserving now.
 *
 * Unrecognized ids return true to preserve current behavior: a parser gap must
 * never silently drop `temperature` on a live route. A genuinely new id that the
 * parser cannot read will surface loudly (a 400 on first call) rather than
 * quietly change sampling — at which point the parser, not this default, is the
 * fix. Range/length constraints stay in Zod, not here (strict-schema sibling
 * gotcha: see feedback_anthropic_strict_tool_schema_no_minmax).
 */
export function modelSupportsSamplingParams(modelId: string): boolean {
  const gen = parseClaudeGeneration(modelId);
  if (!gen) return true;
  // Fable 5 is the first Fable generation and already rejects sampling params.
  if (gen.family === "fable") return false;
  if (gen.major > 4) return false;
  if (gen.major === 4 && gen.minor >= 7) return false;
  return true;
}
