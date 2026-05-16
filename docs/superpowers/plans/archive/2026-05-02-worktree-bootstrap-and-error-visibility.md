# Worktree Bootstrap & Dashboard Error Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make worktree-based dev resilient: a one-shot bootstrap script, fail-fast on missing env, fail-fast on unreachable DB, and dashboard error messages that surface the real cause in development.

**Architecture:** Six independent commits in one PR. Two new bash scripts. One new TypeScript module (`apps/api/src/env.ts`). One refactored module (`apps/api/src/bootstrap/error-handler.ts`, extracted from `app.ts`). Two modified files (`apps/api/src/server.ts`, `apps/api/src/app.ts`, `apps/dashboard/src/lib/proxy-error.ts`). Each layer has an automated regression/persistence test.

**Tech Stack:** Bash (scripts), TypeScript + Fastify (API), TypeScript + Next.js (dashboard), Vitest (both apps), pnpm + Turborepo (workspace).

**Spec:** `docs/superpowers/specs/2026-05-02-worktree-bootstrap-and-error-visibility-design.md`

**Branch:** `dx/worktree-bootstrap-and-error-visibility` from `origin/main`. Open the PR from a fresh worktree (e.g. `.worktrees/dx-impl`) — dogfood the very script this PR ships.

---

## File Map

**New files:**

- `scripts/check-env.sh` — non-blocking predev hint when `.env` is missing in a worktree.
- `scripts/worktree-init.sh` — idempotent bootstrap: copy `.env`, kill stale port listeners, run migrations.
- `apps/api/src/env.ts` — `REQUIRED_ENV` contract + `assertRequiredEnv()` guard.
- `apps/api/src/bootstrap/error-handler.ts` — extracted `installErrorHandler(app)`; encapsulates dev-vs-prod 5xx body shape.
- `apps/api/src/__tests__/env.test.ts` — unit tests for `assertRequiredEnv`.
- `apps/api/src/__tests__/bootstrap-smoke.test.ts` — integration smoke: spawn the entry point with no env, assert exit 1.
- `apps/api/src/__tests__/db-sanity.test.ts` — integration smoke: spawn with `DATABASE_URL` pointing at a closed port, assert exit 1.
- `apps/api/src/bootstrap/__tests__/error-handler.test.ts` — unit tests for dev/prod 5xx body shape.

**Modified files:**

- `apps/api/src/server.ts` — call `assertRequiredEnv()` first.
- `apps/api/src/app.ts` — call `installErrorHandler(app)` (extraction); add bootstrap DB sanity check after `bootstrapStorage`.
- `apps/dashboard/src/lib/proxy-error.ts` — log body to `console.error` on 5xx (no body shape change; existing pass-through already correct once C2a is in).
- `apps/dashboard/src/lib/__tests__/proxy-error.test.ts` — three new cases: 5xx logs, 4xx does not log, regression for the C2a-shaped body.
- `package.json` (root) — add `worktree:init` and `predev` scripts.
- `CLAUDE.md` — Worktree Doctrine: add bullet for `pnpm worktree:init`.

---

## Task 1: B1 — Worktree bootstrap scripts + package.json wiring

**Goal:** A developer in a fresh worktree can run `pnpm worktree:init` once and get a runnable stack. `pnpm dev` prints a hint when `.env` is missing.

**Files:**

- Create: `scripts/check-env.sh`
- Create: `scripts/worktree-init.sh`
- Modify: `package.json` (root) — add `predev` and `worktree:init` to `scripts`.

### Steps

- [ ] **Step 1.1: Create `scripts/check-env.sh`.**

