# F-04: `NEXT_PUBLIC_REPORTS_LIVE=false` at prod default — Results/reports render fixture mode with a "demo data" banner

- **Severity:** embarrasses-pilot
- **Journey/step:** inventory
- **Verdict:** DORMANT
- **Location:** `apps/dashboard/src/lib/route-availability.ts:32,36` (gate); consumers `apps/dashboard/src/components/results/results-page.tsx:35`, `apps/dashboard/src/app/(auth)/(mercury)/reports/reports-page.tsx:29`, `.../reports/components/fixture-mode-banner.tsx:15`, `.../reports/hooks/use-paid-visits.ts:10`, `.../reports/hooks/use-report-data.ts:21` (verified against main on 2026-06-07)
- **Evidence:**
  - `route-availability.ts:36` `isMercuryToolLive(id)` returns `process.env[TOOLS_LIVE_ENV[id]] === "true"`; `reports → NEXT_PUBLIC_REPORTS_LIVE` (`:32`).
  - `.env.example`: `NEXT_PUBLIC_REPORTS_LIVE=false` (the only `_LIVE` flag shipped `false`; CONTACTS/AUTOMATIONS/ACTIVITY/APPROVALS are `true`).
  - `fixture-mode-banner.tsx:15` `if (isMercuryToolLive("reports")) return null;` — i.e. with the flag false the banner renders; `results-page.tsx:35` `const liveMode = isMercuryToolLive("reports")` drives fixture vs live data.

## What was exercised

Read the route-availability gate and every reader. Confirmed the prod default in `.env.example` and that the false branch renders the demo-data banner + fixture data.

## What happened vs expected

Expected: the Results surface shows the customer's real Meta spend/attribution. Observed: at the shipped default the page renders fixture data behind a visible "demo data" banner. This is intentional (launch is gated on a Meta Ads Connection + issue #472 per the env comment), but at prod default a pilot customer sees demo numbers on a flagship surface.

## Suggested fix scope

Per-deployment, flip `NEXT_PUBLIC_REPORTS_LIVE=true` (a Vercel env update + fresh build) once the org has a connected Meta Ads Connection; keep the fixture banner as the safe default. No code change — this is a launch-sequencing flag, tracked alongside the Meta gates.
