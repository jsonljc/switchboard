# F-03: Channel provisioning resolves `config_error` (not `active`) until `INTERNAL_API_SECRET` is set

- **Severity:** embarrasses-pilot
- **Journey/step:** inventory
- **Verdict:** DORMANT
- **Location:** `apps/api/src/lib/resolve-provision-status.ts:23,57-63` (reader/resolver); fed by `apps/api/src/routes/organizations.ts:364-365,490-503` (verified against main on 2026-06-07)
- **Evidence:**
  - `resolve-provision-status.ts:23` documents `chatConfig` requires `CHAT_PUBLIC_URL` (or `SWITCHBOARD_CHAT_URL`) + `INTERNAL_API_SECRET` present; `:57-63` — a failed `chatConfig` returns `{status:"config_error"}` at the highest precedence.
  - `organizations.ts:364` `const chatUrl = process.env.CHAT_PUBLIC_URL ?? process.env.SWITCHBOARD_CHAT_URL`; `:365` `const internalSecret = process.env.INTERNAL_API_SECRET`; `:490-503` `notifyChatProvisionedChannel({chatPublicUrl, internalApiSecret})` returns `config_error` (mapped to `chatConfig.fail` with `config_error_chat:` prefix) when env is missing.
  - Prod defaults (`.env.example`): `CHAT_PUBLIC_URL`/`SWITCHBOARD_CHAT_URL` default to `http://localhost:3001` but `INTERNAL_API_SECRET=` is empty. The localhost URL is not enough — the missing secret alone collapses the channel to `config_error`.
  - E2E test corroborates: `apps/api/src/__tests__/provision-end-to-end.test.ts:549-550` asserts the detail names both `CHAT_PUBLIC_URL` and `INTERNAL_API_SECRET` when absent.

## What was exercised

Read the pure resolver and the route that builds its `StepResult`s. Confirmed the env feed and the prod-default values, and that the localhost URL default does not rescue the missing secret.

## What happened vs expected

Expected: a connected managed channel resolves `active` so inbound chat works. Observed: with `INTERNAL_API_SECRET` unset (the prod default), `chatConfig` fails and the channel resolves `config_error` regardless of the localhost chat URL — the inbound channel cannot deliver, and the operator sees a config_error status rather than a working channel.

## Suggested fix scope

Set `INTERNAL_API_SECRET` (and a real public `CHAT_PUBLIC_URL`) in the deployment env as a launch-checklist item; surface a clear operator-facing remediation message (already partly present in `statusDetail`). No code change required beyond ensuring the launch env is populated and documented.
