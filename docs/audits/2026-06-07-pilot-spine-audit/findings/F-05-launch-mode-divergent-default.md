# F-05: `NEXT_PUBLIC_LAUNCH_MODE` divergent default — `.env.example` says `public`, but code-when-unset is `waitlist` (403 on signup)

- **Severity:** blocks-pilot (only if the prod env var is unset)
- **Journey/step:** inventory
- **Verdict:** DORMANT
- **Location:** `apps/dashboard/src/app/api/auth/register/route.ts:14-20` (reader) (verified against main on 2026-06-07)
- **Evidence:**
  - `register/route.ts:14` `const launchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";` — **fallback when entirely unset is `waitlist`**, not `public`.
  - `:12` `const OPEN_MODES = new Set(["beta", "public"]);` `:15-20` if `launchMode` not in OPEN_MODES ⇒ `403 "Registration is not available. Join the waitlist instead."`.
  - `.env.example:182` `NEXT_PUBLIC_LAUNCH_MODE=public`. The two defaults disagree: a deploy that copies `.env.example` is open; a deploy that simply omits the var is closed (403).

## What was exercised

Read the register route. Compared the `.env.example` documented default against the code's `|| "waitlist"` fallback.

## What happened vs expected

Expected: a single, consistent default. Observed: if the production environment does not explicitly set `NEXT_PUBLIC_LAUNCH_MODE`, signup is silently closed (403), contradicting the `.env.example` value of `public`. This is exactly the class of bug where the env-file default and the code-unset default diverge (cf. the `NODE_ENV insufficient on Vercel` memory note).

## Suggested fix scope

Explicitly set `NEXT_PUBLIC_LAUNCH_MODE` in the production/Vercel env to the intended mode for the pilot; optionally align the code fallback with the documented default (or make the divergence intentional and documented). Add a launch-checklist assertion that the var is set.
