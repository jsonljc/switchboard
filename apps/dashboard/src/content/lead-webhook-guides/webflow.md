# Webflow setup

Webflow form webhooks require a paid Site Plan (Basic or higher) on your site. Free Starter sites do not support outgoing webhooks.

## Steps

1. In Switchboard, generate a webhook URL with source "Webflow". Copy it.
2. In Webflow, open your project and go to **Site Settings → Integrations → Webhooks**.
3. Click **Add Webhook Integration**.
4. Trigger Type: **Form Submission**.
5. Destination URL: paste the Switchboard webhook URL.
6. (Optional) Set the Form Filter to a specific form name.
7. Save.

## Field mapping

Webflow posts form fields under `data` using the field names you configured in the form designer. Name them **Phone**, **Email**, **Name**, **Message** for automatic mapping.

## Important: phone format

Phone numbers MUST include the country code with a leading `+` (e.g., `+6591234567`, not `91234567`).
The webhook will reject leads with bare local numbers because we can't reliably guess the country.

If your form tool offers a phone-input component with country code, use it. Otherwise add a note in your form: "Please include country code (e.g., +65 for Singapore)."
