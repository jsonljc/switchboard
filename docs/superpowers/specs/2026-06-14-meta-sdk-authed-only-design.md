# Spec: load Meta's JS SDK in the authenticated app only

Date: 2026-06-14
Branch: `fix/meta-sdk-auth-only`
Author: Claude (Opus, plan phase)
Status: approved with tweaks (review folded in 2026-06-14)

## 1. Problem

`apps/dashboard/src/app/layout.tsx` is the root layout. It wraps every route in
the dashboard, including the `(public)` route group. Today it conditionally
mounts Meta's JavaScript SDK directly in `<body>`:

```tsx
{
  process.env.NEXT_PUBLIC_META_APP_ID && (
    <Script
      src="https://connect.facebook.net/en_US/sdk.js"
      strategy="lazyOnload"
      onLoad={() => {
        window.FB?.init({
          appId: process.env.NEXT_PUBLIC_META_APP_ID!,
          cookie: true,
          xfbml: true,
          version: "v21.0",
        });
      }}
    />
  );
}
```

Because the root layout wraps the `(public)` group, this script tag is emitted
on the patient-facing `/payment/success` and `/payment/cancel` pages shipped in
#1015, plus `/welcome`, `/privacy`, `/terms`, and the root-level auth-flow pages
(`/login`, `/forgot-password`, `/reset-password`, `/post-auth`). Those are all
unauthenticated surfaces. The SDK exists only for the operator Meta connection
flow, so loading it for unauthenticated SG/MY visitors with no consent is a
PDPA exposure we do not want live when the deposit loop flips.

## 2. Findings that reshape the fix

Verifying against `origin/main` (99cd5993) before designing surfaced three facts
that change the shape of the correct fix. They are recorded here because the fix
follows from them.

### 2.1 The real SDK consumer is the WhatsApp embedded-signup component

The task brief names `connections-list.tsx` as the only consumer. In fact
`connections-list.tsx`'s own OAuth path is a plain redirect
(`window.location.href = getUrl()`), not a `window.FB` call. The actual
`window.FB` consumer is `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx`
(`window.FB.login(...)` at line 51), which `connections-list.tsx` renders only
when `serviceId === "whatsapp" && process.env.NEXT_PUBLIC_META_APP_ID`. That
component lives on the `/settings` page, which is inside the `(auth)` route
group. The `window.FB` type is currently declared there via `declare global`.
This spec relocates that type to a dedicated `src/types/facebook.d.ts` (see
section 5) so the loader and the consumer share an explicit global type rather
than a hidden cross-file dependency.

The init call (`window.FB.init`) is also a consumer: it is the side effect of
the SDK's `onLoad`. Both `init` (loader) and `login` (signup) need the SDK
present on the authed settings surface.

### 2.2 The CSP has never allowed `connect.facebook.net`

`apps/dashboard/next.config.mjs` sets a global CSP for `source: "/:path*"`. Its
`script-src` is `'self' 'unsafe-inline'` (plus `'unsafe-eval'` in dev only).
There is no `connect.facebook.net` allowance, and the full git history of
`next.config.mjs` confirms there never has been. CSP `script-src` is enforced at
the fetch stage, so the browser refuses to even request
`https://connect.facebook.net/en_US/sdk.js` on every route.

Consequences:

- The present-day public exposure is **latent, not active**: under the shipped
  CSP no network request to Facebook is actually made from the patient pages.
  The script tag is in the HTML, but the fetch is blocked.
- The operator WhatsApp embedded-signup flow is **also non-functional today**:
  `window.FB` is never defined because the SDK is fetch-blocked, so
  `whatsapp-embedded-signup.tsx` always hits its `if (!window.FB)` error branch.
- The exposure becomes **active the moment the CSP is relaxed** to allow
  `connect.facebook.net`, which is exactly the step required at live-flip to
  make the operator Meta flow work. If we relaxed the CSP without first scoping
  where the SDK renders, every patient page would start loading Meta's SDK.

This is why the principled fix is two coordinated changes in one atomic PR:
scope **where** the SDK renders (authed only) **and** add the CSP allowance that
makes the authed flow actually work. Doing only the first leaves the operator
flow dead and makes the verification "authed page loads the SDK" impossible.
Doing only the second would turn the latent exposure into an active one.

### 2.3 `NEXT_PUBLIC_META_APP_ID` is unset locally

