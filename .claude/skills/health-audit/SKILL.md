# health-audit — Architecture Health Report

## Description

Periodic health check that identifies trends and prioritizes the most impactful improvements. Focuses on qualitative review and trend analysis — quantitative checks are now automated in CI via `arch-check.ts` and dependency-cruiser.

## When to Use

Activate this skill when:

- The user invokes `/arch-audit` or asks for an architecture review
- Weekly periodic check (suggested cadence)
- Before major releases or milestones

## Instructions

### 1. Run Automated Checks

```bash
npx tsx scripts/arch-check.ts
```

Interpret the output and flag any new issues vs. the previous audit.

### 2. Trend Analysis

Compare with previous audit results:

- Are god files being split or growing?
- Is `as any` count increasing or decreasing?
- Are new packages/cartridges following the checklist?
- Are test coverage numbers improving?

### 3. Top 3 Priorities

Identify the three most impactful issues to fix this week. Prioritize by:

1. Things that block other developers or cause runtime bugs
2. Things that make the codebase harder to understand
3. Things that will get worse if ignored

### 4. Qualitative Review

Things static tools can't catch:

- **Naming consistency** — are similar concepts named the same way across packages?
- **Abstraction quality** — are abstractions at the right level? Too generic? Too specific?
- **Documentation accuracy** — does CLAUDE.md match reality? Are inline comments still accurate?
- **Test meaningfulness** — are tests testing behavior or just hitting coverage numbers?
- **Cartridge internal organization** — is digital-ads (100+ files) well-organized internally?

### 5. Summary Grade

Assign an overall health grade with specific justification:

- **A**: No critical issues, improving trends, all checks passing
- **B**: Minor issues, stable trends, no regressions
- **C**: Some concerning trends, debt accumulating in specific areas
- **D**: Critical issues, declining trends, immediate action needed

### Output Format

```
╔══════════════════════════════════════════════════╗
║        ARCHITECTURE HEALTH REPORT               ║
╚══════════════════════════════════════════════════╝

[Automated Check Results]
[Trend Analysis]
[Top 3 Priorities]
[Qualitative Review]
[Summary Grade: X — justification]
```