```bash
#!/usr/bin/env bash
# Predev hint: prints a one-line warning when .env is missing in a non-primary
# worktree. Non-blocking (always exits 0) — this is a hint, not a gate.
# See docs/superpowers/specs/2026-05-02-worktree-bootstrap-and-error-visibility-design.md.
set -euo pipefail

common_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo "")"
git_dir="$(git rev-parse --git-dir 2>/dev/null || echo "")"

if [[ -z "$common_dir" || -z "$git_dir" ]]; then
  exit 0
fi

common_abs="$(cd "$common_dir" 2>/dev/null && pwd -P || true)"
git_abs="$(cd "$git_dir" 2>/dev/null && pwd -P || true)"

# In the primary worktree, common_dir == git_dir (both point to .git).
if [[ "$common_abs" == "$git_abs" ]]; then
  exit 0
fi

worktree_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "$worktree_root" ]]; then
  exit 0
fi

if [[ ! -f "$worktree_root/.env" ]]; then
  echo ""
  echo "  ⚠ .env is missing in this worktree. Run \`pnpm worktree:init\` from"
  echo "    $worktree_root"
  echo ""
fi

exit 0
```

- [ ] **Step 1.2: Make it executable.**

Run: `chmod +x scripts/check-env.sh`

- [ ] **Step 1.3: Smoke test it manually from the implementation worktree.**

Run: `bash scripts/check-env.sh`

Expected: prints the warning lines if you have not yet copied `.env` into the implementation worktree; otherwise silent.

- [ ] **Step 1.4: Create `scripts/worktree-init.sh`.**

```bash
#!/usr/bin/env bash
# One-shot bootstrap for a fresh git worktree. Idempotent — safe to re-run.
# See docs/superpowers/specs/2026-05-02-worktree-bootstrap-and-error-visibility-design.md.
set -euo pipefail

common_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo "")"
git_dir="$(git rev-parse --git-dir 2>/dev/null || echo "")"

if [[ -z "$common_dir" || -z "$git_dir" ]]; then
  echo "[worktree-init] Not inside a git repository. Aborting." >&2
  exit 1
fi

common_abs="$(cd "$common_dir" 2>/dev/null && pwd -P || true)"
git_abs="$(cd "$git_dir" 2>/dev/null && pwd -P || true)"

if [[ "$common_abs" == "$git_abs" ]]; then
  echo "[worktree-init] This is the primary worktree — nothing to do."
  exit 0
fi

worktree_root="$(git rev-parse --show-toplevel)"
repo_root="$(cd "$common_abs/.." && pwd -P)"

echo "[worktree-init] Bootstrapping worktree at $worktree_root"

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

# 2. Kill listeners on dev ports.
for port in 3000 3001 3002; do
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[worktree-init] Killing stale listener on :$port (PID $pids)"
    kill -9 $pids 2>/dev/null || true
  fi
done

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

# 4. Print next steps.
cat <<EOF

[worktree-init] Done. Next steps:
  cd $worktree_root
  pnpm dev                    # starts api (:3000), chat (:3001), dashboard (:3002)
  open http://localhost:3002

EOF
```

- [ ] **Step 1.5: Make it executable.**

Run: `chmod +x scripts/worktree-init.sh`

- [ ] **Step 1.6: Smoke test the script.**

Run: `bash scripts/worktree-init.sh`

Expected: prints "Bootstrapping worktree at ...", reports `.env` state, kills listeners (or reports none), runs `pnpm db:migrate` if Postgres is up, prints "Done. Next steps:".

- [ ] **Step 1.7: Wire the scripts into root `package.json`.**

In `package.json`, add to the `"scripts"` block:

```json
"predev": "bash scripts/check-env.sh",
"worktree:init": "bash scripts/worktree-init.sh"
```

Place `predev` near `dev` and `worktree:init` near `preflight`. Do not change other scripts.

- [ ] **Step 1.8: Verify wiring.**

Run: `pnpm worktree:init` — should produce the same output as Step 1.6.

Run: `node -e "console.log(require('./package.json').scripts.predev, '|', require('./package.json').scripts['worktree:init'])"` — should print `bash scripts/check-env.sh | bash scripts/worktree-init.sh`.

- [ ] **Step 1.9: Run lint + typecheck (no source changes, but confirms nothing broke).**

Run: `pnpm typecheck`

Expected: no errors.

- [ ] **Step 1.10: Commit.**

```bash
git add scripts/check-env.sh scripts/worktree-init.sh package.json
git commit -m "chore(dx): add scripts/worktree-init.sh + check-env.sh + pnpm worktree:init

Adds a one-shot bootstrap script for fresh worktrees and a non-blocking
predev hint so a developer running pnpm dev in a worktree without .env
discovers the bootstrap step. See docs/superpowers/specs/2026-05-02-worktree-bootstrap-and-error-visibility-design.md."
```