The local `apps/dashboard/.env.local` has no `NEXT_PUBLIC_META_APP_ID`, so the
script does not render at all locally today. Running-app verification will set a
dummy non-secret app id in the local env only (never committed) so the script
renders and the authed-vs-public difference is observable in the network panel.

## 3. Goals and non-goals

### Goals

1. The unauthenticated surface (at minimum the patient-facing `/payment/*`
   pages, and in practice the entire `(public)` group plus the root-level
   auth-flow pages) emits no Meta SDK script tag and defines no `window.FB`.
2. The authenticated app continues to load the SDK so `window.FB` is available
   where `whatsapp-embedded-signup.tsx` expects it, and the operator Meta
   connection path keeps working. After this change it actually works (it was
   CSP-blocked before), and that is demonstrable in the running app.
3. The `/payment/*` pages stay public, static, no-PII, and `noindex` (the #1015
   invariants). `next build` still reports them as static.

### Non-goals

- No consent-management system or consent banner (YAGNI; we omit tracking on
  patient pages, so no consent is required).
- No per-route CSP engine. The CSP allowance stays global; render-time exclusion
  is the protection. Rationale in decision 4.
- No changes to settlement, the deposit loop, the payment-port factory, or the
  #1027 readiness check.
- No change to the embedded-signup UX (the readiness/loading-state hardening for
  the lazyOnload timing risk in section 4.5 is an explicit follow-up, not part of
  this PR).

## 4. Design decisions (forks resolved)

### Decision 1: placement mechanism

**Chosen: a small `"use client"` component (`MetaSdkScript`) that encapsulates
the guarded `<Script>`, mounted in `(auth)/layout.tsx`, removed from the root
layout.**

- Rejected A (move the `<Script>` directly into `(auth)/layout.tsx`):
  `(auth)/layout.tsx` is an async Server Component. `next/script`'s `onLoad`
  handler can only run in a Client Component, so the `<Script onLoad=...>` must
  sit behind a `"use client"` boundary. A dedicated client component is the
  clean way to provide that boundary.
- Rejected C (session-gated conditional render kept in the root layout): still
  renders inside a layout reachable by the `(public)` group, which the brief
  calls the wrong answer, and it bloats the root layout with auth logic.

The chosen component renders the identical `<Script>` (same `src`, same
`strategy="lazyOnload"`, same `onLoad` calling `window.FB?.init` with the same
parameters), plus a stable `id` for dedup and debuggability, so authed behavior
is byte-identical aside from now actually loading (CSP permitting). The `(auth)`
layout (Server Component) renders `<MetaSdkScript />` (Client Component), which
is the standard server-renders-client pattern.

### Decision 2: scope

**Chosen: scope to the `(auth)` route group via the layout. The entire
unauthenticated surface loses the SDK as a consequence.**

- Rejected A (special-case only `/payment/*`): more code (path special-casing),
  and it would leave the SDK on `/welcome`, `/privacy`, `/terms`, `/login`,
  `/forgot-password`, `/reset-password`. The brief's default is to remove
  third-party tracking from the entire unauthenticated surface unless a public
  page genuinely needs it. None of those pages need the Meta SDK.

The existing `(auth)`/`(public)` route-group split is already the auth boundary
(confirmed by `middleware.ts`: `/payment`, `/welcome`, `/privacy`, `/terms`,
`/login`, and the password-reset endpoints are all outside `AUTH_PAGE_PREFIXES`).
Mounting the SDK in `(auth)/layout.tsx` reuses that boundary exactly, with no new
gating logic, session reads, or path matching. The SDK loads for the `(auth)`
group (which includes `/settings`, where the consumer lives) and nowhere else.

**Intentional breadth (documented for reviewers):** this loads the Meta SDK
across the entire authenticated operator app, not only `/settings`. That is a
deliberate choice, not an oversight. The authenticated app is a trusted operator
surface (logged-in business users connecting their own Meta accounts), so the
PDPA concern (unauthenticated patients) does not apply there. A narrower
settings-only mount would reduce third-party exposure on non-settings operator
routes, but it reintroduces the lazyOnload timing race (section 4.5): mounting at
the `(auth)` layout lets the SDK lazy-load while the operator navigates toward
`/settings`, so `window.FB` is far more likely to be ready before they open the
connection dialog. We trade marginally broader (but trusted) exposure for load
reliability.

### Decision 3: consent versus omit

