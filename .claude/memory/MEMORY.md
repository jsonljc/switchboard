# Switchboard Project Memory

## North Star

- [Revenue OS Pivot](project_revenue_os_pivot.md) — 3-module revenue system (Creative, Ad Optimizer, Lead-to-Booking), marketplace substrate preserved, product surface replaced

## Architecture (COMPLETE — guard invariants, no more passes)

- [Architecture Complete](project_architecture_complete.md) — convergence done 2026-04-19, mandate is capability building, guard invariants only
- [No More Architecture Passes](feedback_no_more_architecture.md) — enforce invariants silently, don't reopen the system
- [Native Runtime](native-runtime.md) — sessions, workflows, scheduler, operator chat (all phases complete)
- [Thin Harness, Fat Skills Pivot](project_thin_harness_pivot.md) — domain logic → markdown skills, governance stays as thin harness
- [Platform Convergence Shipped](project_platform_convergence_shipped.md) — contract established 2026-04-16
- [Ingress Convergence](project_ingress_convergence.md) — all commits landed via PRs #209-#212

## Agent-First Dashboard Redesign (ACTIVE)

- [Redesign Roadmap](project_agent_first_redesign.md) — phased A→E roadmap, slice status, PR tracking. Slice A shipped, Slice B S1 shipped / S2–S6 pending
- [Recommendations Backend v1](project_recommendations_backend_v1.md) — routing rail + shadow auto-actions SHIPPED (PR #357). v1.5/v2/v3 deferred, ShadowActionList unwired
- [Reports Backend v1](project_reports_backend.md) — /reports deep-dive. PR-R1 in flight on feat/reports-backend-v1, R2–R6 not started
- [Console Redesign](project_console_redesign.md) — launch readiness + phase 1 + phase 2 all SHIPPED. Separate track, no Phase 3 spec yet

## Shipped (historical — kept for reference)

- [Revenue Loop Closure](project_revenue_loop_closure.md) — calendar booking → attribution → ROI dashboard. SHIPPED 2026-04-18 (PR #209)
- [Alex Wedge Live Wiring](project_alex_wedge_live_wiring.md) — skill runtime + booking into Alex WhatsApp. SHIPPED 2026-04-18 (PR #210)
- [SP4 Full Operator Controls](project_sp4_operator_controls.md) — conversation browser, override, escalation inbox. SHIPPED 2026-04-24
- [Pre-Launch Hardening](project_pre_launch_hardening.md) — 3-track staged hardening, api-client split, error contract. SHIPPED 2026-04-22
- [Navigation Cleanup](project_nav_cleanup_shipped.md) — staff view removed, owner-only nav. SHIPPED 2026-04-21

## Ongoing Tracks

- [Ad Optimizer vs Meta MCP](project_ad_optimizer_vs_meta_mcp.md) — MCP=data pipe, ad-optimizer=intelligence layer. 3 gaps, 4 MCP tools
- [WhatsApp Completeness](project_whatsapp_completeness.md) — Tech Provider + messaging richness, Phase 0 (Meta App Review) in progress
- [WhatsApp Biz API Blockers](project_whatsapp_biz_api_blockers.md) — 3 code blockers + 7 external admin gates

## Feedback

- [Scan data always check_this](feedback_scan_always_check_this.md) — scan-hydrated fields never ready, only user-confirmed content upgrades
- [Decompose parsers](feedback_decompose_parsers.md) — per-section pure functions, not monolithic switches
- [Stop over-reading before writing](feedback_stop_over_reading.md) — gather essential context then write immediately
- [Terse responses preferred](feedback_terse_responses.md) — user is decisive, don't over-explain choices
- [Migration sequencing](feedback_migration_sequencing.md) — deterministic-heavy before latent-heavy
- [Interpretive not extractive](feedback_interpretive_not_extractive.md) — skills produce decision-ready intelligence
- [Infrastructure serves the wedge](feedback_infrastructure_serves_wedge.md) — infra must accelerate the revenue loop
- [Verify before recommending](feedback_verify_before_recommending.md) — search codebase before proposing to build
- [Prove wedge before system](feedback_wedge_before_system.md) — Alex alone must prove conversion loop first
- [Sharper commercial metrics](feedback_sharper_metrics.md) — measure booking completion not link delivery
- [Separate cleanup from positioning](feedback_cleanup_vs_positioning.md) — don't mix dead code removal with label/IA changes
- [Token efficiency practices](feedback_token_efficiency.md) — /clear between task switches, haiku for simple lookups
- [Capabilities explicitly present](feedback_capabilities_explicitly_present.md) — declare, surface degradation, never emulate
- [Simulation hook invariants](feedback_simulation_hook_invariants.md) — substituteResult requires decision=undefined
- [Slice B architecture alignment](feedback_slice_b_architecture_alignment.md) — blocks under agent-home/, don't duplicate dashboard types in core, Mira excluded not stubbed

## User

- [Seller not operator](user_role_seller.md) — user sells Switchboard to SMB owners; end users are SMB owners + their teams

## References

- [Meta Lead Ads Model](reference_meta_lead_ads_model.md) — webhook trigger only, leadgen_id is key, bulk read for recovery

## Gotchas

- **Next.js uses extensionless imports** — `.js` extensions break webpack. All other packages use `.js` per ESM.
- **pnpm not globally installed** — use `npx pnpm@9.15.4`
- **Turborepo cache can mask errors** — use `--force` flag when debugging
