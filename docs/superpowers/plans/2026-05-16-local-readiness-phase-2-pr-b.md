# Local Readiness Phase 2 — PR B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PR B of the local-readiness phase-2 spec — the dev readiness polish PR. Ships `pnpm dev:ready` (a probe that reports when the local dev stack is responsive) and, conditional on measured timing, appends a dashboard typecheck step to `pnpm local:verify:fast`.

**Architecture:** Two independent slices: (1) a new `scripts/dev-ready.ts` that polls the three local dev ports and prints per-port + aggregate ready signals; (2) a measurement-gated addition of `pnpm --filter @switchboard/dashboard typecheck` to the fast pre-flight chain. The B2 slice has a hard timing gate (warm ≤ 30s, cold ≤ 60s); if measurements exceed it, B2 is dropped from this PR and a follow-up issue tracks an ESLint-based alternative.

**Tech Stack:** TypeScript (tsx), Node 18+ `fetch`, Vitest. Existing patterns: `scripts/check-seed-counts.ts` (CLI entry + `process.argv[1] === fileURLToPath(import.meta.url)` guard), `scripts/local-verify-fast.ts` (step list + `spawnSync` per step), `scripts/__tests__/check-seed-counts.test.ts` (vitest, scripts-as-modules).

**Spec:** `docs/superpowers/specs/2026-05-16-local-readiness-phase-2-design.md` (PR #580), sections **PR B** (lines 98–114) and **Success criteria — PR B** (lines 135–138).

**Dependency on PR A:** None. Spec **Sequencing** §2 (line 151 in `docs/superpowers/specs/2026-05-16-local-readiness-phase-2-design.md`) explicitly states PR B "can ship in parallel with PR A review if convenient; carries no dependency on A." PR B branches from `origin/main`, not from PR A's branch. At plan-writing time, PR A (#588) is still **open** with a CI failure on `local:verify:fast`'s new `--strict-db` step (no `DATABASE_URL` in CI); PR B is unaffected.

---

## File Structure

**Created:**

- `docs/superpowers/plans/2026-05-16-local-readiness-phase-2-pr-b.md` — this file (lands on `main` via the plan PR, separate from impl)
- `scripts/dev-ready.ts` — probe script (Task 1 + Task 2)
- `scripts/__tests__/dev-ready.test.ts` — unit tests for `probeServices` (Task 1)

**Modified:**

- `package.json` (root) — adds `dev:ready` script entry (Task 3)
- `README.md` (root) — adds "Watching dev readiness" subsection under `#### Development` (Task 3)
- `scripts/local-verify-fast.ts` — appends dashboard typecheck step, **conditional on B2 measurement** (Task 5 → Task 6)

**Not created:** No new dashboard `/api/health` route. The dashboard already exposes a JSON health endpoint at `/api/dashboard/health` (`apps/dashboard/src/app/api/dashboard/health/route.ts`). The probe targets that existing endpoint, so this PR does not modify dashboard code.

---

## Probe Target Reference

The three endpoints the probe polls:

| Service   | Port | Path                    | Source                                                            |
| --------- | ---- | ----------------------- | ----------------------------------------------------------------- |
| API       | 3000 | `/health`               | `apps/api/src/app.ts:780` — shallow `{ status: "ok" }` JSON       |
| Chat      | 3001 | `/health`               | `apps/chat/src/main.ts:241` — shallow `{ status: "ok" }` JSON     |
| Dashboard | 3002 | `/api/dashboard/health` | `apps/dashboard/src/app/api/dashboard/health/route.ts` — JSON 200 |

All three return 200 with a JSON body on success; the probe treats any 2xx as ready. No new endpoints are introduced.

---

## Sequencing

Tasks are forward-only. Each task ends with a commit.

1. **B1 core — `probeServices` with TDD** (Task 1) — pure logic + unit tests
2. **B1 CLI — wire `main()` + manual smoke** (Task 2) — entry point
3. **B1 surface — package.json script + README** (Task 3) — operator-visible
4. **B2 measurement — baseline + with-typecheck** (Tasks 4 + 5) — record numbers, no commit until decision
5. **B2 decision** (Task 6) — KEEP (commit) or DROP (revert + open follow-up issue)
6. **Final verification + PR** (Task 7)

---

## Doctrine reminders for the implementer

- `git branch --show-current` before every commit. Confirm the active branch is `feat/local-readiness-phase-2-pr-b`.
- Commitlint enforces conventional-commits with a **100-character subject limit**. Keep titles short; put detail in the body.
- Pre-commit `lint-staged` runs `prettier --write` on staged `.md`/`.json`. Markdown reformats inside a commit are benign — re-stage and re-commit if needed.
- `dev-ready.ts` prints to stdout/stderr; CLAUDE.md forbids `console.log`. Use `console.warn`/`console.error` or guard intentional stdout with an inline `// eslint-disable-line no-console`. The existing pattern in `scripts/local-verify-fast.ts` is `/* eslint-disable no-console */` block-scoped around the print function — mirror that.

---

## Task 1: B1 — `scripts/dev-ready.ts` core probe (TDD)

**Files:**

- Create: `scripts/dev-ready.ts`
- Create: `scripts/__tests__/dev-ready.test.ts`

The `probeServices` function is pure logic with injected dependencies (`fetchImpl`, `now`, `sleep`, `log`, `errLog`), so the unit tests run synchronously without real network or wall-clock waits. The CLI wrapper (`main()`) is added in Task 2 — keep this task focused on the testable core.

### Step 1: Create the test file with four failing tests

- [ ] Create `scripts/__tests__/dev-ready.test.ts` with this exact content:

```typescript
import { describe, it, expect } from "vitest";
import { probeServices, type ProbeDeps, type ProbeTarget } from "../dev-ready.js";

const TARGETS: ProbeTarget[] = [
  { port: 3000, path: "/health" },
  { port: 3001, path: "/health" },
  { port: 3002, path: "/api/dashboard/health" },
];

function makeFakeDeps(overrides: Partial<ProbeDeps> = {}): {
  deps: ProbeDeps;
  logs: string[];
  errs: string[];
  clock: { value: number };
} {
  const logs: string[] = [];
  const errs: string[] = [];
  const clock = { value: 0 };
  const deps: ProbeDeps = {
    fetchImpl: async () => ({ ok: true }),
    intervalMs: 100,
    timeoutMs: 1_000,
    fetchTimeoutMs: 100,
    log: (m) => logs.push(m),
    errLog: (m) => errs.push(m),
    now: () => clock.value,
    sleep: async (ms: number) => {
      clock.value += ms;
    },
    ...overrides,
  };
  return { deps, logs, errs, clock };
}

describe("probeServices", () => {
  it("reports all ports ready when fetch succeeds on the first cycle", async () => {
    const { deps, logs, errs } = makeFakeDeps();
    const result = await probeServices(TARGETS, deps);
    expect(result.allReady).toBe(true);
    expect([...result.readyPorts].sort()).toEqual([3000, 3001, 3002]);
    expect(result.timedOutPorts).toEqual([]);
    expect(logs).toEqual(
      expect.arrayContaining([":3000 ready", ":3001 ready", ":3002 ready", "All services ready ✓"]),
    );
    expect(errs).toEqual([]);
  });

  it("times out and prints a recovery hint per unready port when nothing responds", async () => {
    const { deps, logs, errs } = makeFakeDeps({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await probeServices(TARGETS, deps);
    expect(result.allReady).toBe(false);
    expect(result.readyPorts).toEqual([]);
    expect([...result.timedOutPorts].sort()).toEqual([3000, 3001, 3002]);
    expect(logs).not.toContain("All services ready ✓");
    expect(errs).toContain("Timed out waiting for :3000 — is `pnpm dev` running?");
    expect(errs).toContain("Timed out waiting for :3001 — is `pnpm dev` running?");
    expect(errs).toContain("Timed out waiting for :3002 — is `pnpm dev` running?");
  });

  it("reports timeout only for unready ports when some succeed", async () => {
    const { deps, logs, errs } = makeFakeDeps({
      fetchImpl: async (url: string) => {
        if (url.includes(":3000")) return { ok: true };
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await probeServices(TARGETS, deps);
    expect(result.allReady).toBe(false);
    expect(result.readyPorts).toEqual([3000]);
    expect([...result.timedOutPorts].sort()).toEqual([3001, 3002]);
    expect(logs).toContain(":3000 ready");
    expect(logs).not.toContain("All services ready ✓");
    expect(errs).toContain("Timed out waiting for :3001 — is `pnpm dev` running?");
    expect(errs).toContain("Timed out waiting for :3002 — is `pnpm dev` running?");
  });

  it("treats a non-2xx response as not-ready and continues polling until success", async () => {
    let cycle = 0;
    const { deps, logs } = makeFakeDeps({
      intervalMs: 50,
      timeoutMs: 5_000,
      fetchImpl: async () => {
        // First two cycles return ok:false (e.g. 503 during boot); third returns ok:true.
        cycle++;
        return { ok: cycle > 6 };
      },
    });
    const result = await probeServices(TARGETS, deps);
    expect(result.allReady).toBe(true);
    expect(logs).toContain("All services ready ✓");
  });
});
```

### Step 2: Run the test to confirm it fails

Run: `pnpm exec vitest run scripts/__tests__/dev-ready.test.ts`

Expected: Tests fail because `scripts/dev-ready.ts` does not exist yet (module-not-found error). This matches the project convention used by `scripts/__tests__/check-seed-counts.test.ts`.

### Step 3: Implement `probeServices` and supporting types

- [ ] Create `scripts/dev-ready.ts` with this exact content:

```typescript
#!/usr/bin/env tsx
/**
 * Polls local dev services until ready, or times out.
 *
 * Targets: :3000/health (api), :3001/health (chat),
 *          :3002/api/dashboard/health (dashboard).
 *
 * Polls each at 500ms intervals. Prints `:PORT ready` per-port as each
 * becomes responsive and `All services ready ✓` once all three respond.
 * On 90s timeout, prints a recovery hint per still-unready port and
 * exits non-zero.
 *
 * Designed as an optional companion to `pnpm dev` in a second terminal pane.
 */

export interface ProbeTarget {
  port: number;
  path: string;
}

export interface ProbeDeps {
  fetchImpl: (url: string, signal: AbortSignal) => Promise<{ ok: boolean }>;
  intervalMs: number;
  timeoutMs: number;
  fetchTimeoutMs: number;
  log: (msg: string) => void;
  errLog: (msg: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface ProbeResult {
  allReady: boolean;
  readyPorts: number[];
  timedOutPorts: number[];
}

export const DEFAULT_TARGETS: ProbeTarget[] = [
  { port: 3000, path: "/health" },
  { port: 3001, path: "/health" },
  { port: 3002, path: "/api/dashboard/health" },
];

export async function probeServices(targets: ProbeTarget[], deps: ProbeDeps): Promise<ProbeResult> {
  const start = deps.now();
  const ready = new Set<number>();

  while (deps.now() - start < deps.timeoutMs) {
    const unready = targets.filter((t) => !ready.has(t.port));
    await Promise.all(
      unready.map(async (t) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deps.fetchTimeoutMs);
        try {
          const res = await deps.fetchImpl(
            `http://localhost:${t.port}${t.path}`,
            controller.signal,
          );
          if (res.ok && !ready.has(t.port)) {
            ready.add(t.port);
            deps.log(`:${t.port} ready`);
          }
        } catch {
          // Connection refused, aborted, or other transient error — keep polling.
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    if (ready.size === targets.length) {
      deps.log("All services ready ✓");
      return {
        allReady: true,
        readyPorts: [...ready],
        timedOutPorts: [],
      };
    }
    await deps.sleep(deps.intervalMs);
  }

  const timedOut = targets.filter((t) => !ready.has(t.port)).map((t) => t.port);
  for (const port of timedOut) {
    deps.errLog(`Timed out waiting for :${port} — is \`pnpm dev\` running?`);
  }
  return {
    allReady: false,
    readyPorts: [...ready],
    timedOutPorts: timedOut,
  };
}
```

Notes for the implementer:

- The `#!/usr/bin/env tsx` shebang is on line 1 — match `scripts/check-seed-counts.ts`. The file is executed via `npx tsx`, not directly.
- `fetchImpl` returns `{ ok: boolean }` (a structural subset of `Response`). This keeps tests free of full `Response` mocking.
- The `!ready.has(t.port)` guard inside the success branch is belt-and-suspenders: `unready` already excludes ready targets, but the guard prevents a duplicate log if two cycles overlap (defensive, costs nothing).
- The fetch-level `AbortController` with `fetchTimeoutMs` (1s default in Task 2) prevents a hung TCP connection from blocking a probe cycle. Without it, a service that accepts a connection but never responds would freeze the probe.

