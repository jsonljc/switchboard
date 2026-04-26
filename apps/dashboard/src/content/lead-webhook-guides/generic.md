# Custom HTML form setup

For sites where you control the HTML, post directly to the webhook URL.

## Example

```html
<form id="contact">
  <input name="name" required />
  <input name="phone" required />
  <input name="email" />
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>

<script>
  document.getElementById("contact").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const data = Object.fromEntries(new FormData(form).entries());
    data.page = location.href;
    const params = new URLSearchParams(location.search);
    if (params.get("fbclid")) data.fbclid = params.get("fbclid");
    await fetch("PASTE_YOUR_SWITCHBOARD_URL_HERE", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    form.reset();
  });
</script>
```

## Required fields

- `phone` — required for WhatsApp follow-up
- `email` — optional
- `name` — optional but improves greeting personalization
- `message` — optional, captured as the lead's first message

## Important: phone format

Phone numbers MUST include the country code with a leading `+` (e.g., `+6591234567`, not `91234567`).
The webhook will reject leads with bare local numbers because we can't reliably guess the country.

If your form tool offers a phone-input component with country code, use it. Otherwise add a note in your form: "Please include country code (e.g., +65 for Singapore)."
