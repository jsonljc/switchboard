# Design lock manifest

Frozen 2026-05-13. Source URLs are minted snapshots from `api.anthropic.com/v1/design/h/`; all seven URLs returned byte-identical workspace tarballs at fetch time (verified by full-tree diff), so the locked content under `switchboard/` is a single canonical snapshot referenced by every surface below.

## Surfaces

| Surface             | Entrypoint (path under `locked/switchboard/project/`) | SHA-256 (entrypoint)                                               | Source URL                                                   |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Alex home           | `agent-home-v3/Alex Home v2.html`                     | `b2d26468373ad5439db2268c2ebfea58eae899c9ebfddc19dd13909308f24625` | https://api.anthropic.com/v1/design/h/Dj0lR9FN0hOExACWVtlRoQ |
| Riley home          | `agent-home-v3/Riley Home v2.html`                    | `740402734b548727c28c2b78124f27de6478464a8aef7ef16ba5b451089fe2b9` | https://api.anthropic.com/v1/design/h/C75hYXOZz3iqcx3dYyVBhA |
| Pipeline (contacts) | `agent-home-v3/Pipeline.html`                         | `766e56704ecf52da739ca4bc26d98d9cf182b9c2b4590bbefd05d2e600bd3d8f` | https://api.anthropic.com/v1/design/h/MEBu429ZtKACtBZhdFznxg |
| Approvals           | `approvals-v2/Approvals.html`                         | `59c12ab60f095e60238ee3872262938a6c13908c957d0f2b34ba10a3c6d9c8e6` | https://api.anthropic.com/v1/design/h/mTGhnY9yR2bEVZDBO0cp0A |
| Activity            | `activity-v2/Activity.html`                           | `a7a8e3eacea8a135f70486fecf922139f4dd5b81e21f3ee1094504bb3b457c9e` | https://api.anthropic.com/v1/design/h/1SF_KYF9herHoEKgK160kg |
| Reports             | `reports-v2/Reports.html`                             | `342b907179ca91e8051d92fe3a911f2be2effc7218875c70f030c02c6427a5c1` | https://api.anthropic.com/v1/design/h/AV4WzTZ004d4L9AmC_ij8A |
| Mission Control     | `mission/Mission.html`                                | `e4de68057d2b666c9e2dcaed8c422f08020fadf074b26dfbdff29dd6d5297d06` | https://api.anthropic.com/v1/design/h/Ps4ea_DHjXNxXD-VMFiTjA |

## Notes

- Alex home, Riley home, and Pipeline share the `agent-home-v3/` directory — they import the same `app.jsx` / `cockpit.jsx` / `data.jsx` / supporting components. When designing one, read the siblings of your entrypoint to understand the shared shell.
- Pipeline corresponds to the contacts/CRM redesign — the original Claude Design naming is "Pipeline" but the dashboard route is `/contacts`.
- Approvals and Mission are greenfield routes in the app (no existing dashboard UI). Activity, Reports, Contacts, and the per-agent home pages are rebuilds of existing routes.
- The original package README (`switchboard/README.md`) is the handoff guide written by Claude Design. It recommends reading chat transcripts before implementing — they live under `switchboard/chats/` and contain the user's intent record.
