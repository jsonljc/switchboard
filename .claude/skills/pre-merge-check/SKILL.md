# pre-merge-check — Readiness Before Merge

## Description
Final checklist validation before code is committed or a PR is created. Ensures nothing ships incomplete or broken.

## When to Use
Activate this skill when the user says:
- "commit", "push", "create PR", "merge"
- "is this ready", "ready to ship", "looks good?"

## Instructions

### Test File Coverage
Every new `.ts` file (non-test, non-index, non-types) **must** have a corresponding test file:
- Source: `src/foo/bar.ts` → Test: `src/foo/__tests__/bar.test.ts`
- Check all files in the current diff, not the whole codebase

### Code Quality in Diff
Scan the diff (staged + unstaged changes) for:
1. **`as any`** — flag every instance in new/modified code
2. **Files over 500 lines** — flag for splitting before merge
3. **Missing `.js` extensions** in relative imports
4. **`console.log`** usage — should use `console.warn` or `console.error`
5. **Unused imports** — clean them up

### New Cartridge Completeness
If a new cartridge was added in this diff, verify:
- [ ] Has `manifest.ts`
- [ ] Has `defaults/guardrails.ts`
- [ ] Has at least one test file
- [ ] Is imported in at least one app (api or mcp-server)
- [ ] Is included in `Dockerfile` (base and production stages)
- [ ] Dependency boundaries are correct (no db/apps imports)

### Schema Change Verification
If `packages/schemas/` was modified:
- Run `pnpm typecheck` to verify downstream builds pass
- List affected packages

### Final Verification Steps
Run these commands and report results:
```bash
pnpm typecheck
pnpm test
npx depcruise --config .dependency-cruiser.cjs packages/ cartridges/ apps/
```

Report any failures clearly with the specific error messages.
