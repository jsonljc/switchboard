# A16 — Approver-role floor on the API approval surface (P1-4) — ephemeral plan

Plan item A16 of `docs/superpowers/plans/2026-06-22-second-wave-fix-plan.md`. Closes P1-4.
SURFACE-before-merge (governance/authz = merge-stop). Branch `fix/a16-approver-role-floor`,
worktree `.claude/worktrees/a16-approver-role-floor`, off origin/main @ a2de9564f.

## Ground truth (tool-verified on origin/main a2de9564f)

- `apps/api/src/routes/approvals.ts:185` `POST /:id/respond` — derives `respondedBy` from the auth
  principal, checks org + self-approval, but **NO approver-role floor**. A `requester` passes.
- `apps/api/src/routes/action-lifecycle.ts:16` `POST /:id/execute` — `assertOrgAccess` only,
  **NO role floor**. A `requester` passes.
- `apps/api/src/routes/internal-chat-approvals.ts:50` bridge — self-auths via `INTERNAL_API_SECRET`
  (NO `principalIdFromAuth`), then `respondToChannelApproval` → `deriveOperatorPrincipal` →
  `principalHasApproverRole`. **Floor already enforced + tested** (respond-to-channel-approval.test.ts:133,
  `requester` → `not_authorized`).
- `APPROVER_ROLES = ["approver","operator","admin"]` exported from `@switchboard/core`
  (channel-gateway/index.ts:23 → index.ts:254). `requireRole(req,reply,...roles)` at
  apps/api/src/utils/require-role.ts (dev-bypass when authDisabled; fail-closed 403 otherwise).
- `approvalScopeSnapshot = { approvers, riskCategory, fallbackApprover }` lives on the **revision**
  (platform-ingress.ts:356; `ApprovalRevision.approvalScopeSnapshot`), read via
  `lifecycleService.getCurrentRevision(id)`. `DEFAULT_ROUTING_CONFIG.defaultApprovers = []`
  (router.ts:28) → membership inert for the pilot. No surface checks membership today.
- `PrincipalRole` includes `requester` (principals.ts:7) — used by the acceptance test.

## FRAME / design decisions (the genuine brainstorming output)

- **D1 (bridge REVISE — plan-vs-code).** Do NOT add `requireRole` to the bridge. It carries no
  `principalIdFromAuth` (secret-authed, excluded from the API-key middleware) → `requireRole` would
  fail-closed 403 and break it. The approver-role floor for the bridge is already enforced + tested
  in core. The bridge gains the new membership spine transitively via `respondToParkedLifecycle`.
  Deliberate, documented deviation from the plan's literal "add requireRole to the bridge."
