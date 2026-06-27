# Invariant-Guard Ledger (the guard ratchet backlog)

Status: SLICE 0 COMPLETE (full classification of all 114 lessons + 13 Core Invariants landed 2026-06-27).
Date: 2026-06-27
Purpose: the durable, living backlog the Invariant-Guard Loop consumes. One row per durable lesson
or Core Invariant, tracking whether an executable guard exists. Driver: `.claude/invariant-guard-loop.md`.
Design: `docs/superpowers/specs/2026-06-27-invariant-guard-loop-design.md`.

## How this ledger works

- This is a LIVING backlog, not a frozen plan (the spec is the frozen part). It is allowed to change
  on `main` as guards land.
- **Slice 0** ran first and landed the initial full classification of all `feedback_*.md` plus
  the `CLAUDE.md` Core Invariants and `docs/DOCTRINE.md` as its own focused PR (this document).
- **Each guard slice** thereafter flips its own row to `guarded` (recording the guard path and
  `guard-covers`) INSIDE the same PR that adds the guard. The row-flip is atomic with the guard that
  justifies it, so `main` always reflects reality and there is no separate per-run ledger-churn commit.
- **Sibling rows** are new rows in this same ledger, each linking back to its parent id (e.g. a
  parent `G1` spawns `G1-S1`). The parent holds `status = sibling-open` until its siblings land;
  once all of them land, the parent flips back to `guarded`.
- The loop never selects an `operational-skip` row, and never builds a guard for a row already
  `guarded` (it confirms the existing guard covers the specific case, then moves on).

## Row schema

```
| id | lesson (feedback_*.md) | invariant predicate (1 line) | blast-radius | regression-likelihood | guard-type | status | guard location | guard-covers (sites + known gaps) | siblings |
```

- `blast-radius`: Crit | High | Med | Low
- `regression-likelihood`: Hi | Med | Lo (a fix that lives in one place, on a hot-change path, with known siblings ranks Hi)
- `guard-type`: arch | lint | test | ci | type | n-a
- `status`: unguarded | guarded | sibling-open | operational-skip
- `guard location`: path of the guard once written; for an `already-guarded` row, the existing guard
  plus the test `file:line` that covers the SPECIFIC regression case (not merely that some test exists).
- `guard-covers`: the sites the guard actually covers, and any known-uncovered sibling sites.
- `siblings`: ids of sibling-fix rows this lesson spawned (`-` if none).

## Bucket counts (slice 0, reconciled; no silent cap)

Corpus reconciliation: there are **114** `feedback_*.md` files at
`/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/`, two MORE than the 112 the seed
header assumed: one predated this session, and `feedback_type_only_import_and_stalled_subagent_recovery`
was added during slice 0 execution on 2026-06-27 (it is classified too: G114). Slice 0 classified all
114, plus 13 distinct Core Invariants (the 12 `DOCTRINE.md` non-negotiables + the dependency-layer
rule; the 6 `CLAUDE.md` Core Invariants map onto these and are not double-counted).

| set | total | already-guarded | guardable-unguarded | operational-skip |
|-----|-------|-----------------|---------------------|------------------|
| `feedback_*.md` lessons | 114 | 32 | 26 | 56 |
| Core Invariants (DOCTRINE + layers) | 13 | 5 | 5 | 3 |
| **combined** | **127** | **37** | **31** | **59** |

