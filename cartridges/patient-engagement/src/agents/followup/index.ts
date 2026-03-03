// ---------------------------------------------------------------------------
// Follow-up Agent — Post-treatment engagement, review solicitation
// ---------------------------------------------------------------------------

import type { AgentModule } from "../types.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { JourneyStageId } from "../../core/types.js";
import type { ReviewPlatformProvider } from "../../cartridge/providers/provider.js";
import { executeLogTreatment } from "../../cartridge/actions/log-treatment.js";
import { executeRequestReview } from "../../cartridge/actions/request-review.js";
import { executeRespondReview } from "../../cartridge/actions/respond-review.js";

export class FollowupAgent implements AgentModule {
  readonly type = "followup" as const;
  readonly stages: JourneyStageId[] = ["treatment_completed", "repeat_patient"];

  constructor(
    private readonly review: ReviewPlatformProvider,
    private readonly locationId: string,
  ) {}

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    switch (actionType) {
      case "patient-engagement.treatment.log":
        return executeLogTreatment(parameters);
      case "patient-engagement.review.request":
        return executeRequestReview(parameters, this.review, this.locationId);
      case "patient-engagement.review.respond":
        return executeRespondReview(parameters, this.review, this.locationId);
      default:
        return {
          success: false,
          summary: `FollowupAgent cannot handle action: ${actionType}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [{ step: "route", error: `Unknown action: ${actionType}` }],
          durationMs: 0,
          undoRecipe: null,
        };
    }
  }
}
