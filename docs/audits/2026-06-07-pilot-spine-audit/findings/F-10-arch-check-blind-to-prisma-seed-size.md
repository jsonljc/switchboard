# F-10: arch-check size gate is blind to `packages/db/prisma/` — two seed files exceed the 600-line error threshold unmeasured

- **Severity:** decay
- **Journey/step:** decay-pass (Step 3, size)
- **Verdict:** GAP (tooling blind spot, no runtime impact)
- **Location:** `scripts/arch-check.ts:109` (scope) vs `packages/db/prisma/seed-marketplace.ts` (1068 lines), `packages/db/prisma/seed.ts` (653 lines) (verified against branch `audit/pilot-spine` on 2026-06-08)
- **Evidence:**
  - `scripts/arch-check.ts:109` `const srcDir = join(pkgDir, "src");` — the size/`as any`/test-count scan only walks each package's `src/` subtree. The `prisma/` subtree is never visited.
  - `scripts/arch-check.ts:23` `const ERROR_LINES = 600;` and `:155-160` — a file >600 lines is reported 🔴 ERROR (exit 1) **unless** it contains `eslint-disable max-lines` (`:81-88`, `hasEslintDisableMaxLines`).
  - `packages/db/prisma/seed-marketplace.ts` is 1068 raw lines and `packages/db/prisma/seed.ts` is 653 raw lines. Both exceed `ERROR_LINES` (600). Neither lives under a `src/` tree, so neither is scanned — the CI architecture size gate never sees them and cannot flag them.
  - Confirmed empirically: `evidence/arch-check.txt` lists 14 god-module 🟡 entries that are all under `src/`; neither seed file appears, and exit is 0.
  - For contrast, every `src/`-tree `.ts` file >600 lines (e.g. `apps/api/src/bootstrap/inngest.ts` 1280, `packages/core/src/platform/platform-ingress.ts` 675) does carry `eslint-disable max-lines` and is correctly reported 🟡 legacy-debt.

## What was exercised

Step 3 of the decay pass: enumerated all `.ts` files >600 raw lines (`find … | xargs wc -l | awk '$1>600'`), then cross-checked each against `scripts/arch-check.ts`'s scan scope and `eslint-disable max-lines` rule to explain why arch-check still exits 0. The two `prisma/seed*.ts` files are the only >600-line production `.ts` files that are neither eslint-disable'd nor scanned.

## What happened vs expected

Expected: the architecture size gate measures all hand-maintained `.ts` source so growth is caught. Observed: `prisma/seed*.ts` are structurally invisible to the gate. They can grow without bound and never trip the 600-line error or even the 400-line warning. Low blast radius — seed files are dev/test/marketplace scaffolding, not pilot runtime — but the gate gives false assurance that "no .ts file exceeds 600 without an explicit waiver."

## Suggested fix scope

Either (a) extend `arch-check.ts`'s walk to include `packages/db/prisma/*.ts` (and add an `eslint-disable max-lines` waiver to the seed files if the size is accepted), or (b) explicitly document that `prisma/` is out of scope for the size gate. No product-code change; this is a tooling-coverage decay item. Not pilot-blocking.
