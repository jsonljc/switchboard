# receipted-override arc loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_revenue_proof_direction.md.

Goal: turn the read-only receipted-booking worklist (#1088) into an ACTIONABLE one (override
attribution / flag a duplicate / resolve an exception) + kill the two getView hardcodes
(overriddenBy:null, duplicateContactRisk:false). Worktree .claude/worktrees/receipted-override.
Authority: AUTO-MERGE non-stop-glob slices (gates green + independent review clean); SURFACE
stop-glob slices (intent/governance/ingress/new-route/allowlist).
Base: origin/main @ c86360d1c (has spec #1097). Re-fetch each slice.

## PRIOR-RUN RECONCILIATION (2026-06-15, important)

A separate build-loop session ran the WRITE-SIDE of this arc concurrently, DETECTED my session as a
collision, and YIELDED (stopped cleanly; no live process; confirmed). It left:

- branch `receipt-override-writeside-wip` @ 88db52b95 = 2 GREEN commits on top of my spec commit:
  97a610f3b (append-only override-exceptions merge fn) + 88db52b95 (getView surfaces persisted
  overriddenBy). REUSE as REFERENCE (harvest tests + getView logic); do NOT cherry-pick (its getView is
  a SUBSET = only kills overriddenBy hardcode, not duplicate_contact_risk).
- `.claude/receipt-override-writeside-plan.md` (51KB) + `receipt-override-loop-state.md` (its scratch).
  Digested via subagent. Gotchas harvested into the plan below.

## CONSOLIDATED PLAN (best of both; digest-endorsed)

- PR-A (docs, AUTO-MERGE): revise the merged spec's Decision 4 -> adopt CREATE-ON-OVERRIDE for
  override_attribution (mint a row for historical bookings, snapshot live Opportunity.estimatedValue so
  revenue does not regress; governed late-issuance via PlatformIngress, NOT an ungoverned 2nd writer).
  KEEP require-existing-row for flag_duplicate/resolve_exception (nothing to mutate without a row).
  Land before PR-2. [supersedes my spec's require-existing-row, which a pilot's historical-heavy
  worklist makes nearly dead.]
- PR-1 (READ-side hardcode kill, AUTO-MERGE candidate, no stop-glob) — IN PROGRESS (bg agent):
  pure read-union helper in core/receipts + getView UNION fix (effective confidence = override-wins;
  feed real overriddenBy + duplicateContactRisk:false to evaluateExceptions; union open
  duplicate_contact_risk entries from persisted exceptions array, DATE-HYDRATED to z.date()). Kills BOTH
  hardcodes. Tests from persisted fixtures. Branch receipts-readfix.
- PR-2 (GOVERNED WRITE PATH, SURFACE): schemas reconcile param union + db applyReconcile
  (override_attribution=create-on-override+snapshot per the prior Task-3 contract; flag/resolve via
  append-only mergeExceptions(...,{duplicate_contact_risk}); org-scoped every leg; count===0 abort; P2002
  converge) + operator_mutation handler + intent registration/bootstrap + operator-direct route.
- PR-3 (DASHBOARD, SURFACE): extend ReceiptedBookingWorklistItem with issuedAt + populate in rollup;
  proxy route + api-client + worklist tile affordance gated on issuedAt!=null.

## GOTCHAS (harvested from prior plan/2B-grade; do not rediscover)

- db barrel index.ts uses NAMED re-exports (not export \*): any new db result type (ApplyReconcileResult)
  needs an explicit `export type {...}` or api import won't resolve.
- Revenue rollup keys snapshot-vs-live on issuedAt!=null (compute-receipted-booking-revenue.ts:31): a
  create-on-override row with issuedAt=now MUST snapshot live Opportunity.estimatedValue (CENTS, Int) or
  revenue silently drops to 0. snapshotCents() is NaN-safe; do NOT \*100.
- exceptions persisted as SerializedExceptionEntry (ISO STRINGS); view wants z.date() -> date-hydrate on
  read or safeParse reds. mergeExceptions operates in string domain.
- updateMany drops P2025 -> explicit count===0 guard; create -> P2002 converge to updateMany.
- org-scope EVERY leg (F12). NaN-safe (enum ladder). NO em-dashes (grep diff). type vi.fn spies (tsc over
  tests reds api/chat BUILD). CI has no Postgres -> mock Prisma (mirror existing store test). build before test.
- require_approval is a trap (default-deny + unbuilt post-approval dispatch); system_auto_approved skips
  ONLY human-approval, keeps auth/idempotency/WorkTrace/audit. eval:governance needs NO new fixture (confirm).

## Gate results

slice 1 (spec #1097): MERGED 12:07Z (auto-squash). review=4 findings all fixed.
PR-1 (#1101 read-side hardcode kill, branch receipts-readfix @ f2086f81e): gates green (core/db build+test,
typecheck, lint, format, arch; only known PG-integration flakes red). Independent review = MERGE (empirically
red-verified). No stop-glob. AUTO-MERGE ENABLED (pending CI).
PR-A (#1103 spec create-on-override, branch docs/receipts-override-create @ f98388df9): docs-only, prettier+
dash clean. AUTO-MERGE ENABLED (pending CI).

## NEXT (on wake): verify #1101 + #1103 merged -> sync main -> branch PR-2 off new main.

PR-2 = governed write path (SURFACE). Reuse the prior 51KB plan structure (Tasks 3-7) generalized to the
3-action receipt.reconcile_booking. Store contract (from digest, branch receipt-override-writeside-wip):
applyReconcile(orgId, bookingId, action, actorId, now) -> {status:"not_found"} | {status:"applied", created:bool}
override_attribution: existing-row -> updateMany 5 override cols + attributionUpdatedAt=overriddenAt=now
(count===0 -> not_found); absent-row -> create snapshotting live Opportunity.estimatedValue (cents) into
expectedValueAtIssue, issuedAt=now; P2002 -> converge to updateMany.
flag_duplicate/resolve_exception: require existing row (absent/count===0 -> RECEIPTED_BOOKING_NOT_ISSUED);
exceptions = mergeExceptions(prior, desired, now, {duplicate_contact_risk}); validate resolve code in
{duplicate_contact_risk} BEFORE merge.
pure mergeExceptions(prior, desired, now, governedCodes) NEW in core/receipts (string domain, append-only).
handler overriddenBy = AUTHENTICATED actorId (never body). intent receipt.reconcile_booking via
registerOperatorIntent (operator_mutation, system_auto_approved). operator-direct route + Idempotency-Key.
db barrel: explicit export type {ApplyReconcileResult}. eval:governance green (confirm). SURFACE (don't merge).

## Log

- 2026-06-15: ORIENT + slice-1 spec (brainstorm + fresh-context review, 4 findings fixed) -> PR #1097
  MERGED. Discovered + reconciled the prior write-side run (clean yield; WIP branch + 51KB plan harvested).
  Decision: adopt create-on-override (revises spec Decision 4).
- 2026-06-15: PR-1 read-fix dispatched to bg agent -> green + independent review MERGE -> fixed a "--" comment
  dash -> #1101 auto-merge enabled. PR-A spec create-on-override revision -> #1103 auto-merge enabled. Both
  pending CI. Checkpoint -> wake to verify merges + start PR-2 (write path, SURFACE).
- 2026-06-15: WAKE. #1101 MERGED 12:50Z + #1103 MERGED 12:55Z (both on main 6d42bd9dd; getView hardcodes=0,
  spec create-on-override live). Pruned receipts-readfix + docs/receipts-override-create. No concurrent receipts
  session. BOTH MISSION CORE DELIVERABLES SHIPPED (hardcodes killed + create-on-override decided). Wrote
  .claude/receipt-reconcile-pr2-plan.md (6-step TDD, 3-action generalization; KEY: override-create writes
  exceptions=[] since manual_override is column-derived post-PR-1). Dispatched PR-2 impl to bg agent
  (a4f7e6df01ebe4f7a) on branch feat/receipt-reconcile-writepath. PR-2 SURFACES (do not auto-merge).
  Checkpoint -> wake on agent completion to review + open + SURFACE PR-2.
- 2026-06-15: WAKE. PR-2 impl done (19 files +1272/-4, 6 TDD commits, all gates green incl eval:governance
  26/26 + local-verify-fast route-ingress). Self-verified diff (no em-dash/--/any; override-create exceptions:[];
  resolve unsupported_code guard; operator-direct route class + Idempotency-Key; db barrel export; 17 org-scope
  legs). Divergence clean (3 new main commits touch skill-mode, not PR-2 files). Fresh-context independent review
  = READY TO SURFACE (8/8 PASS, 1 pre-existing actorId-unknown nit). Opened PR-2 #1108 (MERGEABLE) + SURFACED
  (create-on-override judgment flagged for human). [SURFACE #1, awaiting human merge.]
  Then built PR-3 dashboard: branched feat/receipts-reconcile-dashboard STACKED on PR-2; wrote
  .claude/receipt-reconcile-pr3-plan.md; dispatched impl to bg agent (abbc05e2170d1c03a). PR-3 SURFACES too.
  Checkpoint -> wake on agent completion to review + open + SURFACE PR-3, then STOP CLEAN (both surfaced).
- 2026-06-15: WAKE. PR-3 impl done (12 files +467/-0 stacked; dashboard build PASS, tests + coverage pass,
  all gates green). Self-verified (no em-dash/--/any; no cross-app redeclare; issuedAt gating; per-click
  Idempotency-Key). Fresh-context independent review = SURFACE WITH CAVEATS: spine all PASS (gating/payload/
  idempotency/PDPA/types/schema-rollup), but 3 warn UX gaps: (1) no refetch-on-success -> row stays stale
  (spec wants optimistic update); (2) reconcile\* CSS classes missing from results.module.css (untyped module
  hid it -> unstyled control); (3) missing_consent links to dead /consent route. Per ship-clean, dispatched
  a fix agent (a9a5b1a220b5edaee) on the PR-3 branch for all 3. Checkpoint -> wake on completion to re-verify
  - open + SURFACE PR-3 (stacked on #1108), then STOP CLEAN + final report + memory update.
- 2026-06-15: WAKE. Fix agent done (all 3 findings fixed: invalidateQueries(reports.all)+onReconciled refetch;
  12 reconcile\* CSS classes; /consent dead link -> non-link note since worklist item has no contactId). Caught
  - fixed 2 NEW em-dashes the fix agent added in CSS comments (matched the file's pre-existing em-dash comment
    convention, but newly-authored -> changed to colon). Opened PR-3 #1110 (base feat/receipt-reconcile-writepath,
    STACKED on #1108) + SURFACED. ARC CODE-COMPLETE.

## FINAL STATE (arc code-complete; LOOP STOPPED CLEAN)

MERGED: #1097 spec, #1101 read-side hardcode kill (BOTH getView hardcodes gone), #1103 create-on-override spec.
ALL MERGED 2026-06-16 (user authorized merge, create-on-override accepted): #1108 governed write path,
#1110 dashboard. Merge-time CI detour (all resolved): chore-deps #1112 (fresh ws/vite/protobufjs GHSA wave failing
pnpm audit) + 2 #1110 fixes (vitest vi.fn 2-arg->1-arg TS2558 caught ONLY by full pnpm typecheck; font-style
italic vs dashboard token-governance TY2). HYGIENE DONE: receipted-override worktree removed + pruned, my 4 merged
branches deleted, main synced @ 90eb83d4b, clean tree. Memory updated (project_revenue_proof_direction.md + new
feedback_operator_mutation_owner_action_recipe.md + MEMORY.md pointer). Left untouched (not mine): branches
receipt-override-writeside-wip (prior run, superseded) + docs/receipted-booking-object-rev2.
Out of scope / own kickoff: identity matcher, manual_override revert, issuance backfill, Ledger/Casey/Quinn-lite/Robin.
