# Google Forms setup

Google Forms doesn't natively support webhooks, but a tiny Apps Script does the job in under a minute.

## Steps

1. In Switchboard, generate a webhook URL with source "Google Forms". Copy it.
2. Open your Google Form. Click the three-dot menu → **Script editor**.
3. Replace the contents with the script below, pasting your URL where indicated.
4. Click **Save** (disk icon), then click **Run**. Approve the permissions prompt.
5. Click the clock icon (Triggers) → **Add Trigger**.
   - Function: `onFormSubmit`
   - Event source: **From form**
   - Event type: **On form submit**
6. Save the trigger.

## The script

```javascript
const WEBHOOK_URL = "PASTE_YOUR_SWITCHBOARD_URL_HERE";

function onFormSubmit(e) {
  const items = e.response.getItemResponses();
  const payload = { source: "website" };
  for (const item of items) {
    const title = item.getItem().getTitle();
    payload[title] = item.getResponse();
  }
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
  });
}
```

## Field naming

Name your form questions exactly **Phone**, **Email**, **Name** (or **Full Name**), and **Message**. Other questions are kept under metadata but not used by Alex.

## Important: phone format

Phone numbers MUST include the country code with a leading `+` (e.g., `+6591234567`, not `91234567`).
The webhook will reject leads with bare local numbers because we can't reliably guess the country.

If your form tool offers a phone-input component with country code, use it. Otherwise add a note in your form: "Please include country code (e.g., +65 for Singapore)."
