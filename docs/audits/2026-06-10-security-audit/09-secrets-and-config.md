# Audit 7 — Secrets & Configuration

_Question: any hardcoded keys, secrets in the browser bundle, or committed `.env`? Read-only._

**Verdict: clean in code.** The residual risks are operational (key rotation, a deploy gap), not defects. Ranked low for that reason.

## Verified clean

- **No secrets committed.** `git ls-files` tracks only `.env.example` and `apps/dashboard/.env.local.example` (templates). The real `.env` is gitignored (`git check-ignore .env` confirms). A scan of tracked, non-test files for real key patterns (`sk-ant-…`, `sk_live_…`, `whsec_…`, `xoxb-…`, AWS keys, private-key headers) found **nothing**. Test files use obvious placeholders (`test-key`, `fake-key`, `sk_test_dummy`).
- **No secrets in the browser.** Every `NEXT_PUBLIC_*` variable is a non-sensitive flag, URL, or public ID (Meta App ID, Stripe price IDs, feature flags). No client component imports a server secret. The dashboard proxies API calls server-side, so the API key never reaches the browser.
- **Critical keys fail loudly when missing.** `CREDENTIALS_ENCRYPTION_KEY` throws on any encrypt/decrypt and the API/chat refuse to boot in production without it. Unscoped API keys crash the server at startup. `NEXTAUTH_SECRET` is required in production.

## Operational gaps to address (not code defects)

1. **Encryption key is global and has no documented rotation path.** One `CREDENTIALS_ENCRYPTION_KEY` for the whole platform (see also `03-multi-tenant-isolation.md` — this is why query-level org filters are the real tenant boundary, not encryption). Rotating it today would invalidate every stored credential. Document a versioned-cipher / dual-key rotation window before you ever need to rotate.
2. **Session-secret rotation logs everyone out.** `NEXTAUTH_SECRET` has no graceful rollover; changing it invalidates all sessions. Plan for it.
3. **`SESSION_TOKEN_SECRET` is optional and silently disables session auth if unset** — no warning. Make it fail loudly in production if that path is relied on.
4. **Known deploy gap (F-15, prior audit):** `SWITCHBOARD_API_KEY` missing from the deploy config blocks chat→API ingress at production defaults. Already tracked in the pilot-spine audit; this is config, not code.
5. **Real production keys sit in this machine's local `.env`.** Not committed, but readable by any process on the dev box (Anthropic key, Meta tokens). Consider a secrets manager / ephemeral local keys for dev.
6. **No shared env schema.** Validation is scattered (startup checks + an allowlist script), so type-coercion bugs (a rate-limit env parsed as `NaN`) are possible. A small Zod env schema per app would centralise the contract.

## Bottom line

Nothing exposed in the repo or the browser; the encryption and startup guards are correct. The work here is operational discipline — a key-rotation runbook and the known deploy-config fix — not a security defect in the code.
