# D7. Operator surface: the desk

Domain auditor: d7. Branch docs/mira-capability-audit. All paths relative to repo root. Evidence verified against live code in this worktree on 2026-06-10.

## Scope and method

The dashboard surface where a human meets Mira: the /mira Director's Desk, /mira/review feed, /mira/creatives/[id] detail page, the cockpit/mira component family, the use-mira-\* and use-review-decision hooks, the dashboard proxy routes under app/api/dashboard/agents/mira/, their API targets under apps/api/src/routes/agent-home/, enablement plumbing (use-mira-enabled, agent-home-access, fetchEnabledAgentsServer, route-availability), the agent-panel Mira drill-in, and swipe-policy parity. Method: read every entry-point file and its consumers, traced the Keep/Pass and brief mutations end to end (hook, proxy, api client, Fastify route, Prisma or PlatformIngress), reconciled against docs/superpowers/specs/2026-05-29-mira-creative-operating-desk-design.md and docs/superpowers/specs/2026-06-03-mira-roadmap.md, and checked each prior-session hypothesis against live code before writing anything down. No servers run, no mutations.

## Capability map

| Capability                                                                    | State on main                                                                                                                         | Evidence                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Director's Desk at /mira (brief box, ready hero, production tray, kept shelf) | Live, org-gated, keys-pending-safe loading                                                                                            | apps/dashboard/src/app/(auth)/mira/page.tsx:8-12; mira-desk-page.tsx:65-78 uses QueryStates; mira-desk-page.test.tsx:56 pins keys-pending skeleton |
| Review feed at /mira/review (vertical clips, Keep/Pass, undo toast)           | Live, org-gated; loading gate deviates from canon                                                                                     | review/page.tsx:8-10; mira-creative-feed.tsx:24-61, 85                                                                                             |
| Keep/Pass/un-keep decision                                                    | Live; firewalled single-field setter, org-scoped, reversible, allowlisted                                                             | mira-decision.ts:59-65; .agent/tools/route-allowlist.yaml:145-146; mira-decision-route.test.ts:96-124                                              |
| Open brief (createCreativeDraftRequest)                                       | Live; governed through PlatformIngress.submit with fail-closed deployment resolution, idempotency, pending-approval branch at the API | mira-brief.ts:115-147; mira-brief-route.test.ts:104-186                                                                                            |
| Continue/Stop with cost confirm and parked-render honesty                     | Live; 202 envelope preserved end to end on this path                                                                                  | use-creative-pipeline.ts:56-89; marketplace approve proxy forwards 202; mira-clip-actions.tsx:29-43, 192-203; creative-detail-page.tsx:411-416     |
| Creative detail page (video, QA line, performance block, Continue/Stop)       | Live; honest spend/attribution copy; no Keep/Pass affordance                                                                          | creative-detail-page.tsx:23-26, 107-191, 193-418                                                                                                   |
| Per-org enablement                                                            | Fail-closed, row-driven, matrix-tested on six surfaces; produced only by seed/runbook                                                 | agent-home-access.ts; seed-mira-pilot-orgs.ts; docs/runbooks/2026-05-29-mira-pilot-enablement.md; mira-route-matrix.test.ts:150-166                |
| Kept shelf as Keep-gesture record                                             | Gesture-backed, not a status map; windowed                                                                                            | desk-model.ts:104-108, 95-97                                                                                                                       |
| Agent panel Mira drill-in                                                     | Minimal (portrait + ready count + route out); 4-slot parity not built; flashes "isn't set up" while probing                           | mira-panel.tsx:10-12, 16-20, 43-51                                                                                                                 |
| Halt integration                                                              | Halt disables brief and Continue, leaves conservative Stop and draft-only Keep/Pass active                                            | mira-brief-box.tsx:41, 203-205; mira-clip-actions.tsx:204-225; creative-detail-page.tsx:197-227                                                    |
| Swipe-policy parity with Riley ownership                                      | CI tripwire over the full action x urgency domain; mira_handoff rows structurally excluded from swipe                                 | swipe-policy.parity.test.ts:37-77                                                                                                                  |
| Demo/fixture branches in Mira UI                                              | None; demo data is a DB seed, copy is medspa-correct                                                                                  | grep of cockpit/mira + hooks returns no demo/fixture branch; desk-copy.ts:72-76                                                                    |

## Findings

