# Switchboard Security Audit — Findings & Priorities

_Read-only audit, Phase 3. Written 2026-06-10. Audience: non-technical founder._
_Every finding below was traced to specific code and personally re-verified; the "scary claims that turned out fine" section is as important as the problems._

## The one-paragraph version

The architecture is genuinely well-built where it counts most: the approval wall holds, the login/permission layer fails safe, webhooks are signature-verified, payments can't be double-charged, and patient data sent to the AI is minimised. Phase-1 raised eight alarming possibilities; **five turned out to be already-defended**, which is a good sign about the team. **What's left is real and clusters in two themes: (1) a few endpoints forgot to check "does this record belong to the clinic asking?", and (2) "right to delete a patient" doesn't actually delete everything.** None of these is being actively exploited, but several should be fixed before you put live patient data through a pilot. There is also one integrity hole worth understanding: the system's "verified payment" stamp can currently be applied without a real payment.

## What to fix, in order

I've grouped by urgency rather than by audit, because that's what's actionable. "Confirmed" means I read the actual code and proved it; "fix effort" is a rough engineering estimate.

### 🔴 Fix before a live-patient pilot

| #   | Finding                                                              | Plain-English impact                                                                                                                                                                                  | Who can do it                                                               | Fix effort |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| F1  | **Workflow routes check ownership only if you ask them to**          | One clinic can read — and cancel or approve — another clinic's automation workflows and approval checkpoints                                                                                          | Any logged-in user who knows a target ID                                    | Small      |
| F2  | **Two "connect your ad account" endpoints skip the ownership check** | One clinic can list another clinic's Meta ad accounts / Google calendars; the server uses the other clinic's stored tokens to do it                                                                   | Any logged-in user who knows a target deployment ID (these show up in URLs) | Small      |
| F3  | **"Verified payment" revenue can be faked**                          | Anyone holding a clinic's API key can record a fake "verified" $X deposit and a matching Meta conversion, with no real charge — because the code trusts a "provider" label instead of checking Stripe | A clinic insider (their own org's API key)                                  | Medium     |
| F5  | **Deleting a patient doesn't delete everything**                     | After a deletion request, the patient's raw messages + phone survive in the dead-letter queue and audit log, and their Google Calendar booking is never cancelled                                     | N/A (compliance gap)                                                        | Medium     |
| F6  | **The dead-letter queue is never purged**                            | Every failed inbound message — full text + phone — is kept forever with no retention limit                                                                                                            | N/A (compliance gap)                                                        | Small      |

### 🟠 Fix soon (real, but narrower or needs specific conditions)

