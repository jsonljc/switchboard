# <Client Name>: Contacts

<!-- Dedupe key = email/phone; merges are proposed by the agent, confirmed by you (doc §7.4). -->
<!-- Contact facts have a 90-day shelf life; the hygiene queue flags older ones for re-confirmation. -->

```yaml
contacts:
  - name:
    role: # and whether they DECIDE, influence, or operate
    email:
    phone_whatsapp: # + opt-in state if known
    preferred_channel: email | whatsapp | call
    language:
    notes: "<rapport notes: what they care about, history>"
    last_confirmed: <YYYY-MM-DD>
```

## Decision map (2 lines)

<!-- Who signs off on spend/product changes; who can block; current access path. -->