**Chosen: omit the SDK entirely on public pages.** No tracking means no PDPA
consent obligation. This is simpler and safer than a banner, and matches the
brief's preference. We do not deviate.

### Decision 4: CSP

**Chosen: add `https://connect.facebook.net` to `script-src` (dev and prod),
keep the CSP global, and rely on authed-only rendering to keep public pages
clean. Add a regression test as the compensating control.**

Rationale:

- The authed flow needs `connect.facebook.net` in `script-src` to load at all
  (finding 2.2). Adding it makes the operator flow functional and makes the
  required verification ("authed page loads the SDK") possible.
- `img-src` is already `'self' data: https:` (covers fbcdn images) and
  `connect-src` is already `'self' https:` (covers any graph.facebook.com XHR),
  so the **only** directive that needs a change is `script-src`. No `fbcdn` or
  pixel host needs adding. The `FB.login` popup navigates to facebook.com in a
  separate window, which is governed by Facebook's origin, not our CSP.
- The allowance is added in both dev and prod because the operator flow runs in
  both, and local verification needs it in dev. It slots into the existing
  dev/prod branch: `script-src 'self' 'unsafe-inline' https://connect.facebook.net${isDev ? " 'unsafe-eval'" : ""}`.
- Rejected A (leave CSP unchanged): the authed flow stays dead and the DONE
  criterion "authed page loads the SDK, verified in the running app" cannot be
  met.
- Rejected C (per-route CSP, strict on public and relaxed on authed, via
  middleware): route groups are URL-transparent (no path prefix), and the
  middleware matcher does not even run on public paths today, so this needs a
  matcher expansion plus a second CSP source of truth. High complexity for
  marginal defense-in-depth. YAGNI.

**The privacy boundary is render-time exclusion plus regression tests, not the
CSP.** Because Next.js `headers()` is global, the CSP now permits
`connect.facebook.net` on every route. CSP is an allow-list, not an action: it
never causes a load; only a rendered `<script>` tag does. After this change only
`(auth)` pages render one, so only they load the SDK. The honest consequence is
that the global allowance no longer blocks a _future_ accidental insertion of a
`connect.facebook.net` script on a public page. The compensating controls are:

1. A `next.config.mjs` comment on the `script-src` line stating that the
   allowance is global and that render-time exclusion (mounting the SDK only in
   the `(auth)` layout) is the real public-surface guard.
2. A regression test (`meta-sdk-surface`) that scans the whole `(public)` route
   subtree and the root and public layouts and asserts none of them reference
   `connect.facebook.net` or `MetaSdkScript`. This is a cheap tripwire, not an
   authoritative guarantee (see section 6); the running-app check is the proof.

### 4.5 Known runtime risk: lazyOnload timing (follow-up, not this PR)

The SDK loads with `strategy="lazyOnload"` (on browser idle). An operator who
opens the WhatsApp connection dialog and clicks "Connect WhatsApp" before the SDK
finishes loading hits the existing guard in `whatsapp-embedded-signup.tsx`:
`if (!window.FB) { setError("Meta SDK not loaded. Please refresh the page."); }`.
That is a degraded message, not a crash.

Mitigation already in this design: mounting at the `(auth)` layout (decision 2)
starts the lazy load as soon as the operator enters the authed app, well before
they navigate to `/settings`, open the dialog, and click. So the race is
unlikely in practice. Note that before this PR the flow never worked at all
(CSP-blocked), so this is a new consideration only because the flow now functions.

Recommended follow-up (out of scope here, called out so reviewers do not expect
it in this PR): give the connect button a disabled or "Loading Meta..." state
until `window.FB` exists, driven either by a small readiness signal emitted from
`MetaSdkScript`'s `onLoad` or by the embedded-signup component observing
readiness. This PR is about where the SDK loads, not the signup UX.

### 4.6 Session gate (added after code review)

High-effort review surfaced that the `(auth)` route group is not a perfect proxy
for "authenticated." A few `(auth)` routes (`/mira`, `/operator`) are absent from
the middleware auth matcher (`AUTH_PAGE_PREFIXES` in `middleware.ts`), so an
unauthenticated request can reach the `(auth)` layout: the layout fetches the
session but does not redirect on null. Mounting the SDK unconditionally in the
`(auth)` layout would therefore load it for an unauthenticated visitor to those
two routes once the CSP allows the host. That contradicts the PR's goal.