### D7-F1 (P1) The brief seam drops the PENDING_APPROVAL envelope between API and operator (verified)

Claim: apps/api mira-brief.ts correctly answers 202 PENDING_APPROVAL when governance parks a submit, and its test pins it, but the dashboard proxy re-labels every success 201 and the hook casts any 2xx body to MiraBriefResult, so the brief box would show "Mira is on it. She started a draft" for a parked, not-started submit.

Evidence: mira-brief.ts:145-147 branches `if ("approvalRequired" in response ...)` to a 202 envelope; mira-brief-route.test.ts:149 "returns 202 PENDING_APPROVAL when the submit parks (never a phantom 201)". The proxy: app/api/dashboard/agents/mira/brief/route.ts:24 `return NextResponse.json(data, { status: 201 })` unconditionally. The hook: use-create-creative-draft-request.ts:19-20 `if (!res.ok) throw ...; return (await res.json()) as MiraBriefResult`. The brief box: mira-brief-box.tsx:48-56 sets phase "submitted" on any resolve, and lines 206-211 render "Mira is on it. She started a draft." The sibling path shows the canonical fix: app/api/dashboard/marketplace/creative-jobs/[id]/approve/route.ts explicitly forwards `outcome === "PENDING_APPROVAL"` as 202, and use-creative-pipeline.ts:56-58 models it as a discriminated union.

Impact: creative.job.submit is registered with approvalPolicy "threshold" and the route comment calls the branch latent (no render-cost signal at submit today), but the branch is reachable the moment an org's governance policy or a future submit-time spend signal parks the submit. Then the operator's commit moment reports a false start: phantom-success at the human-trust seam the whole desk exists to protect. This is the ingress pending_approval gotcha reproduced one layer up, and the per-slice review gotcha (each layer passes its own contract, the seam between them does not).

Recommendation: make the proxy mirror the approve proxy (forward outcome PENDING_APPROVAL as 202 with the envelope), type the hook result as a discriminated union, and give the brief box a third submitted-state copy ("Queued for your approval, nothing started yet"). Pin with a proxy-level test that feeds the API's 202 body through.

Tag: extends (the API half of the contract and the approve-path consumer both exist; this completes the same pattern). Effort: S.

### D7-F2 (P2) Dashboard proxies collapse API status into 500, leaving dead and misleading error arms (verified)

Claim: the api client throws message-only Errors and every Mira proxy maps any non-"Unauthorized" failure to 500, so downstream status-specific handling is unreachable and permanent conditions render as retryable connection trouble.

Evidence: api-client/core.ts:17-20 `if (!res.ok) { ... throw new Error(body.error || "API error: " + res.status) }` discards status. All Mira proxies share `errorResponse` mapping to 401 or 500 (e.g. app/api/dashboard/agents/mira/creatives/[id]/decision/route.ts:8-13). Consequences: use-review-decision.ts:35-37 swallows `res.status === 409` as silent success "canon (use-recommendation-action.ts)", but mira-decision.ts emits only 200/400/404/500/503 (never 409) and the proxy could not forward one anyway, so the arm is dead code documenting behavior that does not exist on this path; an API 404 (cross-org id, deleted job, disabled org) reaches the clip rail as "Couldn't save. Try again." (mira-clip-actions.tsx:181) and the detail page as "Couldn't load this draft. Try again." (creative-detail-page.tsx:23-24), where retry can never succeed; the brief route's deliberate 409 `creative_deployment_not_provisioned` (mira-brief.ts:117-120) reads as a generic failure instead of "Mira isn't provisioned yet".

Impact: error states are not honest. The operator cannot distinguish "gone" from "flaky network", and the one provisioning error a pilot org will actually hit is unexplained.

Recommendation: forward upstream status through the proxies (the approve proxy already special-cases its envelope; generalize with a structured ApiError carrying status), then either make the 409-silent arm real or delete it and its comment.

Tag: new. Effort: M.

### D7-F3 (P2) MiraPanel flashes "Mira isn't set up yet" while enablement is still resolving, and the hook itself collapses keys-pending to disabled (verified)

Claim: the agent-panel drill-in ignores the loading contract its own hook documents, and the hook cannot represent keys-pending at all, so enabled orgs can see "Mira isn't set up yet ... Coming soon" during probe windows.

