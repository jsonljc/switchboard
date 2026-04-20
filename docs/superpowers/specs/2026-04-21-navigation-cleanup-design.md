# Navigation Cleanup — Surgical Pass

**Date:** 2026-04-21
**Status:** Approved
**Scope:** Remove dead navigation surface area, fix inconsistencies, preserve live routes

---

## Context

The dashboard has accumulated navigation residue from earlier concepts: a staff/owner view split that no longer matches the product direction, duplicate routes, dead links, and stale footer items. The approved OwnerToday spec establishes the owner dashboard as the real delivered surface, with StaffDashboard explicitly deferred.

This pass is strictly structural cleanup. No naming, IA, or positioning changes.

**Guiding principle:** Owner-first product, agent-visible funnel.

---

## Scope Boundary

| Bucket     | Description                                          |
| ---------- | ---------------------------------------------------- |
| **Remove** | Dead weight, duplicate concepts, stale links         |
| **Fix**    | Inconsistencies that break the current product shape |
| **Keep**   | Live, intentional surfaces — no changes              |
| **Flag**   | Known issues for a separate pass                     |

---

## Remove

### Staff-only surface area

- `apps/dashboard/src/components/layout/staff-nav.tsx` — desktop top nav
- `apps/dashboard/src/components/layout/staff-mobile-menu.tsx` — mobile hamburger menu
- StaffShell rendering branch in `app-shell.tsx` (preserve shared shell primitives)
- All "Switch to Owner/Staff view" toggles (settings layout, mobile menu, anywhere else)
- `apps/dashboard/src/components/dashboard/staff-dashboard.tsx` — remove only after verifying no shared composition paths, tests, or preview routes depend on it

### Legacy route

- `apps/dashboard/src/app/(public)/agent/[slug]/` — singular duplicate of `/agents/[slug]`. Hard-delete (no redirect); the only internal reference is from the auth'd my-agent detail page, which will be updated to use `/agents/[slug]`

### Footer links (`landing-footer.tsx`)

- "Build an agent" (`mailto:builders@switchboard.ai`) — stale relative to owner-first wedge
- "Get started" — redundant with header CTA

### Test and telemetry residue

- Delete or update tests/storybook snapshots referencing staff view
- Search for and remove staff-view analytics events, feature flags, or telemetry hooks

---

## Fix

### DevPanel (`dev-panel.tsx`)

- Remove `/crm` link (route does not exist)
- Remove `/performance` link (route does not exist)
- Change `/` "Home" → `/dashboard`
- Keep remaining links that resolve to real, live routes

### Footer (`landing-footer.tsx`)

After removals, the footer retains:

- "How it works" → `/how-it-works`
- "Pricing" → `/pricing`
- "Contact us" → `mailto:hello@switchboard.ai`

### AppShell (`app-shell.tsx`)

- Remove staff/owner view toggle state and preference logic
- Remove StaffShell rendering branch
- Remove persisted staff-view preference keys (localStorage, cookies, user prefs)
- Preserve shared layout primitives: providers, chrome-hiding for `/login`, `/onboarding`, `/setup`
- Remove any dead type definitions or enums related to staff view selection
- Result: AppShell always renders the owner dashboard composition

---

## Keep (unchanged this pass)

### Owner tabs (`owner-tabs.tsx`)

- Today (`/dashboard`), Hire (`/marketplace`), Decide (`/decide`), Me (`/me`)
- No label or route changes

### Public nav (`landing-nav.tsx`)

- "How it works", "Pricing", "Get early access" CTA
- No changes

### Public routes

- `/`, `/how-it-works`, `/pricing`, `/get-started`
- `/agents`, `/agents/[slug]` — actively wired into homepage and how-it-works funnel

### Auth routes

Routes remain valid; no route removals or renames outside the Remove section:

- `/dashboard`, `/dashboard/roi`
- `/marketplace/[id]`
- `/my-agent`, `/my-agent/[id]`
- `/tasks`
- `/decide`, `/decide/[id]`
- `/deploy/[slug]`
- `/deployments/[id]`, `/deployments/[id]/traces`, `/deployments/[id]/creative-jobs/[jobId]`
- `/me`, `/onboarding`
- `/settings/*` (all 7 sidebar items stay)

Nav exposure remains selective — not all routes are top-level destinations.

### Settings sidebar (`settings-layout.tsx`)

All 7 items stay: Playbook, Team, Knowledge, Channels, Identity, Test Chat, Account.
Remove only the "Switch to Owner view" toggle (covered in Remove section; related shell logic in Fix section).

---

## Flagged for Separate Pass

### `/marketplace` tab → public layout mismatch

The Owner "Hire" tab links to `/marketplace`, which resolves to the **public** marketplace page (`(public)/marketplace/page.tsx`) wrapped in the public layout (LandingNav + LandingFooter). There is no auth-side `/marketplace` index route.

This is a routing/IA decision, not dead weight. Captured here for a future pass.

### Navigation label review

Labels like "Hire", "Get early access", and "Contact us" may benefit from a positioning review to align with the owner-first wedge. Deferred — do not mix semantic repositioning with structural cleanup.

---

## Success Criteria

- No staff view toggle or rendering path remains in shipped code
- No dead links (`/crm`, `/performance`, `/agent/[slug]`)
- Footer contains exactly 3 nav items (does not constrain legal/privacy text added later)
- DevPanel links resolve to real routes
- AppShell renders owner composition unconditionally
- No orphaned staff-view tests, analytics events, or preference keys
- All existing owner-side and public-site navigation continues to work unchanged
