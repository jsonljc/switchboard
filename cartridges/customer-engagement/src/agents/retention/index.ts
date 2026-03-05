// ---------------------------------------------------------------------------
// Retention Agent — Win-back, re-engagement
// ---------------------------------------------------------------------------

import type { AgentModule } from "../types.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { JourneyStageId } from "../../core/types.js";
import { executeStartCadence } from "../../cartridge/actions/start-cadence.js";
import { executeStopCadence } from "../../cartridge/actions/stop-cadence.js";

export class RetentionAgent implements AgentModule {
  readonly type = "retention" as const;
  readonly stages: JourneyStageId[] = ["dormant", "lost"];

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    switch (actionType) {
      case "customer-engagement.cadence.start":
        return executeStartCadence(parameters);
      case "customer-engagement.cadence.stop":
        return executeStopCadence(parameters);
      default:
        return {
          success: false,
          summary: `RetentionAgent cannot handle action: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "route", error: `Unknown action: ${actionType}` }],
          durationMs: 0,
          undoRecipe: null,
        };
    }
  }
}
