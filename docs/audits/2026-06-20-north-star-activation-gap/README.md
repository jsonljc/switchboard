# North-Star Activation Gap Audit — 2026-06-20

**North star:** weekly **receipted** bookings (proof chain: source → consent → trace → booking → attendance → **payment**).

**Method:** 6 parallel subagent audits, each verified against `main` (read-only, file:line evidence). Deliberately **excluded** the two in-flight workstreams — AI-infra uplift (`.claude/ai-infra-uplift-backlog.md`) and UI/UX aesthetic rehaul (`docs/superpowers/specs/2026-06-19-aesthetic-rehaul-thesis.md`).

**Headline:** the revenue roster (Alex/Casey/Ledger-lite/Quinn-lite/Robin) is **code-complete but prod-inert**. The missing third pillar (beyond AI-infra and aesthetic) is **Activation**: real code bugs + go-live config that, today, prevent a real clinic from receiving reminders, booking onto a real calendar, or having a booking proven as _paid_.

---

## P0 — Prod-inert (code bugs, not config)

### P0.1 Reminders / follow-ups / lead-greetings silently fail in prod

- `conversation.reminder.send`, `conversation.followup.send`, `meta.lead.greeting.send`, `meta.lead.inquiry.record` are registered `defaultMode:"workflow"` (`contained-workflows.ts:629`) with slugs `conversation`/`meta` that are **not seeded** (only `alex`, `ad-optimizer`, `creative` exist).
- The ingress resolver `resolveAuthoritativeDeployment` is strict → `prisma-deployment-resolver.ts:78-79` throws → ingress returns `deployment_not_found` (`platform-ingress.ts:230-244`) **before governance**.
- The `#1119` carve-out (`app.ts:788-790`, `isPlatformDirectIntent`) covers **only** `operator_mutation` + `robin.recovery_campaign.send`. These workflow intents are not covered.
- **Masked by tests:** `__tests__/test-server.ts:470` builds ingress with `resolveAuthoritativeDeployment(null)`; resolver line 42 returns `platform-direct` for _every_ intent when the resolver is null. Green CI, dark prod.
- **Impact:** the entire show-rate nudge loop + instant greeting on paid Meta leads is dark.
- **Fix:** widen `isPlatformDirectIntent` to include these consent-gated, no-spend intents (OR seed `conversation`/`meta` deployments). Add a live-path test using a _throwing_ resolver (mirror `robin-recovery-cron-live-path.test.ts:244`).

### P0.2 Real-calendar bookings don't reach a real calendar

- `calendar-provider-factory.ts:52-94` reads **global env** (`GOOGLE_CALENDAR_CREDENTIALS`/`GOOGLE_CALENDAR_ID`); the per-deployment `google_calendar` Connection creds written by the OAuth flow (`google-calendar-oauth.ts:185-208`) are **ignored** (comment line 75: "per-org credentials is future work"). Env unset → `LocalCalendarProvider` (in-DB `Booking`, fabricated `local-{uuid}` id).
- One agent flagged local receipts as tier `T3_ADMIN_AUDIT` ("not production-countable"). **OPEN QUESTION — must verify:** are LocalCalendar bookings included in the weekly receipted count? If not, the no-PMS wedge's own bookings don't count.
- Architecture B (existing-PMS clinics): `google-calendar-adapter.ts:142-144` `getBooking()` returns `null` — the held/paid re-fetch leg is unimplemented.

### P0.3 Payment leg severed from the proof chain (the strategic gap)

- `payment.record_verified` is fully wired: Stripe Connect adapter (`stripe-connect-payment-adapter.ts`), handler writes a `kind:payment` Receipt + `LifecycleRevenueEvent` welded to `bookingId` (`record-verified-payment.ts:104-152`).
- **But it never feeds the receipted-booking object.** `scoreAttribution`/`build-receipted-booking-data` take zero payment input; no `payment` `ExceptionCode` (`receipted-booking.ts:18-23`); weekly revenue sums `expectedValueAtIssue` (an _estimate_) not paid amount (`compute-receipted-booking-revenue.ts:32`). No booked/held → **paid** promotion.
- **Impact:** a "receipted booking" today proves _booked + attended_, never _paid_. The north star's final, highest-value link is not provable.
- **Fix:** one join + a paid-tier promotion (or payment-aware confidence rung / `unpaid` exception). Primitive already exists.

---

## P1 — Go-live operations (mostly operational)

Everything ships dark by default. Definitive checklist:

