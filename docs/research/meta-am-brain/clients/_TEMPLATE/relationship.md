# <Client Name>: Relationship State

<!-- AM-CONFIRMED class (doc §10): the agent SUGGESTS changes from observed signals -->
<!-- (reply latency, sentiment, meeting outcomes); trust_level and current_mood change ONLY when you confirm. -->
<!-- These fields steer outbound tone and gate the RS queue (client_readiness derives from here). -->

```yaml
relationship_state:
  trust_level: low | medium | high
  current_mood: positive | neutral | frustrated | disengaged
  decision_maker_access: direct | indirect | blocked
  current_objection: budget | bandwidth | skepticism | policy | measurement | none
  preferred_pitch_mode: data_first | case_study | strategic | tactical
  last_value_delivered: <date> "<what>" # stale >30d → next touch leads with value, not an ask
  next_best_relationship_move: educate | ask | escalate | celebrate | follow_up
  last_confirmed: <YYYY-MM-DD>
```

## Standing notes

<!-- Durable relationship facts: history, sensitivities, what won or lost trust before. -->
