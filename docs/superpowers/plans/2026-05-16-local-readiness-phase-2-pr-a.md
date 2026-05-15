# Local Readiness Phase 2 — PR A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PR A of the local-readiness phase-2 spec — the "no silent green" bootstrap correctness PR. After this lands, a fresh `git clone` followed by `pnpm local:setup` produces a working dev environment with no manual steps, and `pnpm local:verify[:fast]` cannot report green when the local database is empty or unconfigured.

**Architecture:** Five tightly-coupled changes that protect a single failure mode: tooling must not signal success when the app isn't actually ready. Three TypeScript script edits (`check-seed-counts.ts`, `local-verify-fast.ts`, new `local-setup.ts`), two shell-script edits (`worktree-init.sh`, `setup-env.sh`), one TypeScript validator extension (`.agent/tools/allowlist.ts`), and two docs touches (`apps/dashboard/.env.local.example`, root `README.md`).

**Tech Stack:** Bash, TypeScript (tsx), Node.js, pnpm + Turborepo, Vitest, Prisma. Spec at `docs/superpowers/specs/2026-05-16-local-readiness-phase-2-design.md` (PR #580).

---

## File Structure

**Created:**

- `docs/superpowers/plans/2026-05-16-local-readiness-phase-2-pr-a.md` — this file
- `scripts/local-setup.ts` — orchestrates the `pnpm local:setup` chain (Task 5)
- `scripts/__tests__/local-setup.test.ts` — unit test for the step list (Task 5)

**Modified:**

- `.agent/tools/allowlist.ts` — adds `validateTemporaryEntries()` (Task 1)
- `.agent/tools/check-routes.ts` — calls the new validator (Task 1)
- `.agent/tools/__tests__/allowlist.test.ts` — adds tests for the rule (Task 1)
- `scripts/check-seed-counts.ts` — three-state output + `--strict-db` flag + recovery hint (Task 2)
- `scripts/__tests__/check-seed-counts.test.ts` — covers all three states + flag (Task 2)
- `scripts/local-verify-fast.ts` — passes `--strict-db` to seed-counts step (Task 2)
- `scripts/setup-env.sh` — extended to handle worktree env copy in addition to secret generation (Task 3)
- `scripts/worktree-init.sh` — migrate failures fatal; add build + seed when DB reachable; explicit DB-unreachable message; delegates env copy to setup-env.sh (Task 4)
- `package.json` (root) — adds `local:setup` script (Task 5)
- `apps/dashboard/.env.local.example` — SYNC-FROM-ROOT header + inline annotations (Task 6)
- `README.md` (root) — adds "First-time local setup" section (Task 6)

---

## Sequencing

Tasks are ordered so each one ships a coherent, testable unit and the dependency chain is forward-only:

1. **A5 — Allowlist temporary-entry rule** (isolated, no dependencies)
2. **A3 — `check-seed-counts.ts` three-state + `--strict-db`** (standalone refactor)
3. **Prep — Extend `setup-env.sh` for worktree env copy** (unblocks Tasks 4 + 5)
4. **A1 — Harden `worktree-init.sh`** (depends on Task 3)
5. **A2 — `pnpm local:setup` command** (depends on Task 3)
6. **A4 — `.env.local.example` + README** (pure docs; can land last)

Each task includes a commit step. Run `pnpm typecheck` and the task's test before committing.

---

## Task 1: A5 — Allowlist temporary-entry issue-reference rule

**Files:**

- Modify: `.agent/tools/allowlist.ts`
- Modify: `.agent/tools/check-routes.ts`
- Modify: `.agent/tools/__tests__/allowlist.test.ts`

### Step 1: Write failing test for `validateTemporaryEntries()`

- [ ] Open `.agent/tools/__tests__/allowlist.test.ts`. The file already imports `describe`, `expect`, `it` from `vitest` and the `AllowlistEntry` type. **Do not blindly paste the imports below — merge into the existing imports.** Add `validateTemporaryEntries` to the existing `../allowlist.js` import line, then append the new `describe` block:

```typescript
// MERGE these imports into the existing ones at the top of the file; do not duplicate:
import { describe, expect, it } from "vitest";
import { validateTemporaryEntries, type AllowlistEntry } from "../allowlist.js";

describe("validateTemporaryEntries", () => {
  it("returns no errors for a permanently-justified entry", () => {
    const entries: AllowlistEntry[] = [
      {
        path: "apps/api/src/routes/foo.ts",
        reason: "Permanently justified: webhook receiver — no operator action.",
      },
    ];
    expect(validateTemporaryEntries(entries)).toEqual([]);
  });

  it("returns no errors for a temporary entry that cites an issue in its reason", () => {
    const entries: AllowlistEntry[] = [
      {
        path: "apps/api/src/routes/foo.ts",
        reason:
          "Temporarily justified: governed mutator pending migration. Follow-up: route-governance-cleanup (#562).",
      },
    ];
    expect(validateTemporaryEntries(entries)).toEqual([]);
  });

  it("returns an error when a temporary entry has no #NNN reference in its reason", () => {
    const entries: AllowlistEntry[] = [
      {
        path: "apps/api/src/routes/foo.ts",
        reason: "Temporarily justified: governed mutator pending migration.",
      },
    ];
    const errors = validateTemporaryEntries(entries);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"apps/api/src/routes/foo.ts"');
    expect(errors[0]).toMatch(/cite an open issue/);
    expect(errors[0]).toMatch(/in its reason field/);
  });

  it("counts multiple offending entries", () => {
    const entries: AllowlistEntry[] = [
      { path: "a.ts", reason: "Temporarily justified: a." },
      { path: "b.ts", reason: "Temporarily justified: b. #999" },
      { path: "c.ts", reason: "Temporarily justified: c." },
    ];
    expect(validateTemporaryEntries(entries)).toHaveLength(2);
  });
});
```

### Step 2: Run test to verify it fails

- [ ] Run: `pnpm exec vitest run .agent/tools/__tests__/allowlist.test.ts`

Expected: FAIL with `validateTemporaryEntries is not exported` / `is not a function`.

### Step 3: Add `validateTemporaryEntries()` to `.agent/tools/allowlist.ts`

- [ ] Append to `.agent/tools/allowlist.ts` after the `isAllowlisted` export:

```typescript
const TEMP_PREFIX = "Temporarily justified:";
const ISSUE_REF_PATTERN = /#\d+/;

/**
 * For any entry whose `reason` starts with `Temporarily justified:`, the
 * reason itself (not a YAML comment above the entry) must cite a `#NNN`
 * GitHub issue. Returns one error message per offending entry; empty array
 * when all temporary entries comply.
 */
export function validateTemporaryEntries(entries: AllowlistEntry[]): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.reason.startsWith(TEMP_PREFIX)) continue;
    if (ISSUE_REF_PATTERN.test(entry.reason)) continue;
    errors.push(
      `Temporary allowlist entry for "${entry.path}" must cite an open issue (e.g., #562) in its reason field.`,
    );
  }
  return errors;
}
```

### Step 4: Run test to verify it passes

Run: `pnpm exec vitest run .agent/tools/__tests__/allowlist.test.ts`
Expected: PASS (4/4).

### Step 5: Wire the validator into `check-routes.ts`

- [ ] Open `.agent/tools/check-routes.ts`. Find the import of `loadAllowlist`:

```typescript
import { loadAllowlist, isAllowlisted, type AllowlistEntry } from "./allowlist.js";
```

Update to:

```typescript
import {
  loadAllowlist,
  isAllowlisted,
  validateTemporaryEntries,
  type AllowlistEntry,
} from "./allowlist.js";
```

- [ ] Find where `loadAllowlist()` is called inside the `run()` function (likely near the top of the function). Immediately after the call, add:

```typescript
const tempErrors = validateTemporaryEntries(allowlistEntries);
if (tempErrors.length > 0) {
  for (const err of tempErrors) {
    console.error(err); // eslint-disable-line no-console
  }
  return { findings: [], suppressedCount: 0, exitCode: 1 };
}
```

(Replace `allowlistEntries` with whatever local variable name `loadAllowlist` is assigned to in the file.)

### Step 6: Add an integration test through `check-routes`

- [ ] In `.agent/tools/__tests__/check-routes.test.ts`, find the existing test fixture pattern (likely using a fixture allowlist file). Add a new test:

```typescript
it("fails when a temporary allowlist entry has no #NNN reference", async () => {
  const fixtureAllowlist = path.join(__dirname, "fixtures", "allowlist-temp-no-issue.yaml");
  // The fixture file content should be:
  //   - path: "apps/api/src/routes/foo.ts"
  //     reason: "Temporarily justified: needs migration."
  const result = await run({
    includePaths: ["apps/api/src/routes/**/*.ts"],
    allowlistPath: fixtureAllowlist,
    repoRoot: REPO_ROOT,
  });
  expect(result.exitCode).toBe(1);
});
```

- [ ] Create the fixture file `.agent/tools/__tests__/fixtures/allowlist-temp-no-issue.yaml`:

```yaml
- path: "apps/api/src/routes/foo.ts"
  reason: "Temporarily justified: needs migration."
