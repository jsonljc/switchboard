# arch-guard — Architecture Guardian

## Description
Validates architectural boundaries and design decisions during AI-assisted coding. This is the primary gatekeeper skill that runs conceptually "first" on any code change.

## When to Use
Activate this skill when:
- Creating new files or adding imports
- Creating new packages or cartridges
- Modifying the dependency structure between packages
- Adding exports to barrel files (index.ts)
- Moving code between packages

## Instructions

### Import Validation
For every new import statement, validate against the dependency layer rules:
- `packages/schemas/` → **NO** `@switchboard/*` imports (leaf package)
- `packages/cartridge-sdk/` → **ONLY** `@switchboard/schemas`
- `packages/core/` → **ONLY** `@switchboard/schemas`, `@switchboard/cartridge-sdk`
- `packages/db/` → **ONLY** `@switchboard/schemas`, `@switchboard/core`
- `cartridges/*/` → **ONLY** `@switchboard/schemas`, `@switchboard/cartridge-sdk`, `@switchboard/core`
- `apps/*/` → may import any `@switchboard/*` package

**REFUSE** to add `@switchboard/db` as a dependency to any cartridge.
**REFUSE** cross-cartridge imports (one cartridge importing from another).

### File Size Monitoring
When a file is being modified:
1. Check its current line count
2. If it will exceed **400 lines** after the change → warn and suggest splitting
3. If it will exceed **600 lines** → refuse and require splitting first

### New Cartridge Validation
When creating a new cartridge, verify:
1. It does not import from `db` or `apps`
2. It has a `manifest.ts`
3. It has `defaults/guardrails.ts`
4. It has at least one test file
5. It's registered in at least one app
6. The `Dockerfile` includes it

### Barrel File Hygiene
When adding exports to an `index.ts`:
- Count total exported symbols
- If exports exceed **40 symbols** → flag for review
- Prefer selective re-exports over `export *`

### Utility Duplication Check
When adding a utility function:
1. Search `packages/cartridge-sdk/src/` for similar functions
2. Search `packages/core/src/` for similar functions
3. Search `packages/schemas/src/` for similar functions
4. If a similar function exists → use it instead of creating a new one

### Schema Change Impact
When modifying files in `packages/schemas/`:
1. List all downstream consumers that import from `@switchboard/schemas`
2. Warn about potential breakage
3. Suggest running `pnpm typecheck` to validate
