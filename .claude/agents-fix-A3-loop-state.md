# A3 First-touch greeting gate — loop state (orchestration scratch, not committed)

Durable record: [[project_all_agents_improvement_audit]]; plan slice A3 in
docs/superpowers/plans/2026-06-20-all-agents-fix-plan.md (on main).

Goal: gate the first-touch WhatsApp greeting through the approved-template + source-aware
opt-in checks its siblings enforce (D2 LOCKED), not consent-only + raw template POST.
Authority: SURFACE-before-merge (user-set; consent+send+templates trip merge-stop globs anyway).
Task-size: standard (one bounded PR).
Base: origin/main @ a49f97cbe (re-fetched). baseline_sha: a49f97cbe (set at PLAN).
Worktree: .claude/worktrees/agents-fix-a3-greeting branch fix/greeting-first-touch-gate
(RE-CREATED off fresh origin/main this session — a concurrent session had pruned the empty
original worktree+branch mid-ORIENT; no PR/branch for A3 existed, so no rival session).
merge_safety: stop-glob touched = YES (consent + external send + templates). NO prisma (enum
value + registry entries only, no schema column → no migration). independent_review = pending.

## Ground-truth brief (tool-verified at ORIENT)

- TRIGGER: meta.lead.greeting.send is spawned ONLY by meta-lead-intake-workflow.ts:148-162
  (Instant-Form leads). No CTWA path reaches it (CTWA → chat-side lead-intake-handler, A2's path).
  So today the greeting fires for IF leads only; D2's CTWA branch is future-proofing.
- CURRENT GATE (meta-lead-greeting-workflow.ts): only evaluateConsentGate(proactive); special
  branch consent_pending + ctwaOptIn → ctwa_optin send; then POSTs input.templateName raw
  (no approval check, no window/opt-in, no registry). Body param = firstName only.
- EVALUATOR (packages/core/src/notifications/proactive-eligibility.ts): evaluateProactiveSendEligibility
  order = (1) evaluateConsentGate proactive [blocks pending AND revoked], (2) canSendWhatsAppTemplate
  (window OR messagingOptIn) → no_optin, (3) resolveTemplate approval-overlay → no_template /
  template_not_approved / marketing_blocked. Inputs already carry messagingOptIn,
  lastWhatsAppInboundAt, jurisdiction, approvalOverlay, allowMarketingTemplate, selectTemplateFn.
  CRUX: step 1 blocks consent_pending → bare-delegating kills the operative IF-lead case
  (brand-new SG/MY lead = pending). The ONLY first-touch difference is step 1's pending treatment.
- WINDOW (whatsapp-window.ts): inbound<24h → allowed (CTWA user-initiated); else messagingOptIn
  → allowed (IF ad-form opt-in); else no_optin. = D2's source-aware basis EXACTLY.
- PRODUCER GAP (load-bearing, feedback_safety_gate_needs_producer_population): IF leads get
  messagingOptIn=FALSE. buildInstantFormIntake (instant-form-adapter.ts:45-63) never sets channel;
  handler (lead-intake-handler.ts:58-78) only captures web_form opt-in when channel==="whatsapp".
  VERIFIED SAFE to set channel:"whatsapp" for phone-bearing IF leads — only side-effect is the
  intended opt-in capture; primaryChannel/firstTouchChannel already default "whatsapp"
  (lead-intake-store.ts:71). No dedup/jurisdiction/attribution change.
- GREETING PRODUCER (contained-workflows.ts:427-447): bespoke, reads only 4 consent fields +
  ctwaOptIn = messagingOptInSource==="ctwa"; does NOT resolve lastWhatsAppInboundAt. The reminder
  producer buildWhatsAppSendContext (304-343) already assembles every eligibility input incl.
  approvalOverlay = parseTemplateApprovalOverlay(runtimeConfig.whatsappTemplateApprovals) + businessName.
- REGISTRY (whatsapp-registry.ts): 5 intentClasses, 10 entries, none first-touch. IntentClass enum
  = packages/schemas/src/intent-class.ts. NO exhaustive switch/Record consumer → safe enum add.
  registry test asserts toHaveLength(10) [→12], banned-phrase scanner + no-efficacy-verb on bodies.
- ProactiveSkipReason (scheduled-follow-up.ts:35-43) already covers all reasons; no schema change.
- TESTS: greeting unit test = apps/api/src/services/workflows/**tests**/meta-lead-greeting-workflow.test.ts
  (full rewrite — built on ctwaOptIn context). Integration proactive-intake-live-path.test.ts SAFE
  (stub handler, not real greeting). meta-lead-intake-workflow.test.ts may assert templateName child param.

## DESIGN (FRAME) — chosen: extend canonical evaluator + fix producer

- Add IntentClass "first-touch-greeting" (schemas enum).
- Registry: +2 entries (SG/MY), marketing, draft, body = greet + {{business_name}} sender-id +
  "reply STOP to opt out", vars [lead_name, business_name]. No em-dash, no banned/efficacy phrase.
- evaluateProactiveSendEligibility: add optional firstTouch?: boolean. When true, relax the
  consent_pending block (revoked STILL blocks; defers to step 2 window/opt-in basis). Default
  false → reminder/followup/Robin unchanged.
- Greeting workflow: route through evaluateProactiveSendEligibility({intentClass:"first-touch-greeting",
  allowMarketingTemplate:true (hardcoded, Robin pattern), firstTouch:true}); send
  eligibility.template.metaTemplateName with body [firstName, businessName]; record skip on block.
  New GreetingSendContext = full eligibility-input shape. Drop templateName param.
- Greeting producer: reuse buildWhatsAppSendContext (resolve lastWhatsAppInboundAt by contactId+org
  thread, like reminder).
- IF adapter: set channel:"whatsapp" for phone-bearing IF leads (producer-population → opt-in).
- Intake: drop templateName forward to greeting child (keep route/schema greetingTemplateName; note superseded).
- Rejected: (Option-1 compose-in-greeting) drifts from canonical evaluator; (Option-2 record ad-form
  opt-in as consentGrantedAt) broad consent-semantics change, collides A10. Option-3 (above) centralizes.

FAN-OUT GRADE (3 adversarial subagents, 2026-06-21): all REVISE, none challenged the approach.
Refinements locked (each verified vs code, receiving-code-review triage):

- R1 [all3 BLOCK] firstTouch relax = `!(firstTouch && reasonCode==="consent_pending")`, NOT a step-1
  short-circuit; revoked always blocks. MUST test firstTouch+revoked→consent_revoked.
- R2 [2 BLOCK] send BOTH params [firstName, ctx.businessName] vs the 2-var template, else Meta #132000.
- R3 [2 BLOCK] greeting unit test full rewrite (13 literals + drop templateName) + producer swap.
- R4 [WARN] add "first-touch-greeting" to intent-class.test.ts loop + registry selectTemplate loop.
- R5 PUSH-BACK (verified): DROP ctwaOptIn; greeting reads messagingOptIn column (true for ctwa AND
  web_form). firstTouch relaxes pending; step-2 messagingOptIn/window IS the enforced basis (no
  opt-in source → messagingOptIn=false → no_optin). D2's intended generalization. No prod consumer
  reads greeting outputs (CODE-GROUNDED confirmed) → outputs shape change safe.
- R6 producer fix (channel:"whatsapp" IF leads) MUST land same PR + test driven from REAL adapter→handler.

| step                     | done-condition (test/cmd)                                                                                | RED proof                          | status | evidence     |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ | ------------ |
| 1 schemas enum           | intent-class.test.ts loop incl first-touch-greeting                                                      | RED: invalid enum value            | DONE   | 4/4 pass     |
| 1b phone helper          | phone.test.ts jurisdictionFromE164 (+65→SG/+60→MY/else null)                                             | RED: not exported                  | DONE   | 17/17 pass   |
| 2 registry +2            | whatsapp-registry.test.ts len 12 + loop + first-touch marketing/optout + banned-phrase scanner           | RED: 3 fail (len/marketing/optout) | DONE   | 21/21 pass   |
| 3 eligibility firstTouch | proactive-eligibility.test.ts: relax/revoked-blocks/false-unchanged/no_optin-floor/window/template-floor | RED: 4 fail (consent_pending)      | DONE   | 15/15 pass   |
| 4 greeting workflow      | meta-lead-greeting-workflow.test.ts rewrite (14 cases)                                                   | RED: 6 fail                        | DONE   | 14/14 pass   |
| 5 greeting producer      | buildWhatsAppSendContext reuse; api tsc --noEmit                                                         | RED: old shape                     | DONE   | api tsc PASS |
| 6 IF adapter             | instant-form-adapter.test.ts phone→channel whatsapp (consumer half already pinned handler.test:88)       | RED: channel undef                 | DONE   | 17/17 pass   |
| 7 intake cleanup         | meta-lead-intake-workflow.test.ts green (no templateName forward)                                        | n/a (cleanup)                      | DONE   | 7/7 pass     |

EXECUTE REVISE (mid-step-4, bounded): IF leads have pdpaJurisdiction=NULL (stamped only at a
governed interaction; OrganizationConfig has no jurisdiction field). Consent gate handles null
(not_applicable→allow) but template selection (eligibility step-3) needs a non-null jurisdiction,
else no_template dark-holes every IF greeting. FIX: greeting workflow resolves jurisdiction =
ctx.jurisdiction ?? jurisdictionFromE164(input.phone) (+65→SG/+60→MY). New tested helper
jurisdictionFromE164 in packages/schemas/src/phone.ts. buildWhatsAppSendContext UNCHANGED (fallback
is greeting-only → reminder/followup/Robin untouched). Reorder greeting: phone-check FIRST (no-phone
→ missing_contact_phone), then eligibility (jurisdiction available), creds, send. firstTouch still
kept (no-op for null-juris not_applicable leads; correct for any future stamped-pending lead).

VERIFY (2026-06-21, all green; re-run post-rebase onto origin/main 147a93da7, docs-only divergence):
gate_results: typecheck=PASS(pkg-level tsc schemas/core/ad-optimizer/api) test=PASS(api 298 files;
core 4375; +touched 96 post-rebase) lint=PASS(16/16, 0 err) format=PASS arch=PASS verify-fast=PASS
security=PASS(exit0, code-independent, no dep change) build=PASS(api tsc) eval=n/a(notifications path,
not decision engine) review=SHIP(independent fresh-context; 4/4 acceptance MET; 1 WARN resolved
[bare-digit phone normalized via normalizeToE164 + test]; 1 nit deferred [route greetingTemplateName inert]).
HEAD=2c2c316 base=origin/main 147a93da7. Commit b655e2d67->rebased 2c2c316.
carry_forward: DONE. SURFACE-before-merge (consent+send+templates merge-stop). NEXT=push+open PR; human
merge call. SURFACE notes: (1) greeting dark until org approvalOverlay marks the first-touch template
approved (operator action, out-of-scope per plan) - intended, recorded skip not silent. (2) compliance
assumption: phone-bearing IF leads are treated as WhatsApp-opted-in (the form must actually collect the
opt-in; no per-lead signal exists). (3) follow-up nit: route still computes inert greetingTemplateName.
carry_forward: ORIENT done. Design locked (Option-3). ~12 files. Next: PLAN (TDD steps) → FAN-OUT grade
→ EXECUTE. Compliance assumption to SURFACE: IF lead form must actually collect WhatsApp opt-in (no
per-lead signal exists; channel:"whatsapp" asserts it for all phone-bearing IF leads, matching the
handler's existing intent). Greeting goes dark until org approvalOverlay marks the first-touch
template approved (operator action, out of scope per plan) — intended, recorded skip not silent.

## Log

- 2026-06-21: ORIENT complete. Worktree re-created off a49f97cbe (concurrent prune). Full producer→
  consumer seam mapped. Design = Option-3. → PLAN.
- 2026-06-21: PLAN + FAN-OUT grade (3 adversarial; all REVISE-with-refinements, approach upheld) →
  EXECUTE (TDD; 7 steps + bounded REVISE for jurisdictionFromE164) → VERIFY (all gates green +
  independent review SHIP; 1 WARN fixed) → CONVERGE. Committed b655e2d67, rebased onto origin/main
  147a93da7 (= 2c2c316), pushed. **PR #1218 OPEN.** CI = 15/15 PASS (test 11m14s); mergeStateStatus
  CLEAN + MERGEABLE. SURFACE-before-merge: STOPPED for human merge call. LOOP DONE.
- 2026-06-21: human merge call given (/goal). 2 fresh-context reviews (architecture + runtime) =
  SHIP, no Critical; triaged: R1 "worktree-drift" = reviewer error (work intact); MY-trunk-zero +
  template-approval-inert = pre-existing/intended/out-of-scope (no code change). SQUASH-MERGED to
  main = 088aef1e2 (PR #1218). Teardown: A3 worktree removed, local+remote branch deleted, stale
  ref pruned, local main ff'd to 088aef1e2, temp files cleaned. A3 plan checkbox left [ ] on main
  (memory RESUME records merged; next ORIENT re-verifies). SESSION CLOSED. NEXT SLICE = A5 (Robin, D4).