If commitlint or husky rejects: read the error, fix root cause (most likely a long header line — keep it ≤ 72 chars), retry. Do **not** use `--no-verify`.

---

## Task 2: B3 — REQUIRED_ENV fail-fast in API

**Goal:** API exits 1 with an actionable error when any value in `REQUIRED_ENV` is missing — not just `DATABASE_URL`.

**Files:**

- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/__tests__/env.test.ts`
- Create: `apps/api/src/__tests__/bootstrap-smoke.test.ts`
- Modify: `apps/api/src/server.ts:1-3` (add the import and call before `buildServer`)

### Steps

- [ ] **Step 2.1: Write the failing unit test.**

Create `apps/api/src/__tests__/env.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { REQUIRED_ENV, assertRequiredEnv } from "../env.js";

describe("assertRequiredEnv", () => {
  let original: Record<string, string | undefined>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    original = {};
    for (const key of REQUIRED_ENV) {
      original[key] = process.env[key];
    }
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__exit__");
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of REQUIRED_ENV) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns silently when every REQUIRED_ENV var is set", () => {
    for (const key of REQUIRED_ENV) process.env[key] = "value";
    expect(() => assertRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  for (const key of REQUIRED_ENV) {
    it(`exits 1 with an actionable error mentioning ${key} when ${key} is unset`, () => {
      for (const k of REQUIRED_ENV) process.env[k] = "value";
      delete process.env[key];
      expect(() => assertRequiredEnv()).toThrow("__exit__");
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errMsg = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(errMsg).toContain(key);
      expect(errMsg).toContain("worktree:init");
    });
  }
});
```

- [ ] **Step 2.2: Run the test to confirm it fails.**

Run: `pnpm --filter @switchboard/api test -- env.test`

Expected: FAIL — `Cannot find module '../env.js'` (the source file does not exist yet).

- [ ] **Step 2.3: Create `apps/api/src/env.ts`.**

```ts
export const REQUIRED_ENV = ["DATABASE_URL", "NEXTAUTH_SECRET"] as const;

export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  console.error(
    `[api] Missing required env vars: ${missing.join(", ")}.\n` +
      "      In a worktree? Run `pnpm worktree:init` from the worktree root.\n" +
      "      Otherwise, copy .env.example to .env and set the missing vars.",
  );
  process.exit(1);
}
```

- [ ] **Step 2.4: Run the unit test to confirm it passes.**

Run: `pnpm --filter @switchboard/api test -- env.test`

Expected: PASS — three test cases (`returns silently`, `exits 1 ... DATABASE_URL`, `exits 1 ... NEXTAUTH_SECRET`).

- [ ] **Step 2.5: Write the failing integration smoke test.**

Create `apps/api/src/__tests__/bootstrap-smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "..", "server.ts");

describe("API bootstrap smoke (B3)", () => {
  it("exits 1 with an actionable error when DATABASE_URL is unset", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.NEXTAUTH_SECRET;

    const result = spawnSync("npx", ["tsx", SERVER_ENTRY], {
      env,
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).toContain("worktree:init");
  }, 20_000);
});
```

- [ ] **Step 2.6: Run the smoke test to confirm it fails.**

Run: `pnpm --filter @switchboard/api test -- bootstrap-smoke`

Expected: FAIL — `result.status` is some other value (likely the API hangs trying to bind, gets killed by the 15s timeout, exits with `null`), or the API silently boots in degraded mode.

- [ ] **Step 2.7: Wire `assertRequiredEnv()` into `server.ts`.**

`apps/api/src/server.ts` currently starts with `import { buildServer } from "./app.js";` (line 1). Modify it to:

```ts
import { assertRequiredEnv } from "./env.js";
import { buildServer } from "./app.js";

assertRequiredEnv();

async function main() {
  const server = await buildServer();
  // ... existing main() body unchanged
}

