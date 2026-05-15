# Secret Rotation Runbook

> **Discipline:** Master record in the password manager. Rotation **updates the vault first**, then propagates the new value to Render (and Vercel, if applicable). See `docs/superpowers/specs/2026-05-15-deployment-hosting-design.md` §4 rule 3.

For each provider below, the entry covers: where to rotate, what to do, and which Render env-var keys to update with the new value.

## Anthropic API key

- **Dashboard:** https://console.anthropic.com/settings/keys
- **Rotation steps:**
  1. Create a new API key in the Anthropic console.
  2. Update the vault entry for `ANTHROPIC_API_KEY` with the new value.
  3. Set the new value in Render for both `switchboard-api` and `switchboard-chat`. The services restart automatically.
  4. Once you have confirmed traffic is flowing on the new key (Anthropic console → usage), revoke the old key.

## Meta WhatsApp / Instagram / Ads tokens

> Meta tokens are time-limited (short-lived debug or 60-day system-user tokens). The rotation is the renewal.

- **Dashboard:** https://business.facebook.com → Business settings → System users → (relevant system user) → Generate new token
- **Rotation steps:**
  1. Generate a new system-user token with the same permissions (`whatsapp_business_management`, `whatsapp_business_messaging`, `ads_management`, `business_management`).
  2. Update the relevant vault entries: `WHATSAPP_TOKEN`, `META_ADS_ACCESS_TOKEN` (often the same token).
  3. Update Render env on `switchboard-api` (for `META_ADS_ACCESS_TOKEN`) and `switchboard-chat` (for `WHATSAPP_TOKEN`).
  4. **WHATSAPP_APP_SECRET** and **WHATSAPP_VERIFY_TOKEN** are app-level, not token-level. They rotate only when you regenerate the app in Meta Developer console or change the webhook verification setup, respectively.

## Telegram bot token

- **Dashboard:** Telegram → talk to @BotFather → `/token` → choose bot → "Revoke current token"
- **Rotation steps:**
  1. Revoke and regenerate via @BotFather. Telegram immediately invalidates the old token.
  2. Update vault entry `TELEGRAM_BOT_TOKEN`.
  3. Update Render env on `switchboard-chat`. The chat process restarts and registers the webhook with the new token via the existing `/webhook/telegram` URL.
  4. **TELEGRAM_WEBHOOK_SECRET** is a value you choose; rotate it by picking a new random string, updating the vault + Render, then re-registering the webhook with `pnpm cli:register-webhook`.

## Slack bot token and signing secret

- **Dashboard:** https://api.slack.com/apps → (your app) → Install App / Basic Information
- **Rotation steps:**
  1. **Bot token:** "Install App" → "Reinstall to Workspace" → copy the new `xoxb-…` token.
  2. **Signing secret:** Basic Information → "Show" / "Regenerate" under Signing Secret.
  3. Update vault entries `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`.
  4. Update Render env on `switchboard-chat`. Old tokens stop working immediately on regeneration.

## Stripe API keys

- **Dashboard:** https://dashboard.stripe.com/apikeys
- **Rotation steps:**
  1. **Secret key:** "Roll" the existing key. Stripe gives a 24-hour grace window where both old and new work.
  2. **Webhook secret:** Per webhook endpoint, "Roll" — same 24-hour grace.
  3. Update vault entries `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
  4. Update Render env on `switchboard-api`. Verify the next webhook event is accepted before the 24-hour grace lapses.

## Voyage AI API key

- **Dashboard:** https://dash.voyageai.com (or current Voyage console URL)
- **Rotation steps:**
  1. Generate a new API key.
  2. Update vault entry `VOYAGE_API_KEY`.
  3. Update Render env on both `switchboard-api` and `switchboard-chat` (both services use embeddings).
  4. Revoke the old key after confirming new traffic.

## Inngest signing keys

- **Dashboard:** https://app.inngest.com/<workspace>/settings/signing-keys
- **Rotation steps:**
  1. Inngest supports zero-downtime rotation by configuring a "next" signing key in the dashboard.
  2. Update vault entries `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
  3. Update Render env on `switchboard-api`. Inngest holds both old and new active until you mark the rotation complete in the dashboard.

## NextAuth secret

- **Source:** Generated locally (e.g., `openssl rand -base64 32`).
- **Rotation steps:**
  1. Generate a new value.
  2. Update vault entry `NEXTAUTH_SECRET`.
  3. Update Vercel env (Production scope) for the dashboard.
  4. Redeploy Vercel.
  5. **Side effect:** all existing NextAuth sessions are invalidated. Pick a time when active users are minimal.

## Meta Pixel ID (`META_PIXEL_ID`)

> **Not a secret.** `META_PIXEL_ID` is the public identifier for a Meta Pixel asset and is surfaced in browser-side tracking code. It is **not typically rotated**.

- **Source:** https://business.facebook.com → Events Manager → (relevant Pixel asset) → Settings → Pixel ID
- **When to replace:** Only when migrating to a different Meta Pixel asset (e.g., consolidating accounts or replacing a deprecated pixel). There is no compromise-driven rotation — the value is non-sensitive by design.
- **Replacement steps (if migrating):**
  1. Capture the new pixel ID from Events Manager.
  2. Update the `META_PIXEL_ID` value in Render for `switchboard-api`.
  3. Verify the next ad event lands on the new pixel (Events Manager → Test Events).

## Credentials encryption key

> **DO NOT ROTATE WITHOUT A MIGRATION PLAN.** Stored credentials in Postgres are encrypted with this key. Rotating it without re-encrypting renders existing credentials unreadable. See [[feedback_dev_stack]] — seed-vs-runtime encryption mismatch is a known footgun.

- If rotation is genuinely needed (compromise), the procedure is: re-encrypt all rows with the new key while both keys are temporarily available, then cut over. This requires a custom migration script and operator approval.
