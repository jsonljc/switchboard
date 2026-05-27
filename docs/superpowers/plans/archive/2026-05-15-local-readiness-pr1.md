# Local Readiness PR 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm test` green on main, complete `.env.example`, delete the orphaned operator-config route, lock live-flag defaults with a visible `/reports` fixture-mode label, expand seed data so live-mode surfaces render non-empty, and ship `pnpm local:verify:fast` + `pnpm local:verify` scripts.

**Architecture:** Six independent commits within branch `feat/local-readiness`, each touching a different concern. The verify scripts depend on the allowlist file from Task 2 — otherwise tasks are decoupled and could be reordered. We keep the spec's narrative order (tests-green → env-honest → routes-honest → flags-honest → data-real → verify) for review clarity.

**Tech Stack:** TypeScript (Node 20+), pnpm workspaces, Vitest, Prisma + PostgreSQL, Fastify (API), Next.js 14 App Router (dashboard).

**Spec:** `docs/superpowers/specs/2026-05-15-local-readiness-and-ci-gates-design.md` (PR #533).

---

## Pre-flight

- [ ] **Step P.1: Branch from main**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/local-readiness
pnpm worktree:init || true
```

The `worktree:init` step is safe even on a non-worktree branch (it copies `.env`, kills stale dev ports, runs migrations if Postgres is up).

- [ ] **Step P.2: Verify starting state**

```bash
git branch --show-current  # → feat/local-readiness
pnpm typecheck             # → exits 0
pnpm lint                  # → exits 0
pnpm test 2>&1 | tail -20  # → expect FAIL in @switchboard/mcp-server (Task 1 fixes this)
```

If `pnpm typecheck` or `pnpm lint` already fails on main, **stop and report**. This plan assumes a clean baseline modulo the known mcp-server timeout.

- [ ] **Step P.3: Repo-shape reconnaissance — required before any coding**

Run these grep commands and record their output in a scratch note (or scrollback) before editing files. They surface the three known risk areas (route registration, flag manifest baseline, Prisma model names) so the agent doesn't paste assumptions over reality.

```bash
# Route shape: confirm operator-config is truly unregistered, including
# string-based fetch paths and ad-hoc app.route() registrations.
grep -rn "operator-config\|/api/operator-config\|operatorConfigRoutes" apps packages 2>/dev/null

# Live-flag baseline: which NEXT_PUBLIC_*_LIVE flags exist today and what
# do they default to in .env.example?
grep -rn "NEXT_PUBLIC_[A-Z_]*_LIVE" apps/dashboard/src .env.example 2>/dev/null

# Prisma schema: which models actually exist? Task 5 must map illustrative
# names (Opportunity, PendingApproval, AutomationRule) to whatever the
# schema actually calls them.
grep -E "^model " packages/db/prisma/schema.prisma
```

**If any of these surface a mismatch** with this plan's assumptions, write a short implementation note at the top of the branch (`docs/superpowers/plans/2026-05-15-local-readiness-notes.md`, untracked) recording:

- Operator-config: any call site this plan doesn't anticipate
- Flag baseline: any `_LIVE` flag in code but not in `.env.example` (or vice versa)
- Schema mapping: actual model name → name used in this plan's sample code

Then proceed. Do NOT silently adjust code mid-task.

---

## File Structure

**New files this PR creates:**

| Path                                                                                                | Responsibility                                                                            |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/mcp-server/src/guard.ts`                                                                      | Side-effect-free `buildMutationModeGuard` extracted from `main.ts`                        |
| `scripts/env-allowlist.local-readiness.json`                                                        | Categorizes every env var the code reads                                                  |
| `scripts/check-env-completeness.ts`                                                                 | Parses `process.env.*` refs, diffs against `.env.example` honoring the allowlist          |
| `scripts/local-verify-fast.ts`                                                                      | Fast structural pre-flight (env, flags, arch, routes, seed count)                         |
| `scripts/local-verify.ts`                                                                           | Full pre-flight (calls fast + typecheck + lint + test + dashboard build + seed integrity) |
| `scripts/check-live-flag-manifest.ts`                                                               | Asserts `.env.example` flag defaults match the decision matrix                            |
| `scripts/check-seed-counts.ts`                                                                      | Queries Postgres row counts for org/agents/opps/audit/approvals/automations               |
| `packages/db/prisma/seed-dev-data.ts`                                                               | Sibling seed: opportunities, more audit entries, approvals, automations                   |
| `apps/dashboard/src/app/(auth)/(mercury)/reports/components/fixture-mode-banner.tsx`                | Visible "demo data" banner shown when `NEXT_PUBLIC_REPORTS_LIVE !== "true"`               |
| `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/fixture-mode-banner.test.tsx` | Test that asserts banner renders/hides based on flag                                      |

**Files this PR modifies:**

| Path                                                               | Change                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `apps/mcp-server/src/main.ts`                                      | Import + re-export `buildMutationModeGuard` from `./guard.js`                                        |
| `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts`  | Update import path to `../guard.js`                                                                  |
| `.env.example`                                                     | Add missing keys, group `NEXT_PUBLIC_*_LIVE` flags with rationale comments, flip defaults per matrix |
| `apps/api/src/routes/operator-config.ts`                           | DELETE (not registered anywhere)                                                                     |
| `apps/dashboard/src/lib/query-keys.ts`                             | DELETE the `operatorConfig` namespace (lines 82–86)                                                  |
| `packages/db/prisma/seed.ts`                                       | Call `seedDevData` near end of `main()`, guarded by `NODE_ENV !== "production"`                      |
| `apps/dashboard/src/app/(auth)/(mercury)/reports/reports-page.tsx` | Mount `<FixtureModeBanner />` near page header                                                       |
| `package.json`                                                     | Add `local:verify:fast` and `local:verify` scripts                                                   |

---

## Task 1: Fix mcp-server test (extract `buildMutationModeGuard`)

**Why:** `pnpm test` times out on `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts` because the test does `await import("../main.js")`, which triggers `main.ts`'s top-level `async function main()` and downstream module side effects. Extract the guard into a sibling module with zero side effects.

**Files:**

- Create: `apps/mcp-server/src/guard.ts`
- Modify: `apps/mcp-server/src/main.ts` (remove inline `buildMutationModeGuard`, import from `./guard.js`)
- Test: `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts` (update import)

- [ ] **Step 1.1: Create the guard module**

Create `apps/mcp-server/src/guard.ts`:

```typescript
/**
 * Pre-flight guard for the MCP server.
 *
 * Kept in its own module (no top-level imports of server bootstrap code) so
 * tests can exercise it without booting the whole server. See
 * `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts`.
 */
export function buildMutationModeGuard(): void {
  const apiUrl = process.env["SWITCHBOARD_API_URL"];
  if (!apiUrl) {
    throw new Error(
      "SWITCHBOARD_API_URL is required. " +
        "The MCP server delegates all operations to the Switchboard API.",
    );
  }
}
```

- [ ] **Step 1.2: Update `main.ts` to import from guard module**

In `apps/mcp-server/src/main.ts`, delete lines 12–20 (the inline `buildMutationModeGuard`) and add this import alongside the existing imports at the top of the file:

```typescript
export { buildMutationModeGuard } from "./guard.js";
import { buildMutationModeGuard as runMutationGuard } from "./guard.js";
```

Then change line 23 (inside `async function main()`) from:

```typescript
buildMutationModeGuard();
```

to:

```typescript
runMutationGuard();
```

The `export { buildMutationModeGuard }` line preserves the existing public API (anything that imports `buildMutationModeGuard` from `"./main.js"` keeps working).

- [ ] **Step 1.3: Update the test import**

In `apps/mcp-server/src/__tests__/production-mutation-guard.test.ts`, change both occurrences of:

```typescript
const { buildMutationModeGuard } = await import("../main.js");
```

to:

```typescript
const { buildMutationModeGuard } = await import("../guard.js");
```

- [ ] **Step 1.4: Run the test in isolation**

```bash
pnpm --filter @switchboard/mcp-server test 2>&1 | tail -20
```

Expected: both tests in `production-mutation-guard.test.ts` pass in well under 2s. Total `mcp-server` test run exits 0.

- [ ] **Step 1.5: Run the whole test suite**

```bash
pnpm test 2>&1 | tail -30
```

Expected: exits 0. If `prisma-work-trace-store-integrity` or `prisma-ledger-storage` or `prisma-greeting-signal-store` fail with `pg_advisory_xact_lock` errors, that's the pre-existing flake documented in [`feedback_db_integrity_tests_pg_advisory_lock.md`](../../../../.claude/projects/-Users-jasonli-switchboard/memory/feedback_db_integrity_tests_pg_advisory_lock.md) — confirm it reproduces on `main` (`git stash && pnpm test`) and continue. If a _new_ failure appears, stop and investigate.

- [ ] **Step 1.6: Typecheck and lint**

```bash
pnpm --filter @switchboard/mcp-server typecheck
pnpm --filter @switchboard/mcp-server lint
```

Expected: both exit 0.

- [ ] **Step 1.7: Commit**

```bash
git add apps/mcp-server/src/guard.ts apps/mcp-server/src/main.ts \
        apps/mcp-server/src/__tests__/production-mutation-guard.test.ts
git commit -m "$(cat <<'EOF'
fix(mcp-server): extract mutation guard into side-effect-free module

The production-mutation-guard test imported ../main.js to exercise
buildMutationModeGuard, which booted the full server (top-level orchestrator
construction, API client init) and timed out at 5s. Extract the guard into
apps/mcp-server/src/guard.ts with no top-level side effects, re-export from
main.ts to preserve the public API, and point the test at the leaner module.

Closes the failing test that kept main from being green.
EOF
)"
```

---

## Task 2: Env allowlist + completeness script + `.env.example` superset

**Why:** Code reads env vars (`process.env.FOO`) that `.env.example` doesn't list. Silent `undefined` at runtime. A raw grep would also catch CI-only and test-only vars and become noisy. Solve both with an allowlist file that categorizes every env var, and a script that enforces the contract.

**Files:**

- Create: `scripts/env-allowlist.local-readiness.json`
- Create: `scripts/check-env-completeness.ts`
- Modify: `.env.example` (add missing `required_in_env_example` keys)

- [ ] **Step 2.1: Enumerate current env-var reads**

```bash
grep -rEho 'process\.env\.\[?"?([A-Z_][A-Z0-9_]*)"?\]?|process\.env\[["'\'']([A-Z_][A-Z0-9_]*)["'\'']\]' \
  apps/api/src apps/chat/src apps/dashboard/src apps/mcp-server/src \
  2>/dev/null \
  | grep -oE '[A-Z_][A-Z0-9_]+' \
  | sort -u > /tmp/env-keys-code.txt

grep -E '^[A-Z_][A-Z0-9_]*=' .env.example \
  | sed 's/=.*//' \
  | sort -u > /tmp/env-keys-example.txt

echo "--- in code, not in .env.example ---"
comm -23 /tmp/env-keys-code.txt /tmp/env-keys-example.txt
```

Expected: a list of ~10-20 keys missing from `.env.example`. Record this list — it informs Step 2.2.

- [ ] **Step 2.2: Create the allowlist file**

Create `scripts/env-allowlist.local-readiness.json` with the categorization. Use the output from Step 2.1 to confirm coverage. Required structure:

```json
{
  "$schema-note": "Every env var the code reads must appear in exactly one category. New uncategorized vars cause check-env-completeness.ts to fail.",
  "required_in_env_example": [
    "ALLOW_SELF_APPROVAL",
    "ESCALATION_EMAIL_RECIPIENTS",
    "ESCALATION_NOTIFY_ON_BREACH",
    "ESCALATION_SLA_MINUTES",
    "META_APP_SECRET",
    "META_GRAPH_VERSION",
    "OPERATOR_ALERT_WEBHOOK_SECRET",
    "OPERATOR_ALERT_WEBHOOK_URL",
    "SWITCHBOARD_CHAT_URL",
    "WHATSAPP_GRAPH_TOKEN",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_DEPLOY_ENV",
    "NEXT_PUBLIC_GOOGLE_AUTH_CONFIGURED",
    "NEXT_PUBLIC_STRIPE_ENABLED",
    "NEXT_PUBLIC_STRIPE_PRICE_PRO",
    "NEXT_PUBLIC_STRIPE_PRICE_SCALE",
    "NEXT_PUBLIC_STRIPE_PRICE_STARTER"
  ],
  "ci_only": ["NEXT_PHASE", "CI", "GITHUB_ACTIONS"],
  "test_only": ["DEV_BYPASS_AUTH"],
  "production_managed": ["RENDER", "RENDER_SERVICE_ID", "VERCEL", "VERCEL_ENV"],
  "deprecated_allowed_temporarily": []
}
```

When Step 2.1's output contains a key NOT in any of the above categories, **do not blindly default it to `required_in_env_example`** — that over-documents CI-only and platform-managed vars. Instead, for each unknown key:

1. Grep its call sites: `grep -rn "<KEY_NAME>" apps/ packages/`
2. Classify based on where it's read:
   - Read by runtime app code (request handlers, page renders, bootstrap) → `required_in_env_example`
   - Read only inside `*.test.ts(x)` or test setup → `test_only`
   - Read only by CI scripts, lint configs, or build tooling → `ci_only`
   - Set by Vercel/Render/the runtime platform itself (e.g. `RENDER`, `VERCEL_ENV`) → `production_managed`
   - Read by app code but slated for removal → `deprecated_allowed_temporarily` (with a `removeBy` date)

If a key spans categories (read by both runtime code AND tests), categorize by the _highest-visibility_ reader — i.e. `required_in_env_example` wins over `test_only`. Only after this triage should the key be added to its chosen category and (if `required`) to `.env.example`.

If `DEV_BYPASS_AUTH` is in fact read by non-test code (verify with `grep -rn "DEV_BYPASS_AUTH" apps/ packages/`), reclassify it. If it's read only in tests, keep it in `test_only`.

- [ ] **Step 2.3: Write the completeness-check test FIRST**

Create `scripts/__tests__/check-env-completeness.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { auditEnvCompleteness } from "../check-env-completeness.js";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

describe("auditEnvCompleteness", () => {
  it("reports zero issues on a fully-aligned repo", () => {
    const result = auditEnvCompleteness({ repoRoot: REPO_ROOT });
    expect(result.uncategorized).toEqual([]);
    expect(result.missingFromExample).toEqual([]);
    expect(result.leakedProductionManaged).toEqual([]);
  });

  it("returns an Issue object shape", () => {
    const result = auditEnvCompleteness({ repoRoot: REPO_ROOT });
    expect(result).toMatchObject({
      uncategorized: expect.any(Array),
      missingFromExample: expect.any(Array),
      leakedProductionManaged: expect.any(Array),
      deprecatedWarnings: expect.any(Array),
    });
  });
});
```

Run it to confirm it fails:

```bash
pnpm exec vitest run scripts/__tests__/check-env-completeness.test.ts
```

Expected: FAIL with "Cannot find module '../check-env-completeness.js'".

- [ ] **Step 2.4: Implement `check-env-completeness.ts`**

Create `scripts/check-env-completeness.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Audits env-var coverage:
 *   1. Greps `process.env.FOO` and `process.env["FOO"]` from app source.
 *   2. Loads scripts/env-allowlist.local-readiness.json.
 *   3. Reads `.env.example` keys.
 *   4. Reports: uncategorized vars, required-but-missing-from-example,
 *      production_managed keys that leaked into .env.example, and
 *      deprecated warnings.
 *
 * Exits 1 if any required category has issues (uncategorized,
 * missingFromExample, leakedProductionManaged). Deprecated entries warn
 * but do not fail.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface Allowlist {
  required_in_env_example: string[];
  ci_only: string[];
  test_only: string[];
  production_managed: string[];
  deprecated_allowed_temporarily: Array<string | { name: string; removeBy: string }>;
}

export interface AuditResult {
  uncategorized: string[];
  missingFromExample: string[];
  leakedProductionManaged: string[];
  deprecatedWarnings: string[];
}

const APP_DIRS = ["apps/api/src", "apps/chat/src", "apps/dashboard/src", "apps/mcp-server/src"];
const ENV_KEY_RE = /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[["']([A-Z_][A-Z0-9_]*)["']\]/g;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function readEnvKeysFromCode(repoRoot: string): Set<string> {
  const keys = new Set<string>();
  for (const dir of APP_DIRS) {
    const root = join(repoRoot, dir);
    try {
      for (const file of walkTs(root)) {
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(ENV_KEY_RE)) {
          const k = m[1] ?? m[2];
          if (k) keys.add(k);
        }
      }
    } catch {
      // Skip missing dirs — partial repos / monorepos in flight.
    }
  }
  return keys;
}

function readEnvExampleKeys(repoRoot: string): Set<string> {
  const text = readFileSync(join(repoRoot, ".env.example"), "utf8");
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=/.exec(line);
    if (m) keys.add(m[1]!);
  }
  return keys;
}

function readAllowlist(repoRoot: string): Allowlist {
  const path = join(repoRoot, "scripts/env-allowlist.local-readiness.json");
  return JSON.parse(readFileSync(path, "utf8")) as Allowlist;
}

function deprecatedName(entry: string | { name: string }): string {
  return typeof entry === "string" ? entry : entry.name;
}

export function auditEnvCompleteness(opts: { repoRoot: string }): AuditResult {
  const codeKeys = readEnvKeysFromCode(opts.repoRoot);
  const exampleKeys = readEnvExampleKeys(opts.repoRoot);
  const allow = readAllowlist(opts.repoRoot);
  const deprecated = new Set(allow.deprecated_allowed_temporarily.map(deprecatedName));

  const categorized = new Set<string>([
    ...allow.required_in_env_example,
    ...allow.ci_only,
    ...allow.test_only,
    ...allow.production_managed,
    ...deprecated,
  ]);

  const uncategorized = [...codeKeys].filter((k) => !categorized.has(k)).sort();
  const missingFromExample = allow.required_in_env_example
    .filter((k) => !exampleKeys.has(k))
    .sort();
  const leakedProductionManaged = allow.production_managed.filter((k) => exampleKeys.has(k)).sort();
  const deprecatedWarnings = [...deprecated].filter((k) => codeKeys.has(k)).sort();

  return { uncategorized, missingFromExample, leakedProductionManaged, deprecatedWarnings };
}
```

Then add the CLI tail at the bottom of the same file:

```typescript
function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = auditEnvCompleteness({ repoRoot });
  const lines: string[] = [];
  let fail = false;

  if (result.uncategorized.length) {
    fail = true;
    lines.push(`✗ Uncategorized env vars (${result.uncategorized.length}):`);
    for (const k of result.uncategorized) lines.push(`    ${k}`);
    lines.push("  → add each to scripts/env-allowlist.local-readiness.json");
  }
  if (result.missingFromExample.length) {
    fail = true;
    lines.push(`✗ Required keys missing from .env.example (${result.missingFromExample.length}):`);
    for (const k of result.missingFromExample) lines.push(`    ${k}`);
  }
  if (result.leakedProductionManaged.length) {
    fail = true;
    lines.push(`✗ production_managed keys leaked into .env.example:`);
    for (const k of result.leakedProductionManaged) lines.push(`    ${k}`);
  }
  if (result.deprecatedWarnings.length) {
    lines.push(`⚠ Deprecated env keys still read: ${result.deprecatedWarnings.join(", ")}`);
  }
  if (!fail) lines.push("✓ env-example completeness OK");

  console.log(lines.join("\n")); // eslint-disable-line no-console
  process.exit(fail ? 1 : 0);
}

// Run when invoked directly (not when imported).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 2.5: Run the test (still failing — script exists but .env.example incomplete)**

```bash
pnpm exec vitest run scripts/__tests__/check-env-completeness.test.ts
```

Expected: FAIL on `expect(result.missingFromExample).toEqual([])`. The output lists the keys to add.

- [ ] **Step 2.6: Update `.env.example` to satisfy the contract**

Add the missing keys to `.env.example`. Group them with logically-related existing sections:

In the **Governance / Escalations** section (insert after `ESCALATION_CHAT_ID` near line 60):

```bash
# Operator escalation routing
ESCALATION_EMAIL_RECIPIENTS=
ESCALATION_NOTIFY_ON_BREACH=
ESCALATION_SLA_MINUTES=
# Allow operators to self-approve their own pending actions (default: false)
ALLOW_SELF_APPROVAL=
# Operator-alert webhook (Slack-compatible) for breach notifications
OPERATOR_ALERT_WEBHOOK_URL=
OPERATOR_ALERT_WEBHOOK_SECRET=
```

In the **Messaging — WhatsApp** section (after `WHATSAPP_VERIFY_TOKEN` near line 72):

```bash
# Marketing API token (separate from messaging WHATSAPP_TOKEN)
WHATSAPP_GRAPH_TOKEN=
```

In the **WhatsApp Tech Provider** section (after `META_SYSTEM_USER_ID` near line 78):

```bash
META_APP_SECRET=
# Meta Graph API version (e.g. v21.0). Defaults to latest stable in code if unset.
META_GRAPH_VERSION=v21.0
```

In the **Managed Provisioning** section (after `INTERNAL_SETUP_SECRET` near line 102):

```bash
# Chat server URL used by API → Chat outbound calls (server-side, no NEXT_PUBLIC_)
SWITCHBOARD_CHAT_URL=http://localhost:3001
```

In the **Dashboard** section (after `NEXT_PUBLIC_LAUNCH_MODE` near line 120):

```bash
# Dashboard public URL (browser-visible). Used in OAuth/email links.
NEXT_PUBLIC_APP_URL=http://localhost:3002
# Switchboard API URL exposed to the browser (only for client-side checks; most calls proxy)
NEXT_PUBLIC_API_URL=http://localhost:3000
# Deployment environment label shown in dashboard chrome ("development", "preview", "production")
NEXT_PUBLIC_DEPLOY_ENV=development
# Set to "true" once GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are configured (gates UI)
NEXT_PUBLIC_GOOGLE_AUTH_CONFIGURED=
```

In the **Stripe Billing** section (after `STRIPE_PRICE_SCALE` near line 219):

```bash
# Mirror server-side keys to the browser to gate Stripe checkout UI
NEXT_PUBLIC_STRIPE_ENABLED=
NEXT_PUBLIC_STRIPE_PRICE_STARTER=
NEXT_PUBLIC_STRIPE_PRICE_PRO=
NEXT_PUBLIC_STRIPE_PRICE_SCALE=
```

**If Step 2.1 surfaced additional keys not listed above**, add them to `required_in_env_example` in the allowlist and to `.env.example` with a sensible empty default + one-line comment.

- [ ] **Step 2.7: Re-run the test (now passing)**

```bash
pnpm exec vitest run scripts/__tests__/check-env-completeness.test.ts
```

Expected: PASS.

- [ ] **Step 2.8: Run the CLI directly**

```bash
pnpm exec tsx scripts/check-env-completeness.ts
```

Expected: `✓ env-example completeness OK`, exit 0.

- [ ] **Step 2.9: Commit**

```bash
git add scripts/env-allowlist.local-readiness.json \
        scripts/check-env-completeness.ts \
        scripts/__tests__/check-env-completeness.test.ts \
        .env.example
git commit -m "$(cat <<'EOF'
feat(scripts): env-completeness check + allowlist + .env.example superset

Adds scripts/env-allowlist.local-readiness.json with five categories
(required_in_env_example, ci_only, test_only, production_managed,
deprecated_allowed_temporarily) so the completeness check stays high-signal
instead of drowning in test-only or CI-only false positives.

Adds scripts/check-env-completeness.ts which parses every process.env.FOO
reference in apps/{api,chat,dashboard,mcp-server}/src, compares against the
allowlist + .env.example, and reports uncategorized vars, missing-from-example
keys, and production_managed leakage.

Expands .env.example with previously-undocumented keys: ALLOW_SELF_APPROVAL,
ESCALATION_*, OPERATOR_ALERT_*, META_APP_SECRET, META_GRAPH_VERSION,
SWITCHBOARD_CHAT_URL, WHATSAPP_GRAPH_TOKEN, NEXT_PUBLIC_APP_URL,
NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DEPLOY_ENV, NEXT_PUBLIC_GOOGLE_AUTH_CONFIGURED,
NEXT_PUBLIC_STRIPE_*.

Closes the "silent undefined at runtime" failure mode where code reads an
env var that .env.example doesn't document.
EOF
)"
```

---

## Task 3: Delete the orphaned operator-config route

**Why:** `apps/api/src/routes/operator-config.ts` is fully stubbed (every store call returns null) and **not registered anywhere** — grep confirms no `app.register(operatorConfigRoutes, ...)` call exists in `apps/api/src/bootstrap/routes.ts`. The file is also referenced by dead query keys in `apps/dashboard/src/lib/query-keys.ts:82-86` that no hook consumes.

**Files:**

- Delete: `apps/api/src/routes/operator-config.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts` (remove the `operatorConfig` namespace, lines 82–86)

- [ ] **Step 3.1: Confirm zero callers before deletion**

```bash
grep -rn "operatorConfigRoutes" apps/ packages/ 2>/dev/null | grep -v "routes/operator-config.ts"
grep -rn "operatorConfig\b" apps/dashboard/src 2>/dev/null | grep -v "query-keys.ts"
```

Expected for first grep: zero matches. Expected for second grep: matches in `api-client/agents.ts`, `hooks/use-agents.ts` referencing the `operatorConfig` _field on agent state_ (different — keep those). If any hook references `keys.operatorConfig` itself, stop and investigate.

- [ ] **Step 3.2: Delete the route file**

```bash
git rm apps/api/src/routes/operator-config.ts
```

- [ ] **Step 3.3: Remove the dead query keys**

In `apps/dashboard/src/lib/query-keys.ts`, delete lines 82–86:

```typescript
  operatorConfig: {
    all: () => [orgId, "operatorConfig"] as const,
    current: () => [orgId, "operatorConfig", "current"] as const,
    autonomy: () => [orgId, "operatorConfig", "autonomy"] as const,
  },
