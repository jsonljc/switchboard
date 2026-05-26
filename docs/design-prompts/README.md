# Design Prompts

Paste-ready prompts for Claude Design (and similar UI-generation tools), grounded in this codebase's real schemas, routes, and design tokens.

Each prompt is verified against the backend at the moment it was written — file paths and schema references are quoted from actual code, not assumed. If a schema drifts after a prompt is written, regenerate the prompt rather than amend it.

## Index

- [/approvals](2026-05-13-approvals.md) — cross-agent governance queue. Greenfield (no UI yet).
- [/activity](2026-05-13-activity.md) — org-wide audit log rebuild. Existing UI; this is a denser editorial pass.
- [/mission](2026-05-13-mission.md) — operator command center across agents. Greenfield route; data hooks exist.
- [/reports](2026-05-13-reports.md) — renewal-checkpoint statement. Schema locked (PRs R1..R6); this is an editorial second pass.
- [/results](2026-05-26-results.md) — customer-facing Results tab (Home·Inbox·Results). Reuses the locked `ReportDataV1`; supersedes the 2026-05-13 `/reports` statement-page prompt for the customer surface. Producer-audited (corrected 2026-05-26).

## Locked design snapshots

Visual designs for this batch (Alex home, Riley home, Pipeline/contacts, Approvals, Activity, Reports, Mission) are frozen under [`locked/`](locked/) so parallel worktrees consume identical bytes. See [`locked/MANIFEST.md`](locked/MANIFEST.md) for the surface → entrypoint mapping and source provenance. Brainstorming sessions should reference `locked/switchboard/project/<dir>/<entrypoint>.html` rather than the original `api.anthropic.com/v1/design/h/...` URLs.

## Conventions

- Filename: `YYYY-MM-DD-<surface>.md`.
- First line is the title. Frontmatter not required.
- Always include the backend verification block (which files / schemas were checked) so a reader can decide if the prompt has gone stale.
- Always include an explicit anti-patterns section — generic SaaS aesthetics are the default failure mode.
