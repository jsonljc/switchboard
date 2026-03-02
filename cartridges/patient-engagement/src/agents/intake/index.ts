// ---------------------------------------------------------------------------
// Intake Agent — Lead qualification, objection handling
// ---------------------------------------------------------------------------

import type { AgentModule } from "../types.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { JourneyStageId } from "../../core/types.js";
import { executeQualifyLead } from "../../cartridge/actions/qualify-lead.js";
import { executeScoreLead } from "../../cartridge/actions/score-lead.js";
import { executeHandleObjection } from "../../cartridge/actions/handle-objection.js";

export class IntakeAgent implements AgentModule {
  readonly type = "intake" as const;
  readonly stages: JourneyStageId[] = ["new_lead", "qualified"];

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    switch (actionType) {
      case "patient-engagement.lead.qualify":
        return executeQualifyLead(parameters);
      case "patient-engagement.lead.score":
        return executeScoreLead(parameters);
      case "patient-engagement.conversation.handle_objection":
        return executeHandleObjection(parameters);
      default:
        return {
          success: false,
          summary: `IntakeAgent cannot handle action: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "route", error: `Unknown action: ${actionType}` }],
          durationMs: 0,
          undoRecipe: null,
        };
    }
  }
}
