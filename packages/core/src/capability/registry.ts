import type {
  CapabilityDescriptor,
  ExecutorType,
  StepType,
  CostTier,
  ActionDefinition,
} from "@switchboard/schemas";

/**
 * CapabilityRegistry — maps flat action type strings to rich capability metadata.
 *
 * Auto-populates from CartridgeManifest actions with heuristics when no explicit
 * hints are provided. Allows manual override via register().
 */
export class CapabilityRegistry {
  private capabilities = new Map<string, CapabilityDescriptor>();

  /**
   * Register a capability descriptor for an action type.
   */
  register(descriptor: CapabilityDescriptor): void {
    this.capabilities.set(descriptor.actionType, descriptor);
  }

  /**
   * Look up a capability by action type.
   */
  lookup(actionType: string): CapabilityDescriptor | null {
    return this.capabilities.get(actionType) ?? null;
  }

  /**
   * Find all capabilities matching a given executor type.
   */
  findByExecutorType(executorType: ExecutorType): CapabilityDescriptor[] {
    return Array.from(this.capabilities.values()).filter((c) => c.executorType === executorType);
  }

  /**
   * Find all capabilities matching a given step type.
   */
  findByStepType(stepType: StepType): CapabilityDescriptor[] {
    return Array.from(this.capabilities.values()).filter((c) => c.stepType === stepType);
  }

  /**
   * List all registered capabilities.
   */
  listAll(): CapabilityDescriptor[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Enrich a flat list of action type strings into CapabilityDescriptors.
   * Returns descriptors for registered actions; unregistered ones get default metadata.
   */
  enrichAvailableActions(actions: string[]): CapabilityDescriptor[] {
    return actions.map((actionType) => {
      const existing = this.capabilities.get(actionType);
      if (existing) return existing;
      return inferCapability(actionType);
    });
  }

  /**
   * Populate registry from a cartridge manifest's action definitions.
   * Uses explicit hints when available, otherwise applies heuristics.
   */
  populateFromManifest(actions: ActionDefinition[]): void {
    for (const action of actions) {
      const descriptor: CapabilityDescriptor = {
        actionType: action.actionType,
        executorType: action.executorHint ?? inferExecutorType(action),
        stepType: action.stepType ?? inferStepType(action),
        costTier: inferCostTier(action),
        requiredContext: Object.keys(action.parametersSchema),
        description: action.description,
      };
      this.capabilities.set(action.actionType, descriptor);
    }
  }
}

/**
 * Infer executor type from action definition using heuristics.
 */
function inferExecutorType(action: ActionDefinition): ExecutorType {
  const at = action.actionType.toLowerCase();
  const risk = action.baseRiskCategory;

  // High-risk writes → l2-llm (needs reasoning)
  if (risk === "critical" || risk === "high") return "l2-llm";

  // Read/fetch/search/list/diagnose/analyze → deterministic
  if (/\.(fetch|get|search|list|status|check)$/.test(at)) return "deterministic";
  if (/\.(diagnose|analyze|snapshot)/.test(at)) return "deterministic";

  // Simple writes (pause/resume/cancel) → deterministic
  if (/\.(pause|resume|cancel|stop|void|deactivate)$/.test(at)) return "deterministic";

  // Medium-risk writes → l1-llm
  if (risk === "medium") return "l1-llm";

  // Default → deterministic
  return "deterministic";
}

/**
 * Infer step type from action definition using heuristics.
 */
function inferStepType(action: ActionDefinition): StepType {
  const at = action.actionType.toLowerCase();

  if (/\.(fetch|get|search|list|snapshot)/.test(at)) return "FETCH";
  if (/\.(diagnose|analyze|compute|score)/.test(at)) return "COMPUTE";
  if (/\.(report|summarize|summary)/.test(at)) return "SUMMARIZE";
  if (/\.(recommend|decide|suggest)/.test(at)) return "DECIDE";
  if (/\.(escalate|ask|confirm)/.test(at)) return "ASK_HUMAN";
  if (/\.(approve|approval)/.test(at)) return "APPROVAL";
  if (/\.(log|audit|record)/.test(at)) return "LOG";

  // Default: anything that mutates → EXECUTE
  return "EXECUTE";
}

/**
 * Infer cost tier from action definition.
 */
function inferCostTier(action: ActionDefinition): CostTier {
  const risk = action.baseRiskCategory;
  if (risk === "critical") return "high";
  if (risk === "high") return "medium";
  if (risk === "medium") return "low";
  return "free";
}

/**
 * Create a default CapabilityDescriptor for an action type that isn't registered.
 */
function inferCapability(actionType: string): CapabilityDescriptor {
  const at = actionType.toLowerCase();

  let executorType: ExecutorType = "deterministic";
  let stepType: StepType = "EXECUTE";
  let costTier: CostTier = "low";

  if (/\.(fetch|get|search|list|snapshot|status|check)/.test(at)) {
    stepType = "FETCH";
    costTier = "free";
  } else if (/\.(diagnose|analyze|compute|score)/.test(at)) {
    stepType = "COMPUTE";
    costTier = "low";
  } else if (/\.(report|summarize)/.test(at)) {
    stepType = "SUMMARIZE";
    executorType = "l1-llm";
    costTier = "low";
  } else if (/\.(create|adjust|modify|set|update)/.test(at)) {
    stepType = "EXECUTE";
    executorType = "l1-llm";
    costTier = "medium";
  } else if (/\.(pause|resume|cancel|stop|void|deactivate)/.test(at)) {
    stepType = "EXECUTE";
    costTier = "free";
  }

  return {
    actionType,
    executorType,
    stepType,
    costTier,
    requiredContext: [],
  };
}