```

### Step 7: Run both tests and `pnpm typecheck`

Run: `pnpm exec vitest run .agent/tools/__tests__/allowlist.test.ts .agent/tools/__tests__/check-routes.test.ts`
Expected: All PASS.

Run: `pnpm typecheck`
Expected: PASS.

### Step 8: Commit

```bash
git add .agent/tools/allowlist.ts .agent/tools/check-routes.ts \
        .agent/tools/__tests__/allowlist.test.ts .agent/tools/__tests__/check-routes.test.ts \
        .agent/tools/__tests__/fixtures/allowlist-temp-no-issue.yaml
git commit -m "feat(local-readiness-phase-2): a5 — allowlist temp-entry issue-reference rule"
```

---

## Task 2: A3 — `check-seed-counts.ts` three-state + `--strict-db` flag

**Files:**

- Modify: `scripts/check-seed-counts.ts`
- Modify: `scripts/__tests__/check-seed-counts.test.ts`
- Modify: `scripts/local-verify-fast.ts`

### Step 1: Read existing test file structure

- [ ] Read `scripts/__tests__/check-seed-counts.test.ts` to understand how `auditSeedCounts()` is mocked or invoked in tests. The function returns `{ skipped, counts, unmet }` per `scripts/check-seed-counts.ts:17-22`.

### Step 2: Write failing tests for three-state behavior

- [ ] Replace the existing test file content (or append, depending on coverage gaps) with tests covering all four scenarios:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { auditSeedCounts, runMain, type SeedCountState } from "../check-seed-counts.js";

describe("auditSeedCounts state machine", () => {
  const originalUrl = process.env["DATABASE_URL"];
  afterEach(() => {
    if (originalUrl) process.env["DATABASE_URL"] = originalUrl;
    else delete process.env["DATABASE_URL"];
  });

  it("returns SKIP-NO-URL when DATABASE_URL is unset", async () => {
    delete process.env["DATABASE_URL"];
    const result = await auditSeedCounts();
    expect(result.state).toBe("SKIP-NO-URL" satisfies SeedCountState);
  });
});

describe("runMain exit codes", () => {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  beforeEach(() => {
    exitSpy.mockClear();
    stderrSpy.mockClear();
    stdoutSpy.mockClear();
  });

  it("exits 0 on SKIP without --strict-db", async () => {
    delete process.env["DATABASE_URL"];
    await expect(runMain({ strictDb: false })).rejects.toThrow("exit:0");
  });

  it("exits 1 on SKIP with --strict-db and prints recovery hint", async () => {
    delete process.env["DATABASE_URL"];
    await expect(runMain({ strictDb: true })).rejects.toThrow("exit:1");
    const combined = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(combined).toMatch(/DATABASE_URL missing or DB unreachable/);
    expect(combined).toMatch(/pnpm local:setup/);
    expect(combined).toMatch(/pnpm db:migrate && pnpm db:seed/);
  });

  it("exits 0 on PASS", async () => {
    process.env["DATABASE_URL"] = "postgresql://localhost/none";
    const auditMock = vi.fn().mockResolvedValue({
      state: "PASS",
      counts: {
        org: 1,
        agents: 7,
        contacts: 8,
        opportunities: 8,
        auditEntries: 17,
        approvalRecords: 2,
        scheduledTriggers: 2,
      },
      unmet: [],
    });
    await expect(runMain({ strictDb: false, _auditFn: auditMock })).rejects.toThrow("exit:0");
  });

  it("exits 1 on FAIL with --strict-db unaffected", async () => {
    process.env["DATABASE_URL"] = "postgresql://localhost/none";
    const auditMock = vi.fn().mockResolvedValue({
      state: "FAIL",
      counts: {
        org: 1,
        agents: 0,
        contacts: 0,
        opportunities: 0,
        auditEntries: 0,
        approvalRecords: 0,
        scheduledTriggers: 0,
      },
      unmet: [{ key: "agents", expected: 2, actual: 0 }],
    });
    await expect(runMain({ strictDb: false, _auditFn: auditMock })).rejects.toThrow("exit:1");
    await expect(runMain({ strictDb: true, _auditFn: auditMock })).rejects.toThrow("exit:1");
  });
});
```

