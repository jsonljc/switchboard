---
# WORKED EXAMPLE: the quality bar for playbooks. Product mechanics below are public-knowledge
# (client_safe). Benchmark numbers are deliberately left as [NEEDS CLEARED BENCHMARK] slots.
product: capi
rs_categories: [signals, measurement]
one_liner: "Server-side events recover signal lost to browser limits and give the delivery system more complete data to optimize against."
eligibility_signals:
  - id: capi_absent
    test: "0 server events in last 30d AND pixel events above minimal volume"
  - id: event_match_quality_low
    test: "EMQ below 6.0 on purchase or lead events"
  - id: ios_heavy_mix
    test: "iOS share of conversions above ~60% (browser signal loss bites hardest here)"
  - id: cpa_volatility_unexplained
    test: "week-over-week CPA swings above 30% without spend/creative changes"
  - id: pixel_only_checkout
    test: "purchase events fire client-side only on a platform with native CAPI support (e.g. Shopify)"
clearance: client_safe
last_reviewed: 2026-06-07
---

# CAPI (Conversions API) playbook

## When to pitch (signal patterns)

1. **`capi_absent` + meaningful spend on conversion objectives.** The strongest setup: they are buying optimization with partial signal. Pair with `event_match_quality_low` if present.
2. **`event_match_quality_low` even with CAPI present.** The pitch becomes "fix match quality," not "adopt CAPI": better customer-information parameters, not new plumbing.
3. **`ios_heavy_mix`.** Browser-side loss is worst exactly where their audience lives.
4. **`cpa_volatility_unexplained`.** Position CAPI as stabilizing the measurement floor before any structural changes; do not promise it fixes volatility by itself.
5. **`pixel_only_checkout` on a native-support platform.** Effort collapses to hours; lead with that.

## Value story and proof points

**Mechanism (client_safe):** browser-side pixels lose events to connection issues, browser privacy limits, ad blockers, and app-tracking changes. CAPI sends the same conversion events server-to-server, so delivery optimization and attribution see a more complete picture. Event Match Quality (EMQ) scores how well the customer information on your server events matches to accounts; richer matched signal means the system optimizes against more of your real conversions.

**Proof points:**

- [NEEDS CLEARED BENCHMARK: cost-per-result improvement range for advertisers adding CAPI alongside pixel, from the approved internal library + approved phrasing]
- [NEEDS CLEARED BENCHMARK: EMQ uplift → performance relationship, if a cleared aggregate exists]
- **Client-specific evidence beats any benchmark:** their own EMQ score, server-event coverage (often zero), and iOS mix, pulled fresh with source + date. Lead with these.

## Talk track (60 seconds, data_first variant)

"Right now we can see [X]% of your conversions are signed iOS traffic and your purchase events come only from the browser pixel; your match quality score is [EMQ] out of 10. That means the delivery system is optimizing against an incomplete picture of who actually buys from you. Conversions API sends the same purchase events from your server as well; the two streams get deduplicated, nothing double-counts. On [their platform] this is a native integration, [effort statement]. The outcome we are targeting: match quality up, more of your real conversions visible to optimization, steadier cost-per-purchase. Can we get your [dev/agency/platform admin] on a 30-minute call to scope it?"

## Objections and responses

| Objection                      | Response                                                                                                                                                                                                                                                 | Evidence ref                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| "No dev bandwidth"             | Effort depends on path, not headcount: native platform toggles (Shopify, WooCommerce, BigCommerce...) are hours of admin work, no code; CAPI Gateway is a no-code hosted relay; full API is the only path needing real dev time. Scope before declining. | implementation section below                            |
| "We already have the pixel"    | CAPI complements it; events deduplicate via event_id. The pixel's losses are invisible by definition; EMQ and server-event coverage are the visible proxies, and yours are [their numbers].                                                              | their EMQ + coverage, cited                             |
| "Privacy concerns"             | Customer information is hashed before sending; this is the same first-party data their pixel already uses, governed by the same data processing terms. Loop in their privacy contact early rather than late.                                             | policy_sensitive: link canonical docs, never paraphrase |
| "We tried it, nothing changed" | Most common causes: dedup misconfigured (double counting then corrected reads as "no change") or thin customer-information parameters keeping EMQ flat. Audit event coverage + EMQ before re-judging.                                                    | their Events Manager diagnostics                        |
| "What does it cost?"           | The API is free; cost is implementation effort plus hosting only if they choose Gateway/server-side GTM. Be precise about which path costs what.                                                                                                         | effort table below                                      |

## Implementation steps and effort honesty

| Path                                         | Fits                             | Effort (honest)                         |
| -------------------------------------------- | -------------------------------- | --------------------------------------- |
| Native platform integration (Shopify et al.) | anyone on a supported platform   | hours; admin access, no code            |
| CAPI Gateway                                 | no platform support, no dev team | ~a day to stand up; small hosting cost  |
| Partner/tag-manager server-side              | existing GTM setup               | days; needs whoever owns their tags     |
| Direct API integration                       | custom stack, has dev team       | a real dev sprint; scope with their eng |

Then, for any path: (1) send the full funnel (view/add-to-cart/initiate-checkout/purchase or lead chain), not purchase alone; (2) set `event_id` on both pixel and server events for dedup; (3) pass customer information parameters (hashed email/phone, fbp/fbc) to lift EMQ; (4) verify in Events Manager: test events tool, dedup status, EMQ per event; (5) judge after a 2 to 4 week observation window, not 3 days.

## Common pitfalls

- Missing/mismatched `event_id` → double counting → trust collapse. Verify dedup before anything else.
- Sending purchase only: the funnel events feed optimization too.
- Thin customer-information parameters: CAPI "on" with EMQ 3 is plumbing without payoff.
- Set-and-forget: EMQ drifts when checkout flows change; re-check quarterly.
- Judging during the first noisy week.

## FAQ

- **Does CAPI replace the pixel?** No; run both, deduplicated. Redundancy is the point.
- **What data gets sent?** The same event + hashed customer information the pixel path uses; nothing new is collected.
- **Will this fix iOS measurement?** It recovers part of the loss; it is not a time machine. Set expectations on EMQ and coverage, not magic.
- **How fast do we see results?** Coverage/EMQ move immediately; performance effects need the observation window.
