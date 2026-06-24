# PR-2 plan: receipt.reconcile_booking governed write path (TDD)

Branch: feat/receipt-reconcile-writepath (off main 6d42bd9dd; PR-1 read-fix + PR-A spec already merged).
Goal: the governed write path for the receipted-booking reconcile action. SURFACE (trips
intent/governance/ingress/new-route stop-globs + carries the create-on-override judgment). Do NOT merge.

CONTRACT: docs/superpowers/specs/2026-06-15-receipted-booking-override.md (Decision 4 create-on-override;
the applyReconcile + mergeExceptions sections; the 3 actions). The prior 51KB plan
.claude/receipt-override-writeside-plan.md is the boilerplate REFERENCE for the route/handler/bootstrap
mechanics (it is single-action `receipt.override_attribution`; ADAPT to the 3-action
`receipt.reconcile_booking`). Existing patterns to mirror: apps/api/src/bootstrap/operator-intents/opportunity.ts

- operator-intents.ts (registerOperatorIntent + handler factory + handlers.set + intentCount);
  apps/api/src/routes/booking-attendance.ts (operator-direct route: requireOrgForMutation +
  requireIdempotencyKey + platformIngress.submit + 200/404/400/503 + the "approvalRequired" in response guard).

KEY DIVERGENCE from the prior plan (post PR-1): `manual_override` is COLUMN-derived (getView raises it from
`overriddenBy` via evaluateExceptions). So the override-create writes `exceptions: []` (NOT a manual_override
entry). The persisted `exceptions` array holds ONLY non-column codes (duplicate_contact_risk + future).

## Step 1 (core) — pure mergeExceptions

File: packages/core/src/receipts/merge-exceptions.ts (+ .test.ts; export from receipts/index.ts).
Also: export `snapshotCents` from build-receipted-booking-data.ts (+ via index.ts) for step 3's snapshot.
Signature: `mergeExceptions(prior: SerializedExceptionEntry[], desired: SerializedExceptionEntry[], now: Date,
governedCodes: Set<ExceptionCode>): SerializedExceptionEntry[]`. Operates in the SERIALIZED string domain
(raisedAt/resolvedAt are ISO strings; stamp with now.toISOString()).
Rules (append-only):

