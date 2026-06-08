# Deploy troubleshooting

Companion to [`production-urls.md`](./production-urls.md). Use when a production build fails or a deploy serves the wrong code.

## Deployment topology (which host builds what)

| App              | Host(s)                                     | Build command                                                   | Triggered by                                                  |
| ---------------- | ------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/dashboard` | **Vercel**                                  | `next build` (via turbo)                                        | Git push to `main` (auto-deploy)                              |
| `apps/api`       | **Vercel** (`switchboard-api`) + **Render** | `tsc` (Vercel) / `pnpm build` Docker (Render, `Dockerfile.api`) | Vercel: git push / PR; Render: `render.yaml` → `branch: main` |
| `apps/chat`      | **Render**                                  | `pnpm build` (Docker)                                           | `render.yaml` → `branch: main`                                |
| Postgres, Redis  | Render                                      | —                                                               | —                                                             |

There is **no `vercel.json` and no `.vercel/` in the repo**: Vercel and Render build settings live in each host's web UI.

### ⚠️ `switchboard-api` is a misconfigured Vercel project — it should not exist

There is a Vercel project named **`switchboard-api`** (visible as the `Vercel` commit status on PRs) that builds `apps/api`. **`apps/api` cannot run on Vercel.** It is a long-running Fastify server (`node dist/server.js` → `buildServer().listen()`), with no serverless handler, no `api/` functions directory, and no `@vercel/node` adapter. Vercel runs serverless/edge functions, not persistent servers, so even a green build would deploy nothing servable. `apps/api` is hosted on **Render** (`render.yaml`).

This project's build fails on every commit (≈76s, fails before/at the workspace build — `@switchboard/*` deps aren't built in its isolated build context), producing a permanent red `Vercel` status that has nothing to do with code health (CI's docker build of `apps/api` is green).

**Resolution (operator action — Vercel-UI only):** delete the `switchboard-api` Vercel project (Vercel → `switchboard-api` → Settings → Advanced → Delete Project). The API deploys via Render; there is no reason for a Vercel project to track it. If it must stay for some reason, set its **Ignored Build Step** (Settings → Git) command to `exit 0` so Vercel skips (rather than fails) every build.

## Symptom: build fails on `apps/api/src/app.ts` (Redis / GovernanceCartridge errors)

```
src/app.ts(43,1): TS6133: 'Redis' is declared but its value is never read.
src/app.ts(59,12): TS2709: Cannot use namespace 'Redis' as a type.
src/app.ts(523,7): TS2352: Conversion of type 'Cartridge' to 'GovernanceCartridge' ...
```

**Root cause: a toolchain-resolution divergence, not an old commit.** Local `tsc` and Render are lenient about two constructs that the **`switchboard-api` Vercel** `tsc` rejects:

- **Default import of `Redis`** (`import type Redis from "ioredis"`): Vercel's resolver treats the default export as a namespace → TS2709 ("cannot use namespace as a type") + TS6133. **Fix:** use the named export — `import [type] { Redis } from "ioredis"` (ioredis exports `Redis` both as `default` and named; the named form is unambiguously the class). All ioredis imports in `apps/api`/`apps/chat` were converted in the PR that added this runbook.
- **`Cartridge`→`GovernanceCartridge` cast** (`app.ts`): the `enrichContext` parameter types are method-bivariant-compatible locally but rejected as insufficiently-overlapping on Vercel → TS2352. **Fix:** cast through `unknown` (`as unknown as GovernanceCartridge | null`).

If a _new_ default-style ioredis import or a fragile structural cast lands and only Vercel goes red while local/CI/Render stay green, apply the same two patterns. To reproduce Vercel locally as closely as possible, run a clean `pnpm build` (not `pnpm reset` alone — `reset` skips `ad-optimizer`/`creative-pipeline`/apps and yields false "has no exported member" alarms).

## Symptom: Vercel (dashboard) serves an old commit / keeps failing after "Redeploy"

"Redeploy" on an existing deployment rebuilds **that deployment's pinned commit** — so redeploying an old, broken deployment reproduces the same failure forever.

1. Vercel → project → **Settings → Git**: confirm the connected repo and **Production Branch = `main`**.
2. Read the deployed SHA: **Deployments → click the deployment** — the commit SHA + message are in the header / "Source". Compare to `git rev-parse origin/main`.
3. Trigger a build of the **latest** commit (not a redeploy of the old one):
   - push to `main` (any real merge), **or**
   - `git commit --allow-empty -m "chore: trigger deploy" && git push origin main`.
4. If you must use Redeploy, **uncheck "Use existing Build Cache"** and redeploy the **latest** `main` deployment, then promote it to Production if it landed as a preview.

## Dashboard build-time environment variables (Vercel)

`NEXT_PUBLIC_*` vars are **inlined at build time** — changing them requires a fresh build, not just an env edit. Missing ones do not fail the build (all have safe defaults) but silently disable features:

- `NEXT_PUBLIC_API_URL` — **must** be set on Vercel (defaults to `http://localhost:3000` otherwise)
- `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_LAUNCH_MODE`, `NEXT_PUBLIC_DEPLOY_ENV`
- `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_CONFIG_ID`
- `NEXT_PUBLIC_STRIPE_ENABLED`, `NEXT_PUBLIC_STRIPE_PRICE_{STARTER,PRO,SCALE}`
- `NEXT_PUBLIC_{CONTACTS,AUTOMATIONS,ACTIVITY,REPORTS,APPROVALS}_LIVE`
- `NEXT_PUBLIC_{SMTP,GOOGLE_AUTH}_CONFIGURED`, `NEXT_PUBLIC_SENTRY_DSN`

Server runtime vars required after the build (not for `next build` itself): `NEXTAUTH_SECRET` (hard-fails the first prod request if absent), `NEXTAUTH_URL`, `SWITCHBOARD_API_URL`, `SWITCHBOARD_API_KEY`, `CREDENTIALS_ENCRYPTION_KEY` (must match the API), `DATABASE_URL`.

**Known risk (currently fine, do not "fix" blindly):** the dashboard's Prisma client is generated by the turbo `^build` chain (`@switchboard/db` build runs `prisma generate`). If the Vercel project's Build Command is ever changed to run `next build` directly with Root Directory = `apps/dashboard`, Prisma generation is skipped and the build fails with _"@prisma/client did not initialize yet"_. If that happens, set the Vercel **Build Command** to `turbo build --filter @switchboard/dashboard` (which runs the dependency chain). `prisma generate` does not need `DATABASE_URL`.

## Build environment

- **Node:** pinned to **22** via root `.nvmrc` (+ `engines.node >=20.9.0`). Vercel and Render read these to select the build runtime. Do not pin to 24 — Vercel has no 24.x build runtime.
- **Package manager:** `pnpm@9.15.4` (root `packageManager`, honored via corepack).
- **TypeScript:** `6.0.3`, pinned in the lockfile; `--frozen-lockfile` installs it exactly.

## Local deploy-parity check (before pushing to `main`)

```bash
pnpm install --frozen-lockfile   # mirrors the host install; should say "up to date"
pnpm build                       # full turbo build — what the hosts run
pnpm typecheck                   # all packages + apps
# dashboard-only, mirrors Vercel:
pnpm dashboard:release-check     # schemas+db build → dashboard typecheck → test → next build
```

If all are green, `main` is deployable; a failing host build is then host-side (stale cache / wrong commit), handled above.