### Step 4: Run the test to confirm it passes

Run: `pnpm exec vitest run scripts/__tests__/dev-ready.test.ts`

Expected: All four tests pass.

### Step 5: Confirm typecheck + lint pass for the new files

Run: `pnpm typecheck`
Expected: PASS (no new errors).

Run: `pnpm lint`
Expected: PASS (no new warnings/errors).

If lint flags `no-console` on a future Task 2 addition, that gets addressed there — Task 1 should be lint-clean as written (no `console.*` calls in `probeServices`; all output goes through injected `log`/`errLog`).

### Step 6: Commit

- [ ] Verify branch: `git branch --show-current` should report `feat/local-readiness-phase-2-pr-b`.

```bash
git add scripts/dev-ready.ts scripts/__tests__/dev-ready.test.ts
git commit -m "feat(local-readiness-phase-2): b1 — probeServices core + unit tests"
```

---

## Task 2: B1 — `dev-ready.ts` CLI entrypoint + manual smoke test

**Files:**

- Modify: `scripts/dev-ready.ts`

The pure `probeServices` from Task 1 needs a CLI wrapper that wires real defaults (`fetch`, `Date.now`, `setTimeout`) and translates the result to a process exit code.

### Step 1: Append `main()` + entry guard to `scripts/dev-ready.ts`

