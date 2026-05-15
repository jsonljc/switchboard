# Pilot Launch Checklist — Operator Quick Reference

> One-page condensation of `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` §10.
> Full rationale, invariants, and exit conditions live in the spec — this page is the do-list.

**Region (pinned):** `oregon` — see `render.yaml` and `production-urls.md`.
**Code state:** Phases 1–3 + cross-phase polish landed on `main` (PRs #519, #523, #524, #526).

## Pre-flight

- [ ] Master vault is populated for every key in `production-urls.md` §"Vault entries map".
- [ ] You have an admin seat on Render, Vercel, Inngest Cloud, Sentry, UptimeRobot.
- [ ] Render plan limits + Postgres snapshot retention validated in the Render dashboard.

## Provision (Render)

- [ ] Connect this repo's `main` branch in Render → Blueprints → New from `render.yaml`.
- [ ] Confirm Render creates: `switchboard-api`, `switchboard-chat`, `switchboard-postgres`, `switchboard-redis` — all in `oregon`.
- [ ] Confirm `preDeployCommand` is on `switchboard-api` only (no migration runner on `chat`).
- [ ] Vault → Render env: paste every `sync: false` value into the corresponding service. `INTERNAL_API_SECRET` and `SENTRY_DSN_SERVER` must be **identical across `api` and `chat`**.

## Provision (Vercel)

- [ ] Set `SWITCHBOARD_API_URL` to Render `api`'s public URL (server-side; no `NEXT_PUBLIC_` prefix).
- [ ] Set `NEXT_PUBLIC_SENTRY_DSN`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.
- [ ] Confirm no backend secrets (Anthropic, Meta, Stripe, etc.) exist on Vercel.

## First deploy

- [ ] Push (or trigger) deploys on Render + Vercel. Watch all three builds finish green.
- [ ] Run `API_URL=… CHAT_URL=… API_KEY=… ./scripts/smoke-prod.sh` from local. All probes green.

## Post-deploy smoke

- [ ] Dashboard loads at production URL; an authenticated dashboard page that proxies through `/api/dashboard/*` succeeds (verifies `SWITCHBOARD_API_URL`).
- [ ] `GET /api/health/deep` on `api` returns 200 with `database: connected`, `redis: connected` (authenticated probe).
- [ ] `GET /api/health/deep` on `chat` returns 200 with DB + Redis + api all `connected`.
- [ ] Meta webhook verification succeeds (`hub.verify_token` match); a bad-signature POST is rejected.
- [ ] Slack signing-secret verification rejects a tampered POST.
- [ ] Telegram secret-token verification rejects a request without the secret header.
- [ ] `pnpm --filter @switchboard/db exec prisma migrate status` reports "up to date" (or equivalent in `api` startup logs).
- [ ] Send one production-safe Inngest event; confirm handler runs inside deployed `api`.
- [ ] Send Sentry test events from `api` and `chat` tagged `environment=production, test=true`; events arrive AND alert rules ignore them.

## Webhook registration

- [ ] **WhatsApp / Instagram / Slack:** register `https://<chat-domain>/webhook/managed/:webhookId` (per-channel `webhookId` from provisioning) in Meta Business Manager / Slack app config.
- [ ] **Telegram:** `pnpm cli:register-webhook https://<chat-domain>/webhook/telegram`.

## Observability

- [ ] Sentry alert rules ignore `test=true` events (server + client projects).
- [ ] UptimeRobot monitors created — `api` `/api/health/deep` (with `Authorization: Bearer <API_KEY>`) and `chat` `/api/health/deep` (unauth). 5-min cadence.
- [ ] Sentry / UptimeRobot / Render / Vercel / Inngest dashboard URLs copied into `production-urls.md` §"Monitoring dashboards".

## Cut the release

- [ ] `git tag v1.0.0 <launch-sha> && git push origin v1.0.0`. Create GitHub release with brief changelog.
- [ ] Fill remaining `<TBD>` rows in `production-urls.md` (service URLs, region, snapshot retention, rollback links).

## Rollback rehearsal (mandatory before opening the funnel)

- [ ] Pick one Render service. Rollback via dashboard → re-run smoke checklist against the rolled-back state → confirm path actually works → redeploy current.
- [ ] OR promote previous Vercel deployment → smoke → revert.
- [ ] Record rehearsal outcome (date + which path exercised) in `production-urls.md` §"Postgres backup management" or an adjacent section.

## 24-hour dry run

- [ ] Hand-onboard ONE trusted user end-to-end.
- [ ] Watch Sentry, Render logs, UptimeRobot, and the dashboard for 24 hours.
- [ ] If clean: open the funnel to additional pilot users. If not: triage before widening.

---

**If any step fails:** stop and resolve before continuing. The launch sequence is order-dependent — skipping the rollback rehearsal or the 24-hour dry run is the single most common way pilots break in week 2.

**Reference:** spec §10 (full runbook), §6 (rollback shapes), §7 (alert routing), `production-urls.md` (host/vault/URL map).