main();
```

The `assertRequiredEnv()` call sits at module top level so it runs before `main()` and before any Prisma side-effecting work happens (which is inside `buildServer()`). The `import { buildServer }` line is inert until `main()` is invoked.

- [ ] **Step 2.8: Run the smoke test to confirm it passes.**

Run: `pnpm --filter @switchboard/api test -- bootstrap-smoke`

Expected: PASS — exit code 1 within ~3 seconds, stderr contains both `DATABASE_URL` and `worktree:init`.

- [ ] **Step 2.9: Run the full API test suite to confirm nothing regressed.**

Run: `pnpm --filter @switchboard/api test`

Expected: every test passes. If any pre-existing test imports `server.ts` directly and now fails because `REQUIRED_ENV` aborts the process, set `DATABASE_URL=test` and `NEXTAUTH_SECRET=test` in the affected `beforeEach`. Do **not** change `assertRequiredEnv` to be opt-out.

- [ ] **Step 2.10: Run typecheck.**

Run: `pnpm --filter @switchboard/api typecheck`

Expected: no errors.

- [ ] **Step 2.11: Commit.**

```bash
git add apps/api/src/env.ts apps/api/src/server.ts apps/api/src/__tests__/env.test.ts apps/api/src/__tests__/bootstrap-smoke.test.ts
git commit -m "feat(api): fail fast on any missing required env var (REQUIRED_ENV)

Replaces the silent prismaClient=null cascade with a one-line actionable
error pointing at pnpm worktree:init. REQUIRED_ENV is a single source of
truth; a future required env var inherits the same fail-fast behavior.
Bootstrap smoke test fails the build if the guard is moved past Prisma
initialization."
```

---

## Task 3: B4 — Bootstrap DB sanity check

**Goal:** API exits 1 if `DATABASE_URL` is set but Postgres is unreachable, instead of silently binding `:3000` with a half-functional server.

**Files:**

- Create: `apps/api/src/__tests__/db-sanity.test.ts`
- Modify: `apps/api/src/app.ts` — insert a connectivity probe immediately after `bootstrapStorage` returns a non-null `prismaClient`.

### Steps

- [ ] **Step 3.1: Write the failing integration smoke test.**

Create `apps/api/src/__tests__/db-sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "..", "server.ts");

