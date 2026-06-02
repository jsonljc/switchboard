# Spec — Operator BusinessFacts editor (Alex T0.1 fast-follow)

- **Date:** 2026-06-02
- **Status:** design (approved by directive → writing-plans)
- **Branch / worktree:** `feat/alex-business-facts-editor` (off `origin/main` @ `a6b354b2`)
- **Predecessor:** PR #813 (`ad42d018`, "unify business facts source of truth"). Its design doc names this editor as the explicit fast-follow.
- **Audit:** `docs/audits/2026-06-02-alex-improvement-audit/` — finding **T0.1** (operator preview).
- **PR title:** `feat(dashboard): operator business-facts editor for Alex`
- **Framing:** a **purely additive dashboard UI** on the already-shipped #813 backend contract. Not a new backend feature.

## Problem

#813 made `BusinessConfig.config` (per-org) the canonical BusinessFacts source that live Alex reads (`PrismaBusinessFactsStore.get → alexBuilder`), shipped the org-scoped `GET/PUT …/deployments/:id/business-facts` route + Next proxy + api-client, seeded a demo medspa blob, and added a **non-blocking** readiness check. But it deferred the operator entry surface: there is still **no live UI** through which a real (non-seeded) clinic can enter or edit its rich facts. So #813's win is demo/eval-only — fresh real orgs still launch Alex **mute on hours/pricing/services/parking** (Alex's highest-frequency inbound class; Bucket-B forces escalation when facts are empty).

`checkBusinessFactsPresent` is hard-coded `blocking: false` with the comment _"there is no live operator editor yet, so a hard gate would deadlock go-live."_ This slice removes that precondition.

## Contract being consumed (verified on `origin/main` @ `a6b354b2`)

This slice **consumes**, and does not modify, the #813 data path:

- **Next proxy** `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts`
  - `GET` → `{ facts: BusinessFacts | null, status: "present" | "missing" | "malformed" }` (the proxy renames the API's `config` → `facts`).
  - `PUT` body = a raw `BusinessFacts` object → validates `BusinessFactsSchema` → `{ success: true }`, or `400 { error, details: <flatten()> }`.
- **api-client** `getBusinessFacts(deploymentId)` / `upsertBusinessFacts(deploymentId, facts)` already point at the dedicated route.
- **API route** `apps/api/src/routes/marketplace.ts` — org-keyed via `request.organizationIdFromAuth`; the `:id` only anchors org ownership; cross-org → `404`.
- **Store** `PrismaBusinessFactsStore.getWithStatus` returns **parsed** facts, so `malformed` ⇒ `facts: null` (the raw bad blob is **not** re-exposed, by design).
- **Schema** `BusinessFactsSchema` (`packages/schemas/src/marketplace.ts`); reference shape = `GLOW_BUSINESS_FACTS` seed.

> **Do not touch** `builders/alex.ts`, `skills/alex/SKILL.md`, the schema, the store, the API route, or the Next proxy. The read path is done. We build UI on top.

## Schema shape (what the form must produce)

`BusinessFactsSchema` — **required (parse fails without):** `businessName`; `locations` ≥1, each `name`+`address`; `openingHours` (a `record<day, {open, close, closed}>`; an empty `{}` parses but is useless); `services` ≥1, each `name`+`description`; `escalationContact` `{name, channel ∈ whatsapp|telegram|email|sms, address}`. **Optional/defaulted:** `timezone` (default `Asia/Singapore`); per-service `durationMinutes, price, currency(SGD), bookingBehavior, consultationRequired, prepInstructions, aftercareNotes, idealFor, notSuitableFor, popularCombinations`; `bookingPolicies {cancellation/reschedule/noShow/prep, advanceBookingDays}`; per-location `parkingNotes, accessNotes`; `additionalFaqs[]` (default `[]`).

## Decisions (locked)

1. **Surface — a dedicated Settings page** `/settings/business-facts`, editable anytime. Onboarding's separate, smaller `PlaybookBusinessFactsSchema` step (serviceArea/USPs → `organizationConfig.onboardingPlaybook`) is **left untouched** — no conflation (per #813's out-of-scope note).
2. **Form fidelity — required core visible, advanced collapsible.** Core (business name, ≥1 location, weekly hours, ≥1 service with name+description+price, escalation contact) is prominent; rich per-service fields, booking policies, FAQs, and parking/access notes live in collapsible sections. The **entire** payload is validated against `BusinessFactsSchema` on save.
3. **Readiness — stay non-blocking, make it actionable.** `checkBusinessFactsPresent` stays `blocking: false` (no behavioral API change; only its now-stale "no editor yet" comment is refreshed). The dashboard's go-live readiness UI links the failing `business-facts-present` row to the editor. Flipping to blocking is a deliberate later call once adoption is proven (avoids deadlocking real orgs that haven't entered facts).
4. **Prefill — smart scaffold + load existing.** `present` → load saved facts. `missing` → a scaffold (1 empty location row, 7 weekday hour rows with sensible defaults, 1 empty service row, empty escalation) so operators edit rather than build from nothing. `malformed` → blank scaffold + a caution banner (the contract returns `facts: null`, so the bad blob can't be re-loaded). **No** cross-source (website-scan/playbook) import in v1.
5. **deploymentId resolution (implementation).** Resolve via `listDeployments()` (already org-scoped) and use `deployments[0].id` purely as the **org-ownership anchor** the route requires — the write re-keys to the authed org, so _which_ deployment id is sent does not affect correctness as long as it belongs to the org. Zero deployments → an empty state ("Deploy an agent first to add business facts").

## Design — by file

All additive dashboard code, respecting layers (no backend behavior change). Imports omit `.js` (relative **and** `@/` alias). Match the warm-editorial settings system (Tailwind + `hsl(var(--x))`, `@/components/ui/*`, action amber for the primary button).

### New

The component split is **driven by the 400-line proactive-split rule** (a single all-in-one form would be 600–800 lines), not by speculative abstraction. Each section is a cohesive `useFieldArray`/collapsible unit; small sections are grouped. The plan may consolidate further but should keep every file < 400 lines.

| File                                                                            | Purpose                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/app/(auth)/settings/business-facts/page.tsx`                | Client page: resolve deploymentId, fetch facts, render the form or the loading / empty / error / malformed states. Thin; delegates to the form component.                                                                                |
| `apps/dashboard/src/components/settings/business-facts/business-facts-form.tsx` | Orchestrator: `react-hook-form` + `zodResolver(BusinessFactsSchema)`, scaffold defaults / `reset`, submit, error focus, sticky save. Inlines the small **Business** block (businessName + timezone). Composes the section subcomponents. |
| `…/business-facts/locations-section.tsx`                                        | `useFieldArray` locations; collapsible parking/access.                                                                                                                                                                                   |
| `…/business-facts/hours-section.tsx`                                            | 7 weekday rows; closed toggle disables open/close.                                                                                                                                                                                       |
| `…/business-facts/services-section.tsx`                                         | `useFieldArray` services; collapsible "More detail" (the largest section).                                                                                                                                                               |
| `…/business-facts/contact-policies-section.tsx`                                 | Escalation contact (required) + collapsible booking policies (both small — grouped).                                                                                                                                                     |
| `…/business-facts/faqs-section.tsx`                                             | collapsible `useFieldArray` FAQs.                                                                                                                                                                                                        |
| `…/business-facts/scaffold.ts`                                                  | `emptyBusinessFacts()` scaffold + form-default helpers (pure, unit-tested).                                                                                                                                                              |
| `apps/dashboard/src/hooks/use-business-facts.ts`                                | `useBusinessFacts(deploymentId)` (read) + `useUpsertBusinessFacts(deploymentId)` (mutation; invalidates facts **and** `useReadiness` keys; surfaces 400 details).                                                                        |
| `apps/dashboard/src/hooks/use-deployments.ts`                                   | `useDeployments()` → `/api/dashboard/marketplace/deployments`; plus a small `useOrgDeploymentId()` selector returning the anchor id (or null).                                                                                           |
| Co-located `*.test.ts(x)`                                                       | scaffold, hooks, form serialization / production-path.                                                                                                                                                                                   |

### Edited (minimal)

| File                                                       | Change                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/dashboard/src/components/layout/settings-layout.tsx` | +1 sidebar item `{ href: "/settings/business-facts", label: "Business facts", icon: ClipboardList }` (lucide).                                                                 |
| `apps/dashboard/src/lib/query-keys.ts`                     | +`marketplace.businessFacts(deploymentId)` key.                                                                                                                                |
| `apps/dashboard/src/components/onboarding/go-live.tsx`     | In `AdvisoryCheckRow`, when `check.id === "business-facts-present"` && `status === "fail"`, render a link/CTA to `/settings/business-facts`.                                   |
| `apps/api/src/routes/readiness.ts`                         | **Comment only** — refresh the "no live operator editor yet" note to reflect that the editor now exists and the gate stays soft pending adoption. (One-line; no logic change.) |

## Form behaviour

- **State:** `react-hook-form` with `zodResolver(BusinessFactsSchema)`. `openingHours` is modelled as a fixed 7-key object (`monday…sunday`) bound directly to `openingHours.<day>.{open,close,closed}`; arrays use `useFieldArray`. Defaults applied via the scaffold for `missing`/`malformed`, or `reset(facts)` for `present`.
- **Save:** one sticky "Save business facts" button → `useUpsertBusinessFacts`. Client validation mirrors the server gate exactly, so an invalid payload never round-trips; the proxy `400` is a backstop whose `details` map onto fields. On success → toast + invalidate facts + readiness.
- **Invalid submit:** block, surface field errors, scroll to the first invalid field.
- **Degradation:** `malformed` → banner + scaffold; `missing` → scaffold; `present` → loaded; resolving deploymentId or fetching → skeleton gated on `!data && !error` (a disabled query is pending+idle, so never gate on `isLoading`); zero-deployment → empty state; proxy/network error → inline error with retry.

## Data flow (after)

`operator → /settings/business-facts → useUpsertBusinessFacts → PUT /api/dashboard/marketplace/deployments/:id/business-facts (proxy validates BusinessFactsSchema) → api-client → API route (org-keyed) → store.upsert(authedOrg) → BusinessConfig.config`. Live read is unchanged: `alexBuilder → store.get(org) → renderBusinessFacts → BUSINESS_FACTS`. The readiness `business-facts-present` row flips `missing → present` and its go-live CTA disappears.

## Testing (TDD)

- **Scaffold unit** — `emptyBusinessFacts()` yields the documented rows/defaults; weekday rows present; `present` path uses `reset(facts)` not the scaffold.
- **Hooks** — `useBusinessFacts` maps `{facts,status}`; gates on `!data && !error`. `useUpsertBusinessFacts` PUTs the exact body, invalidates facts + readiness on success, exposes 400 `details`. `useDeployments`/`useOrgDeploymentId` returns the anchor id, `null` on zero deployments.
- **Form integration** — fill required core on a `missing`-scaffold → submit → mutation called with a body; invalid (empty required) → no submit + field error; `malformed` → banner shown; `present` → fields populated.
- **Production-path keystone** — the form's serialized output (a) **passes `BusinessFactsSchema.safeParse`** (the exact proxy/route gate) and (b) flows through the **real** `@switchboard/core` render path (the narrow `alexBuilder` export #813 added, or `renderBusinessFacts`) and the resulting `BUSINESS_FACTS` contains the operator's hours, price, and `advanceBookingDays`. This proves _form output → live Alex prompt_ without duplicating #813's store/DB wiring; the proxy→route→store→builder half is already covered by `alex-business-facts-live-path.test.ts` + the apps/api store→builder span, which this spec cites.
- **go-live CTA** — when `business-facts-present` fails, the row renders a link to `/settings/business-facts`; when it passes, no link.

## Out of scope (YAGNI / follow-up)

- Cross-source prefill (website-scan / playbook import).
- Flipping the readiness gate to blocking.
- Any change to the onboarding `PlaybookBusinessFacts` step, `builders/alex.ts`, `SKILL.md`, the schema, the store, the API route, or the Next proxy.
- A persistent "facts missing" nudge outside go-live + the always-available settings nav entry.
- Multi-deployment disambiguation UI (the route is org-keyed; the anchor id suffices).

## Coordination / risk

- Base includes #813 (`ad42d018`) and is current with `origin/main` @ `a6b354b2` (#820). Disjoint from in-flight #816 (inbox) / #814 (feel-metrics); #817 (Mira) merged. A parallel session is active in the **main checkout** — this work stays inside its own worktree and touches no other branch/worktree.
- Highest-risk points: (a) `react-hook-form` + `zodResolver` over the nested `openingHours` record and the array mins — covered by the form integration + production-path tests; (b) the deploymentId anchor semantics — documented + tested; (c) dashboard import conventions (`.js`-less; only `next build` catches a missing one) — gated by `pnpm --filter @switchboard/dashboard build`.
- No schema/migration change → `pnpm db:check-drift` is N/A (no Postgres needed for this slice; tests use mocked fetch / in-memory stores).

## Acceptance criteria

1. An operator can enter and edit rich BusinessFacts at `/settings/business-facts`; saving persists to canonical `BusinessConfig.config` via the existing #813 route (no new route/proxy added).
2. Saved facts reach the **live** Alex render path — proven by the production-path test (form output → real `@switchboard/core` render → `BUSINESS_FACTS` contains entered hours/price/advanceBookingDays).
3. `present` loads existing facts; `missing` shows the scaffold; `malformed` degrades to banner + scaffold without crashing; zero-deployment shows an empty state.
4. The whole payload is validated against `BusinessFactsSchema` before save; invalid input is blocked with field-level errors and never round-trips.
5. Readiness stays **non-blocking**; the failing `business-facts-present` go-live row links to the editor; saving valid facts flips it to pass.
6. The editor is reachable from the settings sidebar.
7. Green: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm lint`, and `pnpm --filter @switchboard/dashboard build`; dashboard coverage ≥ 40/35/40/40.
8. No backend behavior change: `builders/alex.ts`, `SKILL.md`, the schema, the store, the API route, and the Next proxy are untouched (readiness change is a comment only).
