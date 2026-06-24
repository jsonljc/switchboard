# CI Record Template

<!-- One per interaction, filed raw under interactions/raw/, rolled into the monthly digest. -->
<!-- A CI only counts if it meets the OFFICIAL definition (Phase -1, section A): mark countable accordingly. -->

```yaml
date: <YYYY-MM-DD>
type: call | email_thread | whatsapp | meeting | qbr
countable_ci: true | false # per the official definition
participants: []
summary: |
  <5 lines max>
rs_touched: [<rs_ids>]
commitments:
  - { by: AM | client, what, due }
sentiment: positive | neutral | frustrated | disengaged # suggestion only; relationship.md changes need your confirm
follow_up_draft: <path or none>
logged_to_official_tracker: true | false
```