describe("API bootstrap DB sanity (B4)", () => {
  it("exits 1 with an actionable error when DATABASE_URL is set but DB is unreachable", () => {
    const result = spawnSync("npx", ["tsx", SERVER_ENTRY], {
      env: {
        ...process.env,
        // Port 1 is reserved + always closed — instant ECONNREFUSED.
        DATABASE_URL: "postgresql://nobody:nobody@127.0.0.1:1/nope",
        NEXTAUTH_SECRET: "test-secret",
      },
      encoding: "utf8",
      timeout: 20_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("not reachable");
    expect(result.stderr).toContain("worktree:init");
  }, 25_000);
});
```

- [ ] **Step 3.2: Run the test to confirm it fails.**

Run: `pnpm --filter @switchboard/api test -- db-sanity`

Expected: FAIL — current bootstrap silently boots with `prismaClient = null` if it can't connect (or takes too long and times out via SIGTERM).

- [ ] **Step 3.3: Add the sanity probe to `apps/api/src/app.ts`.**

Locate the existing block at lines 196-201 in `apps/api/src/app.ts`:

```ts
const { storage, ledger, policyCache, governanceProfileStore, prismaClient, redis } =
  await bootstrapStorage(app.log);

if (prismaClient) {
  await ensureSystemIdentity(prismaClient);
}
```

Replace with:

```ts
const { storage, ledger, policyCache, governanceProfileStore, prismaClient, redis } =
  await bootstrapStorage(app.log);

if (prismaClient) {
  try {
    await Promise.race([
      prismaClient.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB sanity check timed out after 3s")), 3000),
      ),
    ]);
  } catch (err) {
    console.error(
      "[api] DATABASE_URL is set but the database is not reachable.\n" +
        `      ${err instanceof Error ? err.message : String(err)}\n` +
        "      Is Postgres running? Run `pnpm worktree:init` to verify and apply migrations.",
    );
    process.exit(1);
  }

  await ensureSystemIdentity(prismaClient);
}
```

- [ ] **Step 3.4: Run the sanity test to confirm it passes.**

Run: `pnpm --filter @switchboard/api test -- db-sanity`

Expected: PASS — exit 1 within ~5 seconds, stderr contains `not reachable` and `worktree:init`.

- [ ] **Step 3.5: Run the full API test suite to confirm nothing regressed.**

Run: `pnpm --filter @switchboard/api test`

Expected: all tests pass. The `bootstrap-smoke` test from Task 2 still passes (the env-guard fires before reaching the DB probe).

- [ ] **Step 3.6: Run typecheck.**

Run: `pnpm --filter @switchboard/api typecheck`

Expected: no errors.

- [ ] **Step 3.7: Commit.**

```bash
git add apps/api/src/app.ts apps/api/src/__tests__/db-sanity.test.ts
git commit -m "feat(api): bootstrap DB sanity check — exit 1 if Postgres unreachable

Probes the database with SELECT 1 (3s timeout) before declaring the API
ready. Replaces the silent zombie-API state where DATABASE_URL is set
but Postgres is down — previously bound :3000 with a half-functional
server. Validated against the friction observed during the Surface 01
audit walk on 2026-05-02."
```

---

## Task 4: C2a — API setErrorHandler dev-mode passthrough

**Goal:** In `NODE_ENV !== "production"`, 5xx responses include the original `error.message` (and `error.stack`). Production keeps today's scrubbing behavior.

**Approach:** Extract the existing `setErrorHandler` block from `app.ts` into a new module `apps/api/src/bootstrap/error-handler.ts` so it's testable without spinning up the full `buildServer()`. Modify the extraction to add the dev-mode branch.

**Files:**

- Create: `apps/api/src/bootstrap/error-handler.ts`
- Create: `apps/api/src/bootstrap/__tests__/error-handler.test.ts`
- Modify: `apps/api/src/app.ts:160-172` — replace inline block with `installErrorHandler(app)` call.

### Steps

- [ ] **Step 4.1: Write the failing unit test.**

Create `apps/api/src/bootstrap/__tests__/error-handler.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { installErrorHandler } from "../error-handler.js";

describe("installErrorHandler (C2a)", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    installErrorHandler(app);
    app.get("/boom", async () => {
      throw new Error("synthetic-cause");
    });
    app.get("/bad-input", async () => {
      const err = new Error("bad-input") as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    });
    return app;
  }

  it("in development, 5xx body includes the original error message and stack", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("synthetic-cause");
    expect(body.statusCode).toBe(500);
    expect(typeof body.stack).toBe("string");
    expect(body.stack).toContain("Error: synthetic-cause");
    await app.close();
  });

  it("in production, 5xx body scrubs message and omits stack", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("Internal server error");
    expect(body.statusCode).toBe(500);
    expect(body.stack).toBeUndefined();
    await app.close();
  });

  it("4xx errors keep their message and omit stack in both environments", async () => {
    for (const env of ["production", "development"] as const) {
      (process.env as Record<string, string | undefined>).NODE_ENV = env;
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/bad-input" });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("bad-input");
      expect(body.stack).toBeUndefined();
      await app.close();
    }
  });
});
```

- [ ] **Step 4.2: Run the test to confirm it fails.**

Run: `pnpm --filter @switchboard/api test -- bootstrap/error-handler`

Expected: FAIL — `Cannot find module '../error-handler.js'`.

- [ ] **Step 4.3: Create `apps/api/src/bootstrap/error-handler.ts`.**

```ts
import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Installs the global Fastify error handler.
 *
 * Behavior:
 * - 5xx: in production, `error` is scrubbed to "Internal server error" (no
 *   leaking of DB query strings, file paths, stack traces). In development,
 *   the original `error.message` and `error.stack` are passed through so the
 *   dashboard banner and DevTools surface the real cause.
 * - 4xx: `error.message` is always passed through (client error, no scrub).
 *
 * The full error object is always written server-side via `app.log.error`.
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const isProd = process.env.NODE_ENV === "production";

    if (statusCode >= 500) {
      app.log.error(error);
    }

    const message =
      statusCode >= 500
        ? isProd
          ? "Internal server error"
          : (error.message ?? "Internal server error")
        : (error.message ?? "Error");

    const body: { error: string; statusCode: number; stack?: string } = {
      error: message,
      statusCode,
    };
    if (statusCode >= 500 && !isProd && error.stack) {
      body.stack = error.stack;
    }

    return reply.code(statusCode).send(body);
  });
}
```

- [ ] **Step 4.4: Run the test to confirm it passes.**

Run: `pnpm --filter @switchboard/api test -- bootstrap/error-handler`

Expected: PASS — three test cases.

- [ ] **Step 4.5: Replace the inline error handler in `app.ts` with the extracted call.**

In `apps/api/src/app.ts`, lines 160-172 currently contain:

```ts
// Global error handler — consistent error format, no stack leaks in production
app.setErrorHandler((error: FastifyError, _request, reply) => {
  const statusCode = error.statusCode ?? 500;
  const message = statusCode >= 500 ? "Internal server error" : error.message;

  if (statusCode >= 500) {
    app.log.error(error);
  }

  return reply.code(statusCode).send({
    error: message,
    statusCode,
  });
});
```

Replace with:

```ts
// Global error handler — consistent error format. In production, 5xx messages
// are scrubbed; in development, the original message + stack pass through.
installErrorHandler(app);
```

Add the import near the other bootstrap imports at the top of the file:

```ts
import { installErrorHandler } from "./bootstrap/error-handler.js";
```

The unused `FastifyError` import (now only referenced inside the extracted module) can stay if it's used elsewhere in `app.ts`. Run `pnpm --filter @switchboard/api typecheck` after to confirm.

- [ ] **Step 4.6: Run typecheck.**

Run: `pnpm --filter @switchboard/api typecheck`

Expected: no errors. If TypeScript flags `FastifyError` as unused, remove it from the import line at the top of `app.ts`.

- [ ] **Step 4.7: Run the full API test suite.**

Run: `pnpm --filter @switchboard/api test`

Expected: all tests pass, including any pre-existing tests that exercise the error handler indirectly.

- [ ] **Step 4.8: Commit.**

```bash
git add apps/api/src/app.ts apps/api/src/bootstrap/error-handler.ts apps/api/src/bootstrap/__tests__/error-handler.test.ts
git commit -m "feat(api): include error message + stack in 5xx body when NODE_ENV !== production

