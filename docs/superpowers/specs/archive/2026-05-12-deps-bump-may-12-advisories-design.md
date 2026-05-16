# Deps Bump — May 12 Advisories Design

**Status:** Design 2026-05-12.
**Goal:** Unblock the 3 queued auto-merges (#436 spec, #437 plan, #438 implementation) of Alex SG/MY medspa Phase 1d by clearing the high-severity dependency advisories that landed on the dep tree between `main`'s last green CI run (2026-05-11 13:08 UTC) and the PR CI runs (2026-05-12 01:30–03:14 UTC).

## 1. Problem

The CI `security` job runs `pnpm audit --audit-level=high` (`.github/workflows/ci.yml`). It currently fails on all 3 queued PRs AND would fail on `main` if re-run today. The failure is dep-tree-level, not code-level — none of the 3 PRs modify `pnpm-lock.yaml`. New advisories were published since main's last scan:

- **17 high-severity advisories on `next`** — fixed at `>=15.5.18` (for the 15.x line, pulled transitively by `inngest@4.2.4`) and `>=16.2.6` (for the 16.x line, used by `apps/dashboard`).
- **3 high-severity advisories on `@opentelemetry/*`** — `sdk-node`, `exporter-prometheus`, `auto-instrumentations-node`. Pulled transitively by Sentry / inngest; not direct deps anywhere.

A further 16 moderate + 5 low advisories exist (`hono`, `ip-address`, `@anthropic-ai/sdk`, `postcss`, more `next` issues) but **CI does not gate on them**. They are out of scope for this PR.

## 2. Goal

Make CI's `security` job exit 0 by bumping the `pnpm.overrides` floors for the 20 high-severity packages. No code changes. No direct-dep version bumps. Single-file edit + lockfile regen + commit + PR.

The success signal is `pnpm audit --audit-level=high` exiting 0 (which is what CI runs).

## 3. Non-goals

- Moderate / low advisories (`hono`, `ip-address`, `@anthropic-ai/sdk`, `postcss`, etc.). Deferred to a follow-up PR.
- The `@anthropic-ai/sdk` 0.82 → 0.91 upgrade. 9 minor versions on a pre-1.0 SDK; very likely has API-surface changes that need code changes at the call sites. Out of scope for "unblock the merges"; warrants its own brainstorm/plan cycle.
- Sweeping refactor of the existing `pnpm.overrides` block. Only the entries that need to change are touched; existing pins (`minimatch`, `rollup`, `flatted`, `esbuild`, `effect`, `picomatch`, `path-to-regexp`, `protobufjs`, `fastify`, `fast-uri`, `lodash`, etc.) are preserved verbatim.
- Major-version bumps of `next` (no `15 → 16` or `16 → 17` migration). All bumps are patch-level on their existing major.
- Code changes anywhere. If a peer-dep conflict surfaces during `pnpm install`, the only acceptable mitigation is adding a `pnpm.peerDependencyRules.allowedVersions` entry (still config-only).

## 4. Change

Single-file edit to root `package.json` `pnpm.overrides`:

```jsonc
"pnpm": {
  "overrides": {
    "next@<15.5.18": "15.5.18",                                    // was <15.5.15 → 15.5.15
    "next@>=16.0.0 <16.2.6": "16.2.6",                             // NEW — covers dashboard 16.x line
    "@opentelemetry/sdk-node@<0.217.0": "0.217.0",                 // NEW
    "@opentelemetry/exporter-prometheus@<0.217.0": "0.217.0",      // NEW
    "@opentelemetry/auto-instrumentations-node@<0.75.0": "0.75.0", // NEW
    // every existing entry below preserved as-is
    "minimatch@<3.1.4": "3.1.4",
    "minimatch@>=9.0.0 <9.0.7": "9.0.7",
    "minimatch@>=10.0.0 <10.2.3": "10.2.3",
    "rollup@>=4.0.0 <4.59.0": "4.59.0",
    "flatted@<=3.4.1": "3.4.2",
    "esbuild@<0.25.0": "0.25.0",
    "effect@<3.20.0": "3.20.0",
    "picomatch@<2.3.2": "2.3.2",
    "picomatch@>=4.0.0 <4.0.4": "4.0.4",
    "path-to-regexp@>=8.0.0 <8.4.0": "8.4.0",
    "protobufjs@<7.5.5": "7.5.5",
    "fastify@>=5.3.2 <5.8.5": "5.8.5",
    "fast-uri@<3.1.2": "3.1.2",
    "lodash@>=4.0.0 <4.18.0": "4.18.0"
  }
}
```

After the edit, `pnpm install` regenerates the lockfile.

### Why these specific values

| Override                                                     | Source advisory                                                                                                    | Why patch-bump is safe                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next@<15.5.18 → 15.5.18`                                    | 13 advisories pin `>=15.5.18`; some pin `>=15.5.16` (older fix that was superseded). 15.5.18 covers everything.    | Patch release on 15.x. Pulled transitively by `inngest@4.2.4` whose peer is `next >=14`. 15.5.18 satisfies the peer.                                                                                                                                      |
| `next@>=16.0.0 <16.2.6 → 16.2.6`                             | 4 advisories pin `>=16.2.6`; some pin `>=16.2.5` (superseded). 16.2.6 covers everything.                           | Patch release on 16.x. Dashboard's `^16.2.4` already accepts 16.2.6. `next-auth`'s peer (`>=15`) and `@sentry/nextjs`'s peer (`>=14`) both satisfied.                                                                                                     |
| `@opentelemetry/sdk-node@<0.217.0 → 0.217.0`                 | All 3 OTel advisories pin `>=0.217.0` (sdk-node + exporter-prometheus) or `>=0.75.0` (auto-instrumentations-node). | Pre-1.0 package, minor bump. Pulled transitively by Sentry / inngest; not invoked from our code. Sentry's peer for SDK is `>=0.x`. If the bump breaks Sentry's peer, the install will fail loud and we add a `peerDependencyRules.allowedVersions` entry. |
| `@opentelemetry/exporter-prometheus@<0.217.0 → 0.217.0`      | Same advisory chain as sdk-node.                                                                                   | Same risk profile.                                                                                                                                                                                                                                        |
| `@opentelemetry/auto-instrumentations-node@<0.75.0 → 0.75.0` | One advisory.                                                                                                      | Same risk profile.                                                                                                                                                                                                                                        |

The existing `next@<15.5.15 → 15.5.15` override is REPLACED by the new `next@<15.5.18 → 15.5.18` entry; the floor moves up by 3 patch versions. No other existing override is touched.

## 5. Verification

In order, locally before pushing:

```bash
pnpm install                                       # regen lockfile
pnpm audit --audit-level=high                      # MUST exit 0 (this is the CI gate)
pnpm typecheck                                     # all 18 packages
pnpm lint                                          # all 16 lintable packages
pnpm test                                          # full suite (modulo the pre-existing pg_advisory_xact_lock flake per feedback_db_integrity_tests_pg_advisory_lock.md)
pnpm --filter @switchboard/dashboard build         # CI does NOT run this; Next 16.x patch bump warrants a smoke check
```

If any step fails (other than the documented db flake), STOP and investigate before pushing. Acceptable failure modes:

- `pnpm install` peer-dep conflict on an OTel bump → add `pnpm.peerDependencyRules.allowedVersions` entry, re-run install, re-verify.
- Dashboard build TS error from Next 16.2.6 type changes → unlikely on a patch bump, but if it happens, file the error and abort (escalate; out of scope to fix in a deps-bump PR).

If `pnpm audit --audit-level=high` still reports any high-severity hit after install, the override didn't take effect. Likely cause: an existing override entry has a wider range that masks the new one. Diff `pnpm-lock.yaml` to confirm the floor moved.

## 6. PR cadence

Per CLAUDE.md branch doctrine:

1. **This spec** lands on `main` as a focused docs-only PR (this file).
2. **Implementation plan** lands as a separate small PR (`docs/superpowers/plans/2026-05-12-deps-bump-may-12.md`). Short — the implementation is a config edit + 5 verification steps, so the plan is correspondingly compact.
3. **Implementation** lands as a `chore(deps): ...` PR. Squash-merge into main.

Once #3 merges, the queued auto-merges on #436, #437, #438 fire automatically on the next CI cycle.

## 7. Process / execution

- **Worktree:** new branch `chore/bump-deps-may-12-advisories` in `.worktrees/bump-deps-may-12`, off `main` (NOT off the 1d feature branch). Run `pnpm worktree:init` (copies `.env`, clears stale dev ports). Postgres unreachable is fine — no migrations involved.
- **Single commit** with both `package.json` and `pnpm-lock.yaml`. Subject: `chore(deps): bump next + @opentelemetry floors for may-12 advisories` (lowercase, ≤100 chars, Conventional Commits).
- **Author authority**: the spec preauthorizes adding `pnpm.peerDependencyRules.allowedVersions` entries inline if `pnpm install` errors out on peer-dep conflicts (per user approval in brainstorming). Any other unexpected issue (TS error, lint regression, test failure) escalates to user before proceeding.

## 8. Constraints

- ESM only (n/a for config files but a project invariant).
- Conventional Commits, lowercase subject ≤100 chars.
- Schema migration NOT required (no schema change).
- File size: `package.json` will grow by ~4 lines; well under any threshold.

## 9. Open questions resolved during brainstorming

| Question                    | Decision                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope of the deps-bump      | Minimum to unblock CI: 5 override entries covering the 20 high-severity advisories. Moderate / low advisories deferred.                                |
| `@anthropic-ai/sdk` upgrade | Out of scope. 9-minor SDK bump warrants its own brainstorm cycle; CI doesn't gate on it.                                                               |
| Peer-dep conflict handling  | If `pnpm install` errors on an OTel-related peer conflict, add a `pnpm.peerDependencyRules.allowedVersions` entry inline. Any other failure escalates. |
| Worktree placement          | `.worktrees/bump-deps-may-12` off `main` (NOT stacked on the 1d feature branch).                                                                       |

## 10. Prior art / gotchas

- `feedback_db_integrity_tests_pg_advisory_lock.md` — `prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` tests reliably flake on `pg_advisory_xact_lock` deserialization. Reproduces on `main`; not blocked on.
- `feedback_dashboard_build_not_in_ci.md` — CI does NOT run `next build` for the dashboard. A `next` patch bump should not break the build, but step 5 of §5 runs it locally as a defensive check.
- `feedback_prisma_migrate_dev_tty.md` — n/a (no schema change).
- The existing `pnpm.overrides` block in `package.json` already documents the floor-pin pattern (`pkg@<X.Y.Z → X.Y.Z`). This PR follows the existing convention exactly.