- [ ] Open `scripts/dev-ready.ts`. At the very top, **add** these two import lines below the existing JSDoc block (after the closing `*/` and before `export interface ProbeTarget`):

```typescript
import { fileURLToPath } from "node:url";
```

- [ ] At the bottom of the file, **after** the closing `}` of `probeServices`, append:

```typescript
/* eslint-disable no-console */
async function main(): Promise<void> {
  const result = await probeServices(DEFAULT_TARGETS, {
    fetchImpl: (url, signal) => fetch(url, { signal }),
    intervalMs: 500,
    timeoutMs: 90_000,
    fetchTimeoutMs: 1_000,
    log: (m) => console.log(m),
    errLog: (m) => console.error(m),
    now: () => Date.now(),
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  });
  process.exit(result.allReady ? 0 : 1);
}
/* eslint-enable no-console */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
```

Why the `process.argv[1] === fileURLToPath(import.meta.url)` guard: it ensures `main()` only runs when the script is invoked directly (e.g. `npx tsx scripts/dev-ready.ts`), not when imported by the test file. This matches the pattern at the bottom of `scripts/check-seed-counts.ts`.

### Step 2: Re-run the unit tests to confirm imports still resolve

Run: `pnpm exec vitest run scripts/__tests__/dev-ready.test.ts`

