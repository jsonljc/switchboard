import { describe, expect, it, vi } from "vitest";
import { ReEngagementAttributor } from "../re-engagement-attributor.js";
import type { ReEngagementVerdictReader } from "../types.js";

describe("ReEngagementAttributor.attributeReOpen", () => {
  it("returns inbound_after_re_engagement_template when a qualifying verdict exists", async () => {
    const inboundAt = new Date("2026-05-12T09:00:00Z");
    const decidedAt = new Date("2026-05-11T09:00:00Z");
    const reader: ReEngagementVerdictReader = {
      findReEngagementVerdict: vi.fn().mockResolvedValue({
        verdictId: "v-1",
        templateName: "re_engagement_offer_sg_v1",
        decidedAt,
      }),
    };
    const attributor = new ReEngagementAttributor(reader);
    const result = await attributor.attributeReOpen("thread-1", inboundAt);
    expect(result.trigger).toBe("inbound_after_re_engagement_template");
    expect(result.evidence.template_name).toBe("re_engagement_offer_sg_v1");
    expect(result.evidence.governance_verdict_id).toBe("v-1");
    expect(result.evidence.response_lag_h).toBe(24);
  });

  it("returns inbound_after_stalled when no re-engagement verdict exists in window (e.g. 1d not shipped)", async () => {
    const reader: ReEngagementVerdictReader = {
      findReEngagementVerdict: vi.fn().mockResolvedValue(null),
    };
    const attributor = new ReEngagementAttributor(reader);
    const result = await attributor.attributeReOpen("thread-1", new Date());
    expect(result.trigger).toBe("inbound_after_stalled");
    expect(result.evidence).toEqual({});
  });
});
