# Env Config — Production-Default Posture (Audit Task 3, Step 1)

Date: 2026-06-07
Branch: `audit/pilot-spine`
Worktree: `/Users/jasonli/switchboard/.claude/worktrees/pilot-spine-audit`

This file records env-var **NAMES** only — never values. For each, whether it
matches `.env.example` defaults or deviates, with deviations justified as
local-equivalents of production values (localhost URLs against a single host).

## Goal

Bring the stack up at PRODUCTION-DEFAULT config: real NextAuth login (auth ON,
no dev bypass), open public signup, and the API <-> chat service seam wired to
the local-equivalent hosts.

## Required-by-task vars and their state

| Var                           | Where                       | State                            | Matches `.env.example`?                                                                                                                                                   |
| ----------------------------- | --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEV_BYPASS_AUTH`             | `apps/dashboard/.env.local` | NOT set (commented out, line 13) | Yes — example leaves it unset/commented. Auth ON.                                                                                                                         |
| `DEV_BYPASS_AUTH`             | root `.env`                 | NOT present                      | Yes — example default is empty.                                                                                                                                           |
| `NEXT_PUBLIC_DEV_BYPASS_AUTH` | root `.env`                 | NOT present                      | Yes — example default is empty.                                                                                                                                           |
| `NEXT_PUBLIC_LAUNCH_MODE`     | `apps/dashboard/.env.local` | **ADDED = `public`**             | Yes — matches example default `public`. Was previously ABSENT; unset falls back to `waitlist` which 403s `/api/auth/register` (audit finding F-05).                       |
| `CHAT_PUBLIC_URL`             | root `.env`                 | **ADDED**                        | Yes — matches example default `http://localhost:3001`.                                                                                                                    |
| `SWITCHBOARD_CHAT_URL`        | root `.env`                 | **ADDED**                        | Yes — matches example default `http://localhost:3001`.                                                                                                                    |
| `INTERNAL_API_SECRET`         | root `.env`                 | Already present (pre-existing)   | Deviation: example ships empty; a real secret value is set locally. Justified — required for the chat -> API internal seam; a non-empty secret is the production posture. |

## Additional inter-service vars ADDED to root `.env` (Step 1)

The API reads root `.env` via `node --env-file`; the chat server is launched the
same way. Several inter-service URL vars the chat/provision flows reference were
absent from root `.env` (they fall back to localhost in code, but the audit
demands explicit production-default posture). Added as local-equivalents of the
production Render/Vercel URLs:

| Var                    | Value class    | Matches `.env.example`?                                                                           |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `SWITCHBOARD_API_URL`  | localhost:3000 | Yes — example default `http://localhost:3000`. Read by chat `main.ts` (apiBaseUrl) and dashboard. |
| `CHAT_PORT`            | 3001           | Yes — example default `3001`.                                                                     |
| `CHAT_PUBLIC_URL`      | localhost:3001 | Yes — example default.                                                                            |
| `CHAT_INTERNAL_URL`    | localhost:3001 | Yes — example default.                                                                            |
| `CHAT_SERVER_URL`      | localhost:3001 | Yes — example default.                                                                            |
| `SWITCHBOARD_CHAT_URL` | localhost:3001 | Yes — example default.                                                                            |

Deviation justification: all are localhost URLs — local-equivalents of the
production public Render/Vercel hostnames. Same shape, single-host topology.

## Pre-existing root `.env` vars relevant to bring-up (NAMES only)

`DATABASE_URL`, `CREDENTIALS_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
`REDIS_PASSWORD`, `POSTGRES_PASSWORD`, `SESSION_TOKEN_SECRET`,
`INTERNAL_API_SECRET`, `ANTHROPIC_API_KEY`, and the WhatsApp demo block
(`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
`META_SYSTEM_USER_TOKEN`).

`CREDENTIALS_ENCRYPTION_KEY` and `NEXTAUTH_SECRET` are byte-identical between root
`.env` and `apps/dashboard/.env.local` (the SYNC-FROM-ROOT contract), so seed
encryption and NextAuth session signing line up across services.

## Deliberately-unset vars (production-default posture)

- `RESEND_API_KEY` — left UNSET. `/api/auth/register` auto-verifies new users
  when Resend is unset, which the later fresh-user journey relies on.
- `DEV_BYPASS_AUTH` / `NEXT_PUBLIC_DEV_BYPASS_AUTH` — left UNSET so real
  NextAuth login is exercised.

## Dashboard rebuild (Step 2)

`NEXT_PUBLIC_*` vars are baked into the Next.js build. Because
`NEXT_PUBLIC_LAUNCH_MODE` was added in Step 1, the dashboard was rebuilt:

```
pnpm --filter dashboard build   # succeeded
```

`/api/auth/register` compiles as `ƒ` (Dynamic, server-rendered on demand), so it
also reads the live `process.env.NEXT_PUBLIC_LAUNCH_MODE` at runtime under
`next start` (which loads `.env.local` natively). Both the build-time-inline and
runtime-read paths therefore see `public`. Empirically confirmed at bring-up:
`POST /api/auth/register` with `{}` returns `400 {"error":"Email is required"}`,
NOT the `403` waitlist gate — proving open signup is live (F-05 closed for this run).