Expected: All four tests still pass (no change in behavior; the test file imports only `probeServices` and its types).

### Step 3: Verify typecheck + lint

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS. The `console.log` / `console.error` calls inside `main()` are scoped by the `/* eslint-disable no-console */` block, matching the pattern in `scripts/local-verify-fast.ts`.

### Step 4: Manual smoke test (record the result)

This is the only step in PR B that exercises real network I/O. It's a manual sanity check, not an automated test — but it's worth doing once to confirm the probe behaves as designed.

- [ ] In terminal A, from a freshly-prepared dev environment (DB seeded, env files set), run: `pnpm dev`

- [ ] In terminal B, from the repo root, run: `npx tsx scripts/dev-ready.ts`

Expected within ~30s of `pnpm dev` starting:

```
:3000 ready
:3001 ready
:3002 ready
All services ready ✓
```

(Lines may interleave in any order as each port comes up; `All services ready ✓` should be last.)

- [ ] Stop `pnpm dev` in terminal A, then in terminal B re-run: `npx tsx scripts/dev-ready.ts`

Expected after 90s:

```
Timed out waiting for :3000 — is `pnpm dev` running?
Timed out waiting for :3001 — is `pnpm dev` running?
Timed out waiting for :3002 — is `pnpm dev` running?
```

