# arch-guard — Architecture Guardian

## Description

The always-on architecture gatekeeper. Validates every code change against architecture rules in real-time. This skill absorbs the former `pre-merge-check` skill — there is no separate pre-merge step, these checks apply continuously.

## When to Use

Activate this skill when:

- Creating new files or adding imports
- Creating new packages or cartridges
- Modifying barrel files (index.ts)
- Moving code between packages
- Before commits ("is this ready?", "commit", "create PR")
- When the user says "push", "merge", "ready to ship", "looks good?"

## Instructions

### 1. Import Boundary Validation

For every new import statement, validate against the dependency layer rules:

- `packages/schemas/` → **NO** `@switchboard/*` imports (leaf package)
- `packages/cartridge-sdk/` → **ONLY** `@switchboard/schemas`
- `packages/core/` → **ONLY** `@switchboard/schemas`, `@switchboard/cartridge-sdk`
- `packages/db/` → **ONLY** `@switchboard/schemas`, `@switchboard/core`
- `cartridges/*/` → **ONLY** `@switchboard/schemas`, `@switchboard/cartridge-sdk`, `@switchboard/core`
- `apps/*/` → may import any `@switchboard/*` package

**REFUSE** to add `@switchboard/db` as a dependency to any cartridge.
**REFUSE** cross-cartridge imports (one cartridge importing from another).

### 2. File Size Monitoring

When a file is being modified:

1. Check its current line count
2. If it will exceed **400 lines** after the change → warn and suggest splitting
3. If it will exceed **600 lines** → **REFUSE** and require splitting first (ESLint will block the commit anyway)

### 3. Test File Requirement

Every new `.ts` source file (non-test, non-index, non-types) **must** have a corresponding `__tests__/<name>.test.ts`.

- Check all files in the current diff, not the whole codebase
- If creating a new module, create the test file alongside it

### 4. Code Quality Gates

Scan new/modified code for:

1. **`as any`** — flag every instance; suggest proper types or `unknown`
2. **`console.log`** — should use `console.warn` or `console.error`
3. **Missing `.js` extensions** in relative imports
4. **Unused imports** — clean them up
5. **Unsafe parameter casting** — in cartridge `execute()` methods, flag `parameters["key"] as string` patterns; suggest using `parseParams()` from `@switchboard/cartridge-sdk` with a Zod schema instead

### 5. Safe Parameter Extraction

When writing or modifying cartridge `execute()` methods:

- **Do NOT use** `parameters["key"] as string` — this silently produces `"undefined"` (the string) when the key is missing
- **DO use** `parseParams(schema, parameters)` from `@switchboard/cartridge-sdk` with a Zod schema defining the expected parameters
- This provides runtime validation with clear error messages

### 6. New Cartridge Checklist

When creating a new cartridge, verify:

1. It does not import from `db` or `apps`
2. It does not import from other cartridges
3. It has a `manifest.ts`
4. It has `defaults/guardrails.ts`
5. It has at least one test file
6. It's registered in at least one app (api or mcp-server)
7. The `Dockerfile` includes it (base and production stages)
8. **The `.eslintrc.json` blocklists include it** — in both the `cartridges/*/src/**/*.ts` override (cross-cartridge patterns) and the `packages/db/src/**/*.ts` override (db cannot import cartridges)

### 7. Barrel File Hygiene

When adding exports to an `index.ts`:

- Count total exported symbols
- If exports exceed **40 symbols** → flag for review
- Prefer selective re-exports over `export *`

### 8. Utility Duplication Check

When adding a utility function:

1. Search `packages/cartridge-sdk/src/` for similar functions
2. Search `packages/core/src/` for similar functions
3. Search `packages/schemas/src/` for similar functions
4. If a similar function exists → use it instead of creating a new one

### 9. Schema Change Impact

When modifying files in `packages/schemas/`:

1. List all downstream consumers that import from `@switchboard/schemas`
2. Warn about potential breakage
3. Suggest running `pnpm typecheck` to validate

### 10. Pre-Commit Readiness

When the user wants to commit or create a PR, verify:

1. All new source files have corresponding test files
2. No `as any` in new/modified code
3. No `console.log` usage
4. All relative imports have `.js` extensions
5. Suggest running `pnpm typecheck` and `pnpm test` if significant changes were made
6. If a new cartridge was added, run through the full cartridge checklist (step 6)
