# Power-Marketer Depth & the "Simple vs Advanced" Question — Design

**Date:** 2026-05-28
**Status:** Approved (design) — pending spec review
**Topic:** Whether Switchboard needs a simplified vs. advanced product, and what (if any) pages are missing beyond Home · Inbox · Results + the agent panel.

## The question

"What other pages do I need aside from agent panel, Inbox, Results? Should I have a simplified and a more advanced version?"

The driver, on questioning, is **a specific user type**: a real, near-term in-house **power marketer** at a single clinic (not the owner) who wants more ad/funnel depth and control than the calm 2-minute owner glance provides. This is _not_ an agency/multi-tenant need.

## Findings that shaped the decision

Two codebase realities reframed the question (verified 2026-05-28):

1. **No human roles / multi-user-per-org today.** One `DashboardUser` → one `organizationId`, no role field (`packages/db/prisma/schema.prisma`; session shape in `apps/dashboard/src/lib/auth.ts:234` carries `userId`/`organizationId`/`principalId`, no human role). `Principal.roles` exists but governs _agent/service_ authorization, not human UI access. → "The marketer logs in and sees a different app" is **net-new infrastructure**, not a toggle.

2. **Real ad controls don't exist as a backend capability.** Riley is recommend-and-approve only. The campaigns table is read-only; there are no budget/pause/targeting mutation paths to Meta. `autonomyLevel` is stored but unenforced. The retiring `/alex` `/riley` cockpits' "depth" was a KPI strip + approval queue + activity stream + text composer — richer _reading_, not real _control_.

3. **Results is already marketer-grade at the campaign level** (audit of `(auth)/(mercury)/reports` + `ReportDataV1` in `packages/schemas/src/reports/v1.ts`). Shipped today: week/month/quarter toggle, a sortable 9-column per-campaign table with totals, a 5-stage funnel, Riley/Alex attribution split, cost-vs-value, managed comparison. **Missing** (and almost all backend-gated): per-source/channel grouping, per-adset, per-campaign funnel, per-agent attribution _by campaign_, intra-period time-series, and row-level tap-through (explicitly "coming soon" — no endpoint).

**Conclusion:** Most of the marketer's depth is richer _read_ data + the existing approve/decline workflow — much of it already built. True ad-tuning is a separate backend project; a separate marketer identity is a separate roles project. Building a glossy "advanced controls" page on today's backend would recreate the stored-not-enforced safety illusion already fought twice (see P1-B producer-population fix; autonomy fields stored-not-enforced).

## Decisions (locked)

1. **One app, progressive depth — no "Simple vs Advanced" fork and no global Simple/Pro mode toggle.** Calm is the _default presentation_; depth is _reachable_, not a second skin maintained in parallel. This honors the frozen Home · Inbox · Results IA and the `modes-not-knobs` doctrine, and avoids doubling the maintenance surface. A per-user mode switch was explicitly rejected (it historically satisfies neither user and doubles upkeep).

2. **No new primary-nav pages.** The customer-facing page set is decided:
   - **Home** (`/`) — verdict hero + modules (shipped).
   - **Inbox** + **detail sheets** (approval / handoff) — design-prompted, building.
   - **Results** + its existing depth — already campaign-grade.
   - **Drill-ins:** `/contacts` + `/contacts/[id]`, `/activity`, `/automations` (exist; Phase-2 re-skin to editorial).
   - **Agent panel** — a slide-up sheet, not a page (design-prompted, build worktree set up).
   - **Account, under the avatar:** `/settings/*` — consolidation is its **own separate brainstorm**, out of scope here.
   - **Edges:** `/onboarding`, `/login`, `/welcome`, `/privacy`, `/terms`, `/post-auth`.

3. **The marketer shares the org's single login for the first clinic.** They will eventually need their own login; design data/IA so multi-user + roles can slot in later **without rework** (see roles-readiness constraints below), but do not build roles now.

## Phase A — near-term (build now)

Smaller than first assumed, because Results is already deep. Near-term levers:

- **Rich Inbox detail** (already prompted, `2026-05-26-cux-p1c-inbox-detail-design.md`): the approval/handoff detail sheets give the marketer the _why_ behind each Riley recommendation and the lever to act (approve / decline / adjust-via-reply). This is the primary marketer-facing depth increment.
- **Make existing Results depth discoverable**: ensure the per-campaign table, window toggle, and attribution split are reachable and legible in the warm-editorial Results (progressive disclosure below the owner's lean hero). The owner sees the verdict; the marketer expands into the numbers.
- **No new control surfaces.** "Tuning ads" remains the propose→approve loop — which _is_ the safety model.

**Explicitly NOT in Phase A** (backend-gated, demand-driven): per-channel/per-adset breakdown, per-campaign funnel, per-agent attribution by campaign, daily time-series, row-level tap-through. Add only when a clinic actually asks and the endpoint exists.

## Phase B — later (design the door now, build later)

Once the agent-panel sheet ships, it grows an **"Open full view"** affordance → a focused **agent workspace**: the modernized, honest descendant of the retired cockpit (KPI strip + full activity + recommendation queue + composer). Constraints:

- **Not a 4th nav tab.** Reached only from the agent panel / agent chips — never primary nav. This is the structural fuse against the per-agent-cockpit problem the IA lock killed.
- **Opt-in and read-mostly.** Mutations stay propose→approve and risk-gated; the workspace adds _visibility_, not new ungated control.
- Where a marketer "lives" without ever cluttering the owner's 2-minute glance.

We design the affordance and the workspace shape now (as part of the agent-panel work) and build the full workspace when demand confirms it.

## Roles-readiness design constraints (so "own login later" doesn't force rework)

Since the marketer shares the login now but will need their own later, new surfaces must not bake in single-user assumptions:

- Treat depth surfaces (Results drill-downs, the future agent workspace) as **role-addressable** conceptually: nothing should assume "the only viewer is the owner." Avoid copy/affordances that hardwire owner-only framing into depth views.
- Keep depth **reachable by URL/affordance**, not by a hardcoded "this is the owner" branch — so a future role check can gate visibility without restructuring the surface.
- Do not invent a client-side "role" or "mode" flag now (it would be a stored-not-enforced illusion). Roles arrive with real backend enforcement or not at all.

## Out of scope (separate, explicitly-scoped projects)

- **Multi-user + human roles** — net-new infra; the prerequisite for a separate marketer identity. Its own spec when prioritized.
- **Real ad controls** (live budget/pause/targeting mutation to Meta) — backend project; until it exists, control stays propose-and-approve.
- **Settings consolidation** — its own brainstorm (already noted).
- **Backend depth endpoints** (per-channel/adset/time-series, row tap-through) — enable Results depth beyond campaign level; demand-driven.

## Non-goals

- A second "advanced" product or a global Simple/Pro toggle.
- Any new primary-nav tab.
- Hand-edit ad controls on today's recommend-only backend.

## Next steps

1. Proceed with the already-planned **rich Inbox detail** as the near-term marketer depth lever.
2. Fold the **"Open full view" door** into the agent-panel design (affordance + workspace shape), build the workspace later.
3. When a clinic asks for a _separate marketer login_, open the **multi-user + roles** spec.
4. Defer Results depth-beyond-campaign until backend endpoints + real demand exist.
