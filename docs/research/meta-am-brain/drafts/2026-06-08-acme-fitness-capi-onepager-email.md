# DRAFT: awaiting approval

<!-- WORKED EXAMPLE: fictional. Shows the outbound format: metadata → clearance check → body with -->
<!-- claim markers → claims register → approval block (doc §8.3, §12). Nothing sends without approval. -->

```yaml
to: Jane Tan <jane@<redacted>.example>
cc: Marcus Lim
channel: email
re: "CAPI integration paths for Acme (as promised)"
generated_from: [RS-2026-04412, commitments.md#capi-one-pager, playbooks/capi.md, style.md]
purpose: close overdue commitment (due 06-05) + keep RS-2026-04412 warm; NO new ask
clearance_check:
  claims_total: 3
  cleared: 3
  cross_client_check: pass
  freshness_check: pass (all evidence fetched 2026-06-05, within 7d)
autonomy_rung: 0 (manual approve required)
```

---

Subject: CAPI integration paths for Acme (as promised)

Hi Jane,

As promised on Tuesday's call: the one-pager on Conversions API integration paths is attached, scoped to your stack.

The short version:

- Today, trial signups reach us only via the browser pixel: 0 server events in the last 30 days [1], with match quality at 4.2 / 10 [2]. With 71% of your conversions on iOS [3], that is where signal loss hits hardest.
- Your Shopify setup means the lightest path is the native integration: admin work measured in hours, no developer time. The agency-led path is also laid out in the attachment for when onboarding completes.
- No action needed from you this week. When Marcus confirms the agency date, I will propose a 30-minute scoping call.

Best,
[AM]

---

## Claims register

| #   | Claim                 | Evidence                                                                                 | Clearance                         |
| --- | --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | 0 server events / 30d | rs-ledger evidence: capi_absent, source <dashboard link>, fetched 2026-06-05             | client_specific → this client: OK |
| 2   | EMQ 4.2 / 10          | rs-ledger evidence: event_match_quality_low, source <events manager>, fetched 2026-06-05 | client_specific → this client: OK |
| 3   | 71% iOS share         | performance.md, source <dashboard link>, fetched 2026-06-05                              | client_specific → this client: OK |

Note: "hours, no developer time" is a product-mechanics statement (client_safe, playbooks/capi.md implementation table), not a quantitative claim; phrased as path description, not a promise.

## Approval

- [ ] Send as-is
- [ ] Edit (edits feed style.md)
- [ ] Reject (reason → queue feedback)

On send: log CI (countable per official definition: TBD Phase -1), close commitment, update RS-2026-04412 history, set follow-up 2026-06-10.
