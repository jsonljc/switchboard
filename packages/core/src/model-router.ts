export type ModelSlot = "default" | "premium" | "critical" | "embedding";

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
  messageIndex: number;
  toolCount: number;
  hasHighRiskTools: boolean;
  previousTurnUsedTools: boolean;
  previousTurnEscalated: boolean;
  modelFloor?: ModelSlot;
}

const DEFAULT_TIMEOUT_MS = 8000;

const SLOT_RANK: Record<ModelSlot, number> = {
  default: 0,
  premium: 1,
  critical: 2,
  embedding: -1,
};

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
  critical: {
    slot: "critical",
    modelId: "claude-opus-4-6",
    maxTokens: 4096,
    temperature: 0.3,
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

  resolveTier(context: TierContext): ModelSlot {
    let slot: ModelSlot;
    if (context.messageIndex === 0)
      slot = "default"; // Rule 1: greetings
    else if (context.toolCount === 0)
      slot = "default"; // Rule 2: conversational
    else if (context.previousTurnEscalated)
      slot = "critical"; // Rule 3: escalation
    else if (context.previousTurnUsedTools)
      slot = "premium"; // Rule 4: tool follow-up
    else if (context.hasHighRiskTools)
      slot = "premium"; // Rule 5: high risk
    else slot = "default"; // Rule 6: default
    return this.applyFloor(slot, context.modelFloor);
  }

  private applyFloor(slot: ModelSlot, floor?: ModelSlot): ModelSlot {
    if (!floor) return slot;
    return (SLOT_RANK[floor] ?? 0) > (SLOT_RANK[slot] ?? 0) ? floor : slot;
  }
}
