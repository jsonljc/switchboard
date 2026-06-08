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

A four-agent audit plus the PR's own Vercel check established the following with file-level evidence:

1. **`apps/api` IS a Vercel project (`switchboard-api`), not only a Render service.** The audit inferred Render from `render.yaml`, but the PR's commit status shows a Vercel project `switchboard-api` building `apps/api` with `tsc`. That is the host emitting the three errors.

2. **The current source genuinely fails on Vercel's `tsc`, even though local `tsc` passes.** Local `pnpm --filter @switchboard/api typecheck` exits 0 on `main`, but the `switchboard-api` Vercel build of the same source (this branch) failed with the identical TS6133 / TS2709 / TS2352 trio. The divergence is the toolchain/resolution environment, not an old commit: Vercel's resolver treats the **default** import of ioredis's `Redis` as a namespace (→ TS2709 / TS6133), and checks the `Cartridge`→`GovernanceCartridge` cast more strictly than local (the `enrichContext` parameter types — `CartridgeContext` vs `Record<string, unknown>` — are method-bivariant-compatible locally but not under Vercel's evaluation → TS2352).

3. **`git log -S` confirms `app.ts` never had a _value_ `Redis` import** — so this is not an "old commit of app.ts" regression; it is a latent resolution-fragility in the current default-import form that only Vercel's `tsc` surfaces.

**Conclusion:** the fix is a real (small, safe) code change — make the ioredis imports and the governance-cartridge cast robust to Vercel's stricter resolution — plus the build-environment hardening and runbook below. The PR's live Vercel check is the verification gate.

## In scope (changes this branch ships)

1. **Make ioredis imports robust (the actual build fix).** Convert every `import [type] Redis from "ioredis"` (default import) to the **named** form `import [type] { Redis } from "ioredis"` across `apps/api` and `apps/chat`. ioredis 5.x exports `Redis` as both `default` and a named export (`export { default as Redis }`); the named form is unambiguously the class type/value and sidesteps the default-as-namespace resolution that fails on Vercel. Zero behavior change (named class === default class).

2. **Route the governance-cartridge cast through `unknown`.** `app.ts:523`: `... as unknown as GovernanceCartridge | null` — TS's own suggested fix for the TS2352 structural-overlap rejection. This is a deliberate downcast at a storage boundary (the store returns the generic `Cartridge | null`); going through `unknown` makes it resolution-independent.

3. **Pin the build Node version.** Add a repo-root `.nvmrc` (`22`) and a permissive `engines.node` floor (`>=20.9.0`, Next 16's requirement) to root `package.json`. Vercel and Render both read these to select the build runtime, removing silent default-drift. The floor is intentionally open-ended (no upper bound) so local contributors on Node 24 are not warned; `.nvmrc` is what actually pins the hosted build to a Vercel-supported 22.x (Vercel does not offer a 24.x build runtime).

4. **Remove dead duplicate `headers()` in `apps/dashboard/next.config.mjs`.** The file declares `async headers()` twice in one object literal; the second (CSP `securityHeaders`) silently shadows the first. Deleting the dead first block is a **zero-behavior-change** cleanup of the deploy-critical config (the `X-DNS-Prefetch-Control` header in the dead block was never being served).

5. **Add `docs/runbooks/deploy-troubleshooting.md`** — the deployment topology, the operational fix steps for both hosts (Render for api/chat, Vercel for dashboard), the build-time env-var checklist for the dashboard, and the local deploy-parity command.

## Explicitly out of scope (and why)

- **No `vercel.json` / no Prisma `postinstall`.** Prisma-generate-before-`next build` is a _theoretical_ risk, but the dashboard currently builds successfully on Vercel via the turbo `^build` chain. Adding `vercel.json` could override working Vercel-UI build settings and break a deploy that works today. Documented as a known risk in the runbook instead.
- **No TypeScript caret removal, no `crypto`→`node:crypto` rename.** Frozen-lockfile installs already pin TS `6.0.3`; the `crypto` imports resolve fine. Both are cosmetic and outside the deploy-blocking scope.

## Verification

- `pnpm --filter @switchboard/dashboard build` succeeds with the edited `next.config.mjs`.
- `pnpm --filter @switchboard/api typecheck` and `pnpm --filter @switchboard/dashboard typecheck` stay green.
- `pnpm install --frozen-lockfile` stays "up to date" (`.nvmrc`/`engines` do not touch the lockfile).
- No behavioral diff in served headers (manual review of `next.config.mjs`).
