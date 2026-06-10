# D6: Cross-agent Synergy (Riley to Mira, Mira back into the loop, Alex legs)

Domain auditor d6, Mira capability audit, 2026-06-10. Branch docs/mira-capability-audit, worktree baseline origin/main at 84083f0c. Adversarially verified 2026-06-10, then independently re-verified by a second adversarial pass the same day (every cited file re-opened at the cited lines, counter-evidence hunted across submitters, intents, expiry overrides, and memory writers): 7 findings confirmed, 1 corrected (D6-F2 evidence: the /mira brief box submits creative.job.submit, not another draft), 0 refuted, 0 removed.

## Scope and method

This domain traces every agent-to-agent leg that touches Mira: the Riley recommendation handoff (ad-optimizer sink, ownership, abstention, the api handoff workflow, brief synthesis and enrichment, what physically lands), the parked-approval loop (cards, core adapter, respond path, riley pause submit and execution), Mira's feedback legs (creative-attribution cron, pastPerformance consumers, the planned revenue_proven promotion), the Alex legs (the delegate tool target, funnel-friction translation), and the taste-memory firewall. Every claim cites live code read in this worktree. The 2026-06-02 Riley audit (docs/audits/2026-06-02-riley-improvement-audit/domains/D6-cross-agent.md) found zero Riley-to-Mira links; this report documents the delta precisely. Prior-session hypotheses were re-verified; two are refuted below.

## The loop map (prose)