| #   | Finding                                                                           | Plain-English impact                                                                                                                                                             | Fix effort |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| F4  | **Nothing in code stops a future money-moving action from being "auto-approved"** | The spend-cap promise is enforced only by developer discipline; the day someone wires Riley's budget-change action the "obvious" way, it ships with no cap and no human sign-off | Small–Med  |
| F7  | **The "approve your own action" flag has no production guardrail**                | If someone sets `ALLOW_SELF_APPROVAL=true`, four-eyes approval is globally disabled — and unlike the other dev flags, nothing stops it in production                             | Tiny       |
| F8  | **Delegation rules are loaded across all clinics**                                | An approval-authorisation check looks at every clinic's delegation rules, not just the relevant one (narrow exploit, but the isolation guarantee is broken)                      | Small      |
| F9  | **WhatsApp signature is checked against a re-built copy of the message**          | Legitimate WhatsApp messages can be silently rejected (a reliability bug, not a forgery hole) because the chat app rebuilds the body before checking the signature               | Small      |
| F10 | **Phone numbers are written to logs**                                             | Patient phone numbers appear in application logs (including on the deletion endpoint's error path)                                                                               | Tiny       |
| F11 | **The raw "ingress" route accepts unvalidated input**                             | The one mutating endpoint without input validation — and the same door that makes F3 reachable                                                                                   | Small      |
| F12 | **Local-calendar bookings can double-book**                                       | For a clinic with business hours but no Google Calendar connected, two simultaneous requests can book the same slot for two different patients                                   | Medium     |

### 🟡 Track / decide (low risk or a product decision)

| #   | Finding                                                       | Note                                                                                                                                                                     |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F13 | Creative-video jobs do two writes without a transaction       | Self-heals on retry; publish is blocked rather than corrupted. Cosmetic-ish                                                                                              |
| F14 | Meta token refresh can keep a stale token silently            | Fails safe (re-auth), but no operator alert is wired                                                                                                                     |
| F15 | **Consent is stored, not enforced as a booking precondition** | A product/compliance decision: today the consent gate defaults to "off/observe" and booking never checks it                                                              |
| F16 | Dependency advisories                                         | 14 total (1 active critical, 1 suppressed, 11 moderate, 1 low); almost all in third-party libraries (Meta/Google SDK stack, dev tools), not your code. Run `pnpm update` |

## What we checked that turned out SOLID (don't lose sleep here)

These were the Phase-1 "this could be bad" flags. I verified each and they're **fine** — this is where the architecture earns trust:

- **Nobody can post a fake lead.** The Meta lead webhook _is_ signature-verified (the earlier "no auth" worry was a wrong file path). All eight public webhooks authenticate, use timing-safe checks, and fail closed in production.
- **The approval wall holds.** An action that needs human sign-off is parked and physically cannot reach the executors; governance fails closed on any error, runs exactly once, and no downstream code can override a "deny." (The one exception is the auto-approve path — F3/F4.)
- **You can't impersonate another clinic through normal means.** Supplying another org's ID in the request body or an `x-org-id` header is rejected in production; the dev bypasses are hard-locked off when `NODE_ENV=production`, and a misconfigured production server _crashes at startup_ rather than silently running with auth disabled.
- **No double-charges, no double-sends.** Money only moves when Stripe calls back (no job creates a charge); the charge-replay hole from a prior audit is fixed; appointment reminders and follow-ups are idempotent — a retry re-uses a cached result instead of re-sending.
- **The main double-booking defence works.** On the real Google/locked path, simultaneous bookings for the same slot are prevented by a database lock + a uniqueness constraint.
- **The AI sees the minimum.** Patient phone/email are stripped before anything goes to Claude (only first name passes); Meta gets only SHA-256 hashes of email/phone; production error messages are scrubbed; no secrets are committed to the repo or shipped to the browser.
- **Most "read by ID" queries are safe.** Phase 1 worried that lots of database reads skip the clinic filter. In fact all but the workflow routes (F1) re-check ownership in the route — a consistent, well-applied discipline across ~20 endpoint families.

## How the findings map to your original 8 audits

1. **Multi-tenant isolation** → F1, F2, F8 confirmed; otherwise the discipline is sound. _Detail: `03-multi-tenant-isolation.md`_
2. **Auth & governance** → wall is solid; F3, F4, F7 are the gaps. _Detail: `04-auth-and-governance.md`_
3. **Webhooks & input validation** → lead webhook safe; F9, F11 to fix. _Detail: `05-webhooks-and-input-validation.md`_
4. **Background jobs** → no double-charge/double-send; F13, F14 minor. _Detail: `06-background-jobs.md`_
5. **PII & PDPA** → F5, F6, F10 are the real ones; design otherwise good. _Detail: `07-pii-and-pdpa.md`_
6. **Data integrity** → F3 (re-opened from a prior audit), F12, F15. _Detail: `08-data-integrity.md`_
7. **Secrets & config** → clean; operational gaps only. _Detail: `09-secrets-and-config.md`_
8. **Dependencies** → F16; mostly transitive/dev. _Detail: `10-dependencies.md`_

## A note on method (so you can trust this)

Every "confirmed" finding was traced end-to-end from the public entry point to the database query, with the exact file and line. Where two of my investigators disagreed — they did, on F3, about whether the payment code checks Stripe — I read the code myself to settle it (it does **not** check; a misleading code comment caused the disagreement). The "refuted" items above were held to the same standard: I only call something safe after seeing the guard that makes it safe.
