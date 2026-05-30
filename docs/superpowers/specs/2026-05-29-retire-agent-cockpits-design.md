# Retire the /alex and /riley cockpits — design

**Date:** 2026-05-29
**Status:** Approved (brainstorm)
**Surface:** `apps/dashboard`

## Context

The read-only agent panel (Alex/Riley/Mira drill-in Sheet, #738) shipped and is now
the canonical agent drill-in, opened from Home's Team Pulse, the Inbox, and Results.
It replaced the per-agent cockpit pages at `/alex` and `/riley`, which were de-nav'd
(removed from primary navigation) but remain reachable by direct URL.

Customer-UX-overhaul blueprint §4 specifies the cockpit lifecycle as
**route-compat-only → redirect → delete**. This work executes the redirect→delete step.

### Safety note — PR #725

PR #725 ("gate cockpit approval commits behind a confirm step") gated a live hole:
the de-nav'd cockpits committed approvals on one tap, ungated. #725 is **not merged**.
This PR deletes the cockpit surface entirely, which removes that hole and **supersedes
#725** — #725 should be closed as superseded. Interim exposure on `main` is low: the
cockpits are de-nav'd, reachable only by direct URL with an authenticated session.

## Goals

- `/alex` and `/riley` redirect to the agent panel instead of rendering the cockpit.
- Delete the cockpit page surface and everything reachable **only** from it.
- Leave shared cockpit foundation intact (it now underpins Home/Inbox/agent-panel).
- No orphaned files, no broken imports, no dead references.

## Non-goals

- The `window=all` cumulative "since you hired X" panel hero (deferred post-launch).
- Any change to the agent panel itself or to the shared cockpit lib modules' behavior.
- Removing `/alex` `/riley` from middleware auth (the redirect stubs stay auth-gated).

## Design

### 1. Deep-link on Home (server-read, no `useSearchParams`)

Home is mounted by the server component `app/(auth)/page.tsx` → `<HomePage/>`.
Next passes `searchParams` to server pages, so the deep-link is read on the server and
passed down as a validated prop — avoiding `useSearchParams` and any Suspense boundary.

- `app/(auth)/page.tsx` reads `searchParams.agent`, validates it against the
  `PanelAgentKey` union (`"alex" | "riley" | "mira"`), and passes `initialAgent` to
  `HomePage`. Unknown/absent values pass `null`.
- `home-page.tsx` accepts `initialAgent?: PanelAgentKey | null` and seeds
  `useState(initialAgent ?? null)`, so the panel auto-opens on deep-link. Team Pulse
  taps are unchanged. The deep link is sticky (a refresh reopens the panel — correct
  behavior for a deep link); no URL rewriting on close.

### 2. Redirect stubs (the retirement)

`/alex/page.tsx` and `/riley/page.tsx` become thin server components:
`redirect("/?agent=alex")` / `redirect("/?agent=riley")`. The redirect is
**unconditional** — the prior enablement `notFound()` gate is dropped, because Team
Pulse already surfaces all three agents regardless of enablement and the panel renders
a not-set-up agent gracefully. Each route's `__tests__/page.test.tsx` flips to assert
the redirect target.

### 3. Delete the cockpit surface

Delete the two page components (`cockpit-page.tsx`, `riley-cockpit-page.tsx`) and every
file reachable **only** from them or the route pages: action dispatchers, command
palette, composer, KPI/activity/approval UI, riley-only hooks (`use-riley-status`,
`use-riley-activity`, `use-riley-approvals`, `use-cockpit-status`), the alex approvals
infra (`lib/cockpit/approvals/*`), the alex approval-row + pending-approval view
adapters, and the cockpit-only sprite frames — together with their co-located tests and
fixtures. Also delete `lib/api-client/agents-server.ts`, which becomes orphaned once the
stubs stop calling `fetchEnabledAgentsServer`.

**Keep (shared foundation, still imported by inbox-avatar / home / agent-panel):**
`components/cockpit/{tokens,types}.ts`, `sprite/{sprite-chip,types,alex-variants,riley-variants}`,
`lib/cockpit/{alex-config,metrics-types,mission-types,legacy-shapes,...}`,
`lib/cockpit/riley/riley-config.ts`, and the `use-agent-{metrics,mission,activity-cockpit}` hooks.

The exact deletable set is determined **empirically**, because the static import map has
boundary ambiguity: delete the candidate set, then let `pnpm typecheck` + `next build` +
the full vitest suite catch any over-deletion (a wrongly-removed shared file breaks an
import), and an orphan sweep (`grep` for now-unreferenced cockpit files) catch any
under-deletion. Iterate until green with no orphans.

### 4. Reference cleanup

- `app-shell.tsx`: drop `/alex`,`/riley` from `ONBOARDING_GATE_EXEMPT_EXACT` and update
  the stale "agent homes bypass the onboarding gate" comment — they are redirect stubs now.
- `middleware.ts`: **unchanged** — `/alex`,`/riley` stay in the auth prefixes + matcher so
  the redirect stubs remain behind auth.
- `dev-panel.tsx`: **unchanged** — the `/alex` dev link still resolves via the redirect.

## Testing

- New: server-page deep-link test (valid agent opens panel; unknown agent → no panel).
- Flipped: `/alex` `/riley` route tests assert the redirect target.
- Existing shared-module tests stay green (they test code we keep).
- Gates: `pnpm --filter @switchboard/dashboard typecheck`, the **full** dashboard vitest
  suite, and `pnpm --filter @switchboard/dashboard build` (the real import/RSC gate — not
  in CI). Dashboard coverage threshold 40/35/40/40.

## Risks

- **Over-deletion of shared code** — mitigated by the build + full-suite gates (broken
  import fails loudly) and a focused whole-PR review given the blast radius.
- **Under-deletion (silent orphans)** — mitigated by an explicit post-delete orphan sweep.
- **Known flake (not a regression):** `auth-onboarding.test.ts` fails in build worktrees
  (a `@prisma/client` mock missing `KnowledgeKind` via the db seed chain); it passes in CI.
