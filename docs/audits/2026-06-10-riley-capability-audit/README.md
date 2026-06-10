# Riley Capability Audit — 2026-06-10

Full-capability audit of Riley (the `ad-optimizer` agent) against `main` @ `84083f0c`, eight days after the [2026-06-02 improvement audit](../2026-06-02-riley-improvement-audit/FINDINGS.md) and the close of all Riley dev workstreams.

- **[FINDINGS.md](./FINDINGS.md)** — synthesis: thesis, current state, the "shipped but production-inert" meta-finding, confirmed P1s, prioritized backlog, north-star synergy verdict.
- **[domains/](./domains/)** — per-domain evidence reports with `file:line` citations:
  - `D1-decision-engine` — decision engine & statistical soundness
  - `D2-perception-ops` — perception, Meta integration & operational scale
  - `D3-economics-attribution` — economics & attribution truth
  - `D4-control-plane` — v3 control plane & pause execution path
  - `D5-governance-invariants` — governance & architecture invariants
  - `D6-cross-agent-synergy` — Alex/Riley/Mira flywheel
  - `D7-learning-measurement` — learning loop & measurement
  - `D8-cockpit-voice` — cockpit UI & conversational surface
  - `D9-backlog-reconciliation` — item-by-item reconciliation of the 2026-06-02 backlog
  - `critic-completeness` — completeness critic (found the credential-lifecycle axis no domain owned)

Method: 9 parallel domain auditors → adversarial verification (2 lenses per P1, refute-instructed) → completeness critic → hand re-verification of the critic's P1s. ~190 agents. Deterministic baseline: build green, ad-optimizer 613/613 tests, core 4016/4016, riley-recommendation eval 28/28.

Headline: zero P0s; governance spine sound; the dominant finding is that shipped capabilities are production-inert because org-onboarding producers (credentials, policies, economic config, flags) were never built.