Resolution (in scope, no middleware change): gate the mount on the session the
layout already fetches, `{session && <MetaSdkScript />}`. `getServerSession()`
returns a truthy session for an authenticated user (and the dev-bypass session in
local dev) and `null` for an unauthenticated request in production, so the SDK
loads only for a real authenticated session, independent of the middleware gap or
any future un-gated `(auth)` route. Verified in the running app: with no
dev-bypass (null session), `/mira` and `/operator` issue no `connect.facebook.net`
request and define no `window.FB`, even with the app id set; with an
authenticated session, `/settings` loads the SDK.

Residual follow-up (separate, out of scope): `/mira` and `/operator` should be
added to the middleware auth matcher. They are operator routes that currently
render for unauthenticated requests, which is a broader concern than the SDK
(potential operator-data exposure) and warrants its own focused, security-
reviewed change. This PR does not modify auth-gating.

## 5. Detailed design

### New file: `apps/dashboard/src/types/facebook.d.ts`

An ambient (non-module) global type declaration for `window.FB`, moved out of
`whatsapp-embedded-signup.tsx`. `src/types/` already holds global type files
(`css.d.ts`, `next-auth.d.ts`) and is covered by the tsconfig `include`
(`**/*.ts`). Centralizing the type removes the hidden cross-file dependency the
loader and the consumer would otherwise have on a `declare global` block inside
an unrelated component.

```ts
interface Window {
  FB?: {
    init(params: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
    login(
      callback: (response: { authResponse?: { accessToken: string } }) => void,
      params: {
        config_id: string;
        response_type: string;
        override_default_response_type: boolean;
        extras: Record<string, unknown>;
      },
    ): void;
  };
}
```

The `declare global { interface Window { FB?: {...} } }` block is removed from
`whatsapp-embedded-signup.tsx`; its `window.FB.login` call now resolves against
this file.

### New file: `apps/dashboard/src/components/settings/meta-sdk-script.tsx`

A `"use client"` component. Home chosen: `components/settings/`, beside the other
Meta integration components. It renders the same env-guarded `<Script>` the root
layout has today, plus a stable `id`:

```tsx
"use client";
import Script from "next/script";

export function MetaSdkScript() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  if (!appId) return null;
  return (
    <Script
      id="meta-facebook-sdk"
      src="https://connect.facebook.net/en_US/sdk.js"
      strategy="lazyOnload"
      onLoad={() => {
        window.FB?.init({ appId, cookie: true, xfbml: true, version: "v21.0" });
      }}
    />
  );
}
```

Note: `process.env.NEXT_PUBLIC_META_APP_ID` is read as a static member access so
Next.js inlines it client-side (a dynamic bracket read would be undefined in the
browser; see memory `feedback_next_public_dynamic_env_not_inlined`). The value is
captured into `appId` once and reused. The `window.FB?` optional chaining keeps
`onLoad` a safe no-op if the SDK object is not present.

### Changed: `apps/dashboard/src/app/(auth)/layout.tsx`

Import `MetaSdkScript` and render it gated on the authenticated session the
layout already fetches: `{session && <MetaSdkScript />}` (alongside
`<Toaster />`). See section 4.6 for why the gate is on the session, not just
route-group membership.

### Changed: `apps/dashboard/src/app/layout.tsx` (root)

Remove the Meta SDK `<Script>` block (lines ~101-114) and the now-unused
`import Script from "next/script"`. The root layout returns to fonts +
`QueryProvider` + `children`. The `window.FB` reference leaves the root layout.

### Changed: `apps/dashboard/next.config.mjs`

`script-src` gains `https://connect.facebook.net`, with a comment on the global
allowance and the render-time-exclusion boundary:

