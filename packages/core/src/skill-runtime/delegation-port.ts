/**
 * Narrow port the delegate tool depends on. Implemented in apps/api over the
 * existing submitChildWork closure (which calls PlatformIngress.submit). Kept
 * self-contained — NO import from ../platform — so skill-runtime stays free of a
 * type cycle with the platform layer.
 */
export interface DelegationRequest {
  organizationId: string;
  actor: { id: string; type: "agent" };
  intent: string;
  parameters: Record<string, unknown>;
  parentWorkUnitId: string;
  idempotencyKey: string;
}

export interface DelegationResult {
  ok: boolean;
  /** Child execution outcome, e.g. "completed" | "pending_approval" | "failed". */
  outcome?: string;
  childWorkUnitId?: string;
  error?: string;
}

export interface ChildWorkSubmitter {
  submitChildWork(req: DelegationRequest): Promise<DelegationResult>;
}

/**
 * One delegatable target. The delegate tool exposes ONE operation per target —
 * so the set of reachable intents is fixed by construction (the allowlist).
 */
export interface DelegationTarget {
  /** Tool operation name; the LLM calls `delegate.<operation>`. No dots. */
  operation: string;
  /** Platform intent submitted for this target. */
  intent: string;
  /** Shown to the LLM as the operation description. */
  description: string;
  /**
   * JSON schema for the brief the LLM supplies. Must NOT use minimum/maximum or
   * minLength/maxLength constraint keys — Anthropic strict tool schemas 400 on them.
   */
  inputSchema: Record<string, unknown>;
  /** Map the validated brief into the child WorkUnit parameters. */
  mapInput(input: unknown): Record<string, unknown>;
}