```

- [ ] **Step 3.4: Typecheck (catches any forgotten consumer)**

```bash
pnpm typecheck
```

Expected: exits 0. If TypeScript flags an unknown property `operatorConfig` somewhere, the grep in Step 3.1 missed a caller — re-grep with the offending file and either remove the reference or restore the query key.

- [ ] **Step 3.5: Dashboard build (closes the `next build` gap)**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: exits 0.

- [ ] **Step 3.6: Test**

```bash
pnpm test 2>&1 | tail -10
```

Expected: still green (Task 1 fixed the mcp-server failure).

- [ ] **Step 3.7: Commit**

```bash
git add apps/api/src/routes/operator-config.ts apps/dashboard/src/lib/query-keys.ts
git commit -m "$(cat <<'EOF'
chore(api): remove unused operator-config stub route

The route was fully stubbed (every store call returned null) and was never
registered in apps/api/src/bootstrap/routes.ts — grep confirms zero
app.register(operatorConfigRoutes, ...) callers. Dashboard query keys for
the route existed in query-keys.ts but no hook consumed them.

Removing keeps local-readiness honest: a registered no-op route that
appears live but isn't is the exact failure mode the local-readiness spec
exists to eliminate. Re-add deliberately if/when AdsOperatorConfig
gets a real implementation.
EOF
)"
```

---

## Task 4: Live-flag manifest + `/reports` fixture-mode banner

**Why:** Per spec §1.4, flag defaults should be intentional and consistent. `/reports` stays in fixture mode (no local Meta Ads provider) and MUST visibly label itself as demo data so developers aren't misled. We also need a manifest-check script that asserts `.env.example` matches the decision matrix — otherwise future PRs can silently drift.

**Files:**

- Modify: `.env.example` (group `NEXT_PUBLIC_*_LIVE` flags, update defaults per matrix, add rationale comments)
- Create: `scripts/check-live-flag-manifest.ts`
- Create: `scripts/__tests__/check-live-flag-manifest.test.ts`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/fixture-mode-banner.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/fixture-mode-banner.test.tsx`
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/reports-page.tsx`

### 4a — Live-flag manifest

- [ ] **Step 4.1: Update `.env.example` flag section**

Replace lines 122–127 (the `Mercury Tools feature flags` block) with:

```bash
# Mercury Tools feature flags — set to "true" to enable each Tools ▾ route
#
# Local-readiness contract: each flag's default below matches
# scripts/env-allowlist.live-flag-matrix.json. CI fails if .env.example drifts.
#
# /contacts:    backend shipped (PR-C2 #486); seed-dev-data populates rows.
# /activity:    audit-log surface; seed-dev-data backfills entries.
# /approvals:   first-class architecture per docs/DOCTRINE.md.
# /automations: backend shipped (#406); seed-dev-data populates rows.
# /reports:     launch blocked on Meta Ads Connection + issue #472.
#               Stays fixture-mode locally; reports-page.tsx renders a
#               visible "demo data" banner when this flag is not "true".
NEXT_PUBLIC_CONTACTS_LIVE=true
NEXT_PUBLIC_AUTOMATIONS_LIVE=true
NEXT_PUBLIC_ACTIVITY_LIVE=true
NEXT_PUBLIC_REPORTS_LIVE=false
NEXT_PUBLIC_APPROVALS_LIVE=true
```

- [ ] **Step 4.2: Create the manifest file**

Create `scripts/env-allowlist.live-flag-matrix.json`:

```json
{
  "$schema-note": "Encodes the live-flag decision matrix from docs/superpowers/specs/2026-05-15-local-readiness-and-ci-gates-design.md §1.4. check-live-flag-manifest.ts fails if .env.example drifts from these defaults.",
  "flags": {
    "NEXT_PUBLIC_CONTACTS_LIVE": {
      "default": "true",
      "rationale": "Backend shipped PR-C2 #486; seed populates rows"
    },
    "NEXT_PUBLIC_AUTOMATIONS_LIVE": {
      "default": "true",
      "rationale": "Backend shipped #406; seed populates rows"
    },
    "NEXT_PUBLIC_ACTIVITY_LIVE": {
      "default": "true",
      "rationale": "Audit-log surface; seed backfills entries"
    },
    "NEXT_PUBLIC_REPORTS_LIVE": {
      "default": "false",
      "rationale": "Launch blocked on Meta Ads Connection + issue #472"
    },
    "NEXT_PUBLIC_APPROVALS_LIVE": {
      "default": "true",
      "rationale": "First-class architecture per DOCTRINE.md"
    }
  }
}
```

- [ ] **Step 4.3: Write the failing manifest-check test**

Create `scripts/__tests__/check-live-flag-manifest.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { auditLiveFlagManifest } from "../check-live-flag-manifest.js";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