### Step 3: Run tests to verify they fail

Run: `pnpm exec vitest run scripts/__tests__/check-seed-counts.test.ts`
Expected: FAIL — `SeedCountState` not exported, `runMain` not exported, `state` property missing.

### Step 4: Refactor `scripts/check-seed-counts.ts`

- [ ] Replace the file contents with:

```typescript
#!/usr/bin/env tsx
/**
 * Verifies that `org_dev` has enough domain data for live-mode surfaces.
 * Three-state output:
 *   - PASS              DB reachable, all minimums met               → exit 0
 *   - FAIL              DB reachable, at least one minimum unmet     → exit 1
 *   - SKIP-NO-URL       DATABASE_URL not set                         → exit 0 (or 1 with --strict-db)
 *   - SKIP-UNREACHABLE  DATABASE_URL set, DB not reachable           → exit 0 (or 1 with --strict-db)
 *
 * `--strict-db` flag turns either SKIP state into a hard failure with a
 * loud recovery hint. `local:verify:fast` invokes with `--strict-db` so a
 * pre-bootstrap clone fails the local pre-flight instead of silently
 * passing. CI's setup job invokes without the flag (CI configures DB
 * before this check, so SKIP cannot legitimately fire there).
 */
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

const ORG_ID = "org_dev";
const MINIMUMS = {
  org: 1,
  agents: 2,
  contacts: 5,
  opportunities: 5,
  auditEntries: 15,
  approvalRecords: 2,
  scheduledTriggers: 1,
} as const;

export type SeedCountState = "PASS" | "FAIL" | "SKIP-NO-URL" | "SKIP-UNREACHABLE";

export interface SeedCountResult {
  state: SeedCountState;
  counts: Partial<Record<keyof typeof MINIMUMS, number>>;
  unmet: Array<{ key: keyof typeof MINIMUMS; expected: number; actual: number }>;
}

export async function auditSeedCounts(): Promise<SeedCountResult> {
  if (!process.env["DATABASE_URL"]) {
    return { state: "SKIP-NO-URL", counts: {}, unmet: [] };
  }
  const prisma = new PrismaClient();
  try {
    const counts = {
      org: await prisma.organizationConfig.count({ where: { id: ORG_ID } }),
      agents: await prisma.agentRoster.count({ where: { organizationId: ORG_ID } }),
      contacts: await prisma.contact.count({ where: { organizationId: ORG_ID } }),
      opportunities: await prisma.opportunity.count({ where: { organizationId: ORG_ID } }),
      auditEntries: await prisma.auditEntry.count({ where: { organizationId: ORG_ID } }),
      approvalRecords: await prisma.approvalRecord.count({ where: { organizationId: ORG_ID } }),
      scheduledTriggers: await prisma.scheduledTriggerRecord.count({
        where: { organizationId: ORG_ID },
      }),
    };
    const unmet = (Object.keys(MINIMUMS) as Array<keyof typeof MINIMUMS>)
      .filter((k) => counts[k] < MINIMUMS[k])
      .map((k) => ({ key: k, expected: MINIMUMS[k], actual: counts[k] }));
    return { state: unmet.length ? "FAIL" : "PASS", counts, unmet };
  } catch {
    return { state: "SKIP-UNREACHABLE", counts: {}, unmet: [] };
  } finally {
    await prisma.$disconnect();
  }
}

/* eslint-disable no-console */
const SKIP_BANNER = `
================================================================
⚠  SEED-COUNT CHECK SKIPPED
   DATABASE_URL is %REASON%.
   The local dashboard will render empty surfaces until the DB
   is configured and seeded. To recover:
     1. Start Postgres (e.g. \`docker compose up postgres -d\`).
     2. Run \`pnpm local:setup\` (or \`pnpm db:migrate && pnpm db:seed\`).
================================================================
`;

const STRICT_HINT = `
✗ DATABASE_URL missing or DB unreachable.
  Start Postgres and run \`pnpm local:setup\`,
  or run \`pnpm db:migrate && pnpm db:seed\` directly.
`;

interface RunMainOptions {
  strictDb: boolean;
  _auditFn?: () => Promise<SeedCountResult>;
}

export async function runMain(opts: RunMainOptions): Promise<void> {
  const audit = opts._auditFn ?? auditSeedCounts;
  const result = await audit();

  if (result.state === "PASS") {
    console.log("✓ seed counts meet minimums");
    for (const [k, v] of Object.entries(result.counts)) {
      console.log(`    ${k}: ${v}`);
    }
    process.exit(0);
  }

  if (result.state === "FAIL") {
    console.log("✗ seed counts below local-readiness minimums:");
    for (const u of result.unmet) {
      console.log(`    ${u.key}: expected ≥${u.expected}, actual ${u.actual}`);
    }
    process.exit(1);
  }

  // SKIP-NO-URL or SKIP-UNREACHABLE
  const reason = result.state === "SKIP-NO-URL" ? "not set" : "set but DB is unreachable";
  process.stderr.write(SKIP_BANNER.replace("%REASON%", reason));
  if (opts.strictDb) {
    process.stderr.write(STRICT_HINT);
    process.exit(1);
  }
  process.exit(0);
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const strictDb = process.argv.includes("--strict-db");
  void runMain({ strictDb });
}
```

### Step 5: Run the tests to verify pass

Run: `pnpm exec vitest run scripts/__tests__/check-seed-counts.test.ts`
Expected: All PASS.

### Step 6: Wire `--strict-db` into `local-verify-fast.ts`

- [ ] Open `scripts/local-verify-fast.ts`. Find the `STEPS` array entry for seed-counts:

```typescript
{ name: "seed-counts", cmd: "pnpm", args: ["exec", "tsx", "scripts/check-seed-counts.ts"] },
```

Change to:

```typescript
{
  name: "seed-counts",
  cmd: "pnpm",
  args: ["exec", "tsx", "scripts/check-seed-counts.ts", "--strict-db"],
},
```

### Step 7: Verify local-verify-fast still works

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm local:verify:fast`
Expected: PASS on the developer's own machine (DB is configured). If DB unreachable, expect FAIL with the strict-db banner — verify the banner appears and the exit code is non-zero.

### Step 8: Commit

```bash
git add scripts/check-seed-counts.ts scripts/__tests__/check-seed-counts.test.ts scripts/local-verify-fast.ts
git commit -m "feat(local-readiness-phase-2): a3 — three-state seed-counts + --strict-db"
```

---

## Task 3: Prep — Extend `setup-env.sh` for worktree env copy

**Files:**

- Modify: `scripts/setup-env.sh`

The existing `setup-env.sh` generates secrets when `.env` is missing or empty. The spec needs it to ALSO handle the worktree case: when running inside a non-primary git worktree with no `.env`, copy from the primary worktree's `.env` instead of generating fresh secrets (which would diverge from the primary's encryption keys and break shared services).