Evidence: use-mira-enabled.ts:8-9 documents "enabled === undefined -> still loading (don't flash 'not set up')". mira-panel.tsx:16 destructures only `enabled`, line 20 `if (enabled)`, lines 43-51 render the not-set-up branch otherwise, so `undefined` (probe in flight) falls into "Mira isn't set up yet". The panel test mocks the hook with `isLoading: false` (mira-panel.test.tsx:5-8) and never exercises `undefined`, hiding the flash (the React Query real-hook gotcha). Deeper: use-mira-enabled.ts:21 keys off `m.isLoading`, but a keys-pending (session not yet resolved) useAgentMission query is disabled and reports isLoading false (use-agent-mission.ts:30, use-query-keys.ts:9-14), so the hook returns `{enabled: false, isLoading: false}`, not `undefined`, and even contract-honoring consumers like home-page.tsx:140-141 (`setupLoading = miraEnabled.enabled === undefined; // probe unresolved: never flash "Not set up"`) get a hard false. Exposure is narrowed because the authed layout passes a server session into SessionProvider (app/(auth)/layout.tsx:17), but a transient mission error also yields enabled false (use-mira-enabled.ts:22), so an API blip tells an enabled org's operator Mira does not exist.

Impact: the surface that introduces Mira to an operator lies about her existence during loading or API blips. Trust erosion at the front door, and nav consumers (primary-nav.tsx:21, app-sidebar.tsx:97, tools-overflow.tsx:47) pop Mira in late for the same reason.

Recommendation: have useMiraEnabled treat keys-pending and isError as `undefined` (unknown), render a neutral skeleton in MiraPanel for `undefined`, and re-test with the real hook.

Tag: extends (home-page already implements the intended consumer pattern). Effort: S.

### D7-F4 (P2) Feed and detail page gate on isLoading against the codified keys-pending state machine; detail pins "Draft not found" for the loading-shaped state (verified)

Claim: the review feed and the creative detail page use the exact `if (isLoading)` gate that components/query-states/resolve-query-state.ts documents as the false-empty trap, while the desk page uses the safe QueryStates machine; the detail page renders and test-pins "Draft not found." for data-undefined-and-no-error.

Evidence: resolve-query-state.ts header: "A gate written `if (isLoading)` is therefore skipped during keys-pending and flashes a false-empty. We never read isLoading". mira-creative-feed.tsx:85 `if (isLoading)` then line 121 falls through to the empty state ("No drafts to review yet") when data is undefined without error. creative-detail-page.tsx:23-26 `if (jobQ.isLoading) ... if (!job) return ... Draft not found.`; creative-detail-page.test.tsx:232 pins "shows 'Draft not found' (not load-error) when data is undefined and no error". By contrast mira-desk-page.tsx:65-69 wraps the same shape in QueryStates and mira-desk-page.test.tsx:56 pins the keys-pending skeleton. With the server-session bootstrap the window is small, but the only state that can produce data-undefined, no-error, not-loading is keys-pending, so the pinned "Draft not found" arm is exactly the loading state mislabeled.

Impact: a deep link into /mira/creatives/[id] (agent-home tile, notification) can flash "Draft not found." and the feed can flash "No drafts to review yet" before the first fetch, both of which read as definitive verdicts about Mira's output.

Recommendation: route both components through QueryStates (or replicate its data/error/loading precedence) and update the pinned detail test so the data-undefined-no-error arm renders loading, keeping a true 404 mapped to not-found once F2 restores status fidelity.

Tag: extends (QueryStates exists for this and the desk already consumes it). Effort: S.

### D7-F5 (P2) Desk ready count and review feed can disagree on a completed job with no video (verified)

Claim: the desk counts any draft_ready job as ready to review without checking for a watchable draft, while the feed requires videoUrl, so a completed job with a missing or pruned video inflates the hero count and the feed shows nothing.

Evidence: desk-model.ts:65-66 `case "draft_ready": return "ready_to_review"; // always: draft_ready means the video exists at completion (no hasVideo guard needed)` versus creatives.ts:24-30 `isReviewable ... && typeof job.draft?.videoUrl === "string"`. The invariant is asserted in a comment, not enforced: status-mapper.ts:64 derives draft_ready purely from `currentStage === "complete"` (line 58 from `ugcPhase === "complete"`), and the failed-detection arm (status-mapper.ts:19-26) only catches errors-without-video, not complete-without-video.

Impact: the desk's one loud element ("N drafts ready to review" plus the amber CTA) can point at an empty screening room. A single stale row makes the cockpit lie until it ages out of the window.