describe("auditLiveFlagManifest", () => {
  it("reports zero drift when .env.example matches the matrix", () => {
    const result = auditLiveFlagManifest({ repoRoot: REPO_ROOT });
    expect(result.drift).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});
```

Run it:

```bash
pnpm exec vitest run scripts/__tests__/check-live-flag-manifest.test.ts
```

Expected: FAIL — script doesn't exist yet.

- [ ] **Step 4.4: Implement `check-live-flag-manifest.ts`**

Create `scripts/check-live-flag-manifest.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Asserts that .env.example's NEXT_PUBLIC_*_LIVE defaults match
 * scripts/env-allowlist.live-flag-matrix.json. Prevents silent drift.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface Matrix {
  flags: Record<string, { default: string; rationale: string }>;
}

export interface FlagDrift {
  name: string;
  expected: string;
  actual: string;
}

export interface ManifestResult {
  drift: FlagDrift[];
  missing: string[];
}

function readEnvExampleFlags(repoRoot: string): Map<string, string> {
  const text = readFileSync(join(repoRoot, ".env.example"), "utf8");
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^(NEXT_PUBLIC_[A-Z_]*_LIVE)=(.*)$/.exec(line);
    if (m) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

export function auditLiveFlagManifest(opts: { repoRoot: string }): ManifestResult {
  const matrix: Matrix = JSON.parse(
    readFileSync(join(opts.repoRoot, "scripts/env-allowlist.live-flag-matrix.json"), "utf8"),
  );
  const actual = readEnvExampleFlags(opts.repoRoot);

  const drift: FlagDrift[] = [];
  const missing: string[] = [];

  for (const [name, { default: expected }] of Object.entries(matrix.flags)) {
    const actualValue = actual.get(name);
    if (actualValue === undefined) {
      missing.push(name);
    } else if (actualValue !== expected) {
      drift.push({ name, expected, actual: actualValue });
    }
  }

  return { drift, missing };
}

function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = auditLiveFlagManifest({ repoRoot });
  let fail = false;
  if (result.missing.length) {
    fail = true;
    console.log(`✗ Flags missing from .env.example: ${result.missing.join(", ")}`); // eslint-disable-line no-console
  }
  if (result.drift.length) {
    fail = true;
    console.log("✗ Flag defaults drifted:"); // eslint-disable-line no-console
    for (const d of result.drift) {
      console.log(`    ${d.name}: expected ${d.expected}, actual ${d.actual}`); // eslint-disable-line no-console
    }
  }
  if (!fail) console.log("✓ live-flag manifest in sync"); // eslint-disable-line no-console
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4.5: Run the manifest test**

```bash
pnpm exec vitest run scripts/__tests__/check-live-flag-manifest.test.ts
pnpm exec tsx scripts/check-live-flag-manifest.ts
```

Expected: both pass. CLI prints `✓ live-flag manifest in sync`.

### 4b — `/reports` fixture-mode banner

- [ ] **Step 4.6: Write the failing banner test**

Create `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/fixture-mode-banner.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FixtureModeBanner } from "../fixture-mode-banner";

describe("FixtureModeBanner", () => {
  it("renders the demo-data label when NEXT_PUBLIC_REPORTS_LIVE is not 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "false");
    const { getByText } = render(<FixtureModeBanner />);
    expect(getByText(/demo data/i)).toBeTruthy();
  });

  it("renders nothing when NEXT_PUBLIC_REPORTS_LIVE === 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "true");
    const { container } = render(<FixtureModeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the demo-data label when the flag is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_REPORTS_LIVE", "");
    const { getByText } = render(<FixtureModeBanner />);
    expect(getByText(/demo data/i)).toBeTruthy();
  });
});
```

Run it:

```bash
pnpm --filter @switchboard/dashboard exec vitest run \
  src/app/\(auth\)/\(mercury\)/reports/components/__tests__/fixture-mode-banner.test.tsx
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 4.7: Inspect Mercury design tokens before hardcoding colors**

Before writing the banner CSS, check whether the Mercury surface (the namespace `/reports` lives in) already defines reusable tokens for this kind of "informational" / "demo" / "warning" chip:

```bash
grep -rEn "demo|fixture|advisory|notice|warning" \
  apps/dashboard/src/app/\(auth\)/\(mercury\) \
  --include="*.css" --include="*.module.css" 2>/dev/null | head -30

grep -rEn "^\s*--(mercury|sw|cream|ink|clay|amber)" \
  apps/dashboard/src/app/\(auth\)/\(mercury\) \
  apps/dashboard/src/app/globals.css 2>/dev/null | head -40
```

If Mercury already defines tokens like `--mercury-advisory-bg`, `--mercury-notice-border`, or similar, **reuse them** in the banner CSS below instead of hardcoded `hsl(...)` values. If no relevant token exists, the inline HSL values in the sample are acceptable as-is — but log this in the implementation note from Step P.3 so a follow-up can centralize tokens later.

- [ ] **Step 4.8: Implement the banner component**

Create `apps/dashboard/src/app/(auth)/(mercury)/reports/components/fixture-mode-banner.tsx`:

```tsx
import styles from "./fixture-mode-banner.module.css";

/**
 * Visible label shown on /reports when NEXT_PUBLIC_REPORTS_LIVE !== "true".
 *
 * Local-readiness requirement: /reports stays in fixture mode locally
 * (no Meta Ads Connection provider yet). Without this banner, the page
 * looks indistinguishable from real reporting data — exactly the failure
 * mode the local-readiness spec exists to eliminate.
 *
 * See docs/superpowers/specs/2026-05-15-local-readiness-and-ci-gates-design.md §1.4.
 */
export function FixtureModeBanner(): JSX.Element | null {
  const live = process.env.NEXT_PUBLIC_REPORTS_LIVE;
  if (live === "true") return null;
  return (
    <div role="status" className={styles.banner}>
      <span className={styles.chip}>Demo data</span>
      <span className={styles.text}>
        Not connected to a live ads account. Numbers shown are illustrative fixtures.
      </span>
    </div>
  );
}
```

Create `apps/dashboard/src/app/(auth)/(mercury)/reports/components/fixture-mode-banner.module.css`:

```css
.banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 0 1.5rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid hsl(30 35% 80%);
  border-radius: 0.5rem;
  background: hsl(45 55% 96%);
  color: hsl(30 25% 30%);
  font-size: 0.8125rem;
  line-height: 1.3;
}

.chip {
  flex-shrink: 0;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  background: hsl(30 55% 46%);
  color: white;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.text {
  flex: 1;
}
```

- [ ] **Step 4.9: Run the banner test**

```bash
pnpm --filter @switchboard/dashboard exec vitest run \
  src/app/\(auth\)/\(mercury\)/reports/components/__tests__/fixture-mode-banner.test.tsx
```

Expected: all three tests pass.

- [ ] **Step 4.10: Mount the banner on the reports page**

In `apps/dashboard/src/app/(auth)/(mercury)/reports/reports-page.tsx`, near the top of the rendered output (just inside the outermost wrapper, before any data tables/charts), add:

```tsx
import { FixtureModeBanner } from "./components/fixture-mode-banner";

// ...inside the component's JSX, as the first child of the page container:
<FixtureModeBanner />;
```

The exact insertion point depends on the existing `reports-page.tsx` structure — place the banner as the first visible child after the page header so it appears above the metric tiles.

- [ ] **Step 4.11: Run the reports page test suite**

```bash
pnpm --filter @switchboard/dashboard exec vitest run \
  src/app/\(auth\)/\(mercury\)/reports/
```

Expected: all reports tests pass. If existing snapshot tests fail because the banner is now present, update the snapshots after confirming the banner is the only diff:

```bash
pnpm --filter @switchboard/dashboard exec vitest run \
  src/app/\(auth\)/\(mercury\)/reports/ -u
```

- [ ] **Step 4.12: Build the dashboard**

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: exits 0.

- [ ] **Step 4.13: Commit**

```bash
git add scripts/env-allowlist.live-flag-matrix.json \
        scripts/check-live-flag-manifest.ts \
        scripts/__tests__/check-live-flag-manifest.test.ts \
        .env.example \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/fixture-mode-banner.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/fixture-mode-banner.module.css \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/fixture-mode-banner.test.tsx \
        apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/reports-page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): live-flag manifest + /reports demo-data banner

Flips NEXT_PUBLIC_ACTIVITY_LIVE, NEXT_PUBLIC_APPROVALS_LIVE, and
NEXT_PUBLIC_AUTOMATIONS_LIVE to true by default per the local-readiness
decision matrix. NEXT_PUBLIC_REPORTS_LIVE stays false because the launch
is still blocked on a connected Meta Ads Connection + issue #472.

Adds a small "Demo data" banner to /reports that renders whenever
NEXT_PUBLIC_REPORTS_LIVE !== "true". Without it, fixture-mode reports
look indistinguishable from live data — exactly the failure mode the
local-readiness spec exists to eliminate.

scripts/check-live-flag-manifest.ts asserts .env.example never drifts
from scripts/env-allowlist.live-flag-matrix.json. Wired into local:verify
in a later task.
EOF
)"
```

---

## Task 5: `seed-dev-data.ts` for non-empty live surfaces

**Why:** After `pnpm db:seed`, only org/agents/audit-entries (8) exist. Live-enabled surfaces (`/contacts`, `/approvals`, `/automations`) render empty. We need a sibling seed file (the main `seed.ts` is already 613 lines and at the file-size soft limit) that adds: opportunities, more audit entries, approvals, and automations for `org_dev`. Called from `seed.ts` only when `NODE_ENV !== "production"`.

> **Schema mapping — verified against `packages/db/prisma/schema.prisma` on 2026-05-15.**
>
> The seed code below has been pre-mapped to the actual Prisma models. Key findings:
>
> | Surface                | Originally assumed              | Actual Prisma model                                       | Why                                                                                                                                      |
> | ---------------------- | ------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
> | `/contacts` (pipeline) | `prisma.opportunity` standalone | `prisma.opportunity` **with `contactId` FK to `Contact`** | Opportunity requires `contactId`, `serviceId`, `serviceName`. Must seed Contacts first.                                                  |
> | `/approvals`           | `prisma.pendingApproval`        | `prisma.approvalRecord`                                   | `PendingApproval` is a TS projection of the API hook. Real model has `envelopeId` + `request: Json` (risk/summary live inside the JSON). |
> | `/automations`         | `prisma.automationRule`         | `prisma.scheduledTriggerRecord`                           | Confirmed by `apps/api/src/routes/dashboard-automations.ts:2` which reads `ScheduledTriggersListQuerySchema`.                            |
>
> Valid `Opportunity.stage` values observed in `apps/dashboard/src/app/(auth)/(mercury)/contacts/pipeline-page.tsx` + `fixtures.ts`: `"interested"`, `"qualifying"`, `"qualified"`, `"booked"`, `"won"`, `"lost"`. Terminal: `won` / `lost`.
>
> `ApprovalRecord.envelopeId` is a plain `String` (no `@relation`) — Prisma does not enforce it as a FK, so synthetic envelope IDs work without first seeding `ActionEnvelope` rows.
>
> `seed.ts` already creates 10 audit entries today; seeding +5 here gets us to ≥15 total.
>
> **Before pasting the code below:** re-run `grep -E "^model (Opportunity|Contact|ApprovalRecord|ScheduledTriggerRecord) " packages/db/prisma/schema.prisma` and confirm those four models still exist. If `schema.prisma` has been modified since 2026-05-15, re-verify required fields. The mapping above was point-in-time correct.

**Files:**

- Create: `packages/db/prisma/seed-dev-data.ts`
- Modify: `packages/db/prisma/seed.ts` (call `seedDevData` near end of `main()`, guarded)
- Create: `scripts/check-seed-counts.ts`
- Create: `scripts/__tests__/check-seed-counts.test.ts` (offline-only — skips when no DB)

- [ ] **Step 5.1: Re-verify schema matches the pre-baked mapping**

```bash
grep -E "^model (Opportunity|Contact|ApprovalRecord|ScheduledTriggerRecord) " \
  packages/db/prisma/schema.prisma
```

Expected output: all four model declarations. Then spot-check required fields:

```bash
grep -A 5 "^model Opportunity {" packages/db/prisma/schema.prisma | head -8
grep -A 12 "^model ApprovalRecord {" packages/db/prisma/schema.prisma | head -14
grep -A 6 "^model ScheduledTriggerRecord {" packages/db/prisma/schema.prisma | head -8
```

The seed code below assumes (verified 2026-05-15):

- `Opportunity` — required: `id`, `organizationId`, `contactId` (FK → Contact), `serviceId`, `serviceName`; default stage `"interested"`
- `Contact` — required: `id`, `organizationId`; everything else optional or defaulted
- `ApprovalRecord` — required: `id`, `envelopeId`, `request: Json`, `expiresAt`; default status `"pending"`
- `ScheduledTriggerRecord` — required: `id`, `organizationId`, `type` (`"timer" | "cron" | "event_match"`), `action: Json`; default status `"active"`

If `Step 5.1` showed any of these models renamed or required-field-changed, stop and write a short note before pasting Steps 5.3–5.6.

- [ ] **Step 5.2: Create `seed-dev-data.ts` (skeleton)**

Create `packages/db/prisma/seed-dev-data.ts`:

```typescript
/**
 * Dev-only seed expansion: populates domain data so live-mode surfaces
 * render non-empty after `pnpm db:seed` on a fresh local clone.
 *
 * Called from seed.ts only when NODE_ENV !== "production". Idempotent —
 * uses upserts keyed on stable IDs (`dev_*`).
 *
 * Targets (per local-readiness spec §1.5):
 *   - ≥ 5 opportunities across all pipeline stages (seeded with Contact FKs)
 *   - ≥ 15 audit entries (seed.ts already creates 10; we add 7 more → 17 total)
 *   - ≥ 2 ApprovalRecord rows (status "pending")
 *   - ≥ 1 ScheduledTriggerRecord (backs /automations browse)
 */
/* eslint-disable no-console, max-lines */
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const ORG_ID = "org_dev";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function seedDevData(prisma: PrismaClient): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    console.log("[seed-dev-data] NODE_ENV=production — skipping dev seed");
    return;
  }
  console.log("[seed-dev-data] populating dev domain data for", ORG_ID);

  await seedContacts(prisma);
  await seedOpportunities(prisma);
  await seedExtraAuditEntries(prisma);
  await seedApprovals(prisma);
  await seedAutomations(prisma);

  console.log("[seed-dev-data] done");
}
```

- [ ] **Step 5.3: Implement `seedContacts` + `seedOpportunities`**

Contacts must be seeded before Opportunities because `Opportunity.contactId` is a foreign key. Add to `seed-dev-data.ts`:

```typescript
async function seedContacts(prisma: PrismaClient): Promise<void> {
  const sources = ["ctwa", "instant_form", "organic", "web"];
  const channels = ["whatsapp", "telegram", "slack"];

  const rows = Array.from({ length: 8 }).map((_, i) => ({
    id: `dev_contact_${String(i + 1).padStart(3, "0")}`,
    organizationId: ORG_ID,
    name: `Lead ${String.fromCharCode(65 + i)}`,
    phone: `+1555010${String(i).padStart(4, "0")}`,
    email: `lead-${i + 1}@example.com`,
    primaryChannel: channels[i % channels.length]!,
    firstTouchChannel: channels[i % channels.length]!,
    stage: i < 4 ? "new" : "qualified",
    source: sources[i % sources.length]!,
    sourceType: sources[i % sources.length]!,
    firstContactAt: new Date(Date.now() - (8 - i) * 24 * 60 * 60 * 1000),
    lastActivityAt: new Date(Date.now() - (8 - i) * 12 * 60 * 60 * 1000),
  }));

  for (const row of rows) {
    await prisma.contact.upsert({
      where: { id: row.id },
      update: {},
      create: row,
    });
  }
  console.log(`[seed-dev-data] contacts: ${rows.length}`);
}

