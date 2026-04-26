# Typeform setup

Typeform webhooks require a paid plan (Basic or higher). If you're on the free plan, use Tally instead.

## Steps

1. In Switchboard, generate a webhook URL with source "Typeform". Copy it.
2. Open your Typeform form. Click **Connect → Webhooks**.
3. Click **Add a webhook**.
4. Paste the URL into **Endpoint**.
5. Save.

## Field mapping

We match by the question's **ref** (configured in the question's Logic settings) or by its **title**. Set refs to:

- `phone`, `email`, `name`, `message` — for the canonical fields
- Or use titles like "Phone", "Email Address", "Full Name", "Notes"

Hidden fields: pass `page`, `utm_source`, `utm_campaign`, `fbclid` as hidden fields if you want attribution captured.