Leg A, Riley diagnosis to Mira draft: LIVE and unflagged in code, gated in practice by per-org governance seeds. The weekly audit captures per-campaign evidence (packages/ad-optimizer/src/audit-runner.ts:521-524), the sink offers every emitted creative recommendation to a bootstrap-injected submitter (packages/ad-optimizer/src/recommendation-sink.ts:469-491), abstention allows only refresh_creative and add_creative past an evidence floor and learning lock (recommendation-handoff-abstention.ts:10-13,41-52), the submitter synthesizes a BusinessFacts brief (apps/api/src/bootstrap/inngest.ts:325-366) and submits through PlatformIngress with the seeded system principal (apps/api/src/services/workflows/recommendation-handoff-request.ts:47-67). The seeded require_approval(mandatory) policy parks it; the operator card renders via parked-approval-cards.ts:29-66 into the decisions feed (apps/api/src/routes/decisions.ts:51). On approval, respond-to-parked-lifecycle dispatches the handoff workflow, which re-checks abstention and creates a draft-only creative.concept.draft child (recommendation-handoff-workflow.ts:44-88), landing a no-pipeline CreativeJob row (creative-concept-draft-workflow.ts:118-140). Proven by real-path tests (apps/api/src/**tests**/recommendation-handoff-cron-live-path.test.ts, recommendation-handoff-cron-full-loop.test.ts, recommendation-handoff-approval-loop.test.ts) and seeded live on org_dev (#861, spec 2026-06-04-riley-handoff-org-dev-live-loop-design.md).

Leg B, handoff brief enrichment (Mira brain composes the brief pre-park): SHIPPED FLAG-DARK. MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED defaults off; every degrade path falls back to the synthesized brief (handoff-brief-enrichment.ts:39-109, inngest.ts:339).

Leg C, Riley pause self-execution (the parked-approval action loop): SHIPPED DOUBLE-FLAG-DARK. Env kill switch RILEY_PAUSE_SELF_EXECUTION_ENABLED plus per-deployment governanceSettings.pauseSelfExecutionEnabled, both default off (inngest.ts:387-390,437-439; inngest-functions.ts:271-273). The executor is the most truthful consumer in the loop: it marks the source recommendation acted and warns when the row is missing (riley-pause-execution-workflow.ts:237-263).

Leg D, Mira learning from outcomes: SHIPPED FLAG-DARK. CREATIVE_ATTRIBUTION_ENABLED defaults off (inngest.ts:989). The daily 06:30 cron writes a typed pastPerformance row per published creative joining Meta insights with booked ConversionRecords (apps/api/src/services/cron/creative-attribution.ts:162-206,216-320); measured rows aggregate into the history a NEW creative.job.submit brief carries (creative-performance-history.ts:17-63, creative-job-submit-workflow.ts:42-55) and surface in the read model and the self-brief context.

Leg E, Mira back to Riley: MISSING ENTIRELY. revenue_proven has zero writers (the promotion Riley owns is deferred in the schema comment, packages/schemas/src/deployment-memory.ts:13-18); ad-optimizer has no creative-aware reader; the desk model still bans sent_to_riley, in_use, learning, winner, fatigued (packages/core/src/creative-read-model/desk-model.ts:5-8); creative-analyzer remains uncalled by audit-runner. Riley sees Mira campaigns as anonymous campaigns.

Leg F, Alex to Mira concept delegation: LIVE. The delegate tool's one allowlisted target (apps/api/src/bootstrap/delegation-targets.ts:15-54) is in skills/alex/SKILL.md (line 61, section at line 335), draft-only, Mira-enablement gated. Same dead-end as Leg A (the draft).

Leg G, Alex funnel reality into creative: STUB. translateFrictions and per-structure funnelFrictionAffinity exist (funnel-friction-translator.ts:77-113, structure-engine.ts:189-191) but the ugc runner hardcodes funnelFrictions: [] with the comment "SP8 adds real friction store" (ugc-job-runner.ts:236). No producer exists anywhere.

Leg H, Alex bookings into both loops: LIVE plumbing. ConversionRecord booked stats feed Riley trueROAS targets (inngest.ts:316,432) and Mira attribution (creative-attribution.ts:273-278).

Leg I, resume-on-event after a parked approval: STILL MISSING, as documented. Approve always ends in dispatch-or-recovery (respond-to-parked-lifecycle.ts:22-26,179-184,207-244) but no event resumes or notifies the initiating agent. Today's blast radius is small because every parked agent-to-agent intent is cron-initiated (no parent waiting); the legacy session-resume hook exists only on the legacy ApprovalRequest path (respond-to-approval.ts:162-181).

## Capability map

| Capability                                                  | State on main                                                                           | Evidence                                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Riley to Mira governed handoff (diagnosis to draft)         | Shipped, live where governance seeds exist (org_dev); unflagged in code                 | recommendation-sink.ts:469-491; recommendation-handoff-workflow.ts:71-88; seed recommendation-handoff-governance.ts; #861 full-loop test |
| Handoff abstention parity (initiator, handler, ownership)   | Shipped, single shared function                                                         | recommendation-handoff-abstention.ts:41-52; recommendation-handoff-request.ts:38-45; recommendation-ownership.ts:63-69                   |
| Handoff brief enrichment by Mira brain                      | Shipped flag-dark (MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED off)                           | handoff-brief-enrichment.ts:39-46; inngest.ts:339                                                                                        |
| Parked-approval operator cards plus respond loop            | Shipped; dispatch-or-recovery wired; recovery card urgency 100                          | parked-approval-cards.ts:123-127; respond-to-parked-lifecycle.ts:100-244; parked-approval-adapter.ts:101,116,129-131                     |
| Riley pause self-execution loop                             | Shipped double-flag-dark; marks recommendation acted; #949 warn present                 | riley-pause-execution-workflow.ts:237-263; inngest.ts:437-439                                                                            |
| Resume-on-event / parent notify post-approval               | Missing (documented gap stands)                                                         | no parked-lifecycle resume hook; respond-to-approval.ts:162-181 is legacy-path only                                                      |
| Creative attribution into pastPerformance                   | Shipped flag-dark (CREATIVE_ATTRIBUTION_ENABLED off)                                    | creative-attribution.ts:225-228; inngest.ts:989                                                                                          |
| Measured history into new briefs                            | Shipped (enriches creative.job.submit only, not concept drafts)                         | creative-job-submit-workflow.ts:42-55; creative-concept-draft-workflow.ts:136                                                            |
| Mira performance back into Riley (revenue_proven promotion) | Missing; reader wired, zero writers                                                     | deployment-memory.ts:13-18; builders/mira.ts:76-99; no writer repo-wide                                                                  |
| Alex to Mira concept delegation                             | Shipped live (enablement-gated)                                                         | delegation-targets.ts:15-54; skills/alex/SKILL.md:61,335                                                                                 |
| Alex funnel friction into creative weights                  | Stub; translator unfed                                                                  | ugc-job-runner.ts:236; funnel-friction-translator.ts:77                                                                                  |
| Taste vs revenue memory firewall                            | Holds; taste written only by the sweep, Keep route firewalled, no promotion path exists | creative-taste-sweep.ts:160-168; deployment-memory.ts:13-18; creative-taste-context.ts:58-66                                             |

## Delta versus the 2026-06-02 Riley audit D6

That audit's headline ("No Riley-to-anything handoff exists", its R1) is closed: the non-tool submit path it recommended shipped almost exactly as designed (#847, #854/#856 wiring, #861 live seed, #916 enrichment), reusing the governed front door rather than the delegate tool. Its R2 ("carry fatigue evidence in pastPerformance") landed only halfway: evidence reaches the parked card and the WorkTrace, but the CreativeJob draft still gets pastPerformance: null and no campaign linkage (see D6-F1). R3 (lead*quality*\* signals) is unchanged: detected (metric-diagnostician.ts:78,115) and still dropped by the engine. R4 (desk-model reverse edge) unchanged: states still unrepresentable. CreativeJob.pastPerformance is no longer "populated by no caller": the attribution sweep (#880) and submit-time history enrichment now populate it, flag-dark.

## Findings

### D6-F1 (P1, extends, S): The handoff strips Riley's diagnosis at the exact point of value transfer (verified)

Claim: the draft that lands on Mira's desk carries none of the diagnosis. The child submit forwards only productDescription, targetAudience, optional valueContext (recommendation-handoff-workflow.ts:79-87); the draft handler persists only the brief, with pastPerformance: brief.pastPerformance ?? null, which is always null on this path (creative-concept-draft-workflow.ts:118-138). campaignId, rationale, evidence, and recommendationId exist in the parked card and WorkTrace parameters but never reach the CreativeJob or AgentTask. With enrichment off, the brief is BusinessFacts boilerplate (creative-brief-synthesis.ts:25-44): two fatigued campaigns in the same org produce two byte-identical drafts, indistinguishable on /mira, and the generation pipeline (trend-analyzer/hook-generator read brief.pastPerformance, run-stage.ts:74,89) sees zero Riley signal even though the prompt plumbing for it exists.

Impact: "turn Riley diagnoses into winning creative" degrades to "Riley pings Mira to make something generic." The moat leg exists structurally but transfers almost no information.

Recommendation: thread {sourceRecommendationId, campaignId, rationale, evidence} into the child brief (valueContext is already plumbed end-to-end and operator-visible; a typed pastPerformance block is the higher-fidelity slot the 2026-06-02 audit R2 specified) and stamp the task input with the recommendation id for lineage.

### D6-F2 (P1, new, M): The handoff terminates in a draft no product surface can advance (verified, corrected)

Claim (corrected during verification): nothing converts an existing concept draft into a generation run. The draft handler deliberately fires no pipeline (creative-concept-draft-workflow.ts:140); the only generation entries are creative.job.submit submits that create a NEW job and fire job.submitted (creative-job-submit-workflow.ts:92-100); the registered creative intents are submit, continue, stop, publish, concept.draft (contained-workflows.ts:356-401) and none takes an existing draft jobId into the pipeline (continue/stop only emit stage-approval events that an already-running Inngest wait hears; publish requires a completed job; the Keep gesture is a review-decision write only, mira-decision.ts). Correction: the original evidence misread the dashboard. The /mira brief box is NOT another draft creator; POST /agents/mira/brief submits creative.job.submit through PlatformIngress and starts the real pipeline (mira-brief.ts:5-10,126-140, despite the client method name createCreativeDraftRequest), and use-creative-pipeline.ts also carries an unconsumed useSubmitBrief generation POST (lines 113-142) alongside the stage-approve POST (line 73). So an operator CAN fund creative work in-product by hand-retyping the brief into the brief box; what no surface can do is advance the Riley-handed or Alex-delegated draft itself. The retyped submit creates a fresh job with no recommendationId, no parentWorkUnitId chain to the handoff, and no link to the draft row, which ages in "Drafting" forever.

Impact: the human-approves-then-Mira-produces loop has no linked last mile. Every approved handoff and every Alex delegation parks as a dead-end row; producing from it means manual re-entry that severs WorkTrace lineage and Riley provenance (compounding D6-F1, so attribution can never tie the resulting creative back to the recommendation).

Recommendation: a governed "produce this draft" intent that maps an existing draft row into creative.job.submit (inheriting the brief plus D6-F1's evidence), parking at the spend threshold as creative.job.submit already does. Tag new: the roadmap stopped at "a human later funds" without specifying the funding surface.

### D6-F3 (P1, planned, M): Mira's measured outcomes never reach Riley; revenue_proven has zero writers (verified)

Claim: the Riley-owned promotion of attributed performance into revenue_proven memory (roadmap 2026-06-03 section 4.2 invariant 2, "Riley owns promotion"; slice-2 spec section 3.7) is unbuilt. The schema comment defers it "until its trigger fires: the first measured creative with spend > 0" (packages/schemas/src/deployment-memory.ts:15-18); grep finds no writer repo-wide; Mira's builder renders revenue_proven lines first (builders/mira.ts:85-99) that can never exist. Riley's audit has no creative-aware input: no CreativeJob or pastPerformance reference exists in packages/ad-optimizer; the desk model keeps sent_to_riley and fatigued unrepresentable (desk-model.ts:5-8); a winning Mira creative produces no "scale this creative pattern" recommendation, and a refresh_creative handoff's outcome is never measured against the draft it produced.

Impact: the learn leg of the moat is one-way. Mira learns from itself (flag-dark); Riley reallocates blind to creative provenance.

Recommendation: build the slice-2 section 3.7 promotion writer inside riley-outcome-attribution or a sibling cron (Riley is the revenue authority), keyed on measured pastPerformance rows with spend > 0; give the weekly audit a campaign-to-creative join (CreativeJob.metaCampaignId already exists and is 1:1 by construction, creative-attribution.ts:156-160).

### D6-F4 (P1, planned, L): The Alex-to-Mira funnel signal is a stub; the translator is dead code at runtime (verified)

Claim: ugc-job-runner.ts:236 hardcodes funnelFrictions: [] ("SP8 adds real friction store") and line 238 calls translateFrictions([]) so creativeWeights is always empty. The eight-friction rule table (funnel-friction-translator.ts:13-62) and the per-structure funnelFrictionAffinity scoring (structure-engine.ts:189-191) execute against nothing. No FunnelFriction producer exists in apps/chat, apps/api, or core: Alex conversation reality (objections, price shock, low trust, booking drop-offs) never shapes structure or motivator selection.

Impact: the second half of the north-star sentence ("Alex funnel reality into winning creative") is unimplemented beyond type plumbing.

Recommendation: a minimal producer first: derive low_trust/price_shock/expectation_mismatch frictions from existing escalation and conversation outcome data, persist per-org, and feed preloadContext. Tag planned (the SP8 marker and the translator's own "consumes FunnelFriction[] from external sources" comment).

### D6-F5 (P2, extends, M): One diagnosis double-surfaces with uncoordinated state; handoff approval never transitions the source recommendation (verified)

Claim: for a fatigued campaign the operator gets both a /riley queue card (accept merely sets status acted, packages/core/src/recommendations/act.ts:94-105, a bookkeeping write) and a parked workflow_approval card (approve creates the draft). Neither updates the other. The pause executor transitions its recommendation to acted with first-writer-wins (riley-pause-execution-workflow.ts:237-243); the handoff workflow performs no recommendation-store write at all (recommendation-handoff-workflow.ts, entire file), so an approved handoff leaves the source refresh_creative row pending until expiry, and riley-outcome-attribution (which reads acted rows, outcome-attribution-types.ts:143-150) never measures handoff-routed creative refreshes. Verification sharpened this: refresh_creative is one of only two V1 attributable kinds (outcome-attribution-config.ts:3, V1_ATTRIBUTABLE_KINDS = ["pause", "refresh_creative"]), so the blind spot covers half the attributable action space.

Impact: operator-facing incoherence plus an attribution blind spot for exactly the action class Mira exists to serve.

Recommendation: mirror the pause pattern: markRecommendationActed (or a handoff-specific terminal) from the handoff workflow's success leg, and suppress or annotate the queue card when ownership is mira_handoff (the annotation already exists, recommendation-ownership.ts:69, currently report-only by design).

### D6-F6 (P2, extends, S): The parked handoff card is action-blind and the approved no-op leg is invisible (verified)

Claim: handoffCard hardcodes "Riley wants to brief Mira to refresh creative on campaign X" without reading actionType (parked-approval-cards.ts:29-66); an add_creative handoff (an allowlisted action, recommendation-handoff-abstention.ts:10-13, and a real engine output, recommendation-engine.ts:99) is mis-described to the approver. Separately, when Mira is not enabled for the org, an APPROVED handoff completes with skipped/child_no_draft recorded only in WorkTrace outputs (recommendation-handoff-workflow.ts:126-137): the human performed the approval ceremony and nothing happened, with no operator-visible signal. Governance seeding and Mira enablement are independent toggles, so the combination is reachable on any org seeded with handoff policies but not enablement.

Recommendation: branch the card copy on parameters.actionType; surface the child_no_draft outcome (the respond route already returns executionResult; render its summary) or have the cron skip submitting for Mira-disabled orgs.

### D6-F7 (P2, new, S): Weekly cadence versus 24h park expiry structurally drops handoffs (verified)

Claim: handoff parks use the global default expiry, 24 hours (packages/core/src/approval/router.ts:30; platform-ingress.ts:302-303). The producing cron is weekly (ad-optimizer inngest-functions.ts:309, cron "0 9 \* \* 1"). An operator who does not open the inbox within 24h of the weekly run loses the handoff until the next run; the source recommendation card expires on its own independent clock (this_week urgency = 24h, recommendation-sink.ts:136-140). The recommendation-id-based idempotency keys do not block the next week's re-park (new rec ids per run, day-bucketed emit key, emit.ts:15-23), which is what makes the loss recoverable but also means the operator sees a Groundhog-Day card weekly with no memory of prior expiries.

Recommendation: a longer per-intent expiry for adoptimizer.recommendation.handoff (parks are cheap, the draft is no-spend), or expiry-aware re-park messaging ("second offer for this campaign").

### D6-F8 (OPP, extends, S): Flag-dark enrichment is the cheapest live synergy upgrade (verified)

Claim: with MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED=true, the brain composes the brief from the actual recommendation (actionType, campaignId, rationale, evidence ride the compose submit, inngest.ts:334-346, mira-self-brief-request.ts:48-49) BEFORE the park, so the human approves what dispatches, and every failure path is byte-identical fallback (handoff-brief-enrichment.ts:39-46). This is the only shipped mechanism that gets campaign-specific diagnosis into the brief text today, and it is off everywhere.

Recommendation: flip per pilot org once the compose path is verified entitled and seeded (the named launch-mode and entitlement gates are outside this domain); pair with D6-F1 so the structured evidence also persists.

## What is sound

- Abstention is one pure function used at the initiator, the post-approval handler (defense in depth against hand-built submits), and ownership annotation (recommendation-handoff-abstention.ts:41-52 consumed at recommendation-handoff-request.ts:38, recommendation-handoff-workflow.ts:44, recommendation-ownership.ts:64). The handler fails closed on a missing learning flag (recommendation-handoff-workflow.ts:40-42).
- Idempotency is layered and deterministic: day-bucketed emit key (emit.ts:15-23), handoff:riley:recId:action submit key, handoff-draft:recId:action child key, handoff-compose:recId:action enrichment key. A retried cron replays instead of duplicating.
- Approve ends in dispatch-or-recovery with payload binding: frozen payload written to the trace before dispatch, recovery_required renders a Retry card at urgency 100 (respond-to-parked-lifecycle.ts:14-26,168-184; parked-approval-adapter.ts:101,129-131).
- The pause executor is honest end to end: stale-approval cap, org-mismatch loud failure, already-paused abstain, and the #949 not-found warn after a successful Meta write (riley-pause-execution-workflow.ts:141-263). Hypothesis "pause finds no recommendation row" is handled, not latent.
- The taste firewall holds: taste rows are written only by the sweep with bucket-deterministic content and a P2002 re-find/increment (creative-taste-sweep.ts:32-44,160-189), exactly the dedup-axis discipline the DeploymentMemory hypothesis worried about; revenue_proven has no writer so no promotion bypass exists; the polished taste provider refuses ugc buckets (creative-taste-context.ts:61-66).
- The taste-candidate query is starvation-proof by construction (two SQL legs so the cap bounds pending work, prisma-creative-job-store.ts:252-307); the SQL take-before-filter hypothesis is refuted here, and no other handoff-path SQL cap exists (the handoff rides the audit's in-memory loop).
- Layering is clean: the Layer-2 sink never imports ingress; capability injection doubles as enforcement for the pause flag (inngest-functions.ts:268-273).
- The loop is proven, not just wired: real-gate live-path, full-loop, and approval-loop tests exist, and #861 seeded org_dev so all five required pieces coexist on one org.

## Open questions

- Do production pilot orgs get the handoff governance seeds (allow + require_approval) and Mira enablement together during provisioning? Pilot-spine F-16 (policy seeding) owns this; without seeds the leg default-denies org-by-org.
- Does the pilot dashboard build render workflow_approval decisions with approve/reject wired end to end (D2 owns the inbox surface; the API serves them at routes/decisions.ts:51)?
- creative.brief.compose execution: is the skill executor resolvable for the creative slug on non-conversation surfaces for every entitled org (D3 territory; enrichment degrades silently to boilerplate if not)?
- Are ConversionRecords (booked, value-positive) actually populating at pilot scale? Riley targets, Mira attribution, and any future revenue_proven promotion all starve without them.
- lead*quality*\* diagnoses still produce no output (metric-diagnostician.ts:78,115 with no engine branch); a Riley-to-Alex qualification signal remains undesigned. Outside Mira's scope but it is the missing third edge of the triangle.