async function seedOpportunities(prisma: PrismaClient): Promise<void> {
  // Valid stages observed in pipeline-page.tsx + fixtures.ts.
  const stages = ["interested", "qualifying", "qualified", "booked", "won", "lost"];
  const services = [
    { id: "svc_botox", name: "Botox Consultation" },
    { id: "svc_filler", name: "Dermal Filler" },
    { id: "svc_laser", name: "Laser Treatment" },
  ];

  const rows = Array.from({ length: 8 }).map((_, i) => {
    const service = services[i % services.length]!;
    const stage = stages[i % stages.length]!;
    return {
      id: `dev_opp_${String(i + 1).padStart(3, "0")}`,
      organizationId: ORG_ID,
      contactId: `dev_contact_${String(i + 1).padStart(3, "0")}`,
      serviceId: service.id,
      serviceName: service.name,
      stage,
      estimatedValue: 50000 + i * 25000, // cents — $500 to $2700
      notes: `Sample opportunity for ${service.name} at stage "${stage}"`,
      openedAt: new Date(Date.now() - (8 - i) * 24 * 60 * 60 * 1000),
      closedAt:
        stage === "won" || stage === "lost"
          ? new Date(Date.now() - (8 - i) * 12 * 60 * 60 * 1000)
          : null,
    };
  });

  for (const row of rows) {
    await prisma.opportunity.upsert({
      where: { id: row.id },
      update: {},
      create: row,
    });
  }
  console.log(`[seed-dev-data] opportunities: ${rows.length}`);
}
```

- [ ] **Step 5.4: Implement `seedExtraAuditEntries`**

```typescript
async function seedExtraAuditEntries(prisma: PrismaClient): Promise<void> {
  // Find the latest audit entry's hash to continue the chain.
  const latest = await prisma.auditEntry.findFirst({
    where: { organizationId: ORG_ID },
    orderBy: { timestamp: "desc" },
    select: { entryHash: true },
  });
  let previousHash: string | null = latest?.entryHash ?? null;

  const entries = [
    {
      event: "action.proposed",
      actor: "principal_dev",
      entity: "automation",
      entityId: "auto_001",
      risk: "low",
      summary: "Proposed: auto-pause campaigns when CPL > $40",
    },
    {
      event: "action.approved",
      actor: "admin-user",
      entity: "automation",
      entityId: "auto_001",
      risk: "low",
      summary: "Approved: auto-pause rule",
    },
    {
      event: "action.executed",
      actor: "system",
      entity: "automation",
      entityId: "auto_001",
      risk: "low",
      summary: "Executed: rule armed",
    },
    {
      event: "action.proposed",
      actor: "principal_dev",
      entity: "contact",
      entityId: "crm_002",
      risk: "none",
      summary: "Proposed: import 12 leads from CSV",
    },
    {
      event: "action.executed",
      actor: "system",
      entity: "contact",
      entityId: "crm_002",
      risk: "none",
      summary: "Executed: imported 12 leads",
    },
    {
      event: "action.proposed",
      actor: "principal_dev",
      entity: "campaign",
      entityId: "camp_003",
      risk: "medium",
      summary: "Proposed: increase Spring Sale budget to $1200",
    },
    {
      event: "action.executed",
      actor: "system",
      entity: "campaign",
      entityId: "camp_003",
      risk: "medium",
      summary: "Executed: budget increased to $1200",
    },
  ];

  const baseId = "dev_audit_";
  const baseTime = Date.now();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const id = `${baseId}${String(i + 1).padStart(3, "0")}`;
    const timestamp = new Date(baseTime - (entries.length - i) * 60 * 60 * 1000);
    const entryHash = sha256(
      JSON.stringify({
        id,
        eventType: e.event,
        timestamp: timestamp.toISOString(),
        actorId: e.actor,
        entityId: e.entityId,
        previousEntryHash: previousHash,
      }),
    );
    await prisma.auditEntry.upsert({
      where: { id },
      update: {},
      create: {
        id,
        eventType: e.event,
        timestamp,
        actorType: e.actor === "system" ? "system" : "user",
        actorId: e.actor,
        entityType: e.entity,
        entityId: e.entityId,
        riskCategory: e.risk,
        summary: e.summary,
        snapshot: {},
        evidencePointers: [],
        entryHash,
        previousEntryHash: previousHash,
        organizationId: ORG_ID,
      },
    });
    previousHash = entryHash;
  }
  console.log(`[seed-dev-data] audit entries: +${entries.length}`);
}
```

- [ ] **Step 5.5: Implement `seedApprovals`**

The Prisma model is `ApprovalRecord`. Risk category, summary, and binding hash live inside the `request: Json` blob — they are not top-level columns. `envelopeId` is a plain `String` (no `@relation`), so synthetic envelope IDs are safe.

```typescript
async function seedApprovals(prisma: PrismaClient): Promise<void> {
  const futureExpiry = (hoursAhead: number) => new Date(Date.now() + hoursAhead * 60 * 60 * 1000);

  const approvals = [
    {
      id: "dev_approval_001",
      envelopeId: "dev_envelope_001",
      organizationId: ORG_ID,
      request: {
        riskCategory: "medium",
        summary: "Spend $1,200 on Meta Ads campaign 'Spring Sale 2026'",
        bindingHash: sha256("dev_approval_001"),
        actionType: "campaign.update",
        principalId: "principal_dev",
      },
      status: "pending",
      expiresAt: futureExpiry(24),
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    },
    {
      id: "dev_approval_002",
      envelopeId: "dev_envelope_002",
      organizationId: ORG_ID,
      request: {
        riskCategory: "high",
        summary: "Pause underperforming campaign 'Awareness Q1'",
        bindingHash: sha256("dev_approval_002"),
        actionType: "campaign.pause",
        principalId: "principal_dev",
      },
      status: "pending",
      expiresAt: futureExpiry(48),
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    },
  ];

  for (const a of approvals) {
    await prisma.approvalRecord.upsert({
      where: { id: a.id },
      update: {},
      create: a,
    });
  }
  console.log(`[seed-dev-data] approval records: ${approvals.length}`);
}
```

- [ ] **Step 5.6: Implement `seedAutomations`**

The Prisma model is `ScheduledTriggerRecord` (backs `/api/dashboard/automations` per `apps/api/src/routes/dashboard-automations.ts:2`). `type` must be one of `"timer" | "cron" | "event_match"`. `action` is a `Json` blob. There is no `name`/`description` column — those would live inside `action.payload` or in a separate label model.

```typescript
async function seedAutomations(prisma: PrismaClient): Promise<void> {
  const automations = [
    {
      id: "dev_auto_001",
      organizationId: ORG_ID,
      type: "cron",
      cronExpression: "0 9 * * *",
      action: {
        type: "notification.send",
        payload: {
          channel: "telegram",
          label: "Daily ROI digest",
          description: "Post a daily ROI summary to Telegram operators",
        },
      },
      status: "active",
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    },
    {
      id: "dev_auto_002",
      organizationId: ORG_ID,
      type: "event_match",
      eventPattern: {
        type: "metric.threshold_breached",
        filters: { metric: "cpl", op: "gt", value: 40 },
      },
      action: {
        type: "campaign.pause",
        payload: {
          label: "Auto-pause high-CPL campaigns",
          description: "Pause any campaign where cost-per-lead exceeds $40 for 3 consecutive days",
        },
      },
      status: "active",
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  ];

  for (const a of automations) {
    await prisma.scheduledTriggerRecord.upsert({
      where: { id: a.id },
      update: {},
      create: a,
    });
  }
  console.log(`[seed-dev-data] scheduled triggers: ${automations.length}`);
}
```

- [ ] **Step 5.7: Wire `seedDevData` into `seed.ts`**

Add to the top of `packages/db/prisma/seed.ts` alongside existing imports:

```typescript
import { seedDevData } from "./seed-dev-data.js";
```

At the very end of `async function main()` (after the `seedKnowledge(prisma)` call near line 601, before the closing `}`), add:

```typescript
// ── Dev-only domain data ──
// Skipped in production. Idempotent — keyed on `dev_*` IDs.
await seedDevData(prisma);
```

- [ ] **Step 5.8: Write the seed-count check**

Create `scripts/check-seed-counts.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Verifies that `org_dev` has enough domain data for live-mode surfaces
 * to render non-empty. Skips gracefully (exit 0 with a warning) if no
 * DATABASE_URL is configured or the DB is unreachable.
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

