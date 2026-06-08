# F-09: Login is BROKEN under local production build — Auth.js v5 `UntrustedHost` (no `trustHost` set; rescued only by Vercel's auto-set `VERCEL` env)

- **Severity:** blocks-pilot (for any non-Vercel/local-prod runtime) / posture-caveat (on Vercel, auto-rescued)
- **Journey/step:** J1-S3 (login with auth ON)
- **Verdict:** BROKEN (exercised + failed under the audit's stated production posture; artifact captured). Auto-rescued on Vercel — see "Cross-reference / Vercel caveat".
- **Location:** `apps/dashboard/src/lib/auth.ts:83` (`authConfig` object — never sets `trustHost`); rescue logic in dependency `@auth/core/lib/utils/env.js:40` (verified against the running build on 2026-06-07)
- **Evidence:**
  - Exercised the real login twice. (1) CDP-driven browser: navigated to `http://localhost:3002/login`, filled `#email`/`#password` with the freshly-registered credentials, submitted; the page never left `/login` (driver `RESULT_JSON {"finalUrl":".../login","loggedIn":false}`). (2) Direct NextAuth probes: `GET /api/auth/csrf` → **HTTP 500** `{"message":"There was a problem with the server configuration..."}`; `GET /api/auth/session` → **HTTP 500** same body; `POST /api/auth/callback/credentials` → **HTTP 500** same body. Artifacts: `evidence/j1-login-auth-error.txt`, `evidence/j1-login-blocked.png` (full-page shot showing the login form, login blocked).
  - Server log root cause (reproducible): `/tmp/audit-dashboard.log` emits `[auth][error] UntrustedHost: Host must be trusted. URL was: http://localhost:3002/api/auth/{csrf,session,callback/credentials,providers,error}` for every auth request.
  - Config gap: `apps/dashboard/src/lib/auth.ts:83` `authConfig` sets `secret` (line 84) but **never sets `trustHost`**. Confirmed by `grep -n trustHost apps/dashboard/src/lib/auth.ts` → no match.
  - Dependency default (the decisive source): next-auth v5 beta.25 → `@auth/core@0.41.2`, `lib/utils/env.js:40-44`: `config.trustHost ??= !!(AUTH_URL ?? AUTH_TRUST_HOST ?? VERCEL ?? CF_PAGES ?? NODE_ENV !== "production")`. Under the audit posture `NODE_ENV==="production"` and **none** of `AUTH_URL` / `AUTH_TRUST_HOST` / `VERCEL` / `CF_PAGES` are set, so `trustHost` resolves to `false` and `@auth/core/lib/utils/assert.js:56` rejects every request.
  - Env-name mismatch is the underlying trap: the repo configures the **legacy** `NEXTAUTH_URL` / `NEXTAUTH_SECRET` names (root `.env` + `apps/dashboard/.env.local`). Auth.js v5's host-trust default reads `AUTH_URL` (the v5 name), **not** `NEXTAUTH_URL`, so the set `NEXTAUTH_URL=http://localhost:3002` does **not** opt into host trust.

## What was exercised

Registered a fresh org via the live `POST /api/auth/register` (HTTP 201), then attempted to
log in as that user through the real `/login` UI (CDP browser) and directly against the
NextAuth endpoints. Every auth endpoint returns `UntrustedHost`/500. Traced the cause from
`auth.ts` config → the installed `@auth/core` env defaults. The :3002 audit stack was not
modified; failure is reproducible on re-probe.

## What happened vs expected

Expected: a verified self-serve user signs in and lands on the authed app (`/post-auth` →
home). Observed: login is impossible — every NextAuth call 500s with `UntrustedHost`, the
browser stays on `/login`. Under the audit's stated production posture (local `next start`,
`NODE_ENV=production`, auth ON) login is fully BROKEN, which also blocks every downstream
authed surface (including the post-login lazy `AgentDeployment` creation chain; see J1-S2
notes).

## Suggested fix scope

Set `trustHost` deterministically rather than relying on platform-env inference. Either
(a) add `trustHost: true` to `authConfig` in `apps/dashboard/src/lib/auth.ts` (NextAuth runs
behind a trusted reverse proxy on Vercel and behind `next start` locally — host is always
controlled), or (b) standardize on the v5 env names by also exporting `AUTH_URL` /
`AUTH_SECRET` / `AUTH_TRUST_HOST` (and add to the env allowlist). Option (a) is the smaller,
self-documenting fix and removes the silent dependence on the `VERCEL` env. Add a boot/smoke
test that asserts `GET /api/auth/csrf` returns a token (not 500) under `NODE_ENV=production`.

## Cross-reference / Vercel caveat

This does **not** necessarily block the production pilot **on Vercel**: Vercel auto-sets the
`VERCEL` env var, which `@auth/core/lib/utils/env.js:42` treats as a trust signal, flipping
`trustHost` to `true`. So on the real deploy host (see MEMORY: `deploy host = Vercel`) login
likely works today. The risk is real and blocks-pilot for: (1) any non-Vercel / self-hosted
/ local-prod runtime, (2) Vercel **preview** deployments if the proxy/host differs, and
(3) the audit's own ability to exercise the post-login journey locally. It is recorded as a
fragility finding because correct production auth depends on an _implicit, platform-injected_
env var rather than explicit config. Login was not exercisable end-to-end in this audit;
J1-S2's lazy `AgentDeployment` chain is therefore verdicted from source + as
unreachable-while-login-is-broken (see `evidence/deviations.md` D-01).
