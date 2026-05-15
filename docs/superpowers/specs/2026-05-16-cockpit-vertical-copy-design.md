# Cockpit vertical copy — medspa alignment

**Date:** 2026-05-16
**Scope:** Operator-facing copy in the Alex cockpit + mission API + cold-state empty state.
**Status:** Design locked.

## Problem

Alex's launch vertical was locked to med spa / aesthetic clinics on 2026-05-15. The cockpit, mission API, and cold-state copy still carry pre-positioning language from an earlier "tours pipeline" framing:

- `apps/api/src/routes/agent-home/mission.ts:67` — `ALEX_ROLE = "SDR · qualify inbound leads, book tours"`
- `apps/api/src/routes/agent-home/mission.ts:68` — `ALEX_PIPELINE = "Tours pipeline · single funnel"`
- `apps/dashboard/src/lib/cockpit/alex-config.ts:14` — `missionSubtitle: "SDR · Tours pipeline"`
- `apps/dashboard/src/components/cockpit/empty-state.tsx:12-13` — `"Connect HotPod inbox"` (tenant brand leak) and `"Connect tour calendar"`
- `apps/dashboard/src/components/cockpit/empty-state.tsx:50` — `"book tours under your standing rules"`
- `apps/dashboard/src/lib/cockpit/legacy-shapes.ts:103` — ROI bar `suffix: " in tour value"`
- `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md` — illustrative copy across nine line locations
- 9 test-fixture sites across api + dashboard `__tests__/` that hardcode the legacy strings (including `"HotPod Yoga"` as a fixture org name, the _source_ of the brand leak)

A 2026-05-16 holistic code review surfaced the production strings; a 2026-05-16 defensive sweep run as part of brainstorming this spec found the additional `"Connect tour calendar"` site, the ROI suffix, and the test-fixture surface.

## Principle

The architecture stays vertical-agnostic. The first shipped instantiation is medspa. Cockpit copy should match medspa where the operator can read it. Generic code names (schemas, types, internal variables) stay neutral.

**Threshold:** if the operator can see it on a rendered surface — cockpit, mission popover, empty state, ROI bar — it's medspa-vertical copy. If only engineers see it, leave it.

This narrows but does not delete the prior `[[project-alex-vertical-medspa]]` guidance against blind codebase-wide renames.

## Out of scope

- `Service.bookingBehavior` and `consultationRequired` — already medspa-aware in the playbook schema; no work needed.
- `avgValueCents` field name — generic, not user-visible.
- `tourValue` as an internal variable name in computation code — generic, not user-visible.
- Activity-row `"Tell Alex about X"` — agent-name hardcoding is a separate concern (agent-agnostic refactor).
- Riley copy — Riley's surfaces will get the same treatment if/when needed; not bundled here.
- Lifting `ALEX_ROLE` / `ALEX_PIPELINE` into `AgentRoster.config` — premature without a second vertical onboarded. The existing `priceApprovalThreshold` / `quietHours` / `targets` precedent stays as the boundary for what belongs in config today.
- Renaming Alex's role from `SDR`. `SDR` is a recognizable cross-vertical operator role; only `tours` is the launch-mismatched word.

## String changes

### Production code

