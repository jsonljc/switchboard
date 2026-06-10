# Switchboard — Codebase Map (Plain English)

_Read-only audit, Phase 1. Written 2026-06-10. Audience: non-technical._

## What this system is

Switchboard is the "operating system" that lets AI agents (Alex, Riley, Mira) do real revenue work for clinics — answer WhatsApp leads, book appointments, adjust Meta ads, produce creatives — with a governance layer in between so risky actions need human approval. One running system serves many clinics at once; each clinic is an **organization**, and almost every record in the database carries an organization stamp saying who owns it.

## The four moving parts

1. **API server** (the brain, port 3000) — about 62 route files / 100+ endpoints. All business decisions live here. Its core rule: every action that changes the real world is supposed to enter through one front gate (`PlatformIngress.submit`), get judged by a governance gate (allow / ask a human / deny), then get recorded in a permanent log (`WorkTrace`). Config screens, approvals, and webhooks legitimately use side doors — there is an explicit allowlist of those, currently **102 entries**.
2. **Chat server** (the front door for messages, port 3001) — receives webhooks (automatic "doorbells" rung by WhatsApp/Meta, Telegram, Slack when a customer messages). It checks each webhook's cryptographic signature, then forwards the work to the API server using a shared internal secret.
3. **Dashboard** (what you see in the browser, port 3002) — Next.js app. Login is email + password (properly hashed) or Google, with sessions via NextAuth. Its 114 small API routes are mostly "pass-through pipes" that forward to the API server.
4. **Background worker** (Inngest) — ~23 scheduled or event-triggered jobs: the follow-up sender (every 15 min), appointment reminders (hourly), weekly Meta ad audit, daily ad health checks, Meta token refresh, Stripe subscription sync, creative video pipelines, memory decay, etc. These run as a special "system" actor.

## How identity and permissions work

- **Dashboard users**: NextAuth session; each user belongs to one organization.
- **Machines calling the API**: API keys (stored hashed), each tied to an organization in production.
- **Chat → API**: a shared internal secret; the operator who approves things over chat is re-identified server-side from a channel-binding table.
- **Approvals**: an action that needs sign-off is "parked"; an approval response is checked for the right org, the right person (the originator can't approve their own action unless a special flag is set), and a tamper-proof hash.

## The database

PostgreSQL via Prisma: **107 tables**. Roughly 65 carry the clinic stamp (`organizationId`) directly, ~40 reach it indirectly through a linked table, and a handful are deliberately global. Patient/lead PII lives here: names, phones, full WhatsApp conversation text, bookings, consent records. External-service passwords/tokens are encrypted (AES-256-GCM) with a key from the environment — the system refuses to start in production without it.

## Outside services (what data leaves the building)

| Service                                       | Why                                       | Notes                                                                                            |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Meta / WhatsApp                               | messages, ads, leads                      | inbound webhooks signature-verified; email/phone hashed before sending to Meta's Conversions API |
| Telegram, Slack                               | chat + operator approvals                 | signature/secret verified, fail-closed in production                                             |
| Stripe                                        | billing + payment webhooks                | signature verified; amounts re-fetched from Stripe rather than trusted                           |
| Anthropic (Claude)                            | the agents' intelligence                  | full customer conversation text is sent to the LLM; contact name only (phone/email stripped)     |
| Google Calendar                               | bookings                                  | patient name + email go into the calendar event                                                  |
| Kling / HeyGen / ElevenLabs / OpenAI / Voyage | creative video, voice, embeddings         | scripts/prompts only                                                                             |
| Inngest Cloud, Resend, Sentry (optional)      | job orchestration, email, error reporting | job payloads can include conversation context                                                    |

## Secrets and configuration

~130 environment variables, inventoried in `.env.example` and policed by a CI allowlist script. Verified: no `.env` files or real keys committed to the repository; browser-exposed (`NEXT_PUBLIC_*`) variables are all non-sensitive flags/URLs. Real production-grade keys do sit in the local `.env` on this machine (gitignored). Dev conveniences (auth bypass, body-supplied org IDs) exist but are gated to non-production.

## Prior audit trail

The repo has 12 internal audits under `docs/audits/` (most recent: pilot-spine, 2026-06-07, with several open findings). This audit will verify those known items rather than rediscover them.
