import { describe, it, expect, vi, afterEach } from "vitest";
import { MetaAdsClient } from "../meta-ads-client.js";

// Recorded shape of a real GET /act_X/insights?level=campaign response. The
// AdsInsights edge does NOT return `status`/`effective_status`/`revenue`; it
// returns `actions` and `action_values` for conversion + value. Captured from a
// live Graph v21.0 response (see docs/runbooks/riley-meta-insights-live-verify.md).
const RECORDED_INSIGHTS_RESPONSE = {
  data: [
    {
      campaign_id: "23851234567890123",
      campaign_name: "SG-Botox-Lunchtime",
      impressions: "48211",
      inline_link_clicks: "1043",
      spend: "612.40",
      frequency: "1.92",
      cpm: "12.70",
      inline_link_click_ctr: "2.16",
      cost_per_inline_link_click: "0.59",
      actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "11" }],
      action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "3300.00" }],
      date_start: "2026-05-25",
      date_stop: "2026-05-31",
    },
  ],
};

describe("MetaAdsClient — real /insights edge shape (no status/revenue field)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does NOT request the invalid status/revenue fields on /insights", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(RECORDED_INSIGHTS_RESPONSE),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });

    // Drive it through the same field list the audit runner uses.
    const { INSIGHT_FIELDS } = await import("../audit-runner.js");
    await client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-05-31" },
      fields: INSIGHT_FIELDS,
    });

    const url = String(fetchSpy.mock.calls[0]![0]);
    const fields = new URL(url).searchParams.get("fields") ?? "";
    expect(fields).not.toContain("status");
    expect(fields).not.toContain("revenue");
    expect(fields).not.toContain("effective_status");
  });

  it("maps a recorded response without fabricating a status, and sources money from action_values", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(RECORDED_INSIGHTS_RESPONSE),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });

    const [row] = await client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-05-31" },
      fields: ["campaign_id", "spend", "actions", "action_values"],
    });

    // status/effectiveStatus stay empty (honest "unknown"), NOT a fabricated "ACTIVE".
    expect(row!.status).toBe("");
    expect(row!.effectiveStatus).toBe("");
    // revenue is no longer read off a missing field; the value lives in action_values.
    expect(row!.actionValues?.find((a) => a.action_type.includes("purchase"))?.value).toBe(
      "3300.00",
    );
    // and the mapper DERIVES revenue from that purchase action_value (pins the derivation, not just
    // the passthrough): the single fb_pixel_purchase entry of 3300.00.
    expect(row!.revenue).toBe(3300);
  });
});