| File                                                       | Current                                                 | New                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/api/src/routes/agent-home/mission.ts:67`             | `ALEX_ROLE = "SDR · qualify inbound leads, book tours"` | `"SDR · qualify inbound leads, book consultations"`                                     |
| `apps/api/src/routes/agent-home/mission.ts:68`             | `ALEX_PIPELINE = "Tours pipeline · single funnel"`      | `"Consultations pipeline · single funnel"`                                              |
| `apps/dashboard/src/lib/cockpit/alex-config.ts:14`         | `missionSubtitle: "SDR · Tours pipeline"`               | `"SDR · Consultations pipeline"`                                                        |
| `apps/dashboard/src/components/cockpit/empty-state.tsx:12` | `inbox: "Connect HotPod inbox"`                         | `"Connect your inbox"`                                                                  |
| `apps/dashboard/src/components/cockpit/empty-state.tsx:13` | `cal: "Connect tour calendar"`                          | `"Connect consultation calendar"`                                                       |
| `apps/dashboard/src/components/cockpit/empty-state.tsx:50` | `"book tours under your standing rules"`                | `"So Alex can qualify inbound leads and book consultations under your standing rules."` |
| `apps/dashboard/src/lib/cockpit/legacy-shapes.ts:103`      | `rightMeta: { ..., suffix: " in tour value" }`          | `suffix: " in consultation value"`                                                      |

### Test fixtures (must update — will break or trip hygiene test)

A 2026-05-16 defensive sweep found the following test files reuse the legacy strings as fixtures or assertions. They must update in the same PR so production constants and tests stay aligned and the hygiene test passes on first run.

**Assertions on production constants (will fail after production change):**

- `apps/api/src/routes/agent-home/__tests__/mission.test.ts:29-30,202,377` — assertions on `mission.role` / `mission.pipeline` / `mission.brand`
- `apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts:33-34` — fixture role/pipeline strings

**Component test fixtures (synthetic data passed as props):**

- `apps/dashboard/src/components/cockpit/__tests__/identity.test.tsx` — 7 occurrences of `"SDR · Tours pipeline · HotPod"` as `subtitle`
- `apps/dashboard/src/components/cockpit/__tests__/types.test.ts:54,57` — subtitle + `ROLE` row
- `apps/dashboard/src/components/cockpit/__tests__/mission-popover.test.tsx:8-10` — role/pipeline/brand
- `apps/dashboard/src/components/cockpit/__tests__/cockpit-page.test.tsx:83-85` — role/pipeline/brand
- `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx:432,492` — `brand: "HotPod Yoga · —"`
- `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx:10` — `suffix: " in tour value"`

**Test fixture org-name rename (the source of the brand leak):**

The fixture org name `"HotPod Yoga"` appears in 7 test locations across api + dashboard. This is the source of the tenant brand leak — a real tenant name was used as fixture data. Replace with a generic medspa-flavored name (e.g. `"Acme Medspa"`) across all listed test files. The hygiene test below codifies this — `"HotPod"` should not appear anywhere on the dashboard cockpit surface, including tests.

**Optional / out of scope:**

- `packages/core/src/agent-home/__tests__/metrics-types.test.ts:28` — `suffix: " in tour value"` in a core-layer test fixture. By the principle ("engineer-only strings stay neutral"), this can stay. Updating it for consistency is a nice-to-have, not required. The hygiene test does not scan `packages/core/`.

### Spec doc updates (same PR as code)

In `docs/superpowers/specs/2026-05-14-alex-cockpit-home-design.md`, update illustrative copy at:

- L122 — `calendar-book` description: `"Hold/confirm a tour slot"` → `"Hold/confirm a consultation slot"`
- L207 — ROI explanation aside: `"tour value"` → `"consultation value"`
- L358 — mission popover example
- L372 — `ROLE` row example
- L444 — cold-state ROI bar example
- L461 — `MissionViewModel` example comment showing `suffix: " in tour value"`
- L725 — setup checklist `cal` row label
- L733 — cold-state narrator default copy block
- L790 — `role` field comment

These are illustrative copy in a locked spec, not normative architecture. Updating them keeps the spec usable as reference without invalidating the locked design contract.

## Tenant copy

`HotPod` is tenant/fixture/demo brand, not platform vocabulary. It should not appear in shared cockpit surfaces.

V1 choice for the empty-state inbox row: **shared neutral** (`"Connect your inbox"`). No `{orgName}` templating in this slice — it would add a data dependency for one string and risks leaking demo/fixture brand strings if the source isn't sanitized. Tenant-templated copy is reserved for richer surfaces like the mission popover, where org context is already part of the data contract.

## Regression coverage

Two sibling tests prevent reintroduction:

**`apps/dashboard/src/__tests__/cockpit-copy-hygiene.test.ts`**

Scans `apps/dashboard/src/components/cockpit/**/*.{ts,tsx}` and `apps/dashboard/src/lib/cockpit/**/*.{ts,tsx}` (**includes `__tests__/` subdirs** — synthetic test fixtures must also stay clean) and asserts none contain:

- `"HotPod"` (case-insensitive)
- `"Tours pipeline"`
- `"book tours"`
- `" in tour value"`
- `"tour calendar"`

Excludes the hygiene test file itself (it contains the strings as inline test values).

Failure mode: print the offending file path + line number.

**`apps/api/src/routes/agent-home/__tests__/mission-copy-hygiene.test.ts`**

Asserts the rendered mission response from a `buildTestServer` request to `/agent-home/mission` (mocked Prisma per `[[api-test-mocked-prisma]]`) contains none of:

- `"HotPod"`
- `"Tours pipeline"`
- `"book tours"`
- `"tour value"`
- `"tour calendar"`

Recursively walks every string field in the mission payload. Asserting against the rendered response (rather than the constants directly) catches future drift if `ALEX_ROLE` / `ALEX_PIPELINE` are ever moved to config or templated.

Both tests use the five narrow banned phrases above. Lowercase `tour` is **not** banned repo-wide — generic occurrences in code, comments, or unrelated tests are allowed. Only the five operator-visible phrases are gated.

## Implementation slice

Single PR off `origin/main`, branch `fix/cockpit-medspa-vertical-copy`.

Commits:

1. `docs(cockpit): update umbrella spec to medspa vertical copy` — the nine spec doc edits.
2. `fix(cockpit): swap tours and tenant copy for medspa equivalents` — seven production string changes (api + dashboard).
3. `test(cockpit): align fixtures with new medspa copy + rename HotPod org fixture` — the test fixture updates listed in §Test fixtures, plus replacing `"HotPod Yoga"` with `"Acme Medspa"` across the 7 fixture sites.
4. `test(cockpit): add copy-hygiene regression coverage` — the two new tests.

Pre-merge gates:

- `pnpm reset && pnpm typecheck && pnpm lint && pnpm test`
- `pnpm --filter @switchboard/dashboard build` (CI does not run this — `[[dashboard-build-not-in-ci]]`)
- `pnpm format:check` (CI runs prettier check; local lint does not — `[[ci-prettier-not-in-local-lint]]`)
- Coverage: dashboard floor 40/35/40/40 (`[[dashboard-coverage-threshold]]`); root global 55/50/52/55. The change is string-for-string in production code and test fixtures plus two tiny new tests — coverage will not move materially.

PR title: `fix(cockpit): medspa vertical copy + tenant-string removal`

No `--auto` (`[[auto-merge-captures-head-early]]`).

## Memory update (out of git, no commit)

The `[[project-alex-vertical-medspa]]` memory's "Do NOT silently rename 'Tours' in code" guidance is narrowed, not deleted. New rule (applied in memory after this spec lands):

> **Operator-visible threshold (added 2026-05-16):** Strings the operator can read on any rendered surface (cockpit, mission popover, empty state, ROI bar, narrator copy) must use medspa-vertical wording. Strings only visible to engineers — schema field names, internal type names, generic concept names — stay neutral. The 2026-05-16 cockpit-vertical-copy PR applied this threshold to the cockpit; it does not authorize a repo-wide `tour` → `consultation` sweep.

This update is to project memory at `/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/project_alex_vertical_medspa.md`, not to a repo doc, so it is not part of the implementation PR.

## Risk

Low. Seven production string swaps across four code files, nine illustrative-copy lines in the umbrella spec, mechanical fixture/assertion updates across nine test files (including the org-name rename), and two narrowly-scoped new hygiene tests. No schema, no types, no config, no architecture. The largest blast radius is the test-fixture rename surface — straightforward find-and-replace caught by `pnpm test` in pre-merge.
