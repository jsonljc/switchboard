# Acme Fitness: Contacts

<!-- WORKED EXAMPLE: fictional people. -->

```yaml
contacts:
  - name: Jane Tan
    role: "CMO: DECIDES spend + product adoption"
    email: jane@<redacted>.example
    phone_whatsapp: "+65 <redacted> (opted in 2026-02-10)"
    preferred_channel: email
    language: English
    notes: "data-skeptical in a healthy way; hates feeling sold to; warmed notably after May creative audit"
    last_confirmed: 2026-05-30

  - name: Marcus Lim
    role: "performance marketing lead: OPERATES day-to-day, influences Jane"
    email: marcus@<redacted>.example
    phone_whatsapp: "+65 <redacted> (opted in 2026-01-20)"
    preferred_channel: whatsapp
    language: English
    notes: "responsive, hands-on; the practical route for anything technical (pixel access, agency coordination)"
    last_confirmed: 2026-06-05
```

## Decision map (2 lines)

Jane signs off on anything touching budget or new products; Marcus can green-light operational changes (creative swaps, tracking work) up to "needs dev/agency."
Access: direct to both. Dev work goes through an external agency they are CURRENTLY ONBOARDING (the CAPI unblock condition).
