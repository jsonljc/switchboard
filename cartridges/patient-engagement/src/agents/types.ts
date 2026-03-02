// ---------------------------------------------------------------------------
// Agent Module Types
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { JourneyStageId } from "../core/types.js";

export type AgentType = "intake" | "scheduling" | "followup" | "retention";

export interface AgentModule {
  readonly type: AgentType;

  /** Stages this agent is responsible for */
  readonly stages: JourneyStageId[];

  /** Execute an action within this agent's scope */
  execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<ExecuteResult>;
}
