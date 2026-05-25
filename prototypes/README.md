# Prototypes — design source (not product code)

Design-exploration artifacts for the customer-UX overhaul. **Not built or imported by the app** — they exist as reference for the implemented surfaces.

- `switchboard-morning.html` — the phone-first clickable prototype of the P1 "Front Desk" Home (morning check-in).
- `claude-design-prompt.md`, `claude-design-core.md`, `claude-design-prompt-inbox.md` — the self-contained prompts handed to Claude Design to build the interactive rebuild; their data shapes use the canonical `agentKey` / `externalEffect` / `financialEffect` / `clientFacing` / `requiresConfirmation` names for near rename-free wiring.

Implemented in PRs #688 (Home), #690 (risk contract + swipe), #696 (hardening). Frozen spec: `docs/superpowers/specs/2026-05-24-customer-ux-overhaul-design.md`.
