---
name: Meta Lead Ads webhook model
description: How Meta Lead Ads webhooks work — webhook is trigger only, leadgen_id is key, bulk read for recovery
type: reference
originSessionId: 1c1fe4d3-8357-409e-9a76-23d39d02333f
---

Meta Lead Ads has two retrieval modes: Webhooks (real-time) and Bulk Read (batch).

**Webhook model:**

- Webhook delivers identifiers only: `leadgen_id`, `page_id`, `form_id`, `adgroup_id`, `ad_id`, `created_time`
- Full lead data requires a follow-up `GET /<LEAD_ID>` call to Graph API
- Real-time pings can be delayed up to a few minutes
- Requires `pages_manage_metadata` permission

**Bulk Read:**

- Read by ad: `/<AD_ID>/leads`
- Read by form: `/<FORM_ID>/leads`
- Export CSV with date range filtering
- Rate limit: `200 × 24 × leads_in_past_90_days` per Page per 24h

**Important details:**

- `field_data` is flexible `[{name, values}]` pairs — not fixed schema
- Custom disclaimer responses are separate from `field_data`
- Missing `ad_id`/`adgroup_id` is normal (organic reach, ad preview, missing permissions)
- Forms can be reused across ads (form-level reads may contain more leads)
- Permissions are an onboarding blocker — `leads_retrieval`, `ads_management`, etc.

**Switchboard alignment:**

- `meta.lead.intake` workflow = webhook trigger → process leads
- Should treat webhook as trigger, retrieve canonical data via `leadgen_id`
- Bulk read is the recovery/backfill path (not yet built)
