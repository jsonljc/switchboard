# Ad Optimizer Wedge v1 — Pilot Validation Runbook

**Pilot account:** Singapore pilot (same as Alex wedge sprint, after Alex passes its 9 criteria)
**Flag:** `attribution_v1_enabled` per deployment
**Spec:** `docs/superpowers/specs/2026-04-26-ad-optimizer-wedge-v1-design.md`
**Plan:** `docs/superpowers/plans/2026-04-26-ad-optimizer-wedge-v1.md`

## Pre-flight

- [ ] Meta OAuth connected, ad account selected
- [ ] WhatsApp Business webhook subscription confirmed in Meta App settings
- [ ] Meta Lead webhook subscription confirmed
- [ ] CAPI access token + Pixel ID set in deployment env
- [ ] Onboarding `CoverageValidator` run; coverage report visible in dashboard onboarding surface (Task 17 component)

## Day 0 — flag flip

- [ ] `attribution_v1_enabled = true` for pilot deployment
- [ ] Send a test CTWA click → confirm `Contact` row created with `sourceType=ctwa` + `attribution.ctwa_clid`
- [ ] Submit a test Instant Form lead → confirm `Contact` row created with `sourceType=instant_form` + `attribution.leadgen_id`
- [ ] Confirm CAPI Lead event visible in Meta Events Manager for the IF lead with `action_source=system_generated`
- [ ] Verify `MetaCAPIDispatcher` (the active production CAPI path) is the only dispatcher firing — `OutcomeDispatcher` remains dormant per deferred Task 11 decision

## Day 1–7 — operating window

- [ ] At least one CTWA lead booked by Alex → CAPI event visible in Meta Events Manager (under the existing MetaCAPIDispatcher event_name contract — see deferred OutcomeDispatcher migration note)
- [ ] At least one IF lead marked qualified by operator → CAPI Lead event visible
- [ ] No double CAPI dispatches per booked event (verify via Events Manager event count vs. lifecycle event count for the same Contact)
- [ ] Coverage validator output produced; ≥80% spend coverage for non-Web campaigns
- [ ] No new mutation paths surfaced (verify via grep on `apps/api/src/services/`: only `InstantFormAdapter` and `CtwaAdapter` create Contacts from Meta sources)

## Day 7 — first audit

- [ ] Monday cron runs successfully (`createWeeklyAuditCron`)
- [ ] Audit report shows non-zero per-source funnel data for both CTWA and Instant Form (`bySource.ctwa` and `bySource.instant_form` populated, `received >= 1`)
- [ ] Source comparison card renders in dashboard with differentiated metrics across CTWA and IF
- [ ] At least one outcome-aware diagnosis or recommendation generated (e.g., `lead_quality_degradation`, `ctwa_drive_by_clickers`, `shift_budget_to_source`, `switch_optimization_event`)
- [ ] `RealCrmDataProvider` confirmed active (not stub); `orgId` resolved from deployment record (no `"TODO"` strings in audit output)
- [ ] `WorkTrace` shows correct parent/child linkage for IF lead workflow → `lead.intake` work unit (Task 7 trace continuity fix)

## Sign-off

- [ ] All boxes checked → declare v1 ready
- [ ] Document any gotchas in this runbook for future pilots
- [ ] File follow-up tasks for known deferrals:
  - **OutcomeDispatcher migration audit** (deferred from Task 11): audit current Meta CAPI event_name consumers (datasets, custom conversions, optimization rules) before activating `OutcomeDispatcher`. The two dispatchers map ConversionStage → CAPI event_name differently. See migration plan in `apps/api/src/bootstrap/outcome-wiring.ts`.
  - **`showed` lifecycle stage** (deferred from Task 12): no schema model exists today. Add when Alex tracks appointment attendance.
  - **Spend-attribution confidence surface** (deferred from Task 14): `shift_budget_to_source` recommendations currently use moderate confidence (0.6); a per-source `attributionMethod` indicator would let downstream consumers downweight fallback-attributed sources.
  - **Audit-runner pre-existing typecheck errors** (`funnelShape`, `learningStatus.state`): unrelated to this wedge but visible in `pnpm typecheck`. Fix in dedicated task.
  - **Web `fbclid` capture + `action_source=website` dispatch path** (v2 scope): per spec.

## Failure protocol

- Any CTWA lead arriving without `ctwa_clid` → check WhatsApp parser captured referral correctly (Task 3 logic in `apps/chat/src/adapters/whatsapp-parsers.ts`)
- Any IF lead failing to create Contact → check `meta-lead-intake-workflow` retry queue (`PendingLeadRetry`) and the `InstantFormAdapter` route (Task 7 refactor)
- Audit produces stub-shaped data (all zeros) → verify `RealCrmDataProvider` wiring in `apps/api/src/bootstrap/inngest.ts`; the `_deploymentId → organizationId` plumbing should resolve a real org ID
- CAPI events double-firing → an OutcomeDispatcher subscription was accidentally re-enabled. Revert; it must remain dormant until the migration audit completes.

## Rollback

If any day-0 or day-1 check fails:

1. Set `attribution_v1_enabled = false` for the pilot deployment
2. The legacy code paths (`PrismaContactStore.create` direct calls) have been removed in this wedge — no rollback to the pre-wedge state without reverting the merge commit
3. Document the failure mode in this runbook and re-enter the validation cycle after fix