### Step 1: Read the existing script

- [ ] Read `scripts/setup-env.sh` from top to bottom. Note the entry point: `ENV_FILE="${1:-.env}"`, the `cp .env.example "$ENV_FILE"` fallback at line ~18, and the `set_secret()` helper.

### Step 2: Verify the primary-root detection approach

Before coding, run `git worktree list --porcelain` from any worktree to confirm output format:

```
worktree /absolute/path/to/primary
HEAD <sha>
branch refs/heads/main

worktree /absolute/path/to/linked
HEAD <sha>
branch refs/heads/feature
```

Per git docs, the first entry is the main (primary) worktree. We use this — not `common_dir/..` — because `common_dir/..` is brittle (fails on bare repos, custom worktree layouts, or when the primary's `.git` is nested deeper than one level).

### Step 3: Add worktree-aware copy logic

- [ ] At the top of `scripts/setup-env.sh`, immediately after `ENV_FILE="${1:-.env}"`, insert:

```bash
# If we're in a non-primary worktree AND target .env is missing AND primary has one,
# copy from primary instead of regenerating secrets (which would diverge).
common_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo "")"
git_dir="$(git rev-parse --git-dir 2>/dev/null || echo "")"

if [[ -n "$common_dir" && -n "$git_dir" ]]; then
  common_abs="$(cd "$common_dir" 2>/dev/null && pwd -P || true)"
  git_abs="$(cd "$git_dir" 2>/dev/null && pwd -P || true)"
  if [[ "$common_abs" != "$git_abs" && ! -f "$ENV_FILE" ]]; then
    # First worktree in `git worktree list --porcelain` is the primary by convention.
    primary_root="$(git worktree list --porcelain | awk '/^worktree / { print $2; exit }')"
    if [[ -n "$primary_root" && -f "$primary_root/.env" ]]; then
      cp "$primary_root/.env" "$ENV_FILE"
      echo "Copied $ENV_FILE from primary worktree ($primary_root/.env)"
      echo "Skipping secret generation — using primary's existing secrets."
      exit 0
    fi
  fi
fi
```

### Step 4: Manual verification

Shell scripts don't have unit tests in this repo, so verify by inspection and a one-off run.

- [ ] Run: `bash scripts/setup-env.sh` from the primary worktree.
      Expected: existing behavior unchanged — script ensures `.env` exists (from `.env.example` if missing) and fills missing secrets.

- [ ] If a sibling worktree exists, `cd` into it (if its `.env` doesn't yet exist) and run `bash scripts/setup-env.sh`.
      Expected: prints "Copied .env from primary worktree" + "Skipping secret generation"; exits 0.

(If no sibling worktree exists locally, this step is skipped — the integration test happens in Task 4 when `worktree-init.sh` calls it.)

### Step 5: Commit

```bash
git add scripts/setup-env.sh
git commit -m "refactor(local-readiness-phase-2): make setup-env.sh worktree-aware (copy from primary)"
```

---

## Task 4: A1 — Harden `worktree-init.sh`

**Files:**

- Modify: `scripts/worktree-init.sh`

### Step 1: Read the current state

- [ ] Read `scripts/worktree-init.sh` end-to-end. Note steps 1-4 and the `|| { echo "[worktree-init] WARNING ...(continuing)" }` swallow at step 3.

### Step 2: Replace step 1 (env copy) with a delegation to setup-env.sh

- [ ] Find this block (lines ~25-36):

```bash
# 1. Copy .env from repo root if missing.
if [[ -f "$worktree_root/.env" ]]; then
  echo "[worktree-init] .env already present — leaving it alone"
elif [[ -f "$repo_root/.env" ]]; then
  cp "$repo_root/.env" "$worktree_root/.env"
  echo "[worktree-init] Copied .env from $repo_root/.env"
else
  echo "[worktree-init] WARNING: no .env in $repo_root either."
  echo "[worktree-init]          Copy .env.example to .env and set required vars."
fi
```

Replace with:

```bash
# 1. Ensure .env exists (delegates worktree-copy + secret-generation to setup-env.sh).
(cd "$worktree_root" && bash scripts/setup-env.sh)
```

### Step 3: Make step 3 (db:migrate) failure fatal + add build + seed

- [ ] Find this block (the existing step 3, lines ~52-66):

```bash
# 3. DB sanity. Parse DATABASE_URL out of .env (shell `source` chokes on `&` in URLs).
if [[ -f "$worktree_root/.env" ]] && command -v pg_isready >/dev/null 2>&1; then
  db_url="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' "$worktree_root/.env" | tr -d '"' | tr -d "'")"
  if [[ -n "$db_url" ]]; then
    if pg_isready -d "$db_url" >/dev/null 2>&1; then
      echo "[worktree-init] Postgres reachable — running pnpm db:migrate"
      (cd "$worktree_root" && pnpm db:migrate) || {
        echo "[worktree-init] WARNING: pnpm db:migrate failed (continuing)"
      }
    else
      echo "[worktree-init] WARNING: Postgres is not reachable at the configured DATABASE_URL."
      echo "[worktree-init]          Start it (e.g. \`docker compose up postgres -d\`) then re-run."
    fi
  fi
fi
```

Replace with:

```bash
# 3. DB-dependent setup: migrate (fatal on failure), then build, then seed.
#    Skipped (exit 0 with explicit message) when DB is unreachable so devs
#    can re-run after starting Postgres.
db_reachable=false
if [[ -f "$worktree_root/.env" ]] && command -v pg_isready >/dev/null 2>&1; then
  db_url="$(awk -F= '/^DATABASE_URL=/ { sub(/^DATABASE_URL=/, ""); print; exit }' "$worktree_root/.env" | tr -d '"' | tr -d "'")"
  if [[ -n "$db_url" ]] && pg_isready -d "$db_url" >/dev/null 2>&1; then
    db_reachable=true
  fi
fi

if [[ "$db_reachable" == "true" ]]; then
  echo "[worktree-init] Postgres reachable — running pnpm db:migrate"
  (cd "$worktree_root" && pnpm db:migrate)
  echo "[worktree-init] Building workspace (required before seed) — ~30-60s first run"
  (cd "$worktree_root" && pnpm build)
  echo "[worktree-init] Seeding dev data — pnpm db:seed"
  (cd "$worktree_root" && pnpm db:seed)
else
  echo "[worktree-init] DB not reachable. Skipped migrate/build/seed."
  echo "[worktree-init] Run \`pnpm local:setup\` after starting Postgres."
fi
```

The migrate command no longer has `|| { ... }`, so any non-zero exit terminates the script via `set -e`. Same for build and seed.

### Step 4: Confirm "Next steps" footer is intact

- [ ] Re-read the trailing `cat <<EOF ... EOF` block at the bottom of `worktree-init.sh`. No edits required — this is a guard-step to confirm the footer wasn't accidentally regressed during Step 3.

### Step 5: Manual verification

- [ ] On a sibling worktree with DB reachable, run: `pnpm worktree:init`
      Expected: env-copy delegation → migrate → build → seed → footer.

- [ ] Stop Postgres locally, then run `pnpm worktree:init` again.
      Expected: env-copy delegation → "DB not reachable. Skipped migrate/build/seed. Run `pnpm local:setup` after starting Postgres." → footer. Exit code 0.

- [ ] Simulate a migrate failure: temporarily break `prisma/schema.prisma` (e.g., add a syntax error) and run `pnpm worktree:init` with DB reachable.
      Expected: migrate fails, script exits non-zero, no build/seed runs. Revert the change.

### Step 6: Commit

```bash
git add scripts/worktree-init.sh
git commit -m "feat(local-readiness-phase-2): a1 — harden worktree-init.sh (migrate fatal, build+seed, explicit skip)"
```

---

## Task 5: A2 — Add `pnpm local:setup` command

**Files:**

- Create: `scripts/local-setup.ts`
- Create: `scripts/__tests__/local-setup.test.ts`
- Modify: `package.json` (root)

### Step 1: Write failing test for the orchestrator

- [ ] Create `scripts/__tests__/local-setup.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { STEPS } from "../local-setup.js";

describe("local:setup STEPS", () => {
  it("runs install → setup-env → build → migrate → seed → verify:fast in order", () => {
    expect(STEPS.map((s) => s.name)).toEqual([
      "install",
      "setup-env",
      "build",
      "db:migrate",
      "db:seed",
      "local:verify:fast",
    ]);
  });

  it("invokes each step with the expected command contract", () => {
    // setup-env shells out to bash directly (bash is not a pnpm-managed binary,
    // so `pnpm exec bash` would not resolve). All other steps go through pnpm.
    expect(STEPS.find((s) => s.name === "install")).toMatchObject({
      cmd: "pnpm",
      args: ["install"],
    });
    expect(STEPS.find((s) => s.name === "setup-env")).toMatchObject({
      cmd: "bash",
      args: ["scripts/setup-env.sh"],
    });
    expect(STEPS.find((s) => s.name === "build")).toMatchObject({
      cmd: "pnpm",
      args: ["build"],
    });
    expect(STEPS.find((s) => s.name === "db:migrate")).toMatchObject({
      cmd: "pnpm",
      args: ["db:migrate"],
    });
    expect(STEPS.find((s) => s.name === "db:seed")).toMatchObject({
      cmd: "pnpm",
      args: ["db:seed"],
    });
    expect(STEPS.find((s) => s.name === "local:verify:fast")).toMatchObject({
      cmd: "pnpm",
      args: ["local:verify:fast"],
    });
  });

  it("gates DB-dependent steps via dbRequired flag", () => {
    expect(STEPS.find((s) => s.name === "db:migrate")?.dbRequired).toBe(true);
    expect(STEPS.find((s) => s.name === "db:seed")?.dbRequired).toBe(true);
    expect(STEPS.find((s) => s.name === "install")?.dbRequired).toBeFalsy();
    expect(STEPS.find((s) => s.name === "build")?.dbRequired).toBeFalsy();
    expect(STEPS.find((s) => s.name === "local:verify:fast")?.dbRequired).toBeFalsy();
  });
});
```

### Step 2: Run the test to verify it fails

Run: `pnpm exec vitest run scripts/__tests__/local-setup.test.ts`
Expected: FAIL — `local-setup.js` does not exist.

### Step 3: Create `scripts/local-setup.ts`

- [ ] Create `scripts/local-setup.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * One-shot local bootstrap: install → setup-env → build → migrate → seed
 * → verify:fast. Safe to re-run (idempotent).
 *
 * When Postgres is not reachable, runs the non-DB steps (install,
 * setup-env, build), prints recovery guidance, and exits non-zero
 * BEFORE local:verify:fast. We cannot run verify in that state because
 * Task 2 wires `--strict-db` into local:verify:fast, which would fail
 * with a generic strict-db banner — the explicit recovery message here
 * is clearer. "Setup is incomplete" is the correct signal; the "no
 * silent green" promise demands a non-zero exit.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Step {
  name: string;
  cmd: string;
  args: string[];
  dbRequired?: boolean;
}

export const STEPS: Step[] = [
  { name: "install", cmd: "pnpm", args: ["install"] },
  { name: "setup-env", cmd: "bash", args: ["scripts/setup-env.sh"] },
  { name: "build", cmd: "pnpm", args: ["build"] },
  { name: "db:migrate", cmd: "pnpm", args: ["db:migrate"], dbRequired: true },
  { name: "db:seed", cmd: "pnpm", args: ["db:seed"], dbRequired: true },
  { name: "local:verify:fast", cmd: "pnpm", args: ["local:verify:fast"] },
];

/* eslint-disable no-console */
function isDbReachable(): boolean {
  try {
    // Parse DATABASE_URL out of .env (avoid `source` — shell chokes on & in URLs).
    const envText = readFileSync(resolve(REPO_ROOT, ".env"), "utf8");
    const match = envText.match(/^DATABASE_URL=(.+)$/m);
    if (!match) return false;
    const dbUrl = match[1].replace(/^['"]|['"]$/g, "");
    const result = spawnSync("pg_isready", ["-d", dbUrl], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function runStep(s: Step): boolean {
  process.stdout.write(`\n→ ${s.name}...\n`);
  const result = spawnSync(s.cmd, s.args, { cwd: REPO_ROOT, stdio: "inherit" });
  return (result.status ?? 1) === 0;
}

async function main(): Promise<void> {
  // Check DB reachability lazily — on first hit of a dbRequired step.
  // This way setup-env has already created `.env` (with DATABASE_URL),
  // so a fresh-clone-with-Postgres-running scenario detects correctly
  // instead of always seeing "DB not reachable" on first invocation.
  let dbReachable: boolean | null = null;

  for (const step of STEPS) {
    if (dbReachable === null && step.dbRequired) {
      dbReachable = isDbReachable();
      if (!dbReachable) {
        console.log(
          "[local:setup] DB not reachable — db:migrate, db:seed, and local:verify:fast will be skipped.",
        );
      }
    }
    // When DB is missing, skip DB-required steps AND verify:fast (verify
    // uses --strict-db; it would fail with a generic banner. We surface a
    // clearer message at the end and exit non-zero.)
    if (dbReachable === false && (step.dbRequired || step.name === "local:verify:fast")) {
      console.log(`→ ${step.name}... SKIPPED (no DB)`);
      continue;
    }
    if (!runStep(step)) {
      console.error(`✗ ${step.name} failed.`);
      process.exit(1);
    }
  }

  if (dbReachable === false) {
    console.error("\n✗ DB not reachable. Local setup is incomplete.");
    console.error("  Start Postgres and re-run `pnpm local:setup`.");
    process.exit(1);
  }

  console.log("\n✓ Local setup complete.");
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
```

### Step 4: Run the test to verify pass

Run: `pnpm exec vitest run scripts/__tests__/local-setup.test.ts`
Expected: PASS (3/3 — STEPS order, command contract, dbRequired flag gating).

### Step 5: Add the script to root `package.json`

- [ ] Open root `package.json`. Find the `scripts` block. Add an entry (alphabetically; place after `local:verify:fast`):

```json
    "local:setup": "npx tsx scripts/local-setup.ts",
```

(Preserve the existing trailing comma convention — match adjacent entries.)

### Step 6: Manual smoke verification

- [ ] Run with DB reachable: `pnpm local:setup`
      Expected: runs all 6 steps in order; exits 0; final line "✓ Local setup complete."

- [ ] Stop Postgres and run again: `pnpm local:setup`
      Expected: runs install/setup-env/build; prints `SKIPPED (no DB)` for db:migrate, db:seed, local:verify:fast; finishes with:
      ``     ✗ DB not reachable. Local setup is incomplete.
      Start Postgres and re-run `pnpm local:setup`.
    ``
      Exit code: **non-zero (1)**. This is the "no silent green" contract — if setup couldn't complete, the command must fail.

### Step 7: Commit

```bash
git add scripts/local-setup.ts scripts/__tests__/local-setup.test.ts package.json
git commit -m "feat(local-readiness-phase-2): a2 — add pnpm local:setup one-shot bootstrap"
```

---

## Task 6: A4 — Update `.env.local.example` + README

**Files:**

- Modify: `apps/dashboard/.env.local.example`
- Modify: `README.md`

### Step 1: Prepend SYNC-FROM-ROOT header to `.env.local.example`

- [ ] Open `apps/dashboard/.env.local.example`. Prepend the following block at the very top (before the existing `# Dashboard` line):

```
# =============================================================================
# This file mirrors keys from the root `.env`.
# Keys marked SYNC-FROM-ROOT must hold the same values as the root `.env`,
# or auth / encryption will silently fail.
# Run `pnpm local:setup` from repo root to set up env files consistently.
# =============================================================================

```

### Step 2: Annotate the SYNC-FROM-ROOT keys inline

- [ ] In the same file, find these three lines and append `  # SYNC-FROM-ROOT` to each:

```
NEXTAUTH_URL=http://localhost:3002
```

becomes

```
NEXTAUTH_URL=http://localhost:3002  # SYNC-FROM-ROOT
```

```
SWITCHBOARD_API_URL=http://localhost:3000
```

becomes

```
SWITCHBOARD_API_URL=http://localhost:3000  # SYNC-FROM-ROOT
```

```
CREDENTIALS_ENCRYPTION_KEY=same-value-as-api-server
```

becomes

```
CREDENTIALS_ENCRYPTION_KEY=same-value-as-api-server  # SYNC-FROM-ROOT
```

### Step 3: Add "First-time local setup" to root README.md

- [ ] Open root `README.md`. Find an appropriate location near the top — after the project title/description, before deeper architecture sections. If a "Getting Started" or similar section exists, add this immediately after it; otherwise insert before any "Architecture" or "Development" heading.

- [ ] Insert:

````markdown
## First-time local setup

From a fresh clone:

```bash
pnpm local:setup
```
````

This runs: `pnpm install` → environment setup → `pnpm build` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm local:verify:fast`. Safe to re-run if any step fails.

If Postgres is not running yet, the DB-dependent steps are skipped and the command exits non-zero with a clear "setup is incomplete" message. **This is expected** — start Postgres and re-run.

The dashboard reads `apps/dashboard/.env.local`; keys marked `SYNC-FROM-ROOT` in `apps/dashboard/.env.local.example` must match the values in the root `.env` (NextAuth URL, API URL, encryption key) or auth and encryption will silently fail.

````

### Step 4: Manual verification

- [ ] Re-read `apps/dashboard/.env.local.example` end-to-end to confirm the header block + three annotated keys are present and the rest is untouched.

- [ ] Re-read the new README section to confirm the bash block renders correctly (closing backticks line up).

Run: `pnpm format:check`
Expected: PASS (markdown formatting unchanged).

### Step 5: Commit

```bash
git add apps/dashboard/.env.local.example README.md
git commit -m "docs(local-readiness-phase-2): a4 — sync-from-root annotation + first-time setup readme"
````

---

## Final Verification (after all 6 tasks)

Before opening the implementation PR, run the full local-verify chain:

- [ ] `pnpm typecheck` → PASS
- [ ] `pnpm lint` → PASS
- [ ] `pnpm test` → PASS
- [ ] `pnpm format:check` → PASS
- [ ] `pnpm local:verify:fast` → PASS (with DB reachable)
- [ ] `pnpm local:verify` → PASS

Squash-merge readiness: 6 commits is the right granularity for a focused PR. Reviewers can read commit-by-commit and verify each component independently.

---

## Out of Scope

Excluded from this plan per the spec:

- PR B (dev:ready probe + conditional dashboard typecheck in fast verify) — separate plan, lands separately
- Issue #472 (Reports live-mode failure UX) — different workstream
- Route migrations for `recommendations.ts` / `lifecycle-disqualifications.ts` / `dashboard-opportunities.ts` — already shipped via #568/#571/#572; A5 is forward-protection only
- Live-flag/code cross-check, deprecated env-var sunset, multi-environment env vars

---

## Spec Coverage Self-Check

| Spec section                                  | Plan task                                                    |
| --------------------------------------------- | ------------------------------------------------------------ |
| A1 Harden worktree-init.sh — migrate fatal    | Task 4 Step 3                                                |
| A1 Add build + seed when DB reachable         | Task 4 Step 3                                                |
| A1 Explicit DB-unreachable message            | Task 4 Step 3                                                |
| A2 Add `pnpm local:setup` chain               | Task 5 Steps 3 + 5                                           |
| A2 Naming (local:setup not onboard)           | Task 5 Step 3 + 5 (script entry)                             |
| A2 Works on primary + worktrees               | Task 5 (uses setup-env from Task 3, which is worktree-aware) |
| A2 Documented in README                       | Task 6 Step 3                                                |
| A3 Three-state check-seed-counts              | Task 2 Step 4                                                |
| A3 `--strict-db` flag with recovery hint      | Task 2 Steps 4 (STRICT_HINT) + 6 (wiring)                    |
| A3 local:verify:fast uses --strict-db         | Task 2 Step 6                                                |
| A4 SYNC-FROM-ROOT header + inline annotations | Task 6 Steps 1 + 2                                           |
| A4 README first-time setup section            | Task 6 Step 3                                                |
| A5 Temp-entry issue-reference rule            | Task 1 Steps 3 + 5                                           |
| A5 Reason-field strictness (not comment)      | Task 1 (the validator inspects only `entry.reason`)          |

Every PR A requirement maps to a task. No gaps.