| Item                                                                                       | Type                              | Default             | Where read                                                  | Action                                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------- | ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| WhatsApp templates                                                                         | template (per-org overlay + Meta) | all `draft`         | `whatsapp-registry.ts`; gate `proactive-eligibility.ts:94`  | submit to Meta + write `{name:"approved"}` into `runtimeConfig.whatsappTemplateApprovals`         |
| `consentState.mode` (Casey)                                                                | flag (per-deployment)             | `off` (fail-OPEN)   | `governance-config.ts:84`; `calendar-book-consent.ts:97`    | flip to `enforce` per org                                                                         |
| `recovery.mode` (Robin)                                                                    | flag (per-deployment)             | `off` (fail-closed) | `governance-config.ts:114`; `robin-recovery-dispatch.ts:71` | flip to `enforce` per org                                                                         |
| `LEDGER_WEEKLY_REPORT_ENABLED`                                                             | env (api)                         | `false`             | `ledger-weekly-report.ts:99`                                | set `true` + `RESEND_API_KEY`+`EMAIL_FROM`                                                        |
| `WHATSAPP_ACCESS_TOKEN` / `_PHONE_NUMBER_ID`                                               | env (api)                         | unset               | `whatsapp-send-token.ts:17`                                 | set (note chat reads `WHATSAPP_TOKEN`)                                                            |
| `CREDENTIALS_ENCRYPTION_KEY`                                                               | env (all svc)                     | unset               | api-key/cred decrypt                                        | set **byte-identical** across api/chat/dashboard                                                  |
| `DATABASE_URL` / `DASHBOARD_URL`                                                           | env                               | local               | render.yaml; `app.ts:546`                                   | dashboard = Render external string; prod host                                                     |
| Meta secrets (`META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, …) | env (api)                         | unset               | `whatsapp-management.ts`                                    | set per Tech-Provider model                                                                       |
| Per-org provisioning + channel binding                                                     | seed + OAuth                      | not run on signup   | `provision-org-agents.ts`; `resolveByChannelToken`          | run `provisionPilotOrg`; complete WhatsApp embedded-signup OAuth (creates `DeploymentConnection`) |

**External blocker:** Meta Business Verification + App Review for `whatsapp_business_messaging`/`_management`, `business_management` (the embedded-signup _code_ path is now wired per `whatsapp-onboarding.ts:104-230`; the audit's earlier `organizationId:""`/`token=wabaId` bugs are FIXED).

---

## P2 — Moat depth & metric trust

- **Riley act-leg DARK** — executor gated by `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` (default absent, `inngest.ts:570`); reallocates on booked _count_, not paid _value_ — `queryPaidValueCentsByCampaign` never wired (close-the-revenue-loop spec §3.8).
- **Identity matcher absent** — `duplicate_contact_risk` hardcoded `false` (`prisma-receipted-booking-store.ts:177`); **no** `@@unique(org, phoneE164)` (only `@@index`, `schema.prisma:1830`). One human can double-count the headline number.
- **Historical backfill** — `ReceiptedBooking` mints only going forward; clinics with history understate the weekly count.
- **Stripe refund/void accounting** — refunded references excluded from count, but net-to-zero/payout reconciliation deferred.

---

## P3 — De-risk launch + multi-tenant

- **Untested seams (match the "passes CI, inert in prod" pattern):**
  1. Ledger weekly-report cron stubs `submit` entirely (`ledger-weekly-report.test.ts`) — no real ingress/carve-out exercise. **Highest test priority** (it's the launch deliverable + the exact masking that shipped a bug before).
  2. Dashboard owner tiles tested against `reports/fixtures.ts`, not real `listForCohort` output; no API route test for the cohort/view endpoint.
  3. No whole-loop e2e (source→consent→trace→receipt→attendance→count→digest with consistent IDs).
- **Multi-tenant:** proactive sends read one service-level WhatsApp token (`whatsapp-send-token.ts:16`) — tenant #2 sends from tenant #1's number. Per-org calendar has the same single-global issue. Thread `organizationId` through both before clinic #2.

---

## Correctly deferred

- v2 recovery: cancellation-recovery + waitlist/book-the-gap (needs new model; existing `WaitlistEntry` is an email-signup table, not recovery).
- Mira creative/UGC (substantial code, dark behind `opts.mira`; the old "model 404" bug is FIXED — `call-claude.ts:31` now uses `claude-sonnet-4-6`). Keep parked until Ledger has a dense receipted corpus.
- Alex F2 (in-skill approval can't park into a lifecycle) — latent; booking auto-approves today.

---

## Recommended sequence (Activation loop)

1. **P0.1 carve-out widen** — tiny diff, un-darkens show-rate + greeting. Do first.
2. **P0.3 payment → receipt** — makes "receipted" mean _paid_.
3. **P0.2 calendar/receipt-tier verification** + Google seam for existing-PMS.
4. **P1 go-live checklist** + **P3** Ledger cron live-path test & tile consumer test.
5. Multi-tenant cred threading before clinic #2.
