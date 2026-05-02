# Dashboard core — Session Progress

> Resume protocol per spec §13.1. Delete this file when the surface is closed.

**Session SHA at start:** 02fcaa4c3951b2c215b9fca7c5aad04f703f5ff9
**Session date:** 2026-05-01
**Tier:** Deep

## Routes enumerated

From `git ls-tree -r origin/main --name-only | grep "apps/dashboard/src/app/(auth)/(console|decide|escalations|conversations)"`:

- `/console` — `apps/dashboard/src/app/(auth)/console/page.tsx`
- `/decide` — `apps/dashboard/src/app/(auth)/decide/page.tsx`
- `/decide/[id]` — `apps/dashboard/src/app/(auth)/decide/[id]/page.tsx`
- `/escalations` — `apps/dashboard/src/app/(auth)/escalations/page.tsx`
- `/conversations` — `apps/dashboard/src/app/(auth)/conversations/page.tsx`

## Pre-flight

- [x] Spec re-read for this surface (§4 row 1, §5 dimension list, §13.8 calibration)
- [x] Routes enumerated (above)
- [ ] Dev server up: `pnpm --filter @switchboard/dashboard dev` (port 3002)
- [ ] API up: `pnpm --filter @switchboard/api dev` (port 3000)

## Dimensions

- [x] A — Visual (Claude proposes from code; **human takes screenshots**)
- [x] B — UX flow (Claude maps task graph; **human walks tasks**)
- [x] C — Copy (Claude reads + cross-references; **human confirms claims**)
- [ ] D — State (**human forces states**; Claude prepares script + files findings)
- [ ] E — Responsive (**human resizes**; Claude prepares script + files findings)
- [x] F — A11y (Claude code-reads static a11y; **human runs axe + keyboard + VO**)
- [ ] G — Performance (**human runs Lighthouse**; Claude reads JSON + files findings)
- [x] H — Contract (Claude code-reads hooks↔API↔schema)
- [x] I-light — Auth (Claude code-reads guards + RQ scoping; **human two-tenant repro**)

## Closeout

- [ ] Calibration ritual run with user (§13.8)
- [ ] Validation passes: `pnpm audit:validate docs/audits/2026-05-01-pre-launch-surface/01-dashboard-core-findings.md`
- [ ] Artifacts committed under `artifacts/01-dashboard-core/`
- [ ] Findings doc front-matter `session_closed` set
- [ ] PR opened
