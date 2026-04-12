import type { Effort } from "./context-budget.js";

export type ModelSlot = "default" | "premium" | "embedding";

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

const DEFAULT_TIMEOUT_MS = 8000;

const SLOT_CONFIGS: Record<ModelSlot, Omit<ModelConfig, "fallbackSlot" | "timeoutMs">> = {
  default: {
    slot: "default",
    modelId: "claude-haiku-4-5-20251001",
    maxTokens: 1024,
    temperature: 0.7,
  },
  premium: {
    slot: "premium",
    modelId: "claude-sonnet-4-6",
    maxTokens: 2048,
    temperature: 0.5,
  },
  embedding: {
    slot: "embedding",
    modelId: "voyage-3-large",
    maxTokens: 0,
    temperature: 0,
  },
};

export class ModelRouter {
  resolve(slot: ModelSlot, options: ResolveOptions = {}): ModelConfig {
    const { critical = false, degradable, timeoutMs } = options;

    // Critical flag: upgrade default → premium
    const effectiveSlot: ModelSlot = critical && slot === "default" ? "premium" : slot;

    const base = SLOT_CONFIGS[effectiveSlot];
    if (!base) {
      return { ...SLOT_CONFIGS.default, timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS };
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
      timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fallbackSlot,
    };
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
