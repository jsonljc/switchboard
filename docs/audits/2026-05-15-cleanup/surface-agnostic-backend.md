# surface-agnostic-backend

**Charter:** Ensure `packages/core`, `packages/schemas`, `packages/db`, `packages/ad-optimizer` contain no references to UI surfaces (dashboard route names, Mercury/editorial register identifiers, /console becoming Live mode).

**Method:** Grep for surface-specific identifiers: `/console|/dashboard|Mercury|mercury|editorial|/operator|/agents/alex|/agents/riley|cockpit|/reports/|/contacts/|/automations/` across four backend packages. Distinguish HARD violations (code branching on surface) from SOFT violations (types named after surfaces) from INFORMATIONAL (comments).

**Scope exclusions applied:**

- `packages/core/src/**/recommendation*` and `packages/schemas/src/recommendation*` (per spec exclusion mask)
- `packages/core/src/agent-runtime/` `<|operator-content|>` XML sentinel (LLM prompt marker, not surface identifier)

## Headline counts

- HARD violations (code branching on surface): 0
- SOFT violations (types named after surfaces): 1
- INFORMATIONAL (comment references): 14
- MED violations (URL-shaped strings in backend code): 4

## Findings

### [MED] Embedded surface URLs in core projection functions

- **Where:**
  - `packages/core/src/contacts/list.ts:63` — `detailHref: \`/contacts/${c.id}\``
  - `packages/core/src/contacts/detail.ts:39`
  - `packages/core/src/decisions/adapters/handoff-adapter.ts:22` — `threadHref: thread ? \`/contacts/${contact?.id}/conversations/${thread.id}\` : null`
  - `packages/core/src/decisions/adapters/recommendation-adapter.ts:48` — `return typeof contactId === "string" ? \`/contacts/${contactId}/conversations\` : null`
- **Evidence:** Backend projections embedding surface-specific URL paths
- **Why it matters:** Tight coupling between backend and frontend routes. If route path changes (e.g., `/contacts` → `/leads`), this code breaks. Per `feedback_surface_agnostic_backend`: surfaces should be a "one-line route change."
- **Fix:** Extract route paths to a transport-layer configuration or pass them as a dependency parameter to projection builders. Example: add `routeTemplates: { contactDetail: string; threadHref: string }` to `ContactDetailDeps`.
- **Effort:** M
- **Risk if untouched:** Routing changes require backend edits; surfaces cannot customize path hierarchies
- **Collides with active work?:** no (recommendation-adapter.ts may overlap with recommendation exclusion mask; verify)

### [HIGH] DashboardOverview type named after surface

- **Where:** `packages/schemas/src/dashboard.ts:3` (type def), `packages/schemas/src/index.ts:129` (export)
- **Evidence:** `export const DashboardOverviewSchema = z.object({...})` with surface-specific name "Dashboard"
- **Why it matters:** Schema type explicitly named after a UI surface. Violates principle that types describe _data shape_, not _rendering surface_. Complicates multi-surface variants.
- **Fix:** Rename to `OperatorOverviewSchema` or `HomeAgentOverviewSchema`. Add type alias `export type DashboardOverview = OperatorOverview;` for back-compat.
- **Effort:** S
- **Risk if untouched:** Type naming encodes surface assumptions; complicates multi-surface features
- **Collides with active work?:** no

### [LOW] Mercury and cockpit surface references in comments

- **Where:** Multiple files
- **Evidence:**
  - `packages/schemas/src/audit.ts:149`: "One row in the /activity Mercury list."
  - `packages/core/src/contacts/index.ts:1`: "Contacts read-side projection (powers the Mercury /contacts list surface)"
  - `packages/core/src/contacts/list.ts:29`: "Read-side projection that backs `GET /api/dashboard/contacts`. Surface-agnostic..."
  - `packages/core/src/lifecycle/contact-store.ts:81`: "Read-only browse for the Mercury `/contacts` list surface."
  - `packages/schemas/src/scheduler.ts:104`: "One row in the /automations Mercury list."
  - `packages/core/src/agent-home/activity-preview-reader.ts:6`: "The cockpit UI does not render per-message timestamps..."
  - `packages/core/src/agent-home/__tests__/targets-convention.test.ts:25–26`: paths to `apps/dashboard/src/lib/cockpit/` and `apps/dashboard/src/components/cockpit/`
- **Why it matters:** Documentation couples backend to surface; misleads developers; comments become stale when surfaces rename
- **Fix:** Update comments to describe _data intent_ not _surface_. Example: "Read-side projection for contact browsing (backend-agnostic)" instead of "Mercury /contacts list surface."
- **Effort:** S
- **Risk if untouched:** Documentation rot
- **Collides with active work?:** no

### [LOW] Operator-related identifiers in core (clarification — NOT a violation)

- **Where:** `packages/core/src/observability/operator-alerter.ts`, `packages/schemas/src/operator-command.ts`, `packages/core/src/index.ts:218`
- **Evidence:** `NoopOperatorAlerter`, `WebhookOperatorAlerter`, `OperatorCommand`, `OperatorChannel` enum
- **Why it matters:** These are NOT surface references. "Operator" here denotes the _role_ (SMB owner using Switchboard), not a UI surface. Consistent with user-role terminology.
- **Fix:** None required.
- **Status:** Clarification — no finding
- **Collides with active work?:** no

## Out of scope / deferred for this lane

- **Recommendation routing enums** (`RecommendationSurface` = `"queue" | "shadow_action" | "dropped"` in schemas/src/recommendations.ts): Internal routing categories, not UI surfaces. Not a violation.
- **System prompt sentinel markup** (`<|operator-content|>`): LLM prompt marker.
- **Test-only convention references** in `targets-convention.test.ts`: test discipline, not production coupling.
- **Ad-optimizer comment** `recommendation-sink.ts:98` mentioning "/console queue card, /riley page, inbox drawer": design explanation of surface-agnostic principle, not a violation.
- **Paths under `packages/core/src/**/recommendation*`** and `packages/schemas/src/recommendation*`: per exclusion mask; recommend delegating deep audit to recommendations-specific workstream.
