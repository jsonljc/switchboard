# <Surface name> — Session Progress

> Resume protocol per spec §13.1. Delete this file when the surface is closed.

**Session SHA at start:** <commit SHA>
**Session date:** <YYYY-MM-DD>
**Tier:** <Deep | Standard | Light>

## Pre-flight

- [ ] Spec re-read for this surface (§4 row, §5 dimension list)
- [ ] Routes enumerated (`find apps/dashboard/src/app -name page.tsx | grep -E "<surface routes>"`)
- [ ] Dev server up: `pnpm --filter @switchboard/dashboard dev` (port 3002)
- [ ] API up if needed: `pnpm --filter @switchboard/api dev` (port 3000)

## Dimensions

- [ ] A — Visual
- [ ] B — UX flow
- [ ] C — Copy
- [ ] D — State
- [ ] E — Responsive
- [ ] F — A11y
- [ ] G — Performance
- [ ] H — Contract
- [ ] I-light — Auth
- [ ] J — Notifications-specific (only surface 6)

> Tick only dimensions that are in scope per the spec for this surface. Lines outside scope can be deleted.

## Closeout

- [ ] Calibration ritual run with user (§13.8)
- [ ] Validation passes: `pnpm audit:validate <findings file>`
- [ ] Artifacts committed under `artifacts/<NN-surface>/`
- [ ] Findings doc front-matter `session_closed` set
- [ ] PR opened
