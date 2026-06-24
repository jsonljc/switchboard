# zod v4 migration plan

Closed dependabot PR #732 (zod 3.25.76 → 4.4.3) on 2026-06-14 because it is a breaking
code migration, not a clean bump. This note captures what the migration requires so it can
be picked up deliberately on a dedicated branch.

## Why it can't be a plain bump

zod is a Layer-1 dependency (packages/schemas) imported by ~241 source files across 13
workspaces (schemas, core, sdk, cartridge-sdk, ad-optimizer, creative-pipeline, api, chat,
dashboard + 4 eval packages). On #732's CI, `@switchboard/schemas:build` emitted 100+
`TS2554` errors and all four Eval jobs failed.

## Breaking changes to codemod (from the #732 failure surface)

1. **`z.record(...)` now requires explicit key + value types** — ~97 callsites.
   `z.record(Foo)` → `z.record(z.string(), Foo)`.
2. **`z.string().email()/.url()/.uuid()` moved to top-level** — ~65 callsites.
   `z.string().email()` → `z.email()`, etc.
3. **String-message args changed** on `.optional()` / `.default()` and friends.
4. **`.strict()` / `.passthrough()` semantics changed** — audit each object schema.

## Execution order

1. Dedicated branch (do NOT batch with other dep bumps).
2. Codemod the three mechanical patterns above in packages/schemas first.
3. `pnpm reset` (schemas → core → db rebuild chain), then per-package typecheck fixes.
4. `pnpm test` + `pnpm typecheck` across the monorepo; fix Eval packages last.
5. Opus pre-merge review (Layer-1 schema change touching auth/payments-adjacent schemas).

## Re-create the bump

Either reopen #732 after the codemod lands, or let dependabot re-raise it.