Exit code should be non-zero (`echo $?` reports `1`).

If either smoke scenario fails to match, debug before committing. Common causes:

- Dashboard takes >90s to compile on cold cache — bump the timeout argument locally for the manual test (do not change the default; 90s is the spec-mandated default).
- A different process is bound to one of the ports — `lsof -iTCP:3000 -sTCP:LISTEN` to identify the squatter.
- `/api/dashboard/health` returns a non-2xx because `SWITCHBOARD_API_URL` is unset — the route still returns 200 in that case (it just reports `backend: "unconfigured"`), so this should not block readiness. If it does, inspect the route handler.

### Step 5: Commit

```bash
git add scripts/dev-ready.ts
git commit -m "feat(local-readiness-phase-2): b1 — dev-ready CLI entrypoint + smoke verified"
```

---

## Task 3: B1 — Wire `pnpm dev:ready` script + README docs

**Files:**

- Modify: `package.json` (root)
- Modify: `README.md` (root)

### Step 1: Add the `dev:ready` script to `package.json`

- [ ] Open `package.json`. In the `"scripts"` object, find the line:

```json
    "dev": "turbo dev",
```

- [ ] Add a new line immediately after it:

```json
    "dev:ready": "npx tsx scripts/dev-ready.ts",
```

Resulting fragment:

```json
    "dev": "turbo dev",
    "dev:ready": "npx tsx scripts/dev-ready.ts",
    "predev": "bash scripts/check-env.sh",
```

Naming rationale: `dev:ready` is symmetric with `local:verify` / `local:verify:fast` (subject:qualifier). It is NOT named `dev:wait` because that implies a blocking wrapper around `pnpm dev`; the probe is an independent companion command.

### Step 2: Verify the script is registered

Run: `pnpm run dev:ready --help 2>&1 | head -1` (just checks the script resolves)

Expected: Either probe output or a clean exit — whatever `tsx scripts/dev-ready.ts` produces when no dev stack is running. Should NOT error with "missing script".

### Step 3: Add "Watching dev readiness" subsection to `README.md`

- [ ] Open `README.md`. Find the `#### Development` heading at line 149 and read through the existing `pnpm dev` block (lines 149–159).

- [ ] Immediately after the existing paragraph that begins `\`apps/chat\` warns ...` (line 159), insert a blank line and then this new subsection:

````markdown
##### Watching dev readiness

In a second terminal pane after starting `pnpm dev`:

```bash
pnpm dev:ready
```

Polls `:3000/health`, `:3001/health`, and `:3002/api/dashboard/health` at 500ms intervals. Prints `:<port> ready` as each service responds and `All services ready ✓` when all three are up. Times out after 90 seconds with a recovery hint per still-unready port. Optional — useful when a slow cold-cache compile makes it ambiguous whether `pnpm dev` is still booting or actually broken.
````

> The `#####` heading (h5) sits under the `#### Development` (h4) heading. If the immediately-following section uses a different heading level, match this insertion to fit naturally — but do not promote it to `####`; "Watching dev readiness" is a sub-topic of Development, not a peer.

### Step 4: Verify the markdown is prettier-clean

Run: `npx prettier --check README.md package.json`

Expected: PASS (both files report `All matched files use Prettier code style!`). The root `pnpm format:check` only covers `*.ts` (see `package.json` scripts), so check `.md` / `.json` directly here. The pre-commit `lint-staged` hook will reformat them on commit if needed — if it does, re-stage and re-commit. Knowing the file is clean before commit avoids a noisy double-commit.

### Step 5: Commit

```bash
git add package.json README.md
git commit -m "feat(local-readiness-phase-2): b1 — wire pnpm dev:ready + readme docs"
```

---

## Task 4: B2 — Baseline measurement of `pnpm local:verify:fast`

**Files:** None modified. This is a pure measurement task — record numbers, do not commit code.

The B2 acceptance gate (spec line 112) is:

- **Warm:** total wall-clock of `pnpm local:verify:fast` ≤ 30s
- **Cold:** total wall-clock of `pnpm local:verify:fast` ≤ 60s