- **D2 (membership semantics — REVISED after plan-grade).** Enforce `approvers` membership in
  `respondToParkedLifecycle` ONLY when the array is present and non-empty. Scope to the **APPROVE
  paths only** (main pending-approve + recovery_required-retry), matching the existing self-approval
  precedent (approve-only) and minimizing blast radius. **Self-approval is checked FIRST**, membership
  AFTER it — self-approval is the universal four-eyes invariant (holds even with empty approvers) and
  must never be shadowed by membership. This precedence preserves the existing
  `api-approvals-lifecycle.test.ts` self-approval test (originator `default` approving with
  buildTestServer's `defaultApprovers:["reviewer_1"]` → `self_approval`, not `not_authorized`).
  Reject is NOT membership-gated (non-executing; matches self-approval's approve-only scope). Inert
  for the pilot (`DEFAULT_ROUTING_CONFIG.defaultApprovers=[]`). Fail-OPEN on a missing/unfetchable
  current revision — the role floor (requireRole / principalHasApproverRole) is the PRIMARY,
  never-fail-open gate; membership is defense-in-depth — never lock out legitimate members on a
  transient read. Log WARN when the revision fetch THROWS (observable degraded gate). Coerce
  `approvalScopeSnapshot.approvers` with a runtime guard (`Array.isArray` + string filter), never a
  bald `as string[]`. This is the A16 analogue of A15's "converge the source" decision.
- **D3 (single spine).** Membership lives in core so API-parked + chat-fallback + bridge-fallback
  share it. The role floor stays surface-specific (requireRole on API; principalHasApproverRole on
  chat) because identity derivation differs per surface. No invariant weakened; no new bypass path.

## Steps (TDD: RED first, each one dispatch)

### Step 1 — core: membership check in `respondToParkedLifecycle` (+ error class)

- RED: in `packages/core/src/approval/__tests__/respond-to-parked-lifecycle.test.ts`, add cases:
  (a) revision `approvalScopeSnapshot.approvers=["user-x"]`, `respondedBy="user-y"` (non-member,
  non-originator) → throws `ParkedLifecycleNotAuthorizedError` (code `not_authorized`) and NEVER
  approves/dispatches; (b) `approvers=["user-y"]` (member) → approves as today; (c) `approvers=[]` →
  approves as today; (d) `getCurrentRevision` spied to return null → approves (fail-open); (e) spied
  to THROW → approves (fail-open) AND logs WARN; (f) **self-approval precedence**: originator in a
  non-empty approvers list that does NOT include them → still `Self-approval is not permitted`, NOT
  `not_authorized` (membership runs after self-approval).
- GREEN: add + export `ParkedLifecycleNotAuthorizedError` (code `not_authorized`) from the module
  AND the approval barrel `approval/index.ts`. Add a guarded helper `assertApproverMembership` that
  reads `approvalScopeSnapshot.approvers` from the current revision (runtime-guard coerce to
  `string[]`) and throws only when non-empty and `respondedBy` ∉ approvers. Call it on the APPROVE
  paths only, AFTER `assertNotSelfApproval`: in the main approve leg (after line 153) and in
  `retryDispatch` (after line 221, reusing its already-fetched `revision`). Fetch the revision via
  `lifecycleService.getCurrentRevision` for the main leg; wrap in try/catch → WARN-log + skip on throw.
- Done: 6 new cases pass; all existing parked-lifecycle tests stay green (`--filter core test`).

### Step 2 — core: map the new error on the chat surface

- RED: in `respond-to-channel-approval.test.ts`, a parked-fallback respond where the bound approver
  is NOT in a non-empty `approvers` list → outcome `refused: not_authorized`.
- GREEN: in `refusalCodeForError`, `if (err instanceof ParkedLifecycleNotAuthorizedError) return
"not_authorized"`. Import the error from respond-to-parked-lifecycle.
- Done: new chat case passes; existing channel-approval tests green.

### Step 3 — api: approver-role floor on `POST /api/approvals/:id/respond` + membership→403

- RED: NEW `apps/api/src/routes/__tests__/approvals.test.ts` — a `requester`-only principal → 403
  and never reaches the respond engine; an `approver` principal → passes the floor (reaches engine).
  Plus: the core membership error surfaces as **403** (not 400) from `respondViaParkedLifecycle`.
- GREEN: add `requireRole(request, reply, ...APPROVER_ROLES)` as the first guard in the `/:id/respond`
  handler; in `respondViaParkedLifecycle`'s catch add an `instanceof ParkedLifecycleNotAuthorizedError`
  → 403 branch (before the generic 400). Import `APPROVER_ROLES` from `@switchboard/core`.
- Done: requester→403, approver→through, membership→403 (`--filter api test`).

### Step 4 — api: approver-role floor on `POST /api/actions/:id/execute`

- RED: extend `action-lifecycle.test.ts`. The existing `buildApp` harness runs `authDisabled:false`
  with NO `storageContext.identity` and NO `principalIdFromAuth` — adding `requireRole` would 403 ALL
  existing cases. So FIRST retrofit `buildApp` to decorate `storageContext.identity.getPrincipal`
  and set `principalIdFromAuth` to a seeded principal whose role defaults to `operator` (so the
  existing 6 tenant-isolation cases still reach their org check — cross-tenant ones still 403 on org
  grounds, executeApproved still not called). THEN add: a `requester`-only principal → 403 and
  `executeApproved` never called; a no-principal (undefined principalId) → 403; an `operator` → passes
  the floor and reaches executeApproved.
- GREEN: add `requireRole(request, reply, ...APPROVER_ROLES)` as the FIRST guard in `/:id/execute`,
  before the trace/org gating. Import `APPROVER_ROLES` from `@switchboard/core`.
- Done: requester→403 (no execute), no-principal→403, operator→through, existing tenant cases green
  (`--filter api test`).

### Step 5 — VERIFY + SURFACE

- Gates: typecheck; `pnpm test` + `--filter core test` + `--filter api test`; lint; format:check;
  arch:check; `CI=1 npx tsx scripts/local-verify-fast.ts`; build (api + core changed); security
  (`pnpm audit --audit-level=high`). No schema change → no db:check-drift. No engine change → no eval.
- Independent fresh-context review (diff + acceptance + lessons only). Triage. Then SURFACE the PR
  with the bridge-REVISE called out — human makes the merge call (auth/governance merge-stop).

## Acceptance (the plan's bar)

A `requester`-only principal gets 403 on `POST /api/approvals/:id/respond`, `POST /api/actions/:id/execute`;
the internal bridge refuses a non-approver (already enforced; assured by test). Self-approval stays
blocked. Membership enforced only when `approvers` non-empty (pilot `[]` unaffected). SURFACE.

## Out of scope (do not expand)

- `POST /:id/undo` — re-enters ingress governance (its own gate).
- `POST /api/execute`, `POST /api/actions` + `/batch` — re-enter `platformIngress.submit()`; the
  GovernanceGate is the authorization floor there (not a missing role check).
- `escalations/:id/resolve` — resolves Handoff TRIAGE state, not a governed action → no floor.
- Legacy `respondToApproval` / `respond-via-lifecycle.ts` coexistence fork (ApprovalRequest row +
  lifecycle) — deprecated, prod-empty. It gets the role floor (`requireRole` on `/respond`) but NOT
  approvers-membership; membership is enforced on the parked-only path (the prod shape). Documented
  in the PR, not closed here.
- The dashboard (calls the hardened API directly; no proxy route). `decisions.ts` is read-only.
- No schema/migration/env/route-allowlist change.
