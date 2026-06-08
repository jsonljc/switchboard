# F-20: All Mercury-tool `NEXT_PUBLIC_*_LIVE` flags are read with a dynamic key Next.js never inlines — they are permanently `false` in the browser regardless of env

- **Severity:** blocks-pilot (customer-facing fixture leak across 5 surfaces: Contacts, Results, Activity, Automations, Approvals; AND the documented "flip env var to go live" launch step is permanently inert — pilot customers see fabricated named leads and pipeline $ while their live API returns empty)
- **Journey/step:** J5-S2 (Results), J5-S3 (Contacts)
- **Verdict:** CONFIRMED BROKEN + UPGRADED (adversarial review with bundle-level proof; exercised live: env says `true`, surface renders fixtures; root cause is structural, not a flag default)
- **Location (verified against `main`, worktree `audit/pilot-spine`, 2026-06-08):**
  - `apps/dashboard/src/lib/route-availability.ts:28-38` — `TOOLS_LIVE_ENV` maps tool ids to flag names (`:28-36`); `isMercuryToolLive(id)` returns `process.env[TOOLS_LIVE_ENV[id]] === "true"` (`:37`). The env key is a **computed/bracket-indexed** lookup, NOT a statically-written `process.env.NEXT_PUBLIC_FOO`.
  - Next.js inlines `NEXT_PUBLIC_*` into the client bundle **only for statically analyzable** `process.env.NEXT_PUBLIC_X` references. A dynamic `process.env[variable]` is left as-is; in the browser `process.env` is an (almost) empty object, so every `isMercuryToolLive(...)` returns `false` client-side. Built bundle ships the flag names as strings + a runtime `process.env[r[e]]` read against the browser's empty process.env.
  - There is no `env:` block in `apps/dashboard/next.config.mjs` and no runtime env shim. Nothing rescues the dynamic key at runtime.
  - The only reader is the dynamic-index call (grep: zero static `process.env.NEXT_PUBLIC_CONTACTS_LIVE` / `_REPORTS_LIVE` references in `apps/dashboard/src`).
  - All consumers are "use client" — no server-side rescue path exists:
    - `results-page.tsx:9,35` (Results)
    - `reports-page.tsx:29` (Reports)
    - `use-report-data.ts:21,34,55-63` — `:34` gates `enabled:isLive&&!!keys`; `:55-63` returns `FIXTURES_BY_WINDOW` when not live
    - `contacts/hooks/use-opportunities-board.ts:9,18` — `:18` returns `PIPELINE_FIXTURE_PAGE` when not live
    - `app-sidebar.tsx:98` (Activity/Automations/Approvals gates)
    - Activity/Automations hooks
- **Fixture leak detail:**
  - When `isMercuryToolLive` returns `false`, hooks return FIXTURES not empty state and never query the live API.
  - `use-report-data.ts:34` — `enabled:isLive&&!!keys` → React Query disabled → never fetches live data.
  - `use-report-data.ts:55-63` — returns `FIXTURES_BY_WINDOW` hardcoded window fixture data.
  - `use-opportunities-board.ts:18` — returns `PIPELINE_FIXTURE_PAGE`.
  - `contacts/fixtures.ts` — contains named fake leads with real-looking cents values.
  - Pilot customers see fabricated named leads and pipeline $ while their live API returns empty.
- **Launch trap:** the documented "flip `NEXT_PUBLIC_REPORTS_LIVE=true` after Meta connects" step is INERT — the env change does nothing client-side because the flag cannot be read in the browser bundle.
- **Evidence:**
  - `evidence/j5-contacts.png` — `NEXT_PUBLIC_CONTACTS_LIVE=true` in `apps/dashboard/.env.local`, yet `/contacts` renders the `PIPELINE_FIXTURE_*` opportunity board ("$10.1k pipeline", named demo leads) for an org with ZERO contacts, even after a 6 s settle wait.
  - Live API contradicts the UI: authed session-cookie `GET /api/dashboard/opportunities -> 200 {"rows":[]}` (empty, correct). If the flag were honored the board would show `<WholeBoardEmpty/>` (`pipeline-page.tsx:153-154`); instead the client falls into the `!live` branch (`use-opportunities-board.ts:18` returns `PIPELINE_FIXTURE_PAGE`).
  - `evidence/j5-results.png` — `/results` renders fixture numbers ($14,720 attributed, named Riley/Alex narratives) with no demo banner. (For Results the env default is genuinely unset → `false`, so fixtures are expected per F-04; but this finding shows the surface would stay fixture even if `NEXT_PUBLIC_REPORTS_LIVE=true` were set, because the flag is unreadable client-side.)
- **The test trap that hid this:** `apps/dashboard/src/lib/__tests__/route-availability.test.ts:16,48` uses `vi.stubEnv(envVar, "true")`, which mutates node's `process.env` so the dynamic bracket lookup resolves in jsdom and the test PASSES. The test does not replicate Next's build-time inlining, so it green-lights a flag that is dead in the real browser bundle. The browser bundle path is never exercised by the test suite.

## What was exercised

Set `NEXT_PUBLIC_CONTACTS_LIVE=true` (already present in `.env.local`), logged in as `audit-pilot@example.com` via Playwright, navigated to `/contacts` and `/results`, and read the rendered PNGs. Cross-checked the live `/api/dashboard/opportunities` response (`{"rows":[]}`) over the session cookie to prove the API is empty while the UI shows fixtures. Confirmed the reader is a dynamic-index `process.env[...]` with no static reference and no `next.config` env passthrough. Adversarial reviewer independently confirmed with bundle-level proof (built bundle ships flag names as strings + runtime `process.env[r[e]]` read).

## What happened vs expected

- **Expected:** with `NEXT_PUBLIC_CONTACTS_LIVE=true`, `/contacts` fetches and renders the org's real (empty) pipeline → empty-state.
- **Observed:** `/contacts` renders demo/fixture leads; the live empty API response is ignored because `isMercuryToolLive("contacts")` is `false` in the browser (dynamic key not inlined). A pilot customer with a real (or empty) pipeline sees fabricated demo opportunities on a flagship surface. The problem affects all 5 Mercury surfaces simultaneously.

## Relationship to F-04

F-04 reported Results-fixture-mode as a flag-DEFAULT issue (`NEXT_PUBLIC_REPORTS_LIVE=false`) and quoted the `process.env[...]` line without diagnosing the inlining bug. F-20 is the deeper root cause and broadens F-04: even flipping any of these flags to `true` per-deployment does NOTHING on the client. The Meta-gate launch sequence in F-04 ("flip `NEXT_PUBLIC_REPORTS_LIVE=true` once Meta is connected") would silently fail to switch Results to live until this is fixed. F-20 renders the flag-inventory "LIVE at prod default" verdicts for CONTACTS/AUTOMATIONS/ACTIVITY/APPROVALS WRONG — these flags are DORMANT (broken-client-side) regardless of env value.

## Suggested fix scope

Replace the dynamic lookup with a static per-flag map of explicit `process.env.NEXT_PUBLIC_*_LIVE` literal references that Next can inline (e.g. `{ contacts: process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true", reports: process.env.NEXT_PUBLIC_REPORTS_LIVE === "true", ... }` keyed by `ToolsNavId`), or pass the flags through a server-rendered config provider. Add a build-level assertion (or a Playwright smoke that flips one flag and asserts the live empty-state renders) since unit tests with `vi.stubEnv` cannot catch the inlining gap — the test that asserts the built client bundle resolves the flag (not just a vi.stubEnv Node test) is the key missing gate. Re-verify all five surfaces after the fix.
