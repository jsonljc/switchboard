# <Client Name>: Communication Style

<!-- HUMAN-SEEDED; the agent suggests additions from your edit patterns (every draft edit you make -->
<!-- is a style signal, doc §11 L5). This file shapes every outbound draft for this client. -->

```yaml
per_contact:
  - contact: <name>
    channel: email | whatsapp
    register: <formal-short | casual | ...>
    format: <bullets vs prose; length cap>
    language:
    do: []
    dont: [] # e.g. no emojis, no jargon, never "circle back"

global_rules:
  - "numbers always carry a timeframe"
  - "<their-specific etiquette>"

cadence:
  follow_up_after_no_reply: <days>
  max_unanswered_touches: <n, then change channel or park>
```