Read of the split (honest, vs the spec's rough 40-55 guardable estimate from an 18% sample): the
strict already-guarded bar (a guard must red on the SPECIFIC bad state, confirmed by opening it, not
mere test existence) confirmed 37 invariants are ALREADY mechanically locked, which is itself a
high-value slice-0 output (the loop will never write a redundant guard for these). The operational
tail is large (58) because the corpus carries a heavy contingent of agent-workflow, git/worktree,
CI-flake, dev-environment, design-philosophy, and "be aware of how the tooling behaves" lessons that
are not mechanically-checkable code invariants (59 of 127). The genuine work-list is the 31
`guardable-unguarded` rows below.

Classification rule applied (for auditability): a lesson is `already-guarded` only if (a) a STRUCTURAL
guard (lint / type / arch-check / check-routes / commitlint / CI step) covers all current and future
sites, OR (b) the lesson is about a SPECIFIC site/fix and that exact site's bad-state is covered by a
test that was confirmed to red. A lesson phrased as a GENERAL rule ("every X must Y") with only one
instance tested and no structural guard is `guardable-unguarded` (the structural guard is the work).
A "be aware of tooling behavior / CI flake / verify-before-X" lesson is `operational-skip`.

---

## A. Guardable-unguarded: the work-list (ranked by blast-radius x regression-likelihood x id)

The loop always takes the top `unguarded` row. Ties broken by id order for deterministic cross-session
selection. The top of this list is the next guard to build.

| id | lesson | invariant predicate (1 line) | blast | reg-lik | guard-type | status | guard location | guard-covers (sites + known gaps) | siblings |
|----|--------|------------------------------|-------|---------|------------|--------|----------------|-----------------------------------|----------|
| G1 | `feedback_consent_status_revoked_masking` | `deriveConsentStatus` checks revoked BEFORE the null-jurisdiction short-circuit; the consent feed gates the resolved non-null jurisdiction | Crit | Hi | test | unguarded | - | gate test `packages/schemas/.../pdpa-consent-gate.test.ts:232` exists; the schema unit `deriveConsentStatus(null-jurisdiction + revoked)` is MISSING; known regulated sibling `calendar-book-consent.ts:40` | G1-S1 (calendar-book consent, file at run) |
| G2 | `feedback_governed_dispatch_check_full_submit_response` | every governed-dispatch caller treats `outcome !== "completed"` as failure, never `approvalRequired` alone | Crit | Hi | type | unguarded | - | `riley-pause-submitter`/`riley-budget-submitter` tests cover 2 callers; no structural/type guard over ALL callers of the dispatch return type | - |
| G4 | `feedback_messaging_optin_is_platform_not_marketing_consent` | proactive sends gate via `evaluateProactiveSendEligibility` (PDPA-first), never on `messagingOptIn` | Crit | Hi | test | unguarded | - | `proactive-eligibility.test.ts` covers gate layers; no guard pins "marketing send never branches on `messagingOptIn`" across send paths | - |
| G9 | `feedback_booked_capi_occurredat_is_commit_time` | booked CAPI `event_time` = commit-time not the future slot; dispatcher rejects `event_time > now`; dedup on `event_id` | Crit | Hi | test | unguarded | - | `meta-capi-dispatcher.ts:44-48` has the too-old guard but NO future-event guard; regressed once (refixed #1317) so reg-likelihood is proven | - |
| G10 | `feedback_alex_dual_provisioning_seeders` | Alex provisioning payload changes land in BOTH `ensureAlexListingForOrg` (api) AND `ensureAlexForOrg` (db pilot-CLI) | Crit | Hi | test | unguarded | - | each seeder tested individually; no cross-seeder payload-drift test, so the pilot-CLI path can ship inert | - |
| G11 | `feedback_next_server_client_module_split` | shared helpers with server-only deps split into server/client files so server code never bundles into the browser | Crit | Hi | lint | unguarded | - | `apps/dashboard/src/lib/**` shared helpers; no file-split lint rule; `next build` may error but nothing proactively guards it | - |
| G6 | `feedback_allowed_triggers_not_a_public_edge_gate` | auto-exec-only intents are gated by `SERVICE_ONLY_INGRESS_INTENTS`, not by `allowedTriggers`; both ingress edges enforce | Crit | Med | test | unguarded | - | `service-only-intents.test.ts` pins set membership; route-level 403 is code-only (untested); a new service-only intent is unguarded | - |
| G12 | `feedback_dashboard_csp` | dev CSP includes `unsafe-eval` + ws/localhost; prod omits all three | Crit | Lo | test | unguarded | - | `apps/dashboard/next.config.mjs` isDev branch; no test asserts the dev/prod CSP split | - |
| CI-DOCTRINE-7 | (Core) dead-letter for every async path | every Inngest fn with `retries > 1` has an `onFailure` that records retry-exhausted + emits a domain `*.failed` event | Crit | Hi | arch | unguarded | - | `makeOnFailureHandler` factory exists + per-fn tests; no CI guard validates ALL `retries>1` functions declare `onFailure` (spec 2026-05-25 not operationalized) | - |
| G13 | `feedback_deployment_resolver_top_level_no_fallback` | top-level `resolveAuthoritativeDeployment` throws on an unresolved slug (no silent fallback unlike the child-work resolver) | High | Hi | test | unguarded | - | `apps/api/src/bootstrap/platform-deployment-resolver.ts:101`; no regression test pins the no-fallback throw | - |
| G14 | `feedback_demo_mode_mutations_must_branch_explicitly` | every dashboard `useMutation` branches on demo mode (no silent live fetch / no-op) | High | Hi | lint | unguarded | - | read-side `useQuery` demo branching is patterned; no eslint rule guards `useMutation`/`mutationFn` demo branches | - |
| CI-DOCTRINE-4 | (Core) governance runs once | `GovernanceGate.evaluate()` runs exactly once; execution modes do not re-evaluate | High | Hi | test | unguarded | - | implicit in mode flows; no test asserts governance cardinality (e.g. CartridgeMode does not re-eval) | - |
| G3 | `feedback_reaper_freeing_slot_needs_guarded_claimant` | every re-claim path for a freed resource is a status compare-and-set (`updateMany` with a status predicate), not an id-only update | High | Med | test | unguarded | - | the booking-confirm re-claim is tested (`prisma-booking-store.test.ts:654`); no structural guard over ALL re-claim paths of a reaped resource | - |
| G15 | `feedback_ingress_route_must_handle_pending_approval` | a route branches on `approvalRequired` in the submit response BEFORE reading `outputs` | High | Med | test | unguarded | - | code present in `creative-pipeline.ts:212`, `execute.ts:130`; no structural guard so a new route phantom-succeeds | - |
| G16 | `feedback_deployment_memory_dedup_axis` | `DeploymentMemory.content` is a pure function of its bucket; writers catch P2002 and reuse the row by incrementing `sourceCount` | High | Med | arch | unguarded | - | `compounding-service.ts:471` handles it; any new category writer that splits sourceCount is unguarded | - |
| G17 | `feedback_prod_safety_node_env_insufficient` | dev-only gates use `VERCEL_ENV` / explicit `ALLOW_*` flags, never `NODE_ENV` (Vercel preview = production) | High | Med | type | unguarded | - | `apps/dashboard/**` feature gates; no enforced pattern / lint for `NODE_ENV`-based gating | - |
| G18 | `feedback_live_contrast_sampling_over_token_gates` | prove AA via live pixel-sampling; token-pair WCAG gates are necessary not sufficient when gradients/grain change the ground | High | Med | test | unguarded | - | token gates exist (`action-contrast.test.ts`); no playwright live-sampling test over rendered pixels | - |
| G19 | `feedback_dashboard_api_needs_next_proxy_route` | each Fastify endpoint the dashboard calls needs a matching Next proxy route + api-client method | High | Med | test | unguarded | - | unit tests mock fetch so a missing proxy passes; no 1:1 wiring validation | - |
| G20 | `feedback_nan_blind_comparison_gates` | every numeric comparison gate over external data checks `Number.isFinite` before comparing | High | Med | test | unguarded | - | `outcome-corroboration.ts:157-169` guards one gate; no structural guard over all numeric gates | - |
| G21 | `feedback_updatemany_drops_nomatch_abort` | converting `update`->`updateMany` must guard `count === 0` to abort before any dependent write | High | Med | test | unguarded | - | `prisma-knowledge-entry-store.test.ts:126-149` covers one site; no structural guard over all single-row `updateMany` conversions | - |
| CI-DOCTRINE-5 | (Core) deployment context resolved once at ingress | routes resolve via `DeploymentResolver`/`resolveDeploymentForIntent`, never hand-built from request params | High | Med | arch | unguarded | - | ingress-boundary blocks some route-level resolution; no comprehensive guard | - |
| CI-DOCTRINE-9 | (Core) tools strict, auditable, idempotent | every exposed tool has a declared schema, is idempotent-or-justified, audits via WorkTrace, respects governance constraints | High | Med | type | unguarded | - | `ToolDeclaration` schema + AuditLedger exist; no comprehensive guard that all tools meet every obligation | - |
| CI-DOCTRINE-10 | (Core) channel is ingress, not architecture | channel adapters resolve a deployment and submit through `PlatformIngress`, no alternative execution path | High | Med | arch | unguarded | - | `ChannelGateway.onMessage` calls `platformIngress.submit`; no guard forbids direct orchestrator calls from channel adapters | - |
| G22 | `feedback_worktrace_update_lock_two_shapes` | every consumer of `WorkTrace.update` handles BOTH lock shapes (prod `{ok:false}` / non-prod throws) | High | Lo | type | unguarded | - | `stranded-claim-reaper.test.ts:175-206` covers one consumer; a new consumer handling one shape is unguarded | - |
| G23 | `feedback_inngest_step_state_json_only` | `step.run` outputs are JSON-only (class instances lose methods on replay); `waitForEvent` matches on stable ids | Med | Hi | test | unguarded | - | `ugc-job-runner.ts:444` id-match works; no test pins the class-instance serialization failure | - |
| G24 | `feedback_dual_lifecycle_every_consumer_mode_aware` | every reader of a dual-mode lifecycle table (CreativeJob polished vs ugc) checks mode; binary `currentStage` checks misread ugc rows | Med | Hi | test | unguarded | - | `status-mapper.test.ts` covers some readers; classic N+1 - a new reader is unguarded (semantic sibling) | - |
| G25 | `feedback_skill_runtime_two_constraint_regimes` | the skill loop bound is `policy.maxLlmTurns`, NOT `ExecutionConstraints.maxLlmTurns` | Med | Med | test | unguarded | - | `skill-executor.ts:332` loop; no test pins which field is the loop bound | - |
| G26 | `feedback_design_token_collision_hsl_triplet` | ported CSS must not collide token names across HSL-triplet vs literal-color formats | Med | Med | test | unguarded | - | `inbox-design-base.css:15-73` scopes a redefinition; no import-order / format-consistency guard | - |
| G27 | `feedback_dashboard_global_css_cascade_order` | global CSS import order at equal specificity must not let later imports silently beat earlier ones | Med | Med | arch | unguarded | - | no arch check computes CSS import-order/specificity; caught only by live visual testing | - |
| G28 | `feedback_service_id_conventions` | `Connection.serviceId` reads use the canonical producer value (punctuation varies: `meta-ads` vs `google_calendar`) | Med | Med | lint | unguarded | - | many serviceId read sites; no mechanical check of canonical value | - |
| G29 | `feedback_literal_nul_byte_in_source` | no literal NUL byte (0x00) in source files | Med | Lo | ci | unguarded | - | no guard; a CI `grep -P '\x00'` over `*.ts/*.tsx/*.js` is the candidate | - |

## B. Already-guarded (37: confirmed a guard reds on the specific bad state; the loop confirms then skips)

| id | lesson / invariant | predicate (1 line) | blast | guard-type | status | guard location (confirmed file:line) | guard-covers |
|----|--------------------|--------------------|-------|------------|--------|--------------------------------------|--------------|
| G5 | `feedback_next_public_dynamic_env_not_inlined` | no computed-member `process.env[var]` in dashboard client code | Med | lint | guarded | `.eslintrc.json:274-279` (no-restricted-syntax) + `scripts/check-no-dynamic-public-env.ts:26` | all dashboard client files (eslint + CI script) |
| G7 | `feedback_new_mutating_route_needs_route_allowlist` | a new mutating route reaches PlatformIngress or is allowlisted | High | ci | guarded | `.agent/tools/check-routes.ts:71-79` + `.agent/tools/route-allowlist.yaml` | all mutating routes (CI `--mode=error`) |
| G30 | `feedback_store_mutation_org_scope_gate` | every Prisma store mutation has `organizationId` in WHERE (or a directive) | Crit | ci | guarded | `.agent/tools/store-mutation-check.ts:71-74` + tests | all `packages/db/src` store mutations (CI) |
| G31 | `feedback_whatsapp_phone_id_is_tenant_isolation_boundary` | per-org WhatsApp send fails closed when the org has no phone id (never a global fallback) | Crit | test | guarded | `packages/core/src/notifications/__tests__/proactive-sender.test.ts:299-312` | proactive-sender FROM-identity isolation |
| G32 | `feedback_connection_credentials_rmw` | credential blob read-modify-write is org-scoped optimistic-concurrency (`updateMany` + count) | High | test | guarded | `packages/db/src/storage/__tests__/prisma-connection-store.test.ts:164-189` | mergeCredentialsById read + write |
| G33 | `feedback_new_env_var_needs_allowlist` | a new `process.env` read is categorized in the env allowlist | Med | ci | guarded | `scripts/check-env-completeness.ts:64-93` + tests | all app `process.env` reads (CI) |
| G34 | `feedback_cron_submit_seeded_system_principal` | cron submits use the seeded `{id:"system",type:"system"}` principal | Crit | test | guarded | `apps/api/src/__tests__/recommendation-handoff-cron-live-path.test.ts:282` | recommendation-handoff cron via real ingress + gate |
| G35 | `feedback_autonomy_fields_stored_not_enforced` | `spendApprovalThreshold` is enforced post-gate via `applySpendApprovalThreshold` | High | test | guarded | `packages/core/src/platform/__tests__/spend-approval-threshold.test.ts:45-133` | downgrade / park / immunity / dormancy |
| G36 | `feedback_operator_mutation_deployment_resolution_gap` | operator_mutation intents resolve platform-direct (no `deployment_not_found` on unseeded slug) | High | test | guarded | `apps/api/src/__tests__/platform-deployment-resolver.test.ts:142-170` | operator_mutation predicate fallback |
| G37 | `feedback_workflow_intent_deployment_not_found` | workflow intents without a real deployment resolve platform-direct, not throw | High | test | guarded | `apps/api/src/__tests__/platform-deployment-resolver.test.ts:256-311` | `PLATFORM_DIRECT_WORKFLOW_INTENTS` drift guard |
| G38 | `feedback_queued_outcome_post_approval_lifecycle` | post-approval queued outcomes record as non-failure | High | test | guarded | `packages/core/src/platform/__tests__/platform-lifecycle.test.ts` (queued-non-failure case) | core post-approval path |
| G39 | `feedback_threaded_outcome_failclosed_at_seam` | a discriminated outcome threaded across a dist seam fails closed (safeParse, no fallback coercion) | Crit | test | guarded | `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts` (FAILS CLOSED case) | lead.intake seam (other dist seams uncovered) |
| G40 | `feedback_lifecycle_respond_fork_no_dispatch` | approval response ends in dispatch-or-recovery, never a bare approve | High | test | guarded | `packages/core/src/approval/__tests__/respond-via-lifecycle.test.ts` | fork + chat-gateway approve (open: WA template, Telegram 64B) |
| G41 | `feedback_system_auto_approved_bypasses_spend_gates` | system-auto-approved never bypasses spend gates; financial intents fall through to full policy | Crit | test | guarded | `packages/core/src/platform/governance/__tests__/governance-gate-auto-approved-financial.test.ts` | static spendBearing throw + runtime denylist |
| G42 | `feedback_at_most_once_needs_presend_claim` | clear `nextRetryAt` BEFORE the send so a failed post-send write never re-queues | High | test | guarded | `packages/db/src/stores/__tests__/prisma-robin-recovery-send-store.test.ts:117-142` | markSendInFlight + findDue null-exclusion |
| G43 | `feedback_idempotency_reuse_checktime_fingerprint` | the fingerprint is computed once and reused (check == store) via WeakMap stash | Crit | test | guarded | `apps/api/src/middleware/idempotency.ts:87-103` + `api-idempotency.test.ts:74` | headerless replay dedupe |
| G44 | `feedback_sql_take_before_filter_starvation` | take+filter split so SQL bounds the pending set, not the all-matching set | Med | test | guarded | `packages/db/src/stores/__tests__/prisma-creative-job-store-slice2.test.ts:115-129` | never-captured leg bounding |
| G45 | `feedback_floor_reads_windowed_projection_not_cohort` | a floor/gate reads the aggregate over the full cohort, not the display-windowed list | Med | arch | guarded | `packages/core/src/creative-read-model/build-read-model.ts:78-81` | counts over full cohort before slice |
| G46 | `feedback_switchboard_metrics_dual_prom_constructor` | a new metrics counter is added to all three registries (core + api + chat) or typecheck fails | High | type | guarded | `packages/core/src/telemetry/metrics.ts:7-102` interface + 3 constructors | `pnpm typecheck` over all three |
| G47 | `feedback_surface_agnostic_backend` | backend layers never import UI surfaces | Med | lint | guarded | `.eslintrc.json` core:180 / db:143 / ad-optimizer:79 (no-restricted-imports) | core, db, ad-optimizer |
| G48 | `feedback_deployment_resolver_listing_status_active_bug` | the resolver gates on `listing.status === "listed"`, not `"active"` | Crit | test | guarded | `packages/core/src/platform/__tests__/deployment-resolver.test.ts:75-88` | all resolution paths via toResult |
| G49 | `feedback_erasure_phone_shapes_and_parent_keyed_pii` | erasure matches every phone shape + purges parent-id-keyed PII + fixes ConversationState linkage | Crit | test | guarded | `packages/db/src/stores/__tests__/prisma-contact-store-erasure.test.ts:246` | phone shapes, Receipt/ReceiptedBooking, ConversationState |
| G50 | `feedback_react_query_enabled_false_isloading` | gate loading UI on `!data && !error`, not `isLoading` (enabled:false yields isLoading:false) | Med | test | guarded | `apps/dashboard/src/app/(auth)/(mercury)/reports/__tests__/reports-page-pending.test.tsx:32-37` | reports/activity/pipeline pending pages |
| G51 | `feedback_dashboard_no_js_on_any_import` | dashboard imports omit `.js` extensions (Turbopack rejects them) | Med | ci | guarded | `.github/workflows/ci.yml:224-228` (dashboard `next build`) | all dashboard imports (build reds on missing `.js`) |
| G52 | `feedback_vitest_untyped_fn_breaks_chat_build` | typed `vi.fn` args required or `tsc` over tests reds the chat/api build | Med | type | guarded | `apps/chat/tsconfig.json` include `src` + `ci.yml:63` build | apps/chat + apps/api test files (tsc) |
| G53 | `feedback_cockpit_token_system` | inline cockpit tokens reference globals.css var() (no hardcoded hex); amber sole action | High | lint | guarded | `apps/dashboard/src/app/__tests__/token-governance.test.ts:153-157` | cockpit/tokens.ts, alex/riley configs (no hex) |
| G54 | `feedback_canvas_overlay_background_blend_not_layer` | full-bleed texture blends via `background-blend-mode`, not a stacked layer; money cards opaque | Med | lint | guarded | `apps/dashboard/src/app/__tests__/token-governance.test.ts:412-417,489-495` | body grain rule + Results cards opaque |
| G55 | `feedback_ci_security_audit_gate` | `pnpm audit --audit-level=high` is a required CI gate | High | ci | guarded | `.github/workflows/ci.yml:356` | high/critical advisories in deps |
| G56 | `feedback_commitlint_subject_case_lowercase` | commit subject is lowercase (conventional commits) | Low | lint | guarded | `commitlint.config.js` (extends config-conventional) | every commit (husky commit-msg) |
| G57 | `feedback_prisma_index_name_63_char_limit` | hand-written migration index names match Prisma-truncated names (Postgres 63-char limit) | High | ci | guarded | `scripts/check-prisma-drift.sh:73-78` + `ci.yml:56-57` (`migrate diff --exit-code`) | all migrations vs schema |
| G58 | `feedback_anthropic_strict_tool_schema_no_minmax` | Anthropic strict tool schemas omit min/max/length/pattern/format keywords | High | test | guarded | `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts:137-149` + `anthropic-tool-adapter-strict.test.ts:54-61` | strictenToolSchema forbidden-keyword set |
| G59 | `feedback_skill_md_loader_traps` | skill loader validates tool refs + frontmatter params (+ slug pinned at bootstrap) | Med | test | guarded | `packages/core/src/skill-runtime/skill-loader.ts:63-101` + `skill-loader.test.ts:90-169` | traps 1 + 3 (trap 2 slug-mismatch lacks an explicit unit test) |
| CI-DOCTRINE-1 | (Core) one control plane | every governed action enters via `PlatformIngress.submit()` | Crit | test | guarded | `apps/api/src/__tests__/ingress-boundary.test.ts:14-57` + `.eslintrc.json:220-234` | all api routes (text-scan + eslint) |
| CI-DOCTRINE-6 | (Core) idempotency at ingress | `idempotencyKey` enforced at ingress; fingerprint immutable across the request | High | test | guarded | `apps/api/src/__tests__/api-idempotency.test.ts:42-352` | replay dedupe + cross-route/org/actor mismatch |
| CI-DOCTRINE-11 | (Core) cross-app types live in schemas | a local type colliding with a `@switchboard/schemas` export is a violation | Med | lint | guarded | `.agent/tools/cross-app-types-check.ts` (CI `--mode=error`) | new local type declarations in apps/* |
| CI-DOCTRINE-12 | (Core) routes classified; class enforced | every route declares `@route-class`; per-class matrix enforced | High | ci | guarded | `.agent/tools/route-class-validator.ts` + `check-routes.ts` (CI `--mode=error`) | api/chat routes + dashboard non-proxy |
| CI-LAYERS | (Core) dependency layers, no cycles | schemas leaf; core !-> db/creative/ad-optimizer/apps; apps !-> apps | Crit | lint | guarded | `.eslintrc.json:27-212` (no-restricted-imports per package) | all package import boundaries |

## C. Operational-skip (59: agent-behavior / process / tooling / flake; never selected by the loop)

| id | lesson / invariant | bucket reason (one line) |
|----|--------------------|--------------------------|
| G8 | `feedback_no_em_dashes` | writing-style preference, not a code invariant |
| G60 | `feedback_governance_spine_merge_needs_explicit_consent` | merge-workflow human-consent process, not a code invariant |
| G61 | `feedback_safety_gate_needs_producer_population` | per-gate discipline (verify live producer), baked into the loop AUTHORITY; not one predicate |
| G62 | `feedback_operator_mutation_owner_action_recipe` | a registration recipe (operator_mutation + system_auto_approved), not a single regression predicate |
| G63 | `feedback_new_skill_intent_governance_recipe` | a multi-step seeding recipe; each concern has its own guard |
| G64 | `feedback_modes_not_knobs` | product principle (hardcode modes before knobs), not a code invariant |
| G65 | `feedback_arch_job_path_filter_route_debt` | a one-time CI workflow path-filter config fix, not a recurring invariant |
| G66 | `feedback_connection_vs_deployment_connection` | architecture knowledge (two distinct models), not a mechanical check |
| G67 | `feedback_store_tightening_gate_needs_app_tests` | a testing discipline (app tests catch store-signature tightening), not one predicate |
| G68 | `feedback_unswallow_not_durable_without_drainer` | "captured != durable" needs a drainer; no mechanical check for "something drains it" (active PR #1342) |
| G69 | `feedback_meta_ads_client_rate_limiter_fresh_instance` | a fresh-client-per-call review pattern, not CI-enforceable |
| G70 | `feedback_learning_loop_two_layers` | a conceptual layer distinction (correctness vs compounding-quality) |
| G71 | `feedback_prod_deploy_dashboard_db_env` | launch-checklist documentation maintenance |
| G72 | `feedback_fixtures_as_product_copy` | a product-copy quality bar, human-reviewed |
| G73 | `feedback_dashboard_build_not_in_ci` | resolved (#803); dashboard build now runs in CI |
| G74 | `feedback_dashboard_coverage_threshold` | config reference (dashboard has its own threshold) |
| G75 | `feedback_token_namespaces_not_binary` | design-doc verification against surface specs, not auto-gatable |
| G76 | `feedback_cockpit_shell_pr_scope` | PR-scoping discipline (A.1-A.N slicing), code-review-gated |
| G77 | `feedback_anchor_on_role_scorecard` | design philosophy (anchor on the role scorecard, not AI elegance) |
| G78 | `feedback_arch_check_ts_only` | be-aware: arch-check is `.ts`-only and counts raw lines (tooling behavior) |
| G79 | `feedback_build_typechecks_dead_files` | be-aware: tsc/build typechecks dead files (grep importers before deleting) |
| G80 | `feedback_ci_arch_lint_check_merge_result` | be-aware: CI checks the PR merge result, not the branch alone |
| G81 | `feedback_ci_prettier_not_in_local_lint` | be-aware: prettier runs in CI format:check, not local `turbo lint` |
| G82 | `feedback_pnpm_audit_time_triggered_advisory` | a freshly-published advisory reds independent of your diff (time-triggered) |
| G83 | `feedback_codeql_missing_rate_limiting_false_positive` | CodeQL false positive on a non-required check |
| G84 | `feedback_prisma_migrate_dev_tty` | local-tooling: `prisma migrate dev` needs a TTY (use diff + deploy) |
| G85 | `feedback_db_integrity_tests_pg_advisory_lock` | pre-existing pg_advisory_lock test flake (verify on baseline) |
| G86 | `feedback_reset_vs_build_and_chat_flake` | fresh-worktree hygiene + a load-sensitive test flake |
| G87 | `feedback_api_auth_prod_hardening_ci_flake` | CI flake (passes on rerun and locally) |
| G88 | `feedback_api_bootstrap_smoke_npm_warn_flake` | pre-existing env flake (npm warning contaminates stderr) |
| G89 | `feedback_role_floor_needs_identity_mock_retrofit` | a test-harness retrofit discipline + design rule; role-floor behavior is tested (action-lifecycle.test.ts) |
| G90 | `feedback_prompt_cache_min_and_locations` | cache placement is tested; min-token threshold is optimization knowledge |
| G91 | `feedback_model_routing_by_phase` | agent model-routing doctrine, a per-task decision |
| G92 | `feedback_alex_eval_mock_tools_blind` | eval methodology (cover tool logic with unit tests; eval is conversation-only) |
| G93 | `feedback_verify_against_codebase` | agent review discipline (grep/read/typecheck, not mental model) |
| G94 | `feedback_verify_actual_check_conclusions` | merge-gate discipline (read `gh pr checks` conclusions) |
| G95 | `feedback_per_slice_review_misses_cross_slice_seams` | review process + per-feature contract-pin tests, not one global predicate |
| G96 | `feedback_plan_review_gating_capture_sha` | plan-writing discipline (capture approval SHA) |
| G97 | `feedback_gh_pr_merge_worktree_local_switch` | git-CLI mechanics (merge from primary worktree) |
| G98 | `feedback_auto_merge_captures_head_early` | GitHub behavior (disable --auto before late pushes) |
| G99 | `feedback_auto_merge_stacked_pr_no_protection` | GitHub behavior (auto-merge fires immediately on unprotected base) |
| G100 | `feedback_stacked_squash_merge_hazards` | git stacked-PR workflow mechanics |
| G101 | `feedback_subagent_worktree_drift` | agent process (enforce cwd per Bash); check-branch-relevance.sh only warns |
| G102 | `feedback_worktree_shared_refs_three_dot_diff` | git mechanics (use three-dot diffs) |
| G103 | `feedback_worktree_env_sync_corruption` | dev-tooling: `.env.local` is local-only/gitignored, not CI-reachable |
| G104 | `feedback_worktree_init_postgres_down` | dev-tooling: a one-time worktree-init script fix |
| G105 | `feedback_audit_blockers_already_done` | agent process (verify shipped state before spec) |
| G106 | `feedback_audit_driven_fix_workflow` | agent workflow (verify -> fan-out -> per-fix PRs + TDD) |
| G107 | `feedback_workflow_usage_cap_resume` | tooling process (resume via scriptPath + resumeFromRunId) |
| G108 | `feedback_ship_clean_not_followup` | developer discipline (fix before merge, no TODO-rot) |
| G109 | `feedback_concurrent_session_cross_cutting_actions` | agent process (re-check gh pr list + git worktree list) |
| G110 | `feedback_dev_stack` | dev-environment setup procedure |
| G111 | `feedback_local_dev_server_launch` | dev-server launch procedure |
| G112 | `feedback_obsidian_wikilinks_use_exact_filename` | harness memory-file hygiene (outside product CI) |
| G113 | `feedback_no_codex` | agent tool-choice process lesson |
| G114 | `feedback_type_only_import_and_stalled_subagent_recovery` | be-aware (vitest-green != `turbo typecheck`-green; the required typecheck job already reds on a missing cross-package dep, even for `import type`) + stalled-subagent recovery process; not a code invariant |
| CI-DOCTRINE-2 | (Core) one lifecycle spine | architectural principle (platform owns all transitions); legacy bridge being retired |
| CI-DOCTRINE-3 | (Core) one persistence truth | architectural principle (WorkTrace canonical, no parallel persistence) |
| CI-DOCTRINE-8 | (Core) human override is first-class | architectural principle (approval/undo/halt are core lifecycle ops) |

## Seed rows (the 8 worked examples; ids G1-G8 preserved, now subsumed into the full classification above)

The original seed rows are G1-G8. Slice 0 confirmed each on `origin/main`:
- G1 consent revoked-masking: `unguarded` confirmed (gate test exists, schema unit + calendar-book sibling gap remain). The expected first real guard.
- G2 governed-dispatch: `unguarded` confirmed (2 callers tested, no structural guard over all callers).
- G3 reaper guarded-claimant: `unguarded` confirmed (booking re-claim tested, no structural guard over all re-claim paths).
- G4 messagingOptIn: `unguarded` confirmed (gate-layer tests, no "never branch on messagingOptIn" guard).
- G5 dynamic NEXT_PUBLIC env: `guarded` confirmed (`.eslintrc.json` + `check-no-dynamic-public-env.ts`).
- G6 allowedTriggers: `unguarded` confirmed (set-membership tested, route 403 + new-intent unguarded).
- G7 new mutating route allowlist: `guarded` confirmed (`check-routes` + `route-allowlist.yaml`).
- G8 no em-dashes: `operational-skip` confirmed (writing-style preference).

## Prioritization rubric

Rank by **blast-radius x regression-likelihood x not-already-guarded**. The loop always takes the
top `unguarded` row; `operational-skip` rows are never selected.

- **Blast-radius** (reusing the merge-stop glob taxonomy): regulated / money / auth / governance /
  consent / PDPA (Crit) > data-integrity / idempotency / tenant-isolation (High) > decision-engine
  correctness (Med) > dev-ergonomics / CI hygiene (Low).
- **Regression-likelihood**: a fix that lives in exactly one place, on a hot-change path, with known
  siblings, regresses most easily and ranks up.

## Slice 0 instructions (the bootstrap triage) - COMPLETED 2026-06-27

(Retained for provenance.) Slice 0 ran a read-only Explore fan-out over all 114 `feedback_*.md` plus
the `CLAUDE.md` Core Invariants and `docs/DOCTRINE.md`, classified each into exactly one bucket with
the strengthened already-guarded bar (open the candidate guard, confirm it reds on the specific bad
state, record `file:line`), set blast-radius + regression-likelihood per the rubric, and filled the
bucket counts (no silent cap). The classification is sections A/B/C above.
