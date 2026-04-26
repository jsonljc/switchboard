# Tally setup

Tally is free and supports webhooks on every plan, including the free tier. This is the recommended option for most brands.

## Steps

1. In Switchboard, go to **Settings → Website leads** and click **Generate webhook URL**. Pick "Tally" as the source. Copy the URL.
2. Open your Tally form. Click **Settings → Integrations → Webhooks**.
3. Click **Connect** next to Webhooks.
4. Paste the URL into the **Endpoint URL** field. Leave secret signing key empty.
5. Click **Save**.

## Verifying

Submit a test entry on your Tally form. Within seconds, you should see:

- A new contact in Switchboard
- A WhatsApp greeting sent to the phone number you entered
- The webhook's "Last used" timestamp updated in Settings

If nothing happens, open Tally's webhook event log (same Integrations tab). Failed deliveries show the error response.

## Field mapping

We match Tally fields by their **label**. Use these labels (or close variants — we accept "Phone Number", "Mobile", "WhatsApp", etc.):

- **Phone** (required for WhatsApp follow-up)
- **Email** (optional)
- **Full Name** or **Name** (or **First Name** + **Last Name**)
- **Message** or **Notes** (optional, captured as the lead's first message to Alex)

## Important: phone format

Phone numbers MUST include the country code with a leading `+` (e.g., `+6591234567`, not `91234567`).
The webhook will reject leads with bare local numbers because we can't reliably guess the country.

If your form tool offers a phone-input component with country code, use it. Otherwise add a note in your form: "Please include country code (e.g., +65 for Singapore)."
