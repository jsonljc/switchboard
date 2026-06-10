# Audit 6 — Data Integrity (money & bookings under concurrency)

_Question: transactions, race conditions, unique constraints, unsafe migrations — and are the prior audit's money findings closed? Read-only._

## Re-verifying the 2026-06-05 receipted-bookings audit

That audit raised four CRITICAL money attacks. Against current code:

| Prior finding                                   | Status now               | Evidence                                                                                                                                  |
| ----------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Operator types revenue and labels it "verified" | **PARTIAL — door moved** | The dedicated operator route now forces `verified:false`, but the new `payment.record_verified` intent re-opens it (see F3)               |
| Replay one real charge under fresh IDs          | **FIXED**                | Partial unique `(organizationId, externalReference)` (`migration 20260606130000`); dedup now keys on externalReference, not opportunityId |
| Organic/walk-in stamped to a campaign           | **PARTIAL**              | Counted query derives campaign from the booked record + labels `campaign_missing`; but no hard "no click-id → organic" rule               |
| Count "booked" as "held"                        | **OPEN (mitigated)**     | No `held`/`no_show` status, but the paid metric now hangs off a verified payment receipt instead                                          |

## CONFIRMED findings

### F3 — `payment.record_verified` re-opens insider revenue inflation — HIGH (prior: CRITICAL)

Same finding as in `04-auth-and-governance.md`. The new intent writes `verified:true` revenue + a "paid" receipt + a Meta `purchased` conversion, deriving "verified" from the caller-supplied `provider` string with **no PSP fetch-back** (`resolve-payment-tier.ts:20-25`, `record-verified-payment.ts:42-44`). Reachable via the generic `/ingress/submit` route with a user actor, and `system_auto_approved` so the spend gate is skipped. **An authenticated clinic insider can mint production-countable "verified" revenue from a fabricated charge.** This is the single most important integrity item. **Fix:** verify against the PSP server-side; restrict the intent to a service actor / the webhook route.

### F12 — Local-calendar booking path bypasses the lock and double-writes — MEDIUM (race)

For an org configured with business hours but **no Google OAuth** (a real pilot configuration), the booking is written twice — once by the locked store, once by the Local provider — and the Local provider's write does overlap-check-then-insert **without** the `pg_advisory_xact_lock` (`calendar-provider-factory.ts:159-208`, `local-calendar-provider.ts:89`). Two concurrent requests on that path can both pass the overlap check and both insert, **double-booking the same slot for two different patients** (the partial-unique only catches identical contact+service+time). **Fix:** route Local-provider persistence through the locked `PrismaBookingStore`, or add the advisory lock + current-row exclusion.

### F15 — Consent is stored, not enforced as a booking precondition — note/decision

Booking (`calendar-book.ts`) reads no consent before acting. The only consent enforcement is an _outbound-text_ hook (`pdpa-consent-gate.ts`) that defaults to `mode:"off"` and, even at its strongest seeded posture (`observe`), only records — it doesn't block. Consent is a mutable Contact column set by the operator, not an immutable inbound-captured receipt. This is more a **product/compliance decision** than a bug, but you should know: today, consent is not a hard gate on messaging or booking. **Decide:** whether PDPA posture requires consent as a precondition before launch.

## Verified SOLID

- **Double-booking is prevented on the main path.** The locked booking store uses `pg_advisory_xact_lock` + half-open overlap check + a partial-unique index on active bookings, with `count===0` guards on every update (`prisma-booking-store.ts:33-46`). The Local-provider path is the exception (F12).
- **Charge replay is fixed** (partial unique on `externalReference`); the recommendation+WorkTrace dual-write and the booking-confirm multi-write are both properly wrapped in transactions.
- **Migrations are safe.** Scanned all 94: destructive ops are `IF EXISTS`-guarded or add defaulted columns; no type-narrowing or `SET NOT NULL` on populated tables; no migration loses money/booking data. Two un-`IF EXISTS`'d `DROP CONSTRAINT/INDEX` statements are safe in-sequence but brittle to history rewrites — minor.
- **One latent transaction gap:** `LifecycleService.recordRevenue` does 5 sequential writes with no transaction (`lifecycle-service.ts:148-174`), but no live route was found calling it — flag as latent, wrap if adopted.

## Bottom line

The booking/locking and charge-dedup machinery is genuinely solid and the prior audit's replay attack is closed. The two things to act on: F3 (the "verified payment" can be faked — the highest-priority integrity item, shared with the governance audit) and F12 (the no-Google-Calendar booking path can double-book). F15 is a consent-posture decision to make before launch.
