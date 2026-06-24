# PR-3 plan: dashboard action for receipt.reconcile_booking (TDD where applicable)

Branch: feat/receipts-reconcile-dashboard (STACKED on feat/receipt-reconcile-writepath / PR-2 #1108).
PR base = feat/receipt-reconcile-writepath (the diff is ONLY the dashboard slice). SURFACE (do not merge):
the reports path sits under a Next.js (auth) route group (known false-positive for the auth stop-glob) +
a new dashboard-proxy route. Wires the #1088 worklist rows to PR-2's governed reconcile route.

CONTRACT: docs/superpowers/specs/2026-06-15-receipted-booking-override.md "Dashboard action UX" section
(override always available since create-on-override; flag/resolve gated on issuedAt != null; per-click
Idempotency-Key; optimistic update + rollback; missing_consent links to the consent flow, not a resolve).
Existing patterns to mirror: apps/dashboard/src/app/api/dashboard/bookings/[bookingId]/attendance/route.ts
(proxy: requireSession -> getApiClient -> client method with Idempotency-Key); apps/dashboard/src/lib/api-client/dashboard.ts
(recordAttendance method shape); apps/dashboard/src/components/results/receipted-booking-quality-tile.tsx
(the worklist tile to extend).

## Step 1 (schemas) — extend the worklist row

packages/schemas/src/reports/v1.ts: ReceiptedBookingWorklistItem += `issuedAt: string | null` (ISO; null
when no persisted row) + `overridden: boolean`. Update the reports-v1 test + any safeParse fixture. (This
is a cross-app type, so it MUST live in schemas.)

## Step 2 (core) — populate them in the rollup

packages/core/src/reports/compute-receipted-booking-quality.ts: in the worklist.push (the row build),
add `issuedAt: view.issuedAt ? view.issuedAt.toISOString() : null` and `overridden: view.overriddenBy != null`.
(view.issuedAt is Date|null; view.overriddenBy is string|null -- both already on ReceiptedBookingView.)
Update compute-receipted-booking-quality.test.ts: assert a row carries issuedAt + overridden (add an
overridden fixture view). RED first.

## Step 3 (dashboard api-client) — reconcileBooking method

apps/dashboard/src/lib/api-client/dashboard.ts: add
async reconcileBooking(orgId, bookingId, body: ReconcileBookingActionBody, idempotencyKey: string)
where the body is the action discriminated union MINUS bookingId (override_attribution {action,confidence,reason}
| flag_duplicate {action,detail} | resolve_exception {action,code}). Import the type from @switchboard/schemas
(do NOT redeclare -- Doctrine 11). request(`/api/${orgId}/bookings/${bookingId}/reconcile`, {method:"POST",
headers:{"Idempotency-Key": idempotencyKey}, body: JSON.stringify(body)}). Mirror recordAttendance exactly.
(If the schemas type is the full param union incl bookingId, derive an Omit<..., "bookingId"> body type and
export it from schemas so the dashboard imports it; pick whichever keeps the cross-app contract in schemas.)

## Step 4 (dashboard proxy route) — NEW

apps/dashboard/src/app/api/dashboard/bookings/[bookingId]/reconcile/route.ts: POST handler.
const { bookingId } = await params; const session = await requireSession(); const body = await request.json();
const idempotencyKey = request.headers.get("idempotency-key") ?? createIdempotencyKey(); const client =
await getApiClient(); const result = await client.reconcileBooking(session.organizationId, bookingId, body,
idempotencyKey); return NextResponse.json(result). Mirror the attendance proxy route. (Covered by the blanket
dashboard-proxy route-allowlist entry; no new allowlist line.)

## Step 5 (dashboard tile) — the per-row affordance

apps/dashboard/src/components/results/receipted-booking-quality-tile.tsx + a NEW co-located action component
(e.g. reconcile-row-action.tsx) + its test, to keep the tile under the 400-line warn budget.

- Each worklist row gets a compact action control:
  - "Fix attribution" (override_attribution): ALWAYS shown (create-on-override mints the row if absent). Opens
    a small inline form: a confidence picker (the 5 AttributionConfidence rungs) + a one-line reason input ->
    submit -> reconcileBooking({action:"override_attribution", confidence, reason}). Optimistic: mark the row
    overridden / update its confidence; rollback on error.
  - "Flag duplicate" (flag_duplicate) + a flagged row's "Dismiss" (resolve_exception, code duplicate_contact_risk):
    shown ONLY when row.issuedAt != null. flag_duplicate takes a short note.
  - missing_consent rows: a link to the existing consent flow, NOT a resolve button (PDPA).
- Per-click Idempotency-Key (crypto.randomUUID() or the existing dashboard idempotency util). Confirmation +
  disabled-while-pending + error surface. Keep copy free of em-dashes.
- A lightweight component test: renders the action, the override form submits with the right payload (mock the
  api-client), flag/resolve hidden when issuedAt null. (Honor the dashboard coverage 40/35/40/40, not global.)

## Gates

typecheck; pnpm --filter @switchboard/schemas test; --filter @switchboard/core test; --filter @switchboard/dashboard build
(THE key gate -- only next build catches missing-.js / @/-alias import errors + tsx type errors); lint;
format:check; a .tsx prettier pass (npx prettier --write on the touched .tsx; lint-staged re-expands single-line
JSX children); arch:check (.ts only, but run it). If a dashboard component test runner exists, run it.

## Constraints

No `any`; NO em-dashes anywhere (grep diff for the long-dash char AND " -- "); dashboard relative AND @/-alias
imports OMIT the .js extension (Next.js); cross-app types come from @switchboard/schemas (no local redeclare);
ESM; lowercase conventional commit subjects + Co-Authored-By trailer; commit per step (RED before GREEN for the
schema + rollup + the component test). Push the branch. Do NOT open a PR or merge.
