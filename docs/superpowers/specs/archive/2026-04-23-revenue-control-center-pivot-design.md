# Revenue Control Center Pivot — Design Spec

**Date:** 2026-04-23
**Status:** Draft
**Scope:** Authenticated dashboard UX pivot (Pass 1)

---

## 1. Strategic Context

Switchboard is pivoting from "agent marketplace" to "revenue operating system" with three modules:

- **Convert Leads** — Lead-to-booking pipeline
- **Create Ads** — Creative content pipeline
- **Improve Spend** — Ad optimization + attribution

The marketplace data model (AgentDeployment, DeploymentConnection, trust scores) is structurally sound and stays as the internal control-plane substrate. This spec removes the marketplace product surface and replaces it with a module-based revenue control center.

### What this spec is

A UX/narrative pivot of the authenticated dashboard experience. No data model changes. No breaking API changes. One new user-facing aggregation endpoint (`/api/dashboard/modules/status`). Internal reuse of existing marketplace/deployment APIs and proxy routes remains unchanged.

### What this spec is not

- Public site redesign (separate pass)
- Internal code renames (AgentDeployment stays)
- Marketplace route file refactoring
- Data model migration

### Key invariants

1. **Canonical user-facing routes are module-based.** Deployment IDs are internal identifiers, not navigation primitives.
2. **One active deployment per module per org.** `/modules/[module]` is the active-instance route. If multi-instance support is added later, this route remains the active control surface.
3. **UI reflects system truth.** Module status is derived from real backend state (deployments, connections, org config), not synthetic flags.

---

## 2. Module Card State Model

Each module has a deterministic status resolved server-side. First match wins.

### States (priority order)

| Priority | State               | Badge            | CTA      |
| -------- | ------------------- | ---------------- | -------- |
| 1        | `connection_broken` | Attention needed | Fix      |
| 2        | `needs_connection`  | Needs connection | Connect  |
| 3        | `partial_setup`     | Continue setup   | Continue |
| 4        | `not_setup`         | Not set up       | Enable   |
| 5        | `live`              | Live             | View     |

`connection_broken` always overrides other states. A module can be structurally "live" but broken due to an expired token — broken wins.

`partial_setup` means: core connection exists, but module is not yet operational (missing config, missing account selection, etc.).

### State boundary definitions

- **`needs_connection`** = core auth or platform dependency is missing. The module cannot function at all.
- **`partial_setup`** = auth/platform exists, but operational config is incomplete. The module could technically run but isn't properly configured.
- **`live`** = fully configured and operational. For modules with async jobs (Creative, Ad Optimizer), "live" requires at least one completed execution — not merely enabled. This is a deliberate product choice: we want "Live" to mean the module has proven it works, not just that a toggle was flipped.

### Per-module state resolution

**Convert Leads:**

- `connection_broken` → DeploymentConnection (google_calendar) status = `expired` | `revoked`
- `needs_connection` → Deployment exists, scheduling mode is Google Calendar, but no valid connection
- `partial_setup` → Scheduling configured but `BusinessHoursConfig` not set in org config
- `not_setup` → No deployment exists for this module
- `live` → Scheduling configured + business hours set + deployment active

**Create Ads:**

