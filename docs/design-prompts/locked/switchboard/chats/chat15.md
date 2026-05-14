# Mission Page Design

_Started 2026-05-13 04:37 UTC_

---

## User

use pipeline, reports, activity, approval html as referene and riley and alex home html as well for inspiration design mission page

## Assistant

_[tool: list_files]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: update_todos]_

I have enough context. Let me plan and build the /mission page.

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: done]_

_[tool: fork_verifier_agent]_

Built /mission as a single React page following the editorial register from the other Switchboard surfaces.

**Three zones, queue-centric:**

- **Zone A — Now:** Cormorant greeting "Good morning, Jason." with a single-line pulse (3 approvals · 2 overdue · 7 inquiries +2 · 4 bookings), and an emergency-halt menu with per-agent confirm.
- **Zone B — Queue (65 / 35):** Nine items rendered as one uniform card type (APPROVAL / TASK / REC chip + risk pips + hairline left-edge depth instead of color). Inline expand opens a "review & confirm" drawer with the binding-hash ack pattern — no modal. Right column has 3 agent cards (Alex working, Riley idle, Mira waiting) — italic Cormorant names, hairline pill statuses.
- **Zone C — Context strip:** Funnel mini (CSS bars, no chart lib), revenue 7d in mono, bookings today with wa/tg/dash glyphs. Below: 8-row activity tail.

**Design system fidelity:**

- Operator-surface paper (`#F5F3F0` / amber `#A07850`) blended with the editorial Cormorant/Inter/JetBrains Mono type system already shipping in /approvals + /activity + /reports.
- No icons, no traffic lights, no KPI tiles, no charts — mono numerics, hairline outlines, amber depth for risk.
- Stat numbers never headline; the queue does.Done — `mission/Mission.html` is open. Verifier is running in the background.