Recommendation: apply the same hasVideo guard to draft_ready in deriveDeskItemState (or count via isReviewable), one shared predicate for both surfaces, with a test for complete-without-video.

Tag: new. Effort: S.

### D7-F6 (P2) Kept shelf silently loses Keep verdicts beyond the 200-job read window (verified)

Claim: keptDrafts derive from the same windowed read-model as everything else, so a kept draft older than the most recent FEED_WINDOW jobs disappears from the shelf even though the operator's verdict persists in the database.

Evidence: desk-model.ts:95-97 "Window caveat: kept drafts are read from the same windowed rm.jobs (<= FEED_WINDOW). Kept drafts older than the window won't appear - acceptable at M1 pilot scale; revisit with a dedicated query"; creatives.ts:19 `const FEED_WINDOW = 200`; KEPT_SHELF_CAP 8 at desk-model.ts:89. The shelf copy promises permanence: desk-copy.ts:46 "Drafts you keep will live here."

Impact: once the self-brief cron (MIRA_SELF_BRIEF_ENABLED) and per-draft jobs accumulate, the Keep record the roadmap treats as the taste-memory gesture (roadmap section "Slice 2 ... Taste memory is written from the operator's Keep/Pass gesture") becomes a lossy display, and "drafts you keep will live here" goes false exactly when Mira gets productive.

Recommendation: back keptDrafts with a dedicated org-scoped query on reviewDecision = kept ordered by reviewDecidedAt (the field already exists, mira-decision.ts:61), keeping the cap at the display layer.

Tag: extends (the source file flags the revisit). Effort: M.

### D7-F7 (OPP) A reviewable draft's detail page is a decision dead-end (verified)

Claim: for a draft_ready job the seam emits canContinue false, canStop false, label review_draft, so the detail page renders the video with no action at all; Keep/Pass lives only in the feed rail, and deep links land operators somewhere they can watch but not decide.

Evidence: status-mapper.ts:75-76 `case "draft_ready": return { canContinue: false, canStop: false, label: "review_draft" }`; creative-detail-page.tsx:193 gates the whole action block on `canContinue || canStop` (line 418 `: null`); Keep/Pass buttons exist only in mira-clip-actions.tsx:152-186, which the detail page does not render. Deep links arrive from agent-home tiles (route-availability.ts:44-47 creative-job: true) and the clip caption (mira-clip-card.tsx:111-129).

Impact: the operator's taste gesture, the input the learning loop wants most, is only collectible inside the vertical feed. Anyone reviewing from Home, a notification, or the production tray must context-switch to /mira/review and find the clip again.

Recommendation: render the Keep/Pass pair on the detail page when reviewAction.label is review_draft, reusing useReviewDecision (the API is id-addressed and already org-safe).

Tag: new (the 2026-05-29 spec assigns review to the Screening Room and never specifies detail-page decisions, so this is additive). Effort: S.

### D7-F8 (P2) Stale and dead operator-surface modules contradict the shipped desk (verified)

Claim: mira-config.ts still exports M1-era copy claiming Mira has no composer, and the Mira KPI adapter has no consumer at all.

Evidence: mira-config.ts:1-4 "M1 Mira is a draft-only creative cockpit: NO composer (no new submission from the Mira UI)" and lines 27-30 MIRA_FOOTER_NOTE "New briefs come from the existing creative pipeline."; the Phase-2 desk ships exactly that composer (mira-brief-box.tsx, "the operator's only way to request a first draft" per mira-desk-page.tsx:62-64). Grep shows MIRA_FOOTER_NOTE, MIRA_EMPTY_TITLE, MIRA_EMPTY_BODY and metricsViewModelToMiraKpiData have zero consumers anywhere in apps/dashboard/src, tests included (verification grep, 2026-06-10); only DEFAULT_MIRA_VARIANT and MIRA_ACCENT/MIRA_MISSION_SUBTITLE are imported (by creative-detail-page, printed-portrait-avatar, kept-shelf, desk-page, brief-box, feed-page).

Impact: dead exports with confidently wrong comments are exactly how a future session re-learns a false fact (no-composer) or re-wires an adapter nobody renders. metrics-to-kpi-data.ts encodes a real product decision (suppress ROI on a draft-only agent) that is currently enforced by nothing.

Recommendation: delete the dead exports and the adapter or wire the adapter to a desk KPI strip if one is planned; fix the header comment either way.

