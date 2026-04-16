import type { GovernanceDecision, ExecutionConstraints } from "./governance-types.js";
import type { WorkUnit } from "./work-unit.js";
import type { ExecutionResult } from "./execution-result.js";
import type { ExecutionModeName } from "./types.js";

export interface ExecutionContext {
  traceId: string;
  governanceDecision: GovernanceDecision;
}

export interface ExecutionMode {
  name: ExecutionModeName;
  execute(
    workUnit: WorkUnit,
    constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult>;
}