- `connection_broken` → N/A (platform-level keys don't expire per-org)
- `needs_connection` → Platform-level `ANTHROPIC_API_KEY` missing (`isPlatformBlocking: true`)
- `partial_setup` → Deployment exists but no creative jobs submitted yet (deliberate: "live" requires first use, not just enablement — see State boundary definitions above)
- `not_setup` → No deployment exists for this module
- `live` → Deployment active + at least one job completed or in progress

**Improve Spend:**

- `connection_broken` → DeploymentConnection (meta_ads) status = `expired` | `revoked`
- `needs_connection` → Deployment exists but `getDeploymentCredentials` returns null (core auth missing)
- `partial_setup` → Token exists but no `accountId` selected, or no `inputConfig` thresholds set (auth exists, operational config incomplete)
- `not_setup` → No deployment exists for this module
- `live` → Credentials valid + at least one audit completed

### API endpoint

`GET /api/dashboard/modules/status`

```typescript
type ModuleStatus = {
  id: "creative" | "ad-optimizer" | "lead-to-booking";
  state: "not_setup" | "needs_connection" | "partial_setup" | "connection_broken" | "live";
  label: string;
  subtext: string;
  metric?: string; // only populated when state = "live"
  cta: { label: string; href: string };
  setupProgress?: { done: number; total: number };
  isPlatformBlocking?: boolean;
  lastUpdated?: string; // ISO timestamp of last status check
};
```

Response: `ModuleStatus[]` (always exactly 3 items, stable order).

State resolution logic lives server-side in the API route handler. The endpoint is a read-only aggregation over existing data: deployments, DeploymentConnections, org config, and optionally recent job/audit counts for live metrics.

No new data model or tables required.

### CTA href mapping (deterministic per state)

| State               | href                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_setup`         | `/modules/[module]/setup`                                                                                                                                                                 |
| `needs_connection`  | `/modules/[module]/setup?step=[connect-step]` (e.g., `connect-calendar`, `connect-meta`)                                                                                                  |
| `partial_setup`     | `/modules/[module]/setup?step=[first-incomplete]`                                                                                                                                         |
| `connection_broken` | `/modules/[module]/setup?step=[broken-connection-step]` (e.g., `connect-calendar`, `connect-meta` — the UI infers broken state from DeploymentConnection status and shows re-auth prompt) |
| `live`              | `/modules/[module]`                                                                                                                                                                       |

Step params are always semantic keys, not numeric indices.

---

## 3. Revenue Control Center (`/dashboard`)

Redesign of the existing `OwnerToday` component. The module status layer is added on top; existing operational content is preserved below.

### Layout (top to bottom)

**1. Header**
Time-of-day greeting. Keep existing `DashboardHeader`.

**2. Module Cards**
Three cards in a horizontal row (stacks on mobile):

| Card | Label         | Example subtext (live)  | Example subtext (not setup)          |
| ---- | ------------- | ----------------------- | ------------------------------------ |
| 1    | Convert Leads | "8 bookings this week"  | "Enable to start converting leads"   |
| 2    | Create Ads    | "2 jobs running"        | "Enable to generate ad creative"     |
| 3    | Improve Spend | "Next audit Monday 9am" | "Connect Meta Ads to optimize spend" |

Each card:

- Status badge (primary visual state)
- Subtext (one line, contextual)
- One CTA button
- Entire card surface is clickable → same destination as CTA (setup flow when not live, module detail when live). CTA button is the visually prominent affordance; card click is a convenience, not a separate action.
- Metric only shown when `state = live`
- When `isPlatformBlocking`, subtext shows "Platform configuration required" and CTA is disabled or shows "Contact administrator"

**3. Recommendation Bar**
Single, decisive recommendation. Not a banner — feels like the system's opinion.

Priority logic:

1. Any module `connection_broken` → "Fix [module] connection to restore [outcome]"
2. Any module `needs_connection` → "Connect [service] to activate [module]"
3. Any module `partial_setup` → "Finish setting up [module] — [specific missing step]"
4. Any module `not_setup` → Suggest highest-value next module based on what's already live:
   - Creative live, no Ad Optimizer → "Activate Improve Spend to close the learning loop"
   - Ad Optimizer live, no Creative → "Add Create Ads to generate testable variants"
   - Lead-to-Booking live, no Ad Optimizer → "Activate Improve Spend for closed-loop attribution"
   - Nothing live → "Start with Convert Leads to capture and book revenue"
5. All modules `live` → System health insight or opportunity (e.g., "Revenue loop active — 23 bookings attributed to ads this month")

When multiple modules share the same priority tier, apply deterministic tie-break rules:

1. Prefer the module that closes a loop with an already-live neighbor (e.g., if Creative is live, prefer Ad Optimizer over Lead-to-Booking)
2. If no neighbor advantage, prefer Convert Leads (the revenue proof point)
3. If still tied, prefer the module with fewer remaining setup steps

**4. Synergy Strip**
Lightweight status rail showing loop closure:

| Loop                    | Condition                                | Display           |
| ----------------------- | ---------------------------------------- | ----------------- |
| Top-of-funnel learning  | Creative + Ad Optimizer both live        | Active / Inactive |
| Closed-loop attribution | Lead-to-Booking + Ad Optimizer both live | Active / Inactive |
| Full revenue loop       | All three live                           | Active / Inactive |

One horizontal row of three indicators. Compact, not a diagram.

**5. Existing operational content**
All current `OwnerToday` sections preserved in order:

- `StatCardGrid` (pending approvals, inquiries, qualified leads, bookings, revenue, tasks)
- Pending approvals with inline approve/reject
- Upcoming bookings
- `FunnelStrip`
- `RevenueSummary`
- `OwnerTaskList`
- `ActivityFeed`

These begin below the fold. The module layer owns the first screen.

---

## 4. Navigation Changes

### Bottom tab bar

**Before:**

```
Today (/dashboard) — Hire (/marketplace) — Decide (/decide) — Me (/me)
```

**After:**

```
Home (/dashboard) — Decide (/decide) — Me (/me)
```

- "Today" → "Home" (icon: Home, unchanged)
- "Hire" tab → removed entirely. Module activation lives on `/dashboard`.
- "Decide" → unchanged (ShieldCheck icon, approval count badge)
- "Me" → unchanged

### Route changes

| Old route                                 | Action                 | New route                             |
| ----------------------------------------- | ---------------------- | ------------------------------------- |
| `/dashboard`                              | Redesign               | `/dashboard` (revenue control center) |
| `/dashboard/roi`                          | Keep                   | `/dashboard/roi`                      |
| `/marketplace`                            | Remove                 | —                                     |
| `/marketplace/[id]`                       | Remove                 | —                                     |
| `/deploy/[slug]`                          | Replace                | `/modules/[module]/setup`             |
| `/deployments/[id]`                       | Redirect (short-lived) | `/modules/[resolved-module]`          |
| `/deployments/[id]/traces`                | Redirect (short-lived) | `/modules/[resolved-module]/traces`   |
| `/deployments/[id]/creative-jobs/[jobId]` | Redirect (short-lived) | `/modules/creative/jobs/[jobId]`      |
| `/decide`, `/decide/[id]`                 | Keep                   | unchanged                             |
| `/tasks`                                  | Keep                   | unchanged                             |
| `/me`                                     | Keep                   | unchanged                             |
| `/settings/*`                             | Keep                   | unchanged (label review only)         |

Marketplace routes (`/marketplace`, `/marketplace/[id]`) are removed outright — no redirects. Pre-launch, no inbound links exist.

Deployment routes (`/deployments/*`) get short-lived redirects that resolve deployment ID → module slug via the deployment's listing type. These redirects exist only during the refactor transition and are removed once all internal references are updated.

### Settings sidebar

"Team" label stays if the page manages people/roles/ownership. If it manages module configuration, rename to "Modules." Content audit during implementation determines which.

---

## 5. Module Setup Flow (`/modules/[module]/setup`)

Three canonical setup wizards, one per module. Each is a single page with step components. URL uses semantic step keys via query params (`?step=scheduling-mode`). Steps are skippable forward if already complete; returning users land on the first incomplete step.

### Convert Leads

| Step key           | What it collects                                     | Backend target                                                                                    |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `scheduling-mode`  | Choose Google Calendar or local scheduling           | Determines whether to create `DeploymentConnection` type `google_calendar` or use local-only mode |
| `connect-calendar` | Google Calendar OAuth (only if Google mode selected) | `DeploymentConnection` type `google_calendar`                                                     |
| `business-hours`   | Timezone, open/close per day of week                 | `OrganizationConfig.businessHours`                                                                |
| `activate`         | Confirm and enable                                   | `AgentDeployment.status` → `active`                                                               |

Step 1 is the mode selector. In local mode, step 2 is skipped. Business hours are always required regardless of scheduling mode.

### Create Ads

| Step key    | What it collects                             | Backend target                                |
| ----------- | -------------------------------------------- | --------------------------------------------- |
| `enable`    | Confirm activation                           | Create deployment, set `active`               |
| `first-job` | Brief, industry, tone (optional guided step) | Emits `creative-pipeline/job.submitted` event |

If platform keys are configured, this is essentially one-click enable. The optional second step helps cold-start by guiding the first job submission. If `isPlatformBlocking`, step 1 shows a non-actionable platform readiness message.

### Improve Spend

| Step key         | What it collects                               | Backend target                               |
| ---------------- | ---------------------------------------------- | -------------------------------------------- |
| `connect-meta`   | Facebook OAuth flow → long-lived token         | `DeploymentConnection` type `meta_ads`       |
| `select-account` | Pick ad account from `listAdAccounts()`        | `DeploymentConnection.credentials.accountId` |
| `set-targets`    | Monthly budget, target CPA, target ROAS        | `AgentDeployment.inputConfig`                |
| `connect-capi`   | Pixel ID for conversion signal loop (optional) | `DeploymentConnection` type `meta_capi`      |
| `activate`       | Confirm and enable                             | `AgentDeployment.status` → `active`          |

### Deep-link behavior

| CTA context                  | Query param                                      | Behavior                                                                                         |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| "Enable" (not_setup)         | none                                             | Start at step 1                                                                                  |
| "Connect" (needs_connection) | `?step=connect-calendar` or `?step=connect-meta` | Jump to connection step                                                                          |
| "Continue" (partial_setup)   | `?step=[first-incomplete]`                       | Resume at first incomplete step                                                                  |
| "Fix" (connection_broken)    | `?step=[broken-step]` (e.g., `connect-meta`)     | Jump to the broken connection's step; UI detects expired/revoked status and shows re-auth prompt |

### Design decisions

1. **No listing metadata lookup.** Steps are hardcoded per module. Three modules, known requirements.
2. **Reuse existing OAuth.** `facebook-oauth.ts` already produces the right tokens.
3. **Platform readiness guard.** Missing platform-level config (e.g., `ANTHROPIC_API_KEY`) shows non-actionable state with "Platform configuration required — contact administrator."

---

## 6. Module Detail Page (`/modules/[module]`)

Replaces `/deployments/[id]`. The page resolves the org's active deployment for the given module slug internally. This page represents the org's active instance, not an arbitrary deployment record.

### Header

Module name + status badge + "Configuration" link (→ `/modules/[module]/setup`)

### Body (module-specific primary view)

| Module        | Primary view                                                    | Secondary views                                          |
| ------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| Convert Leads | Upcoming bookings + funnel strip (inquiry → booked → completed) | Opportunity list, booking history                        |
| Create Ads    | Active/recent creative jobs with stage progress                 | Job detail drill-down (`/modules/creative/jobs/[jobId]`) |
| Improve Spend | Latest audit report + recommendation cards                      | Campaign list, metric trends, connection health          |

### Common elements (all modules)

- **Connection health** — status of required connections at the top
- **Execution history** — replaces "trust chart." Operational performance over time: completions, failures, approval rates. Uses existing trust score data, presented as execution metrics rather than abstract "trust."
- **Activity feed** — filtered to this module's events
- **Traces link** — `/modules/[module]/traces`
- **Disable module** — deliberate action with confirmation dialog ("Disabling will pause all scheduled jobs for this module. Are you sure?"). Logged to audit trail. Sets `AgentDeployment.status` to inactive.

---

## 7. Onboarding Adjustments

The existing 4-step onboarding flow (Entry → Training → Test Center → Go Live) stays structurally intact. Copy changes only:

- "Go Live" step: instead of "connect channels and launch your agent," frame as "connect channels and enable your first revenue module"
- If the onboarding already produces a deployment, ensure it maps to one of the three canonical modules (likely Lead-to-Booking via the Alex booking agent)
- Post-onboarding redirect lands on `/dashboard` (revenue control center), where module cards show the activation state

No structural changes to onboarding in this pass.

---

## 8. Implementation Scope

### New files

| File                                                                   | Purpose                            |
| ---------------------------------------------------------------------- | ---------------------------------- |
| `apps/dashboard/src/app/(auth)/modules/[module]/page.tsx`              | Module detail page                 |
| `apps/dashboard/src/app/(auth)/modules/[module]/setup/page.tsx`        | Module setup wizard                |
| `apps/dashboard/src/app/(auth)/modules/[module]/traces/page.tsx`       | Module traces (thin wrapper)       |
| `apps/dashboard/src/app/(auth)/modules/creative/jobs/[jobId]/page.tsx` | Creative job detail (thin wrapper) |
| `apps/dashboard/src/components/dashboard/module-cards.tsx`             | Module card grid component         |
| `apps/dashboard/src/components/dashboard/module-card.tsx`              | Individual module card             |
| `apps/dashboard/src/components/dashboard/recommendation-bar.tsx`       | Next-best-action recommendation    |
| `apps/dashboard/src/components/dashboard/synergy-strip.tsx`            | Loop closure indicators            |
| `apps/dashboard/src/components/modules/module-setup-wizard.tsx`        | Setup wizard shell                 |
| `apps/dashboard/src/components/modules/convert-leads-setup.tsx`        | Convert Leads step components      |
| `apps/dashboard/src/components/modules/create-ads-setup.tsx`           | Create Ads step components         |
| `apps/dashboard/src/components/modules/improve-spend-setup.tsx`        | Improve Spend step components      |
| `apps/dashboard/src/components/modules/module-detail.tsx`              | Module detail shell                |
| `apps/dashboard/src/hooks/use-module-status.ts`                        | Hook for module status API         |
| `apps/dashboard/src/app/api/dashboard/modules/status/route.ts`         | Module status API endpoint         |

### Modified files

| File                                                      | Change                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/dashboard/owner-today.tsx` | Add module cards, recommendation bar, synergy strip above existing content                                                 |
| `apps/dashboard/src/components/layout/owner-tabs.tsx`     | Remove "Hire" tab, rename "Today" → "Home"                                                                                 |
| `apps/dashboard/src/app/(auth)/marketplace/page.tsx`      | Delete                                                                                                                     |
| `apps/dashboard/src/app/(auth)/marketplace/[id]/page.tsx` | Delete                                                                                                                     |
| `apps/dashboard/src/components/marketplace/*`             | Delete or repurpose (public-marketplace-browse, agent-marketplace-card — audit for reusable display logic before deleting) |
| `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`    | Delete (replaced by module setup)                                                                                          |
| `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx` | Short-lived redirect to `/modules/[resolved]`                                                                              |

### Not modified

- `packages/schemas/src/marketplace.ts` — data model stays
- `packages/core/src/marketplace/*` — trust engine stays
- `packages/db/src/stores/prisma-*-store.ts` — all stores stay
- `apps/api/src/routes/marketplace.ts` — API routes stay (internal use)
- `apps/dashboard/src/app/api/dashboard/marketplace/*` — proxy routes stay (used by module detail pages internally)

---

## 9. Risks and Mitigations

| Risk                                                         | Mitigation                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module status endpoint becomes slow with multiple DB queries | Parallel queries; cache with short TTL if needed                                                                                                     |
| "Execution history" concept is unclear without trust framing | Use concrete labels: "completions," "approvals," "error rate" — avoid abstract scores                                                                |
| Settings "Team" page still references agent roster language  | Audit during implementation; rename if content is module-config, keep if people-management                                                           |
| Setup wizard step params could proliferate                   | Semantic keys only; max 5 steps per module; no nested params                                                                                         |
| Deployment-to-module resolution fails for edge cases         | Explicit module-type field on deployments; fallback to `/dashboard` if unresolvable                                                                  |
| Module-status logic drifts from setup-flow completion logic  | Share a single `ModuleStateResolver` used by both `/modules/status` endpoint and setup flow step routing. One source of truth for "what's complete." |
