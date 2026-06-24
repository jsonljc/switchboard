# Acme Fitness: RS Ledger

<!-- WORKED EXAMPLE: fictional rs_ids. Mirror of the RS system + our annotations; never invent ids. -->

```yaml
rs:
  - rs_id: RS-2026-04412
    product: capi
    status: open
    local_state: objection_parked
    bands:
      {
        commercial_value: high,
        evidence_readiness: strong,
        client_readiness: blocked,
        urgency: this_month,
        effort: medium,
      }
    score_reason: "EMQ 4.2 + zero server events + 71% iOS mix = strongest evidence in their book; blocked only on dev bandwidth"
    confidence: high
    evidence:
      - signal_id: capi_absent
        metric: "server event coverage"
        value: "0 events / 30d"
        window: 2026-05-08..2026-06-07
        source: <internal dashboard link>
        clearance: client_specific
        fetched_at: 2026-06-05
      - signal_id: event_match_quality_low
        metric: "EMQ (lead)"
        value: "4.2 / 10"
        window: as-of 2026-06-05
        source: <events manager link>
        clearance: client_specific
        fetched_at: 2026-06-05
    objection: "dev bandwidth (Jane, 2026-06-03 call)"
    unblock_condition: "dev agency onboarded OR client mentions dev capacity OR Shopify-native path confirmed viable"
    history:
      - 2026-05-28: email pitch sent (thread <id>)
      - 2026-06-03: call; objection logged; committed to partner-integration one-pager
    next_action: { type: deliver_commitment_then_follow_up, due: 2026-06-10, draft: ready }

  - rs_id: RS-2026-03918
    product: creative_diversification
    status: open
    local_state: evidence_ready
    bands:
      {
        commercial_value: medium,
        evidence_readiness: strong,
        client_readiness: ready,
        urgency: this_month,
        effort: low,
      }
    score_reason: "hero CTR -22% / 3wks; oldest ad 62d; May audit goodwill makes this a natural sequel"
    confidence: high
    evidence:
      - signal_id: creative_fatigue
        metric: "hero ad CTR"
        value: "-22%"
        window: 2026-05-15..2026-06-05
        source: <internal dashboard link>
        clearance: client_specific
        fetched_at: 2026-06-05
    history:
      - 2026-05-21: creative audit delivered (related groundwork)
    next_action: { type: pitch, due: 2026-06-12, draft: not_yet }

  - rs_id: RS-2026-05872
    product: click_to_message
    status: open
    local_state: unscored
    score_reason: "trial-booking business suggests fit, but no evidence gathered; do NOT stack on top of CAPI + creative asks"
    confidence: low
    discovery_action: "after CAPI lands: ask Marcus how trial inquiries are handled today (DMs? phone? form?)"
    history: []
```