```js
// connect.facebook.net is allowed globally (Next headers() is global). The SDK
// is rendered ONLY by the (auth) layout (MetaSdkScript), so only authed pages
// load it. Render-time exclusion, not this allowance, is the public-surface
// guard. See docs/superpowers/specs/2026-06-14-meta-sdk-authed-only-design.md.
`script-src 'self' 'unsafe-inline' https://connect.facebook.net${isDev ? " 'unsafe-eval'" : ""}`,
```

No other directive changes.

### Atomicity

All changes land in one PR. There is no intermediate state where a public page
both renders the tag and the CSP allows it. After merge: public pages render no
tag (CSP allowance is unused there); authed pages render the tag and the CSP
permits the load.

## 6. Testing strategy

TDD drives the new unit; structural regression tests act as cheap tripwires; the
running app is the authoritative integration proof (per the brief). The
structural tests are explicitly _tripwires_, not guarantees: a regression that
hides the SDK URL behind a constant, env var, helper, or dynamic import could
slip past a source-text scan. The running-app checks (section 7) are what
actually prove the behavior.

1. **Unit (TDD core): `meta-sdk-script.test.tsx`.** Mock `next/script` to a
   prop-capturing stub (so we do not depend on `lazyOnload`'s deferred injection
   in jsdom). Assert:
   - With `NEXT_PUBLIC_META_APP_ID` set: renders the stub with the FB `src`,
     `strategy="lazyOnload"`, and `id="meta-facebook-sdk"`; its `onLoad` calls
     `window.FB.init` with `{ appId, cookie: true, xfbml: true, version: "v21.0" }`.
   - With `NEXT_PUBLIC_META_APP_ID` set but `window.FB` undefined: `onLoad` does
     not throw (optional-chaining no-op).
   - Without `NEXT_PUBLIC_META_APP_ID`: renders nothing.
     Env is controlled with `vi.stubEnv`; the static read plus the `next build`
     gate validate the client-side inlining.
2. **Structural tripwire: `meta-sdk-surface.test.ts`.** Assert the SDK is mounted
   only by the `(auth)` layout: `(auth)/layout.tsx` imports and renders
   `MetaSdkScript`; the root layout and **every file under the `(public)`
   subtree** reference neither `MetaSdkScript` nor `connect.facebook.net`; the
   SDK url is centralized in `meta-sdk-script.tsx`; and `next.config.mjs`'s
   `script-src` directive contains `https://connect.facebook.net` (directive-aware
   parse, not a whole-file substring).
3. **Running-app verification (authoritative).** Section 7.

The new component's branches are all covered, keeping the dashboard coverage
thresholds (40/35/40/40) satisfied.

## 7. Running-app verification plan

With a dummy non-secret `NEXT_PUBLIC_META_APP_ID` set in the local
`apps/dashboard/.env.local` only (never committed) and `DEV_BYPASS_AUTH` enabled
for the authed pages:

1. Load `/payment/success`, `/payment/cancel`, and `/welcome`. Confirm in the
   network panel: **no** request to `connect.facebook.net`, and `window.FB` is
   `undefined`.
2. Load an authed page and reach `/settings`. Confirm: a request to
   `connect.facebook.net/en_US/sdk.js` succeeds (not CSP-blocked, no CSP console
   violation), `window.FB` is defined, and the WhatsApp embedded-signup button
   renders without the "Meta SDK not loaded" error.
3. Confirm the emitted CSP header allows the host: `curl -sI` an authed route and
   a public route and check the `Content-Security-Policy` response header's
   `script-src` directive contains `https://connect.facebook.net` (the
   authoritative CSP check, versus the source-text tripwire).
4. Confirm `next build` lists `/payment/success` and `/payment/cancel` as static.

**What this proves vs does not prove.** Proven by the above: public pages issue
no SDK request and define no `window.FB`; the authed page requests the SDK with
no CSP block and defines `window.FB`; `/payment/*` stay static. **Not proven
here:** a real Meta business login / embedded-signup completing end-to-end, which
needs a real production `NEXT_PUBLIC_META_APP_ID` and a real Meta business
account. PR evidence will say "SDK availability and load-location verified," not
"full Meta connection flow verified."

## 8. Pre-PR gates (all must be green)

- `pnpm build` (builds deps + the dashboard `next build`; catches `.js`-import
  misses and route-group issues; offline-safe). Satisfies the
  `pnpm --filter @switchboard/dashboard build` gate.
- `pnpm --filter @switchboard/dashboard test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm arch:check`

Run `pnpm reset` first only if stale-export typecheck noise appears.

## 9. Rollout and follow-ups

- One focused PR to `main` (the code/test changes).
- This spec and the plan land on `main` via a separate focused docs PR at
  closeoff (branch doctrine: no planning docs on the implementation branch).
- Resolves the #1015 deferred follow-up tracked in
  `project_receipted_bookings_architecture`.
- Follow-up (separate PR): embedded-signup readiness/loading state for the
  lazyOnload timing risk (section 4.5).
