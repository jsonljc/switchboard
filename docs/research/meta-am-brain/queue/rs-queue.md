# RS Queue Snapshot

<!-- GENERATED format (Phase 3 automates; manual annotation in Phase 0). EXAMPLE DATA. -->
<!-- Ranking rules (doc §9.2): R0 pins → R1 coverage/pacing boosts → R2 readiness gates → R3 band sort -->
<!-- (urgency, commercial_value, evidence_readiness; effort = in-band penalty) → R4 numeric tiebreak within bands. -->
<!-- This file mirrors ONLY annotated RS. The RS system remains the source of record for all 500-1000. -->

```yaml
as_of: 2026-06-08

queue:
  # ---- R0 PINS ----
  - rs_id: RS-2026-02871
    client: bravo-retail
    product: advantage_plus
    pin: "Q2 program commitment" # pinned regardless of evidence
    bands:
      {
        commercial_value: high,
        evidence_readiness: moderate,
        client_readiness: blocked,
        urgency: this_month,
        effort: medium,
      }
    score_reason: "program-committed; BLOCKED on relationship (mood: frustrated) → repair first, pitch after"
    confidence: high
    required_human_judgment: true # sequencing call is yours

  # ---- R1-BOOSTED (coverage) ----
  - rs_id: RS-2026-05530
    client: delta-beauty
    product: creative_diversification # boost: undercovered family + meeting today
    bands:
      {
        commercial_value: high,
        evidence_readiness: strong,
        client_readiness: ready,
        urgency: now,
        effort: low,
      }
    score_reason: "3 of 4 ads >45d; frequency 6.2; monthly review today 14:00"
    confidence: high
    required_human_judgment: false

  - rs_id: RS-2026-03918
    client: acme-fitness
    product: creative_diversification # boost: undercovered family
    bands:
      {
        commercial_value: medium,
        evidence_readiness: strong,
        client_readiness: ready,
        urgency: this_month,
        effort: low,
      }
    score_reason: "hero ad CTR -22% over 3 wks; May creative audit landed well → natural sequel"
    confidence: high
    required_human_judgment: false

  - rs_id: RS-2026-06104
    client: echo-dental
    product: click_to_message # boost: undercovered family + untouched client
    bands:
      {
        commercial_value: medium,
        evidence_readiness: moderate,
        client_readiness: unknown,
        urgency: this_month,
        effort: low,
      }
    score_reason: "appointment business, zero message ads; readiness unknown → recap touch first, gauge"
    confidence: medium
    required_human_judgment: false

  # ---- PARKED (R2: blocked, with unblock conditions) ----
  - rs_id: RS-2026-04412
    client: acme-fitness
    product: capi
    local_state: objection_parked
    bands:
      {
        commercial_value: high,
        evidence_readiness: strong,
        client_readiness: blocked,
        urgency: this_month,
        effort: medium,
      }
    objection: dev_bandwidth (2026-06-03 call)
    unblock_condition: "dev agency onboarded OR client mentions dev capacity"
    next_action: "overdue one-pager (was due 06-05) goes out today; soft follow-up due 2026-06-10"
    score_reason: "EMQ 4.2 + zero server events = strongest evidence in the book; parked, not buried"
    confidence: high

  # ---- DISCOVERY (R2: unknown → ask, don't guess) ----
  - rs_id: RS-2026-07219
    client: foxtrot-cafe
    product: advantage_plus
    local_state: unscored
    discovery_action: "on quick-win touch, ask who manages campaigns now (in-house vs freelancer)"
    score_reason: "commercial_value unknown: spend too low to band without catalog/ops info"
    confidence: low
    required_human_judgment: false

  # ---- LATER (R3 banded down honestly) ----
  - rs_id: RS-2026-05988
    client: bravo-retail
    product: capi
    bands:
      {
        commercial_value: low,
        evidence_readiness: weak,
        client_readiness: blocked,
        urgency: later,
        effort: medium,
      }
    score_reason: "EMQ already 7.8; no current signal gap; revisit if measurement complaints appear"
    confidence: medium
```

**Feedback discipline (§9.4):** every accept/snooze/reject on a queue item carries a one-tap reason; the queue must visibly re-rank in response or you will (correctly) stop trusting it.