- For each code in governedCodes:
  - in desired AND prior has an OPEN entry (resolvedAt==null) for it -> keep the prior open entry (preserve raisedAt + detail).
  - in desired AND no prior open entry -> append { code, detail?, raisedAt: now.toISOString(), resolvedAt: null } (use the desired entry's detail).
  - prior has an OPEN entry AND code NOT in desired -> stamp resolvedAt = now.toISOString() on it.
- Codes NOT in governedCodes: prior entries pass through verbatim. All prior RESOLVED entries pass through verbatim.
- Invariant: <=1 open entry per code.
  Tests (exhaustive): new-raise; keep-existing-open (untouched, raisedAt preserved); resolve (open not in desired);
  re-raise (prior resolved + now desired -> new open appended, old resolved kept); non-governed passthrough
  (an open missing_consent untouched when governedCodes={duplicate_contact_risk}); detail preserved on append.

## Step 2 (schemas) — ReconcileBookingParametersSchema

File: packages/schemas/src/receipted-booking-reconcile.ts (+ .test.ts; export from the schemas barrel; mirror
how other param schemas are exported). Discriminated union on `action` (z.discriminatedUnion):

- { action: "override_attribution", bookingId: z.string().min(1), confidence: AttributionConfidenceSchema, reason: z.string().min(1).max(500) }
- { action: "flag_duplicate", bookingId: z.string().min(1), detail: z.string().min(1).max(500) }
- { action: "resolve_exception", bookingId: z.string().min(1), code: ExceptionCodeSchema }
  Export `ReconcileBookingParameters` type. Tests: each variant parses; bad action / missing field / bad enum rejected.

## Step 3 (db) — applyReconcile + barrel export

File: packages/db/src/stores/prisma-receipted-booking-store.ts (add method; new **tests** file mocking Prisma,
mirror prisma-receipted-booking-store.test.ts). Barrel: packages/db/src/index.ts add `export type { ApplyReconcileResult }`.
Signature: `applyReconcile(input: { orgId: string; bookingId: string; action: ReconcileBookingParameters; actorId: string; now?: Date }): Promise<ApplyReconcileResult>`
Result: `type ApplyReconcileResult = { status: "not_found" } | { status: "not_issued" } | { status: "applied"; created: boolean } | { status: "unsupported_code" }`
Logic (now defaults to new Date(); org-scope EVERY leg; F12):

- booking.findFirst({ where: { organizationId: orgId, id: bookingId }, select: { id, opportunityId } }) absent -> { status: "not_found" }.
- read prior = receiptedBooking.findFirst({ where: { organizationId: orgId, bookingId }, select: { id, exceptions } }).
- action.action === "override_attribution":
  - prior present -> updateMany({ where: { organizationId: orgId, bookingId }, data: { attributionConfidence: confidence, attributionUpdatedAt: now, overriddenBy: actorId, overrideReason: reason, overriddenAt: now, lastEvaluatedAt: now } }); count===0 -> { status: "not_found" }; else { status: "applied", created: false }. (value snapshot stays frozen: do NOT touch expectedValueAtIssue/issuedAt/currency.)
  - prior absent -> snapshot: opp = booking.opportunityId ? opportunity.findFirst({ where: { organizationId: orgId, id: booking.opportunityId }, select: { estimatedValue } }) : null; expectedValueAtIssue = snapshotCents(opp?.estimatedValue). create({ data: { organizationId: orgId, bookingId, issuedAt: now, attributionConfidence: confidence, attributionUpdatedAt: now, expectedValueAtIssue, currency: null, exceptions: [], overriddenBy: actorId, overrideReason: reason, overriddenAt: now, lastEvaluatedAt: now } }); on P2002 (unique bookingId race) -> converge to the prior-present updateMany branch; { status: "applied", created: true }. (exceptions: [] -- manual_override is column-derived.)
- action.action === "flag_duplicate":
  - prior absent -> { status: "not_issued" }.
  - desired = [{ code: "duplicate_contact_risk", detail, raisedAt: now.toISOString(), resolvedAt: null }]; merged = mergeExceptions(prior.exceptions as SerializedExceptionEntry[], desired, now, new Set(["duplicate_contact_risk"])); updateMany({ where: { organizationId: orgId, bookingId }, data: { exceptions: merged, lastEvaluatedAt: now } }); count===0 -> { status: "not_found" }; else { status: "applied", created: false }.
- action.action === "resolve_exception":
  - if code !== "duplicate_contact_risk" -> { status: "unsupported_code" } (BEFORE any merge; never stamp a live signal).
  - prior absent -> { status: "not_issued" }.
  - desired = []; merged = mergeExceptions(prior.exceptions, [], now, new Set(["duplicate_contact_risk"])) (stamps resolvedAt on the open duplicate, idempotent no-op if none open); updateMany(...); count===0 -> { status: "not_found" }; else { status: "applied", created: false }.
    Coerce prior.exceptions Json -> SerializedExceptionEntry[] without `any` (cast through unknown). NaN-safe via snapshotCents.
    Tests (mock Prisma): override existing-row (updateMany cols, no value-snapshot fields, count===0->not_found); override absent-row create (snapshot live opp into expectedValueAtIssue, exceptions=[], issuedAt=now); override absent no-opportunity (expectedValueAtIssue null, opportunity.findFirst not called); override P2002 -> converge updateMany -> created:false; flag_duplicate appends duplicate via merge; flag on absent row -> not_issued; resolve stamps resolvedAt; resolve unsupported code -> unsupported_code (no updateMany); booking absent -> not_found; org-scope assertions on every where.

## Step 4 (api handler)

File: apps/api/src/bootstrap/operator-intents/reconcile-booking.ts (+ .test.ts). Constant
RECONCILE_BOOKING_INTENT = "receipt.reconcile_booking" in operator-intents/shared.ts. Add error codes to
OPERATOR_INTENT_ERROR_CODES (RECEIPTED_BOOKING_NOT_ISSUED, RECONCILE_UNSUPPORTED_CODE; reuse BOOKING_NOT_FOUND).
buildReconcileBookingHandler(store): returns OperatorMutationHandler. execute(workUnit): parse
workUnit.parameters via ReconcileBookingParametersSchema (Zod throw on bad params); actorId = workUnit.actor.id
(AUTHENTICATED -- the override provenance/overriddenBy is the actor, NEVER from the body); call
store.applyReconcile({ orgId: workUnit.organizationId, bookingId: params.bookingId, action: params, actorId, now });
map: applied -> { outcome:"completed", summary, outputs:{ status, created } }; not_found -> { outcome:"failed",
error:{ code: BOOKING_NOT_FOUND } }; not_issued -> failed RECEIPTED_BOOKING_NOT_ISSUED; unsupported_code ->
failed RECONCILE_UNSUPPORTED_CODE. Tests (3+): override happy path; not_found mapping; bad-params throw.

## Step 5 (bootstrap)

apps/api/src/bootstrap/operator-intents.ts: add a reconcileBookingStore (PrismaReceiptedBookingStore) dep;
handlers.set(RECONCILE_BOOKING_INTENT, buildReconcileBookingHandler(store)); registerOperatorIntent(intentRegistry,
RECONCILE_BOOKING_INTENT); bump the expected intentCount in any test asserting it. Wire the store in app.ts
(construct PrismaReceiptedBookingStore, pass it). Mirror opportunity wiring exactly. Update the bootstrap test if
it counts operator intents.

## Step 6 (route)

File: apps/api/src/routes/receipted-booking-reconcile.ts (+ **tests**). First line `// @route-class: operator-direct`.
POST /:orgId/bookings/:bookingId/reconcile. preHandler buildDevAuthFallback + requireOrgForMutation.
requireIdempotencyKey (400 if absent). Body = the action sans bookingId (action + its fields); build parameters =
{ bookingId: params.bookingId, ...body }. platformIngress.submit({ intent: RECONCILE_BOOKING_INTENT, parameters,
actor: { id: request.actorId, type: "user" }, organizationId: request.orgId, trigger: "api", surface: { surface: "api" },
idempotencyKey }). Guard `"approvalRequired" in response` BEFORE destructuring (defensive; system_auto_approved
won't park). !response.ok -> ingressErrorToReply. result.outcome failed -> map BOOKING_NOT_FOUND /
RECEIPTED_BOOKING_NOT_ISSUED -> 404, RECONCILE_UNSUPPORTED_CODE / bad params -> 400, else 500. success -> 200
{ status, created }. Register in bootstrap/routes.ts + apps/api/src/**tests**/test-server.ts. Tests (4+): 200 happy;
404 not-found; 400 missing Idempotency-Key; 400 bad action.

## Gates (report per-gate)

typecheck; pnpm --filter @switchboard/core test; --filter @switchboard/db test; --filter @switchboard/api test;
pnpm test (or rely on the per-filter); lint; format:check; arch:check; pnpm build (api changed);
pnpm eval:governance (MUST stay green; auto-approve operator-mutation needs NO new fixture -- confirm);
CI=1 npx tsx scripts/local-verify-fast.ts (new route via submit() needs NO route-allowlist entry -- confirm it passes).

## Constraints

No `any`; NO em-dashes (grep the diff for the long-dash char AND " -- "); type vi.fn spy args; ESM .js relative imports;
lowercase conventional commit subjects + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`;
org-scope every store leg; NaN-safe; override-create writes exceptions=[]. Commit per step (RED before GREEN).
Push the branch. Do NOT open a PR or merge.