Today the API scrubs 5xx error.message to 'Internal server error', which
leaves the dashboard with no diagnostic. Production keeps the scrub
(security: no leaking DB query strings, file paths, stack traces).
Development surfaces the real cause so dashboard banners and DevTools
show what actually broke. Extracts the handler into bootstrap/error-handler.ts
to make it directly unit-testable."
```

---

## Task 5: C2b — Dashboard `proxyError` logs body to stdout

**Goal:** Whenever `proxyError` returns a 5xx, the full upstream body is written to dashboard stdout via `console.error`. Existing pass-through behavior is unchanged (already correct once C2a populates a useful `error` field).

**Files:**

- Modify: `apps/dashboard/src/lib/proxy-error.ts:1-14`
- Modify: `apps/dashboard/src/lib/__tests__/proxy-error.test.ts` (append three cases)

### Steps

- [ ] **Step 5.1: Append the new failing tests to `proxy-error.test.ts`.**

Open `apps/dashboard/src/lib/__tests__/proxy-error.test.ts`. The existing `import` line is `import { describe, it, expect } from "vitest";` — extend it to also import `vi`:

```ts
import { describe, it, expect, vi } from "vitest";
```

Append the following three test cases inside the existing `describe("proxyError", ...)` block (i.e., before the final closing brace):

```ts
it("writes the full upstream body to console.error for 5xx responses", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  proxyError(
    { error: "OrganizationConfig.upsert failed", statusCode: 500, stack: "Error: …\n  at …" },
    500,
  );
  expect(errorSpy).toHaveBeenCalledTimes(1);
  expect(errorSpy).toHaveBeenCalledWith(
    "[proxyError]",
    expect.objectContaining({
      statusCode: 500,
      body: expect.objectContaining({
        error: "OrganizationConfig.upsert failed",
        stack: expect.any(String),
      }),
    }),
  );
  errorSpy.mockRestore();
});

