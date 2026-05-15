# lint-debt

**Charter:** console.log, \_-prefix escapes, prettier drift, .js-extension rule per-direction.

**Method:**

- `console.log`: rg -n '\bconsole\.log\b' apps/ packages/ -g '\*.{ts,tsx,mjs,cjs}' (16 hits, all in seed.ts)
- prettier-drift: pnpm format:check (0 violations)
- dashboard `.js` violations: rg -n "from ['\"][^']_\.js['\"]" apps/dashboard/src -g '_.{ts,tsx}' (36 violations, 32 in tests, 4 in source)
- other-package `.js` violations: rg -n "from ['\"][^']_\.js['\"]" apps/api/src packages/_/src -g '\*.ts' (0 violations)
- `_`-prefix escapes: rg -n '\bconst _\w+|\blet _\w+' and manual code-read (2 bugs identified)

**Scope exclusions applied:** None (standard exclusions — node_modules, dist, .next — applied by tooling)

## Headline counts

- `console.log` hits: 16 (all in database seed script)
- prettier-drift files: 0
- dashboard `.js` violations (should OMIT): 36 (4 in source, 32 in tests)
- other-package `.js` violations (should INCLUDE): 0
- `_`-prefix bugs (used after underscore, masking a real value): 2

## Findings

### [MED] Module-level `_stripe` variable shadows actual usage

- **Where:** `apps/api/src/services/stripe-service.ts:7, 10, 13, 15`
- **Evidence:** `let _stripe: Stripe | null = null;` followed by `if (!_stripe) { _stripe = new Stripe(key, {...}); } return _stripe;`
- **Why it matters:** The underscore prefix signals "unused variable" by CLAUDE.md convention, but `_stripe` is a module-level singleton that is initialized and returned. This contradicts the naming convention and masks the actual purpose of the variable.
- **Fix:** Rename `_stripe` to `stripe` to match the pattern used elsewhere (e.g., `prisma` in packages/db/src/index.ts).
- **Effort:** S
- **Risk if untouched:** None (code works correctly, but the convention violation could confuse maintainers or trigger linting).
- **Collides with active work?:** No

### [MED] Test-level `_idSeq` counter shadows actual usage

- **Where:** `apps/api/src/__tests__/integration-lifecycle-3b.test.ts:43, 62`
- **Evidence:** `let _idSeq = 0;` followed by `transitions.push({ id: \`t-${++\_idSeq}\`, ...t } as any);`
- **Why it matters:** `_idSeq` is a module-level test fixture counter that is actively incremented to generate unique IDs. The underscore prefix violates the CLAUDE.md convention and misrepresents the variable's purpose.
- **Fix:** Rename `_idSeq` to `idSeq`.
- **Effort:** S
- **Risk if untouched:** Convention violation but functionally sound.
- **Collides with active work?:** No

### [LOW] Dashboard imports include `.js` extension (violates Next.js convention)

- **Where:** `apps/dashboard/src` — 36 violations across 34 files
  - Source files (4): resolve-link.ts:3, map-to-decision-card.ts:1, route-availability.ts:24
  - Test files (32): widespread in `__tests__` directories (activity, decisions, routes, hooks, components)
- **Evidence:** Patterns like `import type { AgentHomeLink } from "./types.js";` and `import { GET } from "../route.js";`
- **Why it matters:** CLAUDE.md §"Code Basics" states ".js extensions in relative imports (except Next.js)". Dashboard is Next.js and should OMIT `.js` extensions per Next.js/SWC resolver rules. Including them forces explicit extension resolution, which can break builds or cause module resolution failures.
- **Fix:** Strip `.js` from all dashboard imports. Mechanical find-replace.
- **Effort:** S (mechanical, low risk)
- **Risk if untouched:** Potential Next.js/SWC module resolution failures if bundler or type-checker becomes strict.
- **Collides with active work?:** No

### [LOW] 16 `console.log` statements in database seed script

- **Where:** `packages/db/prisma/seed.ts` (lines 52, 66, 81, 85, 114, 144, 166, 189, 201, 271, 322, 500, 589, 592, 596, 600)
- **Evidence:** All 16 hits are `console.log(...)` calls in the Prisma seed script
- **Why it matters:** CLAUDE.md §"Code Basics" forbids `console.log`; only `console.warn` and `console.error` are allowed. This script is development-only and non-blocking, but violates the standard.
- **Fix:** Replace `console.log` with `console.error` (or `console.warn` for non-error messages).
- **Effort:** S
- **Risk if untouched:** Purely a lint standard violation.
- **Collides with active work?:** No

## Out of scope / deferred for this lane

- None. All discovered lint debt is actionable and low-risk.
