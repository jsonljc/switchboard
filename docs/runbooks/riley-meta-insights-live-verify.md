# Riley Meta `/insights` field set — one-time live verify

**Type:** Manual, one-time. Requires real Meta credentials from a Tier-0-credentialed
pilot org. **Blocked-by Tier 0** (a credentialed org).

**Why this exists:** Riley's weekly audit requests campaign insights from the Meta
Marketing API's AdsInsights `/insights` edge. PR 1.1 (finding D2-2) removed `status`,
`effective_status`, and `revenue` from the requested fields because those keys do **not**
exist on the `/insights` edge — they belong to the campaign-object edge. Requesting them
returns a Graph error or silent zeros, which previously zeroed money in the audit. The
code now sources money from `action_values` (summed over purchase entries into
`insight.revenue` inside `MetaAdsClient.mapCampaignInsight`).

This runbook confirms that assumption against a **real** account before relying on it in
production. If Meta in fact returns `status`/`effective_status`/`revenue` on `/insights`,
**STOP** — the call-count and money-source math in PR 1.2 (D2-7) and PR 1.3 (D2-1) depend
on it, and those plans must be revisited.

## Procedure

1. Obtain a valid system-user (or page) access token and the ad-account id
   (`act_<id>`) for a Tier-0-credentialed pilot org. Do **not** paste the token into
   this file or any commit.

2. Run a single read-only insights call (Graph v21.0). Replace `ACT_ID` and `TOKEN`:

   ```bash
   curl -sG "https://graph.facebook.com/v21.0/act_ACT_ID/insights" \
     --data-urlencode "level=campaign" \
     --data-urlencode "fields=campaign_id,spend,actions,action_values" \
     --data-urlencode "date_preset=last_7d" \
     -H "Authorization: Bearer TOKEN" | jq .
   ```

3. Confirm the response shape:
   - [ ] **(a)** No `status`, `effective_status`, or `revenue` keys appear on any row
         under `data[]`.
   - [ ] **(b)** `action_values` is present on rows with conversions and carries the
         purchase value under an `action_type` containing `purchase`
         (e.g. `offsite_conversion.fb_pixel_purchase`).

4. **If (a) or (b) is contradicted** (Meta DOES return `status`/`revenue`, or money is
   NOT in `action_values`): STOP. Do not flip Riley's audit to production. Re-plan
   D2-7 / D2-1 in
   `docs/superpowers/plans/2026-06-10-riley-remediation-tier1-perception-ops.md` — the
   field set and call-count math change.

5. **If both confirm:** record the captured response shape (PII/account-id scrubbed) as
   the canonical fixture. It must match `RECORDED_INSIGHTS_RESPONSE` in
   `packages/ad-optimizer/src/__tests__/meta-ads-client-insights-fixture.test.ts`. If the
   real shape differs in any load-bearing way (key names, value formats), update that
   fixture so the pin reflects reality.

## Canonical fixture shape (pinned by the recorded-fixture test)

```jsonc
{
  "data": [
    {
      "campaign_id": "23851234567890123",
      "campaign_name": "SG-Botox-Lunchtime",
      "impressions": "48211",
      "inline_link_clicks": "1043",
      "spend": "612.40",
      "frequency": "1.92",
      "cpm": "12.70",
      "inline_link_click_ctr": "2.16",
      "cost_per_inline_link_click": "0.59",
      "actions": [{ "action_type": "offsite_conversion.fb_pixel_purchase", "value": "11" }],
      "action_values": [
        { "action_type": "offsite_conversion.fb_pixel_purchase", "value": "3300.00" },
      ],
      "date_start": "2026-05-25",
      "date_stop": "2026-05-31",
    },
  ],
}
```
