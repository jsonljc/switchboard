# Vercel / deploy hardening — design

**Date:** 2026-06-08
**Branch:** `chore/vercel-deploy-audit`
**Trigger:** Repeated production build failures reported as "Vercel" errors compiling `apps/api/src/app.ts`:

```
src/app.ts(43,1): error TS6133: 'Redis' is declared but its value is never read.
src/app.ts(59,12): error TS2709: Cannot use namespace 'Redis' as a type.
src/app.ts(523,7): error TS2352: Conversion of type 'Cartridge' to type 'GovernanceCartridge' ...
```

## Investigation summary (what is actually wrong)

A four-agent audit established the following with file-level evidence:

1. **The current repo is deploy-clean.** On `main` (`02f11ae1`), `apps/api/src/app.ts:43` is `import type Redis from "ioredis"` (used only in type position at line 59), and the `GovernanceCartridge` cast at `app.ts:522-525` is structurally sound. `pnpm --filter @switchboard/api typecheck` exits 0 after a normal build. None of the three errors reproduce.

2. **The errors cannot come from any committed version of `app.ts`.** `git log -S 'import Redis from "ioredis"' -- apps/api/src/app.ts` is empty — `app.ts` has used the `import type` form since the line was introduced (`18b6d710`). The value-import hits in old commits (`8c1e4838` et al.) live in `apps/api/src/middleware/idempotency.ts` and `guardrail-state/*.ts`, **not** `app.ts`. The `GovernanceCartridge` cast did not exist in old `app.ts` either. So an "old commit" of `app.ts` could not emit this exact error trio.

3. **Deployment topology:** Vercel builds **only the dashboard** (`apps/dashboard`, Next.js). `apps/api` and `apps/chat` deploy to **Render** (`render.yaml`, `Dockerfile.api`, `docs/runbooks/production-urls.md`). The dashboard does **not** depend on `@switchboard/api`, so a Vercel dashboard build never compiles `app.ts`. The failing `tsc`-on-`app.ts` build therefore runs on the **api host (Render)** or a local/CI tree — not on Vercel.

4. **Most consistent cause:** the api host built a **stale build cache or a dirty/old snapshot** (the classic "main is broken" false alarm: a tree where lower layers were not rebuilt, or a one-off edit that flipped `import type Redis` → `import Redis`). There is **no committed misconfiguration** driving it — no `vercel.json`, no `.vercel/`, no deploy hook, no CI deploy step.

**Conclusion:** the live failure is an **operational** host-side issue (clear cache + rebuild latest commit), not a code defect. This branch therefore (a) confirms the repo is clean, (b) ships safe, proactive hardening so an unpinned build environment can't reintroduce divergence, and (c) documents the operational fix as a runbook.

## In scope (changes this branch ships)

1. **Pin the build Node version.** Add a repo-root `.nvmrc` (`22`) and a permissive `engines.node` floor (`>=20.9.0`, Next 16's requirement) to root `package.json`. Vercel and Render both read these to select the build runtime, removing silent default-drift. The floor is intentionally open-ended (no upper bound) so local contributors on Node 24 are not warned; `.nvmrc` is what actually pins the hosted build to a Vercel-supported 22.x (Vercel does not offer a 24.x build runtime).

2. **Remove dead duplicate `headers()` in `apps/dashboard/next.config.mjs`.** The file declares `async headers()` twice in one object literal; the second (CSP `securityHeaders`) silently shadows the first. Deleting the dead first block is a **zero-behavior-change** cleanup of the deploy-critical config (the `X-DNS-Prefetch-Control` header in the dead block was never being served).

3. **Add `docs/runbooks/deploy-troubleshooting.md`** — the deployment topology, the operational fix steps for both hosts (Render for api/chat, Vercel for dashboard), the build-time env-var checklist for the dashboard, and the local deploy-parity command.

## Explicitly out of scope (and why)

- **No change to `apps/api/src/app.ts`.** It is correct. Forcing `as unknown as` on the cast would reduce type safety to fix an error that does not exist on `main`.
- **No `vercel.json` / no Prisma `postinstall`.** Prisma-generate-before-`next build` is a _theoretical_ risk, but the dashboard currently builds successfully on Vercel via the turbo `^build` chain. Adding `vercel.json` could override working Vercel-UI build settings and break a deploy that works today. Documented as a known risk in the runbook instead.
- **No TypeScript caret removal, no `crypto`→`node:crypto` rename.** Frozen-lockfile installs already pin TS `6.0.3`; the `crypto` imports resolve fine. Both are cosmetic and outside the deploy-blocking scope.

## Verification

- `pnpm --filter @switchboard/dashboard build` succeeds with the edited `next.config.mjs`.
- `pnpm --filter @switchboard/api typecheck` and `pnpm --filter @switchboard/dashboard typecheck` stay green.
- `pnpm install --frozen-lockfile` stays "up to date" (`.nvmrc`/`engines` do not touch the lockfile).
- No behavioral diff in served headers (manual review of `next.config.mjs`).
