import type { ExecutionModeName, WorkOutcome, ExecutionError } from "./types.js";

export interface ExecutionResult {
  workUnitId: string;
  outcome: WorkOutcome;
  summary: string;
  outputs: Record<string, unknown>;
  mode: ExecutionModeName;
  durationMs: number;
  traceId: string;
  approvalId?: string;
  jobId?: string;
  error?: ExecutionError;
  /**
   * PR-3.2c: IDs of DeploymentMemory pattern rows rendered into the
   * <outcome-patterns> envelope for this turn's prompt. Threaded from
   * ParameterBuilders that surface patterns via ContextBuilder, through
   * SkillMode, to WorkTrace.injectedPatternIds at finalization. Empty
   * for turns that surfaced no patterns and for modes that don't render
   * a prompt envelope (cartridge, workflow).
   */
  injectedPatternIds?: string[];
}