it("does not log to console.error for 4xx responses", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  proxyError({ error: "Bad input" }, 400);
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

it("regression: forwards a C2a-shaped dev-mode upstream error verbatim", async () => {
  // C2a (apps/api/src/bootstrap/error-handler.ts) sends this exact shape
  // for 5xx in NODE_ENV=development. Lock the contract: proxyError must
  // pass the `error` field through unchanged so the dashboard banner reads it.
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = proxyError(
    { error: "OrganizationConfig.upsert failed", statusCode: 500, stack: "Error: …" },
    500,
  );
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body).toEqual({ error: "OrganizationConfig.upsert failed", statusCode: 500 });
  errorSpy.mockRestore();
});
```

- [ ] **Step 5.2: Run the tests to confirm two of three fail.**

Run: `pnpm --filter @switchboard/dashboard test -- proxy-error`

Expected:
- The first two new cases (`writes the full upstream body`, `does not log`) FAIL — current `proxyError` never calls `console.error`.
- The third case (regression) PASSES — current `proxyError` already pass-throughs the `error` field.

- [ ] **Step 5.3: Modify `apps/dashboard/src/lib/proxy-error.ts` to add the log.**

Replace the file contents (currently 14 lines) with:

```ts
import { NextResponse } from "next/server";

export function proxyError(backendBody: unknown, fallbackStatus: number): NextResponse {
  const body =
    backendBody && typeof backendBody === "object" && "error" in backendBody
      ? (backendBody as { error: string; statusCode?: number; stack?: string })
      : null;

  const error = body?.error || "Request failed";
  const statusCode = body?.statusCode || fallbackStatus;

  if (statusCode >= 500) {
    console.error("[proxyError]", { statusCode, body: backendBody });
  }

  return NextResponse.json({ error, statusCode }, { status: statusCode });
}
```

The body shape of the response (`{ error, statusCode }`) is unchanged. The only added behavior is the conditional `console.error` for 5xx.

- [ ] **Step 5.4: Run the tests to confirm they all pass.**

Run: `pnpm --filter @switchboard/dashboard test -- proxy-error`

Expected: PASS — all five original cases plus three new cases (8 total).

- [ ] **Step 5.5: Run the full dashboard test suite.**

Run: `pnpm --filter @switchboard/dashboard test`

Expected: all tests pass. The dashboard is large; expect ~400+ tests.

- [ ] **Step 5.6: Run the dashboard preflight (typecheck + schema/db build chain).**

Run: `pnpm dashboard:preflight`

Expected: no errors.

- [ ] **Step 5.7: Commit.**

```bash
git add apps/dashboard/src/lib/proxy-error.ts apps/dashboard/src/lib/__tests__/proxy-error.test.ts
git commit -m "feat(dashboard): proxyError logs upstream body for 5xx

Pairs with the API-side C2a change. When the upstream API returns a
5xx, the full body (including the dev-mode message and stack) is
written to dashboard stdout — operators can scroll dashboard logs
instead of API logs to diagnose. The response body shape is unchanged;
banners read body.error which now carries the real cause in development."
```

---

## Task 6: CLAUDE.md doctrine update

**Goal:** A new contributor reading `CLAUDE.md` learns to run `pnpm worktree:init` after `git worktree add`.

**Files:**

- Modify: `CLAUDE.md:19-25` (the `## Branch & Worktree Doctrine` section).

### Steps

- [ ] **Step 6.1: Read the current Worktree Doctrine section.**

Run: `grep -n "Worktree" CLAUDE.md` — confirms the heading is at line 19 and existing bullets follow.

- [ ] **Step 6.2: Add the new bullet.**

In `CLAUDE.md`, locate the `## Branch & Worktree Doctrine` section. Find the existing bullet:

```markdown
- **Worktrees have a teardown step.** When the underlying branch merges or is deleted, remove the worktree the same day: `git worktree remove <path> && git worktree prune`.
```

Insert a new bullet **immediately above** it:

```markdown
- **Worktrees have a setup step.** After `git worktree add`, run `pnpm worktree:init` from the new worktree root. The script copies `.env`, kills stale dev-port listeners, and runs `pnpm db:migrate` if Postgres is reachable. See `scripts/worktree-init.sh`.
```

