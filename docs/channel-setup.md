# Channel Setup

How to configure Telegram and WhatsApp messaging channels for Switchboard.

## Telegram

### 1. Create a Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Save the **bot token** (format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### 2. Configure Environment

Add to your `.env.prod`:

```env
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_WEBHOOK_SECRET=a-random-secret-string
```

Generate a webhook secret:

```bash
openssl rand -hex 32
```

### 3. Register Webhook

After the server is running, register the webhook URL with Telegram:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://your-domain.com/webhook/telegram" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

### 4. Verify

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Should show `"url": "https://your-domain.com/webhook/telegram"` with no errors.

### 5. Test

Send a message to your bot in Telegram. You should get a response within a few seconds.

---

## WhatsApp

### 1. Meta Business Setup

1. Go to [Meta for Developers](https://developers.facebook.com)
2. Create a new app (type: Business)
3. Add the **WhatsApp** product to your app
4. In the WhatsApp section, note your:
   - **Phone Number ID** (from the API Setup page)
   - **Temporary Access Token** (for testing) or generate a permanent System User token

### 2. Configure Environment

Add to your `.env.prod`:

```env
WHATSAPP_TOKEN=your-access-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_APP_SECRET=your-app-secret
WHATSAPP_VERIFY_TOKEN=a-random-verify-string
```

- `WHATSAPP_APP_SECRET`: Found in App Settings > Basic > App Secret
- `WHATSAPP_VERIFY_TOKEN`: Any random string you choose (used during webhook verification)

### 3. Register Webhook

1. In Meta Developer Portal, go to your app > WhatsApp > Configuration
2. Click **Edit** next to Webhook URL
3. Enter:
   - **Callback URL**: `https://your-domain.com/webhook/managed/<webhookId>`
   - **Verify Token**: The same value as `WHATSAPP_VERIFY_TOKEN`
4. Click **Verify and Save**
5. Subscribe to the `messages` webhook field

> Note: For single-tenant mode, the webhook URL format is `/webhook/managed/<webhookId>` where `webhookId` is assigned when the channel is provisioned via the API.

### 4. Permanent Access Token

The temporary token expires in 24 hours. For production:

1. Go to Meta Business Suite > System Users
2. Create a system user with `whatsapp_business_messaging` permission
3. Generate a permanent token
4. Update `WHATSAPP_TOKEN` in `.env.prod`

### 5. WhatsApp 24-Hour Window

WhatsApp enforces a 24-hour conversation window:

- **Inside window** (after user messages): You can send any text message
- **Outside window**: You can only send pre-approved template messages

Switchboard tracks `lastInboundAt` per conversation and respects this window automatically.

### 6. Test

Send a message to your WhatsApp Business number. You should get a response with a slight typing delay (1.5-4 seconds).

### 7. Controlled-beta operator flow

In the controlled beta an operator can attach a WhatsApp channel two ways:

- **Embedded Signup (ESU)** — recommended when available. The dashboard
  exchanges the short-lived ESU token for the WABA id and the first phone
  number id, then registers the per-WABA webhook override automatically.
- **Manual entry** — operator pastes a Meta access token and phone number id
  into the dashboard form. Useful when ESU is not yet enabled for the app.

On success the channel reports `status: active`. Otherwise the dashboard
surfaces a `statusDetail` describing the blocker. Common values:

- `config_error` — required platform env var missing on the API tier.
- `pending_chat_register` — chat server didn't acknowledge the new channel
  (retryable; check chat server health).
- `health_check_failed` — Meta rejected the token or phone number id during
  the post-provision health probe.
- `pending_meta_register` — `POST /<waba>/subscribed_apps` failed; usually
  transient and clears on retry.

**v1 limit:** one managed WhatsApp number per organization. Multi-number
support is a future schema-migration branch.

> Follow-up note: the ESU route currently returns success once the Meta side
> is wired but does not itself trigger the chat-server provision-notify path
> that the manual flow exercises. Tracking separately.

---

## Managed Channels (Multi-Tenant)

For multi-tenant setups where channels are provisioned via the API:

1. Create an organization and managed channel via the API
2. The system generates a unique webhook URL per channel
3. Configure the webhook URL in the respective platform (Telegram/WhatsApp/Slack)
4. The chat server automatically routes messages to the correct runtime

See the API documentation at `https://your-domain.com/docs` for the managed channel provisioning endpoints.
