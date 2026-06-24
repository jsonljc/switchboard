# <Client Name>: RS Ledger

<!-- Overlay on the RS system of record: NEVER invent rs_ids; mirror only what you annotate. -->
<!-- History is append-only. local_state values (doc §7.3): unscored | banded | evidence_ready | -->
<!-- pitch_drafted | pitched | objection_parked | won | lost. -->

```yaml
rs:
  - rs_id: <from the RS system>
    product:
    status: <mirror of system-of-record state>
    local_state:
    bands: { commercial_value, evidence_readiness, client_readiness, urgency, effort }
    score_reason: "<plain English: why this rank, what evidence>"
    confidence: high | medium | low
    evidence:
      - signal_id:
        metric:
        value:
        window:
        source: <link>
        clearance: client_specific
        fetched_at:
    objection: # if parked
    unblock_condition: # REQUIRED if parked: what would re-surface this
    history: # append-only
      - <date>: <event>
    next_action: { type, due, draft }
```