export interface SeedCountResult {
  skipped: boolean;
  counts: Partial<Record<keyof typeof MINIMUMS, number>>;
  unmet: Array<{ key: keyof typeof MINIMUMS; expected: number; actual: number }>;
}

export async function auditSeedCounts(): Promise<SeedCountResult> {
  if (!process.env["DATABASE_URL"]) {
    return { skipped: true, counts: {}, unmet: [] };
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
    return { skipped: false, counts, unmet };
  } catch (err) {
    // DB unreachable — treat as skipped, not a failure.
    console.warn(`[seed-counts] DB unreachable: ${(err as Error).message}`); // eslint-disable-line no-console
    return { skipped: true, counts: {}, unmet: [] };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const result = await auditSeedCounts();
  if (result.skipped) {
    console.log("⚠ skipping seed-count check (no DB reachable)"); // eslint-disable-line no-console
    process.exit(0);
  }
  if (result.unmet.length) {
    console.log("✗ seed counts below local-readiness minimums:"); // eslint-disable-line no-console
    for (const u of result.unmet) {
      console.log(`    ${u.key}: expected ≥${u.expected}, actual ${u.actual}`); // eslint-disable-line no-console
    }
    process.exit(1);
  }
  console.log("✓ seed counts meet minimums"); // eslint-disable-line no-console
  for (const [k, v] of Object.entries(result.counts)) {
    console.log(`    ${k}: ${v}`); // eslint-disable-line no-console
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
```

- [ ] **Step 5.8b: Co-located test for seed-count skip behavior**

Create `scripts/__tests__/check-seed-counts.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { auditSeedCounts } from "../check-seed-counts.js";

describe("auditSeedCounts", () => {
  const originalUrl = process.env["DATABASE_URL"];
  beforeEach(() => {
    delete process.env["DATABASE_URL"];
  });
  afterAll(() => {
    if (originalUrl !== undefined) process.env["DATABASE_URL"] = originalUrl;
  });

  it("skips with no error when DATABASE_URL is unset", async () => {
    const result = await auditSeedCounts();
    expect(result.skipped).toBe(true);
    expect(result.unmet).toEqual([]);
  });
});
```

Add the missing `afterAll` import at the top:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
```

Run it:

```bash
pnpm exec vitest run scripts/__tests__/check-seed-counts.test.ts
```

Expected: PASS. Asserts the offline-safe contract: no DB → exit 0 with `skipped: true`.

- [ ] **Step 5.9: Run the seed against a local DB**

```bash
# Ensure Postgres is running (docker-compose or local install)
pnpm db:migrate
pnpm db:seed
```

Expected output lines from `[seed-dev-data]`:

```
[seed-dev-data] contacts: 8
[seed-dev-data] opportunities: 8
[seed-dev-data] audit entries: +7
[seed-dev-data] approval records: 2
[seed-dev-data] scheduled triggers: 2
[seed-dev-data] done
```

- [ ] **Step 5.10: Run the seed-count check**

```bash
pnpm exec tsx scripts/check-seed-counts.ts
```

Expected:

```
✓ seed counts meet minimums
    org: 1
    agents: 7
    contacts: 8
    opportunities: 8
    auditEntries: 17
    approvalRecords: 2
    scheduledTriggers: 2
```

- [ ] **Step 5.11: Confirm idempotency (re-seed doesn't dupe)**

```bash
pnpm db:seed
pnpm exec tsx scripts/check-seed-counts.ts
```

Expected: same row counts as Step 5.10 (no duplication from the second run).

- [ ] **Step 5.12: Typecheck, lint, build**

```bash
pnpm typecheck
pnpm lint
pnpm --filter @switchboard/dashboard build
```

Expected: all exit 0.

- [ ] **Step 5.13: Commit**

```bash
git add packages/db/prisma/seed-dev-data.ts packages/db/prisma/seed.ts \
        scripts/check-seed-counts.ts scripts/__tests__/check-seed-counts.test.ts
git commit -m "$(cat <<'EOF'
feat(db): dev-only seed for contacts, opportunities, approvals, triggers + audit

Adds packages/db/prisma/seed-dev-data.ts as a sibling to seed.ts. Called
from seed.ts main() at the end, but only when NODE_ENV !== "production".
Seeds idempotently (upserts keyed on `dev_*` IDs):

  - 8 contacts (FKs for opportunities)
  - 8 opportunities across all pipeline stages (interested/qualifying/
    qualified/booked/won/lost), referencing the seeded contacts
  - 7 additional audit entries (hash chain continued from seed.ts → 17 total)
  - 2 ApprovalRecord rows (status=pending; risk/summary in `request` JSON)
  - 2 ScheduledTriggerRecord rows (one cron, one event_match) — these back
    /api/dashboard/automations per ScheduledTriggersListQuerySchema

These minimums make /contacts, /activity, /approvals, and /automations
render non-empty after a fresh `pnpm db:seed`, closing the "live-mode
surface renders empty" failure mode from the local-readiness audit.

Also adds scripts/check-seed-counts.ts which the local:verify pipeline
calls to assert minimums. Skips with a loud warning when DATABASE_URL
is unset (offline-friendly).
EOF
)"
```

---

## Task 6: `pnpm local:verify:fast` and `pnpm local:verify`

**Why:** Per spec §1.6, developers need a structural pre-flight (≤10s) and a full pre-flight (minutes). CI uses the fast variant; developers use the full one before pushing.

**Files:**

- Create: `scripts/local-verify-fast.ts`
- Create: `scripts/local-verify.ts`
- Modify: `package.json` (add `local:verify:fast` and `local:verify` scripts)

- [ ] **Step 6.1: Implement `local-verify-fast.ts`**

Create `scripts/local-verify-fast.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Fast structural pre-flight (≤10s, no Postgres required).
 *
 * Runs:
 *   1. env-completeness         (scripts/check-env-completeness.ts)
 *   2. live-flag manifest       (scripts/check-live-flag-manifest.ts)
 *   3. arch:check               (pnpm arch:check)
 *   4. route-ingress check      (.agent/tools/check-routes)
 *   5. seed-count check         (scripts/check-seed-counts.ts — skips if no DB)
 *
 * Fail-fast: stops at first non-zero exit. Each step prints a one-line
 * summary.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
  name: string;
  cmd: string;
  args: string[];
}

const STEPS: Step[] = [
  {
    name: "env-completeness",
    cmd: "pnpm",
    args: ["exec", "tsx", "scripts/check-env-completeness.ts"],
  },
  {
    name: "live-flag-manifest",
    cmd: "pnpm",
    args: ["exec", "tsx", "scripts/check-live-flag-manifest.ts"],
  },
  { name: "arch:check", cmd: "pnpm", args: ["arch:check"] },
  { name: "route-ingress", cmd: "bash", args: [".agent/tools/check-routes"] },
  { name: "seed-counts", cmd: "pnpm", args: ["exec", "tsx", "scripts/check-seed-counts.ts"] },
];

function runStep(s: Step): boolean {
  process.stdout.write(`→ ${s.name}... `);
  const result = spawnSync(s.cmd, s.args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const code = result.status ?? 1;
  if (code === 0) {
    process.stdout.write("OK\n");
    return true;
  }
  process.stdout.write(`FAIL (exit ${code})\n`);
  if (result.stdout?.length) process.stdout.write(result.stdout.toString());
  if (result.stderr?.length) process.stderr.write(result.stderr.toString());
  return false;
}

function main(): void {
  console.log("local:verify:fast — structural pre-flight\n"); // eslint-disable-line no-console
  for (const step of STEPS) {
    if (!runStep(step)) {
      console.error("\n✗ local:verify:fast failed at:", step.name); // eslint-disable-line no-console
      process.exit(1);
    }
  }
  console.log("\n✓ local:verify:fast — all checks passed"); // eslint-disable-line no-console
  process.exit(0);
}

main();
```

- [ ] **Step 6.2: Implement `local-verify.ts`**

Create `scripts/local-verify.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Full pre-flight: calls local:verify:fast first, then the heavy checks
 * (typecheck, lint, test, dashboard build, seed integrity).
 *
 * Fail-fast: stops at first non-zero exit.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
  name: string;
  cmd: string;
  args: string[];
}

const HEAVY_STEPS: Step[] = [
  { name: "typecheck", cmd: "pnpm", args: ["typecheck"] },
  { name: "lint", cmd: "pnpm", args: ["lint"] },
  { name: "test", cmd: "pnpm", args: ["test"] },
  { name: "dashboard build", cmd: "pnpm", args: ["--filter", "@switchboard/dashboard", "build"] },
];

function run(s: Step, label: string): boolean {
  console.log(`\n→ ${label}: ${s.name}`); // eslint-disable-line no-console
  const result = spawnSync(s.cmd, s.args, { cwd: REPO_ROOT, stdio: "inherit" });
  return (result.status ?? 1) === 0;
}

function main(): void {
  console.log("local:verify — full pre-flight\n"); // eslint-disable-line no-console

  if (!run({ name: "local:verify:fast", cmd: "pnpm", args: ["local:verify:fast"] }, "fast")) {
    console.error("\n✗ local:verify failed at fast pre-flight"); // eslint-disable-line no-console
    process.exit(1);
  }

  for (const step of HEAVY_STEPS) {
    if (!run(step, "heavy")) {
      console.error(`\n✗ local:verify failed at: ${step.name}`); // eslint-disable-line no-console
      process.exit(1);
    }
  }

  console.log("\n✓ local:verify — all checks passed"); // eslint-disable-line no-console
  process.exit(0);
}

main();
```

- [ ] **Step 6.3: Add the npm scripts**

In `package.json`, in the `"scripts"` section, add (alphabetically among existing entries):

```json
    "local:verify": "tsx scripts/local-verify.ts",
    "local:verify:fast": "tsx scripts/local-verify-fast.ts",
```

- [ ] **Step 6.4: Run `local:verify:fast`**

```bash
pnpm local:verify:fast
```

Expected:

```
local:verify:fast — structural pre-flight

→ env-completeness... OK
→ live-flag-manifest... OK
→ arch:check... OK
→ route-ingress... OK
→ seed-counts... OK

✓ local:verify:fast — all checks passed
```

Total wall-clock ≤10s on a warm machine. If `seed-counts` prints `⚠ skipping seed-count check (no DB reachable)`, that's fine — still exits 0.

- [ ] **Step 6.5: Run `local:verify`**

```bash
pnpm local:verify
```

Expected: all five fast checks pass, then typecheck → lint → test → dashboard build all succeed. Wall-clock ~3-6 minutes depending on machine.

- [ ] **Step 6.6: Confirm fast mode handles offline gracefully**

```bash
DATABASE_URL= pnpm local:verify:fast
```

Expected: exits 0 with `⚠ skipping seed-count check (no DB reachable)` line; all other checks pass.

- [ ] **Step 6.7: Commit**

```bash
git add scripts/local-verify-fast.ts scripts/local-verify.ts package.json
git commit -m "$(cat <<'EOF'
feat(scripts): pnpm local:verify:fast and pnpm local:verify

Two-tier local pre-flight per the local-readiness spec §1.6.

local:verify:fast — structural checks (≤10s, no Postgres required):
  env-completeness, live-flag-manifest, arch:check, route-ingress,
  seed-counts (skips gracefully when DATABASE_URL is unset).

local:verify — full pre-flight (minutes): runs :fast first, then
typecheck, lint, test, and dashboard build. The dashboard build closes
the next-build-not-in-CI gap by making it part of the developer
pre-push routine.

CI gates (covered by PR 2) call local:verify:fast in the lint job;
the heavy checks run in their own parallel jobs as before.
EOF
)"
```

---

## Final verification

- [ ] **Step F.1: Re-run `pnpm local:verify` from a clean state**

```bash
git status --short        # → expect nothing untracked or modified
pnpm install              # ensure node_modules current
pnpm db:migrate
pnpm db:seed              # idempotent re-seed
pnpm local:verify
```

Expected: clean exit, all checks pass.

- [ ] **Step F.2: Spot-check the dashboard renders non-empty data**

```bash
pnpm dev &
DEV_PID=$!
sleep 12
curl -s http://localhost:3002/contacts > /dev/null && echo "/contacts OK"
# (For visual verification, open localhost:3002 in a browser and confirm
#  /contacts, /activity, /approvals, /automations show seeded rows, and
#  /reports shows the "Demo data" banner with fixture numbers.)
kill $DEV_PID 2>/dev/null || true
```

This is a sanity check — not a hard gate. The seed-counts check already proves the DB has data; the spot-check confirms the dashboard renders it.

- [ ] **Step F.3: Push and open PR**

```bash
git push -u origin feat/local-readiness
gh pr create --base main --title "feat: local readiness (PR 1 of local-readiness spec)" \
  --body "Implements PR 1 of docs/superpowers/specs/2026-05-15-local-readiness-and-ci-gates-design.md.

## Summary

- Fixes \`pnpm test\` timeout in mcp-server by extracting \`buildMutationModeGuard\` into a side-effect-free module.
- Adds \`scripts/env-allowlist.local-readiness.json\` + \`scripts/check-env-completeness.ts\` and completes \`.env.example\` with 18 previously-undocumented keys.
- Deletes the orphaned \`apps/api/src/routes/operator-config.ts\` (never registered, fully stubbed) and the dead dashboard query keys.
- Locks live-flag defaults: contacts/activity/approvals/automations ON; reports OFF with a visible 'Demo data' banner on /reports.
- Adds \`packages/db/prisma/seed-dev-data.ts\` so \`/contacts\`, \`/activity\`, \`/approvals\`, \`/automations\` render non-empty after \`pnpm db:seed\`.
- Adds \`pnpm local:verify:fast\` (≤10s structural) and \`pnpm local:verify\` (full pre-flight).

Six commits, each isolated to one concern.

## Test plan

- [ ] \`pnpm local:verify\` exits 0 on a fresh clone after setup-env + db:migrate + db:seed.
- [ ] Open localhost:3002 and confirm /contacts, /activity, /approvals, /automations render seeded rows; /reports shows the 'Demo data' banner.
- [ ] CI changes ship in PR 2 (chore/ci-local-readiness-gates) after this merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review Notes

**Spec coverage:**

- §1.1 (mcp-server test fix) — Task 1
- §1.2 (.env.example superset) — Task 2 (steps 2.6–2.7)
- §1.3 (operator-config deletion as isolated commit) — Task 3
- §1.4 (live-flag matrix + /reports fixture banner) — Task 4
- §1.5 (seed expansion + truthful empty state) — Task 5
- §1.6.a (`local:verify:fast`) — Task 6 step 6.1
- §1.6.b (`local:verify` full) — Task 6 step 6.2
- §1.6.c (env allowlist categories) — Task 2 step 2.2

All eight spec sub-sections have at least one task implementing them.

**Out-of-scope reminder:** CI wiring is PR 2 (separate plan), not this PR. The success criterion for this plan is `pnpm local:verify` exits 0 locally — not CI green.

**Known risk:** Step 5.1 (Prisma model name discovery) is the only step that assumes specific model names. If `Opportunity` is actually `Contact`, `PendingApproval` is actually `Approval`, or `AutomationRule` is actually `Automation`, substitute throughout Task 5. Re-run typecheck after substitution.

**Pre-existing flake to expect:** `prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` may fail with `pg_advisory_xact_lock` errors. Documented in `feedback_db_integrity_tests_pg_advisory_lock.md`. If they reproduce on `main` (pre-branch), they're not regressions from this PR.