Tag: extends (matches the tracked "Identity cleanup" follow-up from the coherence audit). Effort: S.

### D7-F9 (P2) Page-level enablement 404 gates have no pinning tests, though the spec demands them (verified)

Claim: the /mira and /mira/review server pages gate via fetchEnabledAgentsServer + notFound(), but no test references MiraPage, MiraReviewPage, or fetchEnabledAgentsServer, while the desk spec explicitly requires route-level tests for the migration.

Evidence: app/(auth)/mira/page.tsx:9-10 and review/page.tsx:9-10 carry the gates; repo-wide grep finds no test importing them. docs/superpowers/specs/2026-05-29-mira-creative-operating-desk-design.md, "Route migration is a product migration, not a UI refactor": "The PR must include route-level tests ... /mira preserves the existing org-enablement 404 gate ... /mira/review renders the feed when enabled (and is itself gated)". The API layer is well covered (mira-route-matrix.test.ts:150-166 pins 200/404 and leak-free bodies on six surfaces; creatives/brief/decision routes each pin their own 404s), so data cannot leak, but the page gate is one deleted line from exposing the shell to non-pilot orgs with every module in connection-trouble state.

Impact: weakens the opt-in pilot posture the whole M1 design leans on; a refactor regression would be caught by no CI signal.

Recommendation: add two small unit tests mocking fetchEnabledAgentsServer (enabled and disabled arms asserting notFound), mirroring how the desk-page tests mock hooks.

Tag: planned (spec section quoted above). Effort: S.

### D7-F10 (P2) route-availability still reads NEXT_PUBLIC flags via a dynamic bracket key (pilot-spine F-20 confirmed live); Mira links are unaffected (verified)

Claim: isMercuryToolLive reads `process.env[TOOLS_LIVE_ENV[id]]`, which Next.js never inlines client-side, so in the browser every Mercury tool flag is permanently undefined regardless of env; Mira's own link kind is hardcoded live and dodges the bug.

Evidence: route-availability.ts:36-38 `return process.env[TOOLS_LIVE_ENV[id]] === "true"` with the comment asserting build-time inlining (only static `process.env.NEXT_PUBLIC_X` member expressions inline). Client consumers include app-sidebar.tsx:98, tools-overflow.tsx:48, reports/contacts/automations/activity hooks. Mira: route-availability.ts:44-47 returns true statically for creative-job, so /mira/creatives/[id] deep links from agent-home tiles work.

Impact on this domain: none direct for Mira surfaces; material for the surrounding shell (tools nav and contact links the Mira operator also sees). This is the pilot-spine audit's open F-20; re-verified here because route-availability is in scope.

Recommendation: replace the dynamic read with a static map of `process.env.NEXT_PUBLIC_CONTACTS_LIVE === "true"` expressions (one per flag), or move the gate server-side.

Tag: extends (pilot-spine audit F-20). Effort: S.

## What is sound

The two mutation paths honor their contracts and are pinned by tests. The Keep/Pass route is exactly what the roadmap defends: a draft-only, org-scoped, reversible single-field setter (mira-decision.ts:59-65 updateMany on `{reviewDecision, reviewDecidedAt}` with the count===0 guard), explicitly allowlisted with a reasoned entry (.agent/tools/route-allowlist.yaml:145-146), with tests pinning "writes ONLY the decision field" and cross-tenant 404 (mira-decision-route.test.ts:96-124). The brief path goes through the governance front door: PlatformIngress.submit with intent creative.job.submit, fail-closed deployment resolution (409 before any submit, mira-brief.ts:115-121), the pending-approval branch the ingress gotcha demands, idempotency via the global middleware plus a browser-generated key, and tests including replay dedupe and "no direct writes" (mira-brief-route.test.ts:104-186).

Enablement is genuinely per-org and fail-closed: API surfaces 404 for non-enabled orgs with leak-free bodies across greeting/pipeline/metrics/activity/mission/wins (mira-route-matrix.test.ts:157-166), pages 404 via fetchEnabledAgentsServer whose failure fallback excludes Mira (agents-server.ts:21-24), and rows are produced deliberately by seedMiraPilotOrgs or the documented runbook upsert (docs/runbooks/2026-05-29-mira-pilot-enablement.md), no global flip.

