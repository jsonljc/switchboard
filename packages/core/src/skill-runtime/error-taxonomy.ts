export type ErrorCategory = "governance" | "execution" | "budget" | "approval" | "circuit";

export const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  "governance",
  "execution",
  "budget",
  "approval",
  "circuit",
] as const;

export const TAXONOMY_CODES: Record<ErrorCategory, readonly string[]> = {
  governance: [
    "DENIED_BY_POLICY",
    "TRUST_LEVEL_INSUFFICIENT",
    "ACTION_TYPE_BLOCKED",
    "COOLDOWN_ACTIVE",
    "ENTITY_PROTECTED",
  ],
  execution: [
    "TOOL_NOT_FOUND",
    "INVALID_INPUT",
    "EXECUTION_TIMEOUT",
    "EXTERNAL_SERVICE_ERROR",
    "IDEMPOTENCY_DUPLICATE",
    "STEP_FAILED",
  ],
  budget: [
    "TOKEN_BUDGET_EXCEEDED",
    "TURN_LIMIT_EXCEEDED",
    "RUNTIME_LIMIT_EXCEEDED",
    "WRITE_LIMIT_EXCEEDED",
    "BLAST_RADIUS_EXCEEDED",
  ],
  approval: ["APPROVAL_REQUIRED", "APPROVAL_EXPIRED", "APPROVAL_REJECTED", "BINDING_HASH_MISMATCH"],
  circuit: ["CIRCUIT_BREAKER_TRIPPED", "SAFETY_ENVELOPE_EXCEEDED"],
} as const;

