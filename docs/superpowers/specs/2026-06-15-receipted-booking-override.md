# Receipted-booking reconcile (the actionable override surface): design spec

Status: design spec (2026-06-15). Consumes and completes the deferred override arc in
`docs/superpowers/specs/2026-06-14-receipted-booking-object-design.md` ("Re-evaluation triggers:
resolution (2026-06-15)", the two non-recomputable signals). Scope owner: the receipted-booking
read-model. This spec defines the OWNER-FACING ACTION that turns the read-only worklist (#1088) into
an actionable one.

## Problem

The receipted-booking moat ships a per-booking proof-quality worklist (#1088): the owner sees which
receipted bookings need attention and why (their open exception codes). It is READ-ONLY. The owner
cannot act on it. Two of the four exception signals are derived JUDGMENTS that no source primitive
can recompute, so `PrismaReceiptedBookingStore.getView` hardcodes them off:

```
overriddenBy: null,            // -> manual_override never raised
duplicateContactRisk: false,   // -> duplicate_contact_risk never raised
```

Until a governed producer writes those signals and `getView` reads them, the worklist cannot surface
a manual override or a duplicate-contact flag, and the owner cannot correct an attribution the
system scored wrong. This spec closes that: a single governed operator action ("reconcile this
booking") plus the `getView` consumer fix that kills both hardcodes.

## Ground truth (verified on main, 2026-06-15)

- `evaluateExceptions(ctx)` (`packages/core/src/receipts/evaluate-exceptions.ts`) ALREADY accepts
  `overriddenBy` and `duplicateContactRisk` and raises `manual_override` / `duplicate_contact_risk`
  from them. `getView` just feeds it `null` / `false`. The hardcode is the only gap on the read side.
- `scoreAttribution(evidence)` (`score-attribution.ts`) is a pure enum ladder (no numerics, so no
  NaN-blind gate). `getView` always recomputes it lazily and ignores the persisted
  `attributionConfidence` column.
- The persisted `ReceiptedBooking` row (`packages/schemas/src/receipted-booking.ts`) ALREADY carries
  every column this arc needs: `overriddenBy`, `overrideReason`, `overriddenAt`,
  `attributionConfidence`, `attributionUpdatedAt`, and the `exceptions` Json array. ZERO schema change.
- `getView` already reads the persisted row (org-scoped) and surfaces `overriddenBy` / `overrideReason`
  / `overriddenAt` on the view, but does not feed them into the exception/attribution logic, and does
  not read the persisted `attributionConfidence` or `exceptions` columns.
- The issuance hook (#1080) mints the `ReceiptedBooking` row inside the governed `calendar-book`
  `$transaction`. That is the ONLY birth site for a row (object-design spec invariant). This arc does
  NOT mint rows; it mutates existing ones.
- Operator-direct owner mutations route through the `operator_mutation` execution mode: a direct
  handler keyed by intent, registered at bootstrap, bound via `executor: { mode: "operator_mutation" }`,
  with `approvalMode: "system_auto_approved"`. Reference intents: `operator.transition_opportunity_stage`
  (`apps/api/src/bootstrap/operator-intents/opportunity.ts`) and `booking.record_attendance`
  (`apps/api/src/routes/booking-attendance.ts`). WorkTrace is written automatically by PlatformIngress.

## Decisions (locked)

1. **One governed intent: `receipt.reconcile_booking`.** Mode `operator_mutation`,
   `approvalMode: "system_auto_approved"`, `approvalPolicy: "none"`, `mutationClass: "write"`,
   `budgetClass: "cheap"`, `spendBearing: false`, `idempotent: true`, `allowedTriggers: ["api"]`.
   The owner correcting their OWN derived read-model is not a financial action, carries no outbound
   spend, and has no second approver (the owner is the authority). It therefore uses the same
   auto-approve operator-mutation class as opportunity-stage and attendance, NOT a skill-mode intent.
   Consequences pinned so the implementer does not re-derive them:
   - NOT a skill: no SKILL.md, no `skillSlug`, no skill-runtime tool. (The memo's "SKILL.md loader
     trap" guidance is moot for this mode.)
   - NO anchored allow-policy seed: `system_auto_approved` short-circuits the policy engine for
     non-financial intents (`governance-gate.ts`), so the default-deny / anchored-allow recipe that a
     `require_approval` financial intent needs does NOT apply here. The F4 spend-bearing guard
     (`spendBearing: false`) is what keeps the auto-approve safe.
   - Entitlement is enforced automatically at `PlatformIngress.submit` (the org-level gate). No
     per-intent entitlement wiring.

2. **Three actions, discriminated on `action`.** One intent, one executor, one route; the executor
   branches. This keeps the governance + route footprint to a single surface:
   - `override_attribution` `{ bookingId, confidence, reason }`: the owner asserts the correct
     attribution. Writes the override COLUMNS (`attributionConfidence`, `attributionUpdatedAt`,
     `overriddenBy`, `overrideReason`, `overriddenAt`). Producer for `manual_override`, which `getView`
     derives from the `overriddenBy` column.
   - `flag_duplicate` `{ bookingId, detail }`: the owner asserts this contact is a probable duplicate.
     Appends an open `duplicate_contact_risk` entry to the persisted `exceptions` array. Producer for
     `duplicate_contact_risk` (a manual stopgap; the automated identity matcher remains a better future
     producer, out of scope here).
   - `resolve_exception` `{ bookingId, code }`: stamps `resolvedAt` on the matching open array entry.
     v1 supports `code: "duplicate_contact_risk"` only ("dismiss the duplicate flag"). `manual_override`
     is reverted by overriding again; a dedicated revert is deferred. The param schema accepts the full
     `ExceptionCode` enum for forward-compat; the executor rejects unsupported codes with a clear error.

3. **manual_override is column-derived; duplicate_contact_risk is array-sourced.** This avoids a
   dual-source for any single code. The override COLUMNS are the attribution-override snapshot and the
   sole source for `manual_override`. The `exceptions` ARRAY is the home for non-column-backed
   non-recomputable codes (`duplicate_contact_risk`, and any future code). The recomputable codes
   (`missing_source`, `missing_consent`) stay LIVE (recomputed every read from Contact + ConversionRecord
   facts) and are never owner-resolvable here (clearing `missing_consent` requires recording real consent
   via the existing consent flow, a PDPA invariant; clearing `missing_source` is done by overriding
   attribution to a non-`unattributed` value).

4. **The override requires an existing persisted row.** A booking with no `ReceiptedBooking` row
   (historical, pre-#1080) cannot be reconciled: the executor returns a `RECEIPTED_BOOKING_NOT_ISSUED`
   failure (mapped to 404). Minting a row here would create a second birth site and violate the
   single-issuance-path invariant. `getView` already exposes `issuedAt` (non-null iff a row exists), so
   the dashboard gates the action on `issuedAt` presence. Backfilling issuance for historical bookings
   is a separate optional future slice.

5. **Read-model, not control plane (Doctrine 3).** The mutation routes through `PlatformIngress.submit`
   (the one control plane) and writes a `WorkTrace` (canonical). The `ReceiptedBooking` columns/array are
   only the resulting SNAPSHOT. No parallel control plane is created; the read-model gains a governed,
   audited write path to its own designated provenance columns.

## Exceptions merge semantics (pure `mergeExceptions`, `core/receipts`)

The persisted `exceptions` array is append-only and history-preserving. The pure function
`mergeExceptions(prior, desired, now, governedCodes)` is reused by every array WRITE:

- `governedCodes` is the set of codes this merge OWNS (e.g. `{duplicate_contact_risk}` for a flag/resolve
  re-eval). Codes outside `governedCodes` pass through untouched (a flag write must not resolve an
  unrelated `missing_consent`).
- For each `code` in `governedCodes`:
  - desired-and-prior-open -> keep the prior open entry untouched (preserve its `raisedAt`).
  - desired-and-no-prior-open -> append `{ code, detail?, raisedAt: now }` (re-raise; any prior resolved
    entry stays as history).
  - prior-open-and-not-desired -> stamp `resolvedAt: now` on the prior open entry.
- Prior entries for non-governed codes, and all prior resolved entries, are carried forward verbatim.
- Invariant: at most one OPEN entry per code at a time.

`evaluateExceptions` is unchanged: it computes the current DESIRED set; `mergeExceptions` reconciles
that against the persisted array. `mergeExceptions` operates in the SERIALIZED string domain
(`SerializedExceptionEntry`, ISO-string dates), because the persisted `exceptions` column is JSON; the
read-union helper hydrates to `Date` only when assembling the view. Exhaustive enum tests (one per code,
each transition: raise, keep, resolve, re-raise, non-governed-passthrough).

## getView consumer fix (kills both hardcodes)

`getView` stops hardcoding and reads the persisted provenance, org-scoped as today:

1. Select the persisted `attributionConfidence` and `exceptions` columns too (already selects
   `overriddenBy` / `overrideReason` / `overriddenAt`).
2. `effectiveConfidence = persisted?.overriddenBy ? persisted.attributionConfidence : liveScore`
   (the overridden value wins; otherwise the lazy `scoreAttribution`). NaN-free (enum).
3. `hasOpenDuplicate = persisted.exceptions` carries an OPEN `duplicate_contact_risk` entry.
4. `desired = evaluateExceptions({ attributionConfidence: effectiveConfidence, consent..., overriddenBy:
persisted?.overriddenBy ?? null, duplicateContactRisk: false, now })`. Feed the real `overriddenBy`
   (so `manual_override` raises from the column), but keep `duplicateContactRisk: false` HERE: the sole
   source of `duplicate_contact_risk` on the read path is the persisted-array carry in step 5. Routing it
   through both `evaluateExceptions` and the carry would land the same code twice and break the
   one-open-per-code invariant.
5. Final `exceptions` = the step-4 entries (recomputable codes + column-derived `manual_override`) UNION
   the OPEN array-sourced entries from `persisted.exceptions` (`duplicate_contact_risk` + any future
   non-column code), each DATE-HYDRATED. The column stores ISO strings (`SerializedExceptionEntry`) but
   the view's `ExceptionEntry.raisedAt` is `z.date()`, so `new Date(...)` the carried strings or the
   `ReceiptedBookingViewSchema.safeParse` seam test reds. The returned view surfaces
   `attributionConfidence = effectiveConfidence`.

The read is a UNION (live recomputable + persisted non-recomputable); the append-only `mergeExceptions`
is the WRITE-path reconciler. Both are pure `core/receipts` functions; db stays store-only, no core->db
import. Every persisted-row read leg stays org-scoped (F12).

## Governed write path

`apps/dashboard` worklist affordance -> dashboard-proxy route (`apps/dashboard/src/app/api/dashboard/**`,
`requireSession` -> `getApiClient`) -> api-client method (forwards `Idempotency-Key`) -> operator-direct
api route (`@route-class: operator-direct`, `requireOrgForMutation`, `requireIdempotencyKey`) ->
`app.platformIngress.submit({ intent: "receipt.reconcile_booking", parameters, actor: {id, type:"user"},
organizationId: orgId, trigger: "api", surface: {surface:"api"}, idempotencyKey })` -> `operator_mutation`
mode -> the reconcile handler -> `PrismaReceiptedBookingStore.applyReconcile`.

`applyReconcile(orgId, bookingId, action, actorId, now)`:

- org-scoped `updateMany` (the F12 write-side lesson); `count === 0` -> abort with
  `RECEIPTED_BOOKING_NOT_ISSUED` (conflates missing-row and tenant-mismatch, the security-correct
  behaviour). Reads the prior row first (org-scoped) to compute the merged array.
- `override_attribution`: set the five override columns; `attributionUpdatedAt = overriddenAt = now`.
- `flag_duplicate` / `resolve_exception`: `exceptions = mergeExceptions(prior.exceptions, desired, now,
{duplicate_contact_risk})`. The handler validates a `resolve_exception` `code` is in the v1-supported
  set (`duplicate_contact_risk`) BEFORE the merge; an unsupported code (e.g. a recomputable PDPA code) is
  rejected with a clear failure and never reaches `mergeExceptions`, so it can never stamp a false
  `resolvedAt` on a live signal.
- `lastEvaluatedAt = now`.

The WorkTrace is written by PlatformIngress (the handler returns `{outcome, summary, outputs}`); the
handler never hand-writes a trace.

## Dashboard action UX

Slice 4 first EXTENDS the worklist row `ReceiptedBookingWorklistItem`
(`packages/schemas/src/reports/v1.ts`) with `issuedAt` (and an `overridden` marker) and populates them
from `view.issuedAt` / `view.overriddenBy` in `computeReceiptedBookingQuality`; today the row carries only
`{bookingId, service, startsAt, attributionConfidence, openExceptionCodes}`, so the tile cannot gate on
`issuedAt` without this. The worklist-row extension and the tile change ship together (producer +
consumer).

The worklist row (`receipted-booking-quality-tile.tsx`) then gains a compact per-row affordance, gated on
`issuedAt != null`:

- "Looks right" on a row whose only open code is `missing_source` -> `override_attribution` with a
  confidence the owner picks and a one-line reason. Clearing `missing_source` is the immediate payoff.
- "Flag duplicate" -> `flag_duplicate` with a short note.
- A flagged duplicate row shows "Dismiss" -> `resolve_exception`.

Confirmation, optimistic update with rollback on error, a generated `Idempotency-Key` per click. Keep the
tile under the 400-line warn / 600-line error budget; extract the action control to its own component +
test if needed. `missing_consent` rows surface a link to the existing consent flow, not a resolve button
(PDPA). An overridden booking keeps `manual_override` as an open code (the override sets `overriddenBy`),
so it stays on the worklist, de-prioritized by the worst-first sort (one low-severity code + a now-strong
confidence sorts to the bottom), and thus remains visible and re-overridable. Dropping `manual_override`
from the attention COUNT (so an override reduces "needs attention") is a noted future refinement, not v1.

## Layering and invariants

schemas (the reconcile param union + the existing enums) -> core/receipts (pure `mergeExceptions` +
the read-union helper; `scoreAttribution` / `evaluateExceptions` unchanged) -> db
(`applyReconcile` + the `getView` fix) -> apps (the handler, intent registration, route, proxy, UI).
No core->db import; the merge/union functions are pure and store-free. PlatformIngress is the only
mutating entry; WorkTrace is canonical; the read-model is never a parallel control plane; every store
leg is org-scoped; the math is enum-only (NaN-safe). No em-dashes in code or copy.

## Suggested implementation slices

Adapt against fresh main each iteration; this spec governs.

1. **DONE on merge of this doc**: the design contract (this file), landed as its own docs PR.
2. **Read-side hardcode kill (auto-mergeable; no stop-glob).** The pure read-union helper in
   `core/receipts` + the `getView` fix (steps 1-5 above): feed the real `overriddenBy` column and the
   open `duplicate_contact_risk` array entries into `evaluateExceptions`, surface the overridden
   confidence. Tests from persisted fixtures (an overridden row; a row with an open / a resolved
   duplicate entry; a plain row). This alone KILLS BOTH hardcodes on the read side. Consumer = getView.
3. **Governed write path (SURFACE; trips intent-registration / PlatformIngress / new-mutating-route /
   route-allowlist stop-globs).** schemas reconcile param union + pure `mergeExceptions` + db
   `applyReconcile` (org-scoped `updateMany`, `count===0` abort) + the `operator_mutation` reconcile
   handler + intent registration/bootstrap + the operator-direct api route. Producer + its handler
   consumer ship together. `pnpm eval:governance` stays green (auto-approve operator-mutation needs no
   new policy fixture; confirm, do not assume).
4. **Dashboard action surface (SURFACE; trips the reports `(auth)` route-group glob as a known false
   positive + the new dashboard-proxy route).** The `ReceiptedBookingWorklistItem` `issuedAt` extension +
   rollup population + proxy route + api-client method + the worklist affordance +
   `--filter dashboard build` + a `.tsx` prettier pass.

## Out of scope

The automated identity matcher (the better `duplicate_contact_risk` producer), a dedicated
`manual_override` revert, status override, bulk actions, manual resolution of `missing_consent` /
`missing_source`, historical-booking issuance backfill, and the greenfield agents (Ledger / Casey /
Quinn-lite / Robin). Each is its own initiative.