The desk is truthful by construction in its core semantics: keptDrafts derive only from `job.reviewDecision === "kept"` (desk-model.ts:104-108), Phase-4/5 states are unrepresentable in the desk-state union (desk-model.ts:8-24), forbidden Phase-4/5 words are test-banned on the desk (mira-desk-page.test.tsx:68), and the kept shelf's "sending to Riley comes later" stays neutral with a no-red-chip test (mira-kept-shelf.test.tsx:24). Spend moments are consequence-graded as the spec orders: Continue requires a cost confirm with a rounded estimate readback sourced from the same module as the governance spend signal (creative-render-spend.ts:41-43, cost-estimator rounding at :78,113,117), Stop requires an irreversible confirm, and a parked render is surfaced as "Queued for your approval ... Nothing ran or was charged" rather than a completion (use-creative-pipeline.ts:56-58, mira-clip-actions.tsx:33-43, creative-detail-page.tsx:411-416). The performance block converts cents explicitly, dates measured numbers, and suppresses Meta's misleading zero-conversion field (creative-detail-page.tsx:156-189). There are no demo or fixture branches anywhere in the Mira components or hooks, and the brief examples are vertical-correct medspa copy (desk-copy.ts:72-76). The swipe-policy parity tripwire enumerates the full Riley action x urgency domain against the sink's own emitted contract and structurally excludes mira_handoff rows from swipe-approval (swipe-policy.parity.test.ts:37-77).

## Open questions

1. Keep/Pass as taste signal: packages/core/src/skill-runtime/builders/mira.ts reads reviewDecision, so the gesture has a brain-side consumer; D3 should confirm whether that consumption matches the roadmap's taste-vs-revenue separation and whether Pass (negative taste) is used at all.
2. The greeting line on the desk comes from useAgentGreeting("mira"); the greeting builder's honesty (no fabricated activity for an org with zero jobs) is D3/D5 territory and was not audited here beyond the enablement matrix.
3. mira-decision.ts's preHandler trusts x-org-id when app.authDisabled is true (mira-decision.ts:30-38, same pattern across agent-home routes); whether authDisabled can ever be true in a deployed environment is a D8/tenancy question (pilot-spine F-15 fixed the chat hop, this is the same trust shape).
4. The desk hero count and panel ready count poll at 30s staleTime with window-focus refetch but there is no push/refresh signal when a render completes; whether Inngest completion should invalidate (or the desk should poll while inProduction is non-empty, as use-creative-pipeline does with refetchInterval) is a product-latency question for D5.
5. dashboard-agents.ts derives every agent's status purely from enablement rows (`row?.status ?? "coming_soon"`), while agent-home-access hardcodes alex/riley ALWAYS_ON; an org missing day-one seed rows would show alex "coming_soon" in the shell while his API surfaces answer 200. Outside Mira scope but the asymmetry is worth one look.

## Refuted during verification

None. An independent adversarial pass on 2026-06-10 re-opened every cited file and line for all ten findings and attempted refutation; all ten verified as written. Notable re-checks: the D7-F1 chain was confirmed at every layer (mira-brief.ts pendingApprovalReply returns 202 with outcome PENDING_APPROVAL and the route test pins "never a phantom 201" at mira-brief-route.test.ts:149-159; the brief proxy returns `NextResponse.json(data, { status: 201 })` unconditionally; SwitchboardClientCore.request treats 202 as ok and returns the parsed body; makeTheDraft sets phase "submitted" on any resolve; creative.job.submit is registered budgetClass "expensive" / approvalPolicy "threshold" in contained-workflows.ts:356-361, so the park is policy-reachable). D7-F3's hook collapse was confirmed against the real files (use-agent-mission.ts:30 `enabled: !!keys`; use-mira-enabled.ts:21-22 keys off m.isLoading; the panel test at components/agent-panel/**tests**/mira-panel.test.tsx sets enabled only to true/false, never undefined). D7-F5's count/feed divergence was confirmed through to the counter (desk-model.ts:112 increments from deriveDeskItemState, which has no hasVideo guard on draft_ready). D7-F8 is slightly stronger than written: the four dead exports have zero consumers including tests. D7-F9's absence of page-gate tests was re-confirmed by repo-wide grep (no test references fetchEnabledAgentsServer, MiraPage, or MiraReviewPage) against the spec's explicit route-level-test requirement (spec line 148). D7-F10's wrong inlining comment is at route-availability.ts:9-11 with the dynamic bracket read at :36-38.
