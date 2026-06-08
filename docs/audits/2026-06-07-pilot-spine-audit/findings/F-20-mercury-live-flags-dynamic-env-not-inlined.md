# F-20: All Mercury-tool `NEXT_PUBLIC_*_LIVE` flags are read with a dynamic key Next.js never inlines — they are permanently `false` in the browser regardless of env

- **Severity:** embarrasses-pilot (flagship customer surfaces — Contacts, Results, Activity, Automations, Approvals — can NEVER render live data via these flags from the client; they show fixtures even when the env says `true`)
- **Journey/step:** J5-S2 (Results), J5-S3 (Contacts)
- **Verdict:** CONFIRMED BROKEN (exercised live: env says `true`, surface renders fixtures; root cause is structural, not a flag default)
- **Location (verified against `main`, worktree `audit/pilot-spine`, 2026-06-08):**
  - `apps/dashboard/src/lib/route-availability.ts:37` — `isMercuryToolLive(id)` returns `process.env[TOOLS_LIVE_ENV[id]] === "true"`. The env key is a **computed/bracket-indexed** lookup (`TOOLS_LIVE_ENV[id]`, `:30-36`), NOT a statically-written `process.env.NEXT_PUBLIC_FOO`.
  - Next.js inlines `NEXT_PUBLIC_*` into the client bundle **only for statically analyzable** `process.env.NEXT_PUBLIC_X` references. A dynamic `process.env[variable]` is left as-is; in the browser `process.env` is an (almost) empty object, so every `isMercuryToolLive(...)` returns `false` client-side.
  - There is no `env:` block in `apps/dashboard/next.config.mjs` and no runtime env shim, so nothing rescues the dynamic key at runtime.
  - The only reader is the dynamic-index call (grep: zero static `process.env.NEXT_PUBLIC_CONTACTS_LIVE` / `_REPORTS_LIVE` references in `apps/dashboard/src`).
  - Client consumers affected: `use-opportunities-board.ts:9,13,18` (Contacts → fixtures), `results-page.tsx:35`, `reports-page.tsx:29`, `fixture-mode-banner.tsx:15`, `use-paid-visits.ts`, `use-report-data.ts`, plus Activity/Automations/Approvals gates (`route-availability.ts:31-34`).
- **Evidence:**
  - `evidence/j5-contacts.png` — `NEXT_PUBLIC_CONTACTS_LIVE=true` in `apps/dashboard/.env.local`, yet `/contacts` renders the `PIPELINE_FIXTURE_*` opportunity board ("$10.1k pipeline", named demo leads) for an org with ZERO contacts, even after a 6 s settle wait.
  - Live API contradicts the UI: authed session-cookie `GET /api/dashboard/opportunities -> 200 {"rows":[]}` (empty, correct). If the flag were honored the board would show `<WholeBoardEmpty/>` (`pipeline-page.tsx:153-154`); instead the client falls into the `!live` branch (`use-opportunities-board.ts:18` returns `PIPELINE_FIXTURE_PAGE`).
  - `evidence/j5-results.png` — `/results` renders fixture numbers ($14,720 attributed, named Riley/Alex narratives) with no demo banner. (For Results the env default is genuinely unset → `false`, so fixtures are expected per F-04; but this finding shows the surface would stay fixture even if `NEXT_PUBLIC_REPORTS_LIVE=true` were set, because the flag is unreadable client-side.)
- **The test trap that hid this:** `apps/dashboard/src/lib/__tests__/route-availability.test.ts:16,48` uses `vi.stubEnv(envVar, "true")`, which mutates node's `process.env` so the dynamic bracket lookup resolves in jsdom and the test PASSES. The test does not replicate Next's build-time inlining, so it green-lights a flag that is dead in the real browser bundle (the "test with the REAL mechanism" gotcha — here the real mechanism is Next inlining, which the unit test cannot reproduce).

## What was exercised

Set `NEXT_PUBLIC_CONTACTS_LIVE=true` (already present in `.env.local`), logged in as `audit-pilot@example.com` via Playwright, navigated to `/contacts` and `/results`, and read the rendered PNGs. Cross-checked the live `/api/dashboard/opportunities` response (`{"rows":[]}`) over the session cookie to prove the API is empty while the UI shows fixtures. Confirmed the reader is a dynamic-index `process.env[...]` with no static reference and no `next.config` env passthrough.

## What happened vs expected

- **Expected:** with `NEXT_PUBLIC_CONTACTS_LIVE=true`, `/contacts` fetches and renders the org's real (empty) pipeline → empty-state.
- **Observed:** `/contacts` renders demo/fixture leads; the live empty API response is ignored because `isMercuryToolLive("contacts")` is `false` in the browser (dynamic key not inlined). A pilot customer with a real (or empty) pipeline sees fabricated demo opportunities on a flagship surface.

## Relationship to F-04

F-04 reported Results-fixture-mode as a flag-DEFAULT issue (`NEXT_PUBLIC_REPORTS_LIVE=false`) and quoted the `process.env[...]` line without diagnosing the inlining bug. F-20 is the deeper root cause and is broader: even flipping any of these flags to `true` per-deployment does NOTHING on the client. The Meta-gate launch sequence in F-04 ("flip `NEXT_PUBLIC_REPORTS_LIVE=true` once Meta is connected") would silently fail to switch Results to live until this is fixed. The flag-inventory rows marking CONTACTS/AUTOMATIONS/ACTIVITY/APPROVALS as "LIVE at prod default" are REFUTED for client-side gating.

## Suggested fix scope

Replace the dynamic lookup with a static map of `process.env.NEXT_PUBLIC_*_LIVE` references that Next can inline (e.g. an explicit `{ contacts: process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true", ... }` record keyed by `ToolsNavId`), or pass the flags through a server-rendered config provider. Add a build-level assertion (or a Playwright smoke that flips one flag and asserts the live empty-state renders) since unit tests with `vi.stubEnv` cannot catch the inlining gap. Re-verify all five surfaces after the fix.