The order is now: branch doctrine → setup step → teardown step → branch context → pre-commit hook.

- [ ] **Step 6.3: Verify.**

Run: `grep -n -A 1 "setup step" CLAUDE.md`

Expected: shows the new bullet at the right line, with the correct content.

- [ ] **Step 6.4: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): worktree doctrine — run pnpm worktree:init after add

New contributors discover the bootstrap step from the doctrine, not just
from the predev hint. Pairs with scripts/worktree-init.sh added in the
same PR."
```

---

## After All Tasks

- [ ] **Open the PR.**

```bash
git push -u origin dx/worktree-bootstrap-and-error-visibility
gh pr create --title "chore(dx): worktree bootstrap + dashboard error visibility" --body "$(cat <<'EOF'
## Summary

Implements `docs/superpowers/specs/2026-05-02-worktree-bootstrap-and-error-visibility-design.md`. Six commits, one per layer, for clean bisect.

- **B1** — `scripts/worktree-init.sh` + `scripts/check-env.sh` + `pnpm worktree:init` + `predev` hint
- **B3** — API fail-fast on any missing `REQUIRED_ENV` var (currently `DATABASE_URL`, `NEXTAUTH_SECRET`)
- **B4** — API bootstrap DB sanity check (`SELECT 1`, 3s timeout)
- **C2a** — API `setErrorHandler` includes `error.message` + `error.stack` in 5xx body when `NODE_ENV !== "production"`
- **C2b** — Dashboard `proxyError` logs the full upstream body to stdout for 5xx
- **Docs** — CLAUDE.md Worktree Doctrine adds the setup step

## Persistence properties

- Adding a new required env var = one line in `REQUIRED_ENV`. No other code changes.
- `bootstrap-smoke` integration test fails the build if the env guard is reordered past Prisma init.
- `db-sanity` integration test fails the build if the SELECT 1 probe is removed.
- `error-handler.test.ts` fails the build if dev-mode passthrough is silently reverted.
- `proxy-error.test.ts` regression case fails the build if the dashboard stops forwarding the real cause.

## Test plan

- [ ] `pnpm --filter @switchboard/api test` — all green including `env`, `bootstrap-smoke`, `db-sanity`, `bootstrap/error-handler`
- [ ] `pnpm --filter @switchboard/dashboard test` — all green including new `proxy-error` cases
- [ ] `pnpm typecheck` — no errors
- [ ] Manual smoke: in a fresh worktree, delete `.env`, run `pnpm dev` — see the `pnpm worktree:init` hint. Run `pnpm worktree:init`, run `pnpm dev` again — `/console` loads.
- [ ] Manual smoke: in a fresh worktree, set `DATABASE_URL` to a dead host, run `pnpm dev` — API exits 1 with the actionable message.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Tear down the implementation worktree** after the PR merges:

```bash
git worktree remove .worktrees/dx-impl
git worktree prune
git push origin --delete dx/worktree-bootstrap-and-error-visibility
```

---

## Self-Review Checklist (run after the plan is committed)

**Spec coverage** — every requirement in the spec maps to a task:

| Spec section | Task |
|---|---|
| B1 — `scripts/worktree-init.sh` | Task 1 |
| B1' — `predev` env check | Task 1 |
| B3 — `REQUIRED_ENV` fail-fast | Task 2 |
| B4 — Bootstrap DB sanity | Task 3 |
| C2a — API dev-mode passthrough | Task 4 |
| C2b — Dashboard `proxyError` log | Task 5 |
| CLAUDE.md doctrine update | Task 6 |
| All test/regression cases in spec § Testing | Tasks 2–5 |
| All six commits in spec § Rollout | Tasks 1–6 |

**Type consistency:** `REQUIRED_ENV`, `assertRequiredEnv`, `installErrorHandler`, `proxyError` — names match across tasks. Test imports use `.js` extensions (ESM). `process.exit` is mocked via `vi.spyOn`.

**Placeholder scan:** no `TBD`/`TODO`/`fill in`. Every code block is complete and ready to paste.
