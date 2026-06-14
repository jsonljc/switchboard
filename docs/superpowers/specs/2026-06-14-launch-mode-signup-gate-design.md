# F-05: enforce launch-mode across all self-serve signup entry points

- Date: 2026-06-14
- Branch: `fix/launch-mode-oauth-gate`
- Verified against: `origin/main` @ b968f1da
- Finding: pilot-spine audit F-05 (+ the OAuth adjacent flagged during F-02)

## Problem

`NEXT_PUBLIC_LAUNCH_MODE` is meant to gate self-serve signup (`waitlist` = closed). The password
register route enforces it (`apps/dashboard/src/app/api/auth/register/route.ts:12-21`: 403 unless
mode is `beta`/`public`), but the NextAuth `createUser` adapter (`apps/dashboard/src/lib/auth.ts:87`)
calls `provisionDashboardUser` UNCONDITIONALLY. So Google OAuth and magic-link email sign-in
provision a brand-new org even in `waitlist` mode, bypassing the gate. This is the same adjacent gap
flagged in the F-02 work. With F-02 now comping every freshly provisioned org, an ungated signup path
means anyone who completes OAuth/email gets a working comped org.

## GTM decision (my pick, per "proceed with my pick")

Pilot posture: **`waitlist`** (closed self-serve). The pilot is a small set of hand-vetted clinics, so
public self-serve should be closed; vetted pilots are onboarded by ops (pre-provisioned via
`provisionDashboardUser`, which is not behind the route gate). This coheres with F-02: the comp is
only safe while the registration surface is bounded. `waitlist` is also the fail-closed default (an
unset `LAUNCH_MODE` must NOT open public signup).

The posture itself is an env setting (operational), not hardcoded. This change makes the code ENFORCE
whatever `LAUNCH_MODE` says, consistently across every self-serve entry point.

## Fix

1. Add one shared, fail-closed helper `isSelfServeSignupOpen()` in
   `apps/dashboard/src/lib/register.ts` (the existing registration-logic module): returns true only
   when `NEXT_PUBLIC_LAUNCH_MODE` is `beta` or `public`; defaults to closed (allowlist, not denylist:
   false for `""`/undefined/unknown). Read at call time (static `process.env.NEXT_PUBLIC_LAUNCH_MODE`,
   server-side, so it is inlined/readable and testable via `vi.stubEnv`; not a dynamic bracket read,
   so the F-20 `no-dynamic-public-env` guard is satisfied).
2. `register/route.ts`: replace the inline `OPEN_MODES` check with the helper (DRY).
3. `auth.ts` add a `callbacks.signIn` (primary denial seam, per plan review): when signup is closed,
   allow `credentials` logins and any sign-in whose email already exists (pre-provisioned pilots,
   resolved by `prisma.dashboardUser.findUnique({ where: { email } })`), and deny only NET-NEW
   OAuth/email sign-ins. Returning `false` throws the client-safe `AccessDenied` (user lands on
   `/login?error=AccessDenied`) and runs BEFORE any adapter/DB write. The existence check is what
   prevents locking out existing pilots, and it is directly unit-testable.
4. `auth.ts` `createUser`: keep a fail-closed backstop. If signup is closed, `console.warn` (so the
   server log shows a deliberate policy denial, not a config error) and throw before calling
   `provisionDashboardUser`. This is defense-in-depth: `signIn` already denies net-new users, so in
   practice `createUser` is never reached for them in closed mode, but the throw guarantees no comped
   org is ever minted if a future change bypasses `signIn`.

Why `signIn` (not only the `createUser` throw): a raw throw inside `createUser` is wrapped by
`@auth/core` as a non-client-safe `CallbackRouteError`, so the user sees a misleading
`error=Configuration` and it is logged as a server misconfiguration. `signIn -> false` yields the
correct `AccessDenied` semantics and runs earlier. Both providers (Google OAuth, magic-link email)
route new users through `signIn` then `createUser`, so this covers both. Credentials logins never
touch the adapter and are explicitly allowed.

## Safety / why this does not lock out vetted pilots

NextAuth calls the adapter `createUser` ONLY for a genuinely new email. A pre-provisioned pilot
(ops created their `DashboardUser` with their email) is resolved by `getUserByEmail`
(`auth.ts:115`) and never reaches `createUser`, so the gate does not affect them. The gate blocks only
net-new self-serve signups, exactly as `waitlist` intends. Existing-user login (CredentialsProvider
`authorize`, OAuth for an already-linked account) is untouched. Ops onboarding of a new vetted pilot
is a pre-provision step (`provisionDashboardUser` directly), which is not behind the route gate.

## Non-goals

- Not changing the code default (`waitlist`, fail-closed) or `.env.example` (`public` is a local-dev
  convenience; local is not prod). The real bug is the ungated OAuth/email path, not the default.
- No allowlist/invite mechanism (out of scope; the waitlist capture endpoint stays as-is).

## Test strategy (TDD)

1. `register.ts` helper unit test: `isSelfServeSignupOpen()` is false for `waitlist`/undefined/unknown,
   true for `beta`/`public` (drive via `vi.stubEnv`). Allowlist, not denylist.
2. `auth.ts signIn` callback tests (existing harness already mocks prisma `dashboardUser.findUnique`,
   next-auth, providers): closed + new email (findUnique -> null) -> `false`; closed + EXISTING email
   (findUnique -> a user) -> `true` (THE no-lockout invariant the gate must never break); open
   (beta/public) -> `true`; `credentials` provider -> `true`.
3. `auth.ts createUser` backstop test (mock `../provision-dashboard-user`): closed -> rejects AND
   `provisionDashboardUser` NOT called; open -> provisions.
4. `register/route.ts` still 403s in `waitlist` via the shared helper (existing route test already
   covers `waitlist` 403 / `beta` allow / `public` allow; keep green after the refactor).

## Required follow-up before flipping prod to `waitlist` (named, not in this PR)

Closing self-serve strands pilot onboarding unless ops has a real provisioning entrypoint. Today the
only callers of `provisionDashboardUser` are the (now-gated) register route and OAuth adapter, and
`/api/setup/bootstrap` is first-user-only and does not set `entitlementOverride`/`businessHours` (so
it cannot onboard pilot #2 with a working comped org). Before setting `NEXT_PUBLIC_LAUNCH_MODE=waitlist`
in prod, add a small `scripts/provision-pilot.ts` that wraps `provisionDashboardUser` (email + name),
so vetted pilots can be onboarded out-of-band. This PR ships the enforcement; the ops entrypoint and
the env flip are the operational prerequisites.

Note: `.env.example` keeps `NEXT_PUBLIC_LAUNCH_MODE=public` (local-dev convenience) while the code
default is `waitlist` (fail-closed). So local dev has open signup and prod is closed by default; this
is intentional, called out here so nobody "tests the gate" locally and sees it open.

## Verification gate

typecheck; dashboard test; dashboard `next build`; `build`; lint; `format:check`; `arch:check`;
`CI=1 local:verify:fast`.

## Done when

Launch-mode is enforced at register + OAuth + email; pre-provisioned pilots are unaffected; tests pin
both the helper and the `createUser` gate; gate green; PR squash-merged; ledger + memory updated.
