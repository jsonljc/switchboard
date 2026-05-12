import type { ConversationLifecycleTrigger } from "@switchboard/schemas";
import type { ReEngagementVerdictReader } from "./types.js";
import { RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS } from "./constants.js";

export interface ReOpenAttribution {
  trigger: ConversationLifecycleTrigger;
  evidence: Record<string, unknown>;
}

/**
 * Resolves the re-open trigger by reading 1d's substitute verdicts. If 1d has
 * not yet shipped, or did not fire a substitute in the window, falls back to
 * `inbound_after_stalled`. This means 3a does not require 1d as a prerequisite
 * — it gracefully degrades to no-attribution when the verdict trail is absent.
 */
export class ReEngagementAttributor {
  constructor(private readonly verdicts: ReEngagementVerdictReader) {}

  async attributeReOpen(threadId: string, inboundAt: Date): Promise<ReOpenAttribution> {
    const verdict = await this.verdicts.findReEngagementVerdict(
      threadId,
      inboundAt,
      RE_ENGAGEMENT_ATTRIBUTION_WINDOW_DAYS,
    );
    if (!verdict) {
      return { trigger: "inbound_after_stalled", evidence: {} };
    }
    const responseLagH = Math.round(
      (inboundAt.getTime() - verdict.decidedAt.getTime()) / (60 * 60 * 1000),
    );
    return {
      trigger: "inbound_after_re_engagement_template",
      evidence: {
        template_name: verdict.templateName,
        governance_verdict_id: verdict.verdictId,
        response_lag_h: responseLagH,
      },
    };
  }
}