Both must hold for B2 to be included. This task captures the **baseline** (without B2's added step) so the cost of B2 is visible in the PR description.

### Step 1: Cold baseline

- [ ] From a known-warm dev environment (so the cold reset is the only cache miss), run:

```bash
pnpm clean
pnpm install
time pnpm local:verify:fast
```

Record the `real` time. If `pnpm local:verify:fast` fails for unrelated reasons (e.g. missing `DATABASE_URL` after PR A's `--strict-db` lands — but PR A has NOT merged at the time of this plan, so this should not happen on `origin/main`), debug before continuing.

> If PR A (#588) has merged by the time you measure, `pnpm local:verify:fast` will fail without a configured DB. In that case, ensure `DATABASE_URL` is set and Postgres is reachable before measuring. The measurement is meaningful only when the chain runs end-to-end.

### Step 2: Warm baseline (3 runs, take minimum)

- [ ] Run the verify three more times back-to-back:

```bash
time pnpm local:verify:fast
time pnpm local:verify:fast
time pnpm local:verify:fast
```

Record the `real` time of each. Take the minimum as the warm baseline (most representative of steady-state developer experience; outliers from disk noise are filtered).

### Step 3: Record the numbers

- [ ] In a scratch file or directly in the eventual PR description draft, note:

```
Baseline (without dashboard typecheck):
  cold real: <Xs>
  warm runs: <as>, <bs>, <cs>  (min = <Ms>)
```

This task ends without a commit. Numbers feed Task 5's comparison.

---

## Task 5: B2 — Append dashboard typecheck step + re-measure

**Files:**

- Modify: `scripts/local-verify-fast.ts`

### Step 1: Add the dashboard typecheck step to the `STEPS` array

- [ ] Open `scripts/local-verify-fast.ts`. Find the `STEPS` array (currently 5 entries: `env-completeness`, `live-flag-manifest`, `arch:check`, `route-ingress`, `seed-counts`).

- [ ] Append a sixth entry **after** `seed-counts`:

```typescript
  {
    name: "dashboard:typecheck",
    cmd: "pnpm",
    args: ["--filter", "@switchboard/dashboard", "typecheck"],
  },
```

Why last in the list: dashboard typecheck is the slowest step and runs only after the cheaper structural checks have passed. If any earlier step fails, we don't pay the typecheck cost.

> **What this step actually runs:** `apps/dashboard`'s `typecheck` script is `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/db build && tsc --noEmit`. On a warm cache the schema + db builds are turbo-cache no-ops; on a cold cache they're real builds. This is the biggest cold-vs-warm variance — call it out in the measurement record so reviewers understand what is being timed.

> If PR A's `--strict-db` change has merged before this measurement, the `seed-counts` step will need a `--strict-db` flag in `args`. Do not assume that change is in place; inspect `STEPS[4]` before modifying.

### Step 2: Cold measurement with dashboard typecheck

- [ ] Run:

```bash
pnpm clean
pnpm install
time pnpm local:verify:fast
```

Record the `real` time. Confirm the new `dashboard:typecheck` line appears in the output.

### Step 3: Warm measurement (3 runs, take minimum)

- [ ] Run three more times:

```bash
time pnpm local:verify:fast
time pnpm local:verify:fast
time pnpm local:verify:fast
```

Record the `real` of each; take the minimum as the warm number.

### Step 4: Record the numbers next to the baseline

- [ ] Update the scratch notes from Task 4 Step 3:

```
With dashboard typecheck:
  cold real: <Xs>     (gate: ≤ 60s)
  warm runs: <as>, <bs>, <cs>  (min = <Ms>, gate: ≤ 30s)
```

**Do not commit yet.** The commit decision is Task 6.

---

## Task 6: B2 — Decision and either KEEP or DROP

**Decision gate (both must hold):**

- Cold ≤ 60 s
- Warm minimum ≤ 30 s

### Step 1: Evaluate the gate

- [ ] Compare Task 5 Step 4 numbers against the gate.

If **both** thresholds are met: proceed to Step 2a (KEEP).
If **either** threshold is exceeded: proceed to Step 2b (DROP).

### Step 2a: KEEP path — commit B2

- [ ] Verify branch: `git branch --show-current` should be `feat/local-readiness-phase-2-pr-b`.

- [ ] Stage and commit, embedding the measurement in the commit body:

```bash
git add scripts/local-verify-fast.ts
git commit -m "$(cat <<'EOF'
feat(local-readiness-phase-2): b2 — dashboard typecheck in local:verify:fast

Measurement (acceptance gate: cold ≤60s, warm ≤30s):
  Baseline:    cold <Xs>, warm <Ms>
  With B2:     cold <Xs>, warm <Ms>
EOF
)"
```

Replace the `<Xs>` / `<Ms>` placeholders with the actual recorded values from Tasks 4 and 5.

### Step 2b: DROP path — revert and open follow-up issue

- [ ] Revert the Task 5 change:

```bash
git checkout scripts/local-verify-fast.ts
```

Confirm with `git status` that `scripts/local-verify-fast.ts` is no longer modified.

- [ ] Open a follow-up GitHub issue tracking the ESLint alternative (per spec line 114):

```bash
gh issue create --title "Local readiness: ESLint rule forbidding .js extensions in dashboard relative imports" --body "$(cat <<'EOF'
PR B's measurement (see plan `docs/superpowers/plans/2026-05-16-local-readiness-phase-2-pr-b.md` Task 5) showed that appending `pnpm --filter @switchboard/dashboard typecheck` to `pnpm local:verify:fast` exceeded the acceptance gate (cold ≤60s, warm ≤30s).

Recorded numbers:
  Baseline:    cold <Xs>, warm <Ms>
  With B2:     cold <Xs>, warm <Ms>  (over gate)

The spec (line 113) notes that dashboard typecheck does NOT close the `.js`-extension regression gap anyway — Next.js rejects `.js` even when `tsc` accepts them. The cheaper, more-targeted alternative (spec line 114) is an ESLint rule forbidding `.js` extensions in dashboard relative imports.

Scope:
- ESLint rule (project-local or via existing eslint-plugin-import) that errors when any `import` statement inside `apps/dashboard/src/**/*.{ts,tsx}` has a `from "./foo.js"` or `from "@/foo.js"` form.
- Add to the dashboard's ESLint config so `pnpm lint` catches the regression.
- No verify-script change required — `pnpm lint` already runs in CI.

Spec reference: `docs/superpowers/specs/2026-05-16-local-readiness-phase-2-design.md` lines 109–114.
Related memory: `feedback_dashboard_no_js_on_any_import.md`.
EOF
)" --label "local-readiness,follow-up"
```

Replace the `<Xs>` / `<Ms>` placeholders. Capture the issue URL — it goes in the PR description.

- [ ] No commit on this branch for the DROP path — `scripts/local-verify-fast.ts` is untouched relative to `origin/main`.

### Step 3: Self-check before Task 7

- [ ] If KEEP: `git log --oneline origin/main..HEAD` should show 4 commits (Tasks 1, 2, 3, 6).
- [ ] If DROP: `git log --oneline origin/main..HEAD` should show 3 commits (Tasks 1, 2, 3) — no B2 commit.

---

## Task 7: Final verification + open PR

### Step 1: Run the full local verification chain

- [ ] Run each in order; fix any failures before proceeding:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm local:verify:fast
```

All five must report PASS. For `pnpm local:verify:fast`, ensure `DATABASE_URL` is set and Postgres is reachable (matches the gate this PR helps enforce).

### Step 2: Push the branch

```bash
git push -u origin feat/local-readiness-phase-2-pr-b
```

### Step 3: Open the PR

- [ ] Determine the title based on Task 6 outcome:
  - KEEP: `feat(local-readiness-phase-2): pr-b — dev:ready probe + dashboard typecheck in fast verify`
  - DROP: `feat(local-readiness-phase-2): pr-b — dev:ready probe (dashboard typecheck deferred)`

- [ ] Open the PR with a body that embeds the measurement:

```bash
gh pr create --base main --title "<the title from above>" --body "$(cat <<'EOF'
## Summary

Implements PR B of the local-readiness-phase-2 spec — the dev readiness polish PR.

### B1 — `pnpm dev:ready` probe

New `scripts/dev-ready.ts` polls `:3000/health` (api), `:3001/health` (chat), and `:3002/api/dashboard/health` (dashboard) at 500ms intervals. Prints per-port `:<port> ready` lines and an aggregate `All services ready ✓`. Times out after 90s with a recovery hint per still-unready port. Optional companion to `pnpm dev` in a second terminal pane.

### B2 — Dashboard typecheck in `pnpm local:verify:fast`

[If KEEP] Appended `pnpm --filter @switchboard/dashboard typecheck` as the last step of the fast verify chain.

[If DROP] Measurement exceeded the spec's acceptance gate (cold ≤60s, warm ≤30s); dropped from this PR. Follow-up issue #<NNN> tracks the ESLint-rule alternative.

### Measurement

```

Baseline: cold <Xs>, warm <Ms>
With B2: cold <Xs>, warm <Ms>
Gate: cold ≤60s, warm ≤30s
Outcome: [KEEP / DROP]

```

## Dependency on PR A

None. Spec **Sequencing** §2 explicitly notes PR B carries no dependency on PR A. Branched from `origin/main`.

## Test plan

- [ ] `pnpm typecheck` passes locally
- [ ] `pnpm lint` passes locally
- [ ] `pnpm test` passes locally (new `scripts/__tests__/dev-ready.test.ts` runs in vitest)
- [ ] `pnpm format:check` passes locally
- [ ] `pnpm local:verify:fast` passes locally with DB reachable
- [ ] Manual smoke: `pnpm dev` in terminal A, `pnpm dev:ready` in terminal B → all three ready
- [ ] Manual smoke: no `pnpm dev` running → 90s timeout with recovery hints, exit non-zero

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Replace placeholders before running the command.

### Step 4: Capture the PR URL in the session

- [ ] Note the PR number from `gh pr create` output. Pass it back to the user.

---

## Out of Scope

Excluded per spec:

- PR A (worktree-init hardening, `pnpm local:setup`, three-state `check-seed-counts`, SYNC-FROM-ROOT docs, allowlist temp-entry rule) — separate plan, separate impl PR.
- Dashboard `/api/health` new route — not added; existing `/api/dashboard/health` is used instead (spec line 104 allowed adding one but flagged it as "not required"; the existing endpoint makes a new one redundant).
- ESLint `.js`-extension rule for dashboard imports — only created as a GitHub issue if B2 is dropped (Task 6 Step 2b); not implemented in this PR.
- All Out-of-Scope items from the spec (Issue #472, route migrations, live-flag matrix cross-check, deprecated env-var sunset, multi-env env vars).

---

## Spec Coverage Self-Check

| Spec section                                           | Plan task                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| B1 New `scripts/dev-ready.ts` polling 3 ports          | Task 1 Step 3 + Task 2 Step 1                                   |
| B1 500ms poll interval                                 | Task 2 Step 1 (`intervalMs: 500`)                               |
| B1 Per-port `:PORT ready` lines                        | Task 1 Step 3 (`deps.log(...)`)                                 |
| B1 Aggregate `All services ready ✓`                    | Task 1 Step 3 (post-loop)                                       |
| B1 90s default timeout                                 | Task 2 Step 1 (`timeoutMs: 90_000`)                             |
| B1 Timeout message + exit non-zero                     | Task 1 Step 3 + Task 2 Step 1                                   |
| B1 Documented as optional second-terminal companion    | Task 3 Step 3 (README subsection)                               |
| B1 May add `/api/health` to dashboard (not required)   | NOT added; `/api/dashboard/health` already exists, used instead |
| B2 Append dashboard typecheck to `local:verify:fast`   | Task 5 Step 1                                                   |
| B2 Acceptance gate (warm ≤30s, cold ≤60s)              | Task 6 Step 1 + Task 4/5 Step 4                                 |
| B2 Drop if gate fails                                  | Task 6 Step 2b                                                  |
| B2 Caveat — typecheck ≠ Next.js `.js`-rejection        | Task 6 Step 2b (issue body)                                     |
| B2 Alternative: ESLint rule (follow-up if dropped)     | Task 6 Step 2b (issue creation)                                 |
| Success: `pnpm dev:ready` reports per-port + aggregate | Task 2 Step 4 (manual smoke)                                    |
| Success: timeout behavior when a port is stalled       | Task 2 Step 4 (second smoke case)                               |
| Success: B2 acceptance gate met OR feature dropped     | Task 6 Step 1                                                   |