export interface StructuredError {
  category: ErrorCategory;
  code: string;
  message: string;
  modelRemediation: string;
  operatorRemediation: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export const DEFAULT_REMEDIATIONS: Record<
  string,
  { modelRemediation: string; operatorRemediation: string; retryable: boolean }
> = {
  // governance
  DENIED_BY_POLICY: {
    modelRemediation: "This action is not permitted. Try a different approach or escalate.",
    operatorRemediation: "Policy denied the action. Check governance rules.",
    retryable: false,
  },
  TRUST_LEVEL_INSUFFICIENT: {
    modelRemediation: "Trust level too low for this action. Use a lower-risk alternative.",
    operatorRemediation: "Agent trust level does not meet the threshold for this operation.",
    retryable: false,
  },
  ACTION_TYPE_BLOCKED: {
    modelRemediation: "This action type is blocked. Try a different operation.",
    operatorRemediation: "Action type is on the block list. Update governance policy if needed.",
    retryable: false,
  },
  COOLDOWN_ACTIVE: {
    modelRemediation: "A cooldown is active. Wait before retrying this action.",
    operatorRemediation: "Cooldown period has not elapsed. Check cooldown configuration.",
    retryable: true,
  },
  ENTITY_PROTECTED: {
    modelRemediation: "This entity is protected and cannot be modified. Try a different target.",
    operatorRemediation: "Entity has protection rules. Review entity protection settings.",
    retryable: false,
  },
  // execution
  TOOL_NOT_FOUND: {
    modelRemediation: "Tool not found. Check available tools for this skill.",
    operatorRemediation: "Tool ID does not match any registered tool.",
    retryable: false,
  },
  INVALID_INPUT: {
    modelRemediation: "Input validation failed. Check parameter types and required fields.",
    operatorRemediation: "Tool received invalid input. Review input schema.",
    retryable: false,
  },
  EXECUTION_TIMEOUT: {
    modelRemediation: "The operation timed out. Try again or use a simpler query.",
    operatorRemediation: "Tool execution exceeded timeout. Check external service latency.",
    retryable: true,
  },
  EXTERNAL_SERVICE_ERROR: {
    modelRemediation: "An external service failed. Try again shortly.",
    operatorRemediation: "External dependency returned an error. Check service health.",
    retryable: true,
  },
  IDEMPOTENCY_DUPLICATE: {
    modelRemediation: "This operation was already performed. No action needed.",
    operatorRemediation: "Duplicate operation detected via idempotency key.",
    retryable: false,
  },
  STEP_FAILED: {
    modelRemediation: "A workflow step failed. Review the error and try an alternative approach.",
    operatorRemediation: "Step execution failed. Check step logs for details.",
    retryable: false,
  },
  // budget
  TOKEN_BUDGET_EXCEEDED: {
    modelRemediation: "Token budget exhausted. Wrap up and provide a final answer now.",
    operatorRemediation: "Token budget exceeded. Increase budget or optimize prompt.",
    retryable: false,
  },
  TURN_LIMIT_EXCEEDED: {
    modelRemediation: "Turn limit reached. Provide a final answer with current information.",
    operatorRemediation: "LLM turn limit exceeded. Increase maxLlmTurns if needed.",
    retryable: false,
  },
  RUNTIME_LIMIT_EXCEEDED: {
    modelRemediation: "Runtime limit reached. Conclude with available results.",
    operatorRemediation: "Execution exceeded runtime limit. Increase maxRuntimeMs if needed.",
    retryable: false,
  },
  WRITE_LIMIT_EXCEEDED: {
    modelRemediation: "Write operation limit reached. No more write operations allowed.",
    operatorRemediation: "Write limit exceeded. Review blast radius settings.",
    retryable: false,
  },
  BLAST_RADIUS_EXCEEDED: {
    modelRemediation: "Operation affects too many records. Narrow the scope and retry.",
    operatorRemediation: "Blast radius limit exceeded. Adjust limits or approve manually.",
    retryable: false,
  },
  // approval
  APPROVAL_REQUIRED: {
    modelRemediation: "This action requires human approval. Wait for the operator to respond.",
    operatorRemediation: "Action queued for approval. Review and approve or reject.",
    retryable: false,
  },
  APPROVAL_EXPIRED: {
    modelRemediation: "The approval request expired. Re-submit if still needed.",
    operatorRemediation: "Approval timed out. The agent may re-request.",
    retryable: true,
  },
  APPROVAL_REJECTED: {
    modelRemediation: "The operator rejected this action. Try a different approach.",
    operatorRemediation: "Action was rejected. Provide feedback to the agent if appropriate.",
    retryable: false,
  },
  BINDING_HASH_MISMATCH: {
    modelRemediation: "The approval binding has changed. Re-submit the action for approval.",
    operatorRemediation: "Approval hash mismatch. The action parameters changed after approval.",
    retryable: true,
  },
  // circuit
  CIRCUIT_BREAKER_TRIPPED: {
    modelRemediation: "Too many recent failures. Stop and escalate to a human.",
    operatorRemediation: "Circuit breaker tripped. Check failure count.",
    retryable: false,
  },
  SAFETY_ENVELOPE_EXCEEDED: {
    modelRemediation: "Safety limits exceeded. Stop all operations and escalate.",
    operatorRemediation: "Safety envelope breach detected. Review safety configuration.",
    retryable: false,
  },
};

const allCodes: Set<string> = new Set(Object.values(TAXONOMY_CODES).flatMap((codes) => [...codes]));

const codeToCategory: Map<string, ErrorCategory> = new Map();
for (const [category, codes] of Object.entries(TAXONOMY_CODES)) {
  for (const code of codes) {
    codeToCategory.set(code, category as ErrorCategory);
  }
}

export function isValidTaxonomyCode(code: string): boolean {
  return allCodes.has(code);
}

export function getCategoryForCode(code: string): ErrorCategory | undefined {
  return codeToCategory.get(code);
}

export function structuredError(
  category: ErrorCategory,
  code: string,
  message: string,
  opts?: {
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  },
): StructuredError {
  const defaults = DEFAULT_REMEDIATIONS[code];
  return {
    category,
    code,
    message,
    modelRemediation:
      opts?.modelRemediation ?? defaults?.modelRemediation ?? "An error occurred. Try again.",
    operatorRemediation:
      opts?.operatorRemediation ?? defaults?.operatorRemediation ?? "Unexpected error. Check logs.",
    retryable: opts?.retryable ?? defaults?.retryable ?? false,
    ...(opts?.retryAfterMs !== undefined ? { retryAfterMs: opts.retryAfterMs } : {}),
  };
}
