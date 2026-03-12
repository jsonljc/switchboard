# weekly-audit — Architecture Health Report

## Description
Periodic health check that surfaces architectural drift before it becomes a problem. Generates a comprehensive report covering boundaries, code quality, test coverage, and infrastructure.

## When to Use
Activate this skill when:
- The user invokes `/arch-audit` or asks for an architecture review
- Weekly periodic check (suggested cadence)
- Before major releases or milestones

## Instructions

Run the following checks and compile a structured report:

### 1. Dependency Boundary Validation
```bash
npx depcruise --config .dependency-cruiser.cjs packages/ cartridges/ apps/
```
Report any violations with file paths and the rule that was violated.

### 2. File Size Audit
Find all `.ts` source files (non-test, non-declaration) over 400 lines:
- List each with its line count
- Flag files over 600 lines as critical
- Suggest splitting strategies for the largest files

### 3. Test Coverage Gaps
For each package in `packages/`, `cartridges/`, and `apps/`:
- Count source files vs test files
- Flag packages with fewer than 3 test files
- Flag packages with 0 test files as critical

### 4. `as any` Audit
Count `as any` occurrences per package:
- List packages sorted by count (highest first)
- Flag any new `as any` added since the last audit

### 5. Package Size Tracking
For each package, report:
- Number of source files
- Flag any package with more than 50 source files as a monolith candidate
- Compare with expected growth patterns

### 6. Infrastructure Checks
- **Dockerfile**: verify all cartridges in `cartridges/` are included in the Dockerfile
- **ESLint overrides**: verify the `no-restricted-imports` blocklists in `.eslintrc.json` include all cartridges (defense-in-depth backup for dependency-cruiser)
- **CI workflow**: verify the `boundaries` job exists in `.github/workflows/ci.yml`

### 7. Summary
Generate a 1-paragraph summary of architecture health:
- Overall grade (A/B/C/D)
- Top 3 issues to address
- Trend since last audit (improving/stable/declining)

### Output Format
```
╔══════════════════════════════════════════════════╗
║        ARCHITECTURE HEALTH CHECK REPORT         ║
╚══════════════════════════════════════════════════╝

[Section 1: Boundaries]
[Section 2: File Sizes]
[Section 3: Test Gaps]
[Section 4: Any Usage]
[Section 5: Package Sizes]
[Section 6: Infrastructure]
[Section 7: Summary]
```

Alternatively, run the `scripts/arch-check.ts` script for an automated version:
```bash
npx tsx scripts/arch-check.ts
```
