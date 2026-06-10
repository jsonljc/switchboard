# D8 — Cockpit UI & Conversational Surface (riley capability audit, 2026-06-10)

## Thesis

Riley's _seeing_ leg has materially improved since the 2026-06-02 baseline but stops one seam short of truth, and the _talking_ leg has not moved at all — it has actually regressed in perceived quality, because a dead Operator Chat widget now advertises a Riley command ("pause low-performing ads") that fails on every send. The approval moment is the bright spot: #841's per-campaign economic truth (tier basis, CPL, cost-per-booked, trueROAS) flows producer→consumer fully intact into the inbox approval sheet. The panel headline, however, shows a blended-denominator CAC that is suppressed entirely for unconfigured orgs, and the richest economics Riley computes (per-source trueROAS, sourceComparison, ownership annotation) die in a dashboard hook with zero importers.

**Verdict: an operator can partially SEE Riley's real economics (best at the approval moment, weakest at the headline) and cannot TALK to Riley at all.** Soundness: sound-with-gaps.

## Where the cockpit actually lives

`/riley` is a retired route: `apps/dashboard/src/app/(auth)/riley/page.tsx` redirects to `/?agent=riley`, which Home reads server-side (`(home)/page.tsx:10-13`) and auto-opens the self-contained **AgentPanel** sheet (`components/agent-panel/agent-panel.tsx`) — five slots: IdentityStatus, KeyResult, OpenDecisions, WorkLog, freshness foot. The old `/api/cockpit/riley/outcomes` route survives as a documented legacy/debug contract (`routes/cockpit/riley/outcomes.ts:2-5`); the operator-visible outcome surface is the merged activity feed (`routes/agent-home/activity.ts:101-125`).

## Current-state table

| Surface                            | What it shows today                                                                         | Evidence                                                                                                                     | State                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Panel hero (KeyResult)             | "ad leads" count, week window; lifetime window 400s by construction                         | `metrics-riley.ts:155-159`; proxy `metrics/route.ts:5`; API `metrics.ts:12`                                                  | partial — lifetime branch dead                         |
| Panel ROI line                     | `"$X per booked · target $Y"` (server-computed)                                             | `metrics-riley.ts:108-116`; `key-result.tsx:166-170`                                                                         | real but blended denominator; hidden when target unset |
| Economic tier / trueROAS in panel  | absent                                                                                      | only typed consumer `use-ad-optimizer.ts` has 0 importers                                                                    | gap                                                    |
| Approval moment (#841)             | tier basis line + CPL / $x-per-booked / trueROAS dataLines                                  | `recommendation-sink.ts:377-388` → `emit.ts:78-95` → `recommendation-adapter.ts:43-48` → `approval-detail-sheet.tsx:187-201` | **wired, confirmed**                                   |
| Reallocation approval              | winner/loser trueROAS cells, `Number.isFinite`-guarded                                      | `recommendation-sink.ts:253-260`                                                                                             | wired                                                  |
| Parked pause approval (#933 spine) | clicks/conversions + reversibility, **no economics, raw campaignId**                        | `parked-approval-cards.ts:89-111`                                                                                            | gap at the money moment                                |
| Work log                           | outcome rows w/ trust-delta suffix, fail-closed copy allowlist                              | `outcome-activity-row.ts:24-45`; `activity-voice.ts` ("I noted …")                                                           | sound                                                  |
| Greeting / wins / pipeline         | full riley coverage (4 variants; "Adjusted."; $-at-risk tiles w/ malformed-row drop)        | `greeting.ts:94-100,156-227`; `wins.ts:73`; `pipeline-riley.ts`; `routes/agent-home/pipeline.ts:96-107`                      | sound                                                  |
| Decisions feed                     | riley recs + handoffs + parked approvals; integrity-failed lifecycles render degraded cards | `routes/decisions.ts:41-48,88-100`                                                                                           | sound                                                  |
| Reports wire                       | riley = first-touch ad-attributed revenue cell; PaidVisitRow w/ honest attributionBasis     | `attribution-rule.ts:5-10,65-77`; `schemas/reports/v1.ts:88-103`                                                             | sound                                                  |
| riley_self ownership (#934)        | produced on report wire; **no UI consumer** (parity test only pins swipe policy)            | `schemas/ad-optimizer.ts:348`; `swipe-policy.parity.test.ts`                                                                 | reserved, unconsumed                                   |
| Conversational                     | **none**; SKILL_NOT_FOUND for ad-optimizer slug; dead chat widget on every page             | `skill-mode.ts:145-150,698,728`; `agents.ts:209`; `(auth)/layout.tsx:22`                                                     | open + regression                                      |
| Demo mode                          | riley surfaces have no demo branches (live-only); fixture toggle = mercury pages only       | `lib/data-mode/shared.ts`; no DataMode usage in home/agent-panel/inbox                                                       | no drift risk                                          |

## Findings detail

### D8-1 (P1, regression) — Zombie Operator Chat widget

`OperatorChatWidget` mounts on every authed page (`(auth)/layout.tsx:22`, `HIDDEN_PATHS` empty), suggests _"pause low-performing ads"_, and posts via `/api/dashboard/operator-chat` → `sendOperatorCommand` → `this.request("/api/operator/command")` (`api-client/agents.ts:209`). That path has exactly one reference in the repo — the client. The backend handler died in commit `8121a2aa` (2026-04-19, "delete dead single-tenant chat runtime"). `use-operator-chat.ts:53-60` renders every send as "Sorry, something went wrong." **Unmount it or make it real before pilot.**

### D8-2 (P1, known-open) — Baseline D9 fully still open

`skill-mode.ts` builds `skillsBySlug` from alex + mira only (:145-148) and registers builders for `"alex"` (:698) and `"creative"` (:728). `adOptimizerInteractiveBuilder` is exported (`builders/index.ts:2`) and registered nowhere; `createAdsDataTool`/`createAdsAnalyticsTool` have zero non-test consumers. The seeded riley deployment's `skillSlug: "ad-optimizer"` would hit `SKILL_NOT_FOUND` (`platform/modes/skill-mode.ts:57`). Cheapest credible first voice: a read-only narrate-the-audit skill over the persisted recommendation + outcome stores (baseline 6.2), registered with the mira-style slug-pinned loader.

### D8-3 (P1, verify-shipped/partial — baseline 2.4) — Headline CAC is blended and suppressible

Baseline 2.4 ("show booked-CAC, not cost-per-lead") _partially_ shipped: the panel now shows `$X per booked · target $Y`. But: (a) denominator = ALL non-cancelled bookings (`metrics-riley.ts:22,32-37`, deliberately lockstep with Alex's hero) while Riley's decisions run on ad-attributed per-campaign booked-CAC — organic bookings flatter the displayed number; (b) `hasRoiProof` requires a non-"—" target (`key-result.tsx:166`), target comes solely from AgentRoster `targetCpbCents` (`routes/agent-home/metrics.ts:18-30`), and nothing seeds it — zero-config orgs see no economics at all; (c) trueROAS/economic-tier never reach the panel. Fix: attributed-denominator CAC + render value without target + seed targets.

### D8-4 (P2, net-new) — Last-mile computed-then-discarded

`useAdOptimizerAudit` (`use-ad-optimizer.ts:85`) types the full audit report including `sourceComparison` (cpl/costPerQualified/costPerBooked/closeRate/trueRoas) and has **zero importers**. The #923/#934 ownership annotation on the report wire similarly has no apps/ consumer (the swipe-policy parity test pins the _policy_, not the wire). The baseline's meta-finding reproduces at the UI seam.

### D8-5 (verify-shipped: CONFIRMED) — #841 approval-moment economics

Full seam traced: `buildPresentation` (sink :377-388) embeds `economicBasisLine` (:211-220) + `economicsCells` (:235-243, honest-null, "true ROAS not yet attributed" never fabricated 0) → `emit.ts:78-95` stores presentation inside `parameters.__recommendation` (survives JSONB) → `recommendation-adapter.ts:43-48` extracts → `approval-detail-sheet.tsx:187-201` renders every line. `sourceReallocationCells` Number.isFinite-guards both ROAS values (:258-260). Recommend one `safeParse` wire test pinning sink output to `DecisionPresentation`.

### D8-6 (P2, net-new) — Money-moment approval card is economically thinner than the advisory card

`pauseCard` for `adoptimizer.campaign.pause` (`parked-approval-cards.ts:89-111`): clicks/conversions + reversibility, raw `campaignId` in the summary, no tier-basis or cost-per-booked line. When the flag-gated pause spine goes live, the actual Meta mutation gets approved with less truth than the advisory rec. Thread name + economics into intent parameters at submit-and-park.

### D8-7 (P2) — Dead lifetime window

`window=all` is rejected by both the Next proxy (`VALID_WINDOWS`, route.ts:5) and the API (`z.enum(["week"])`, metrics.ts:12); KeyResult fires it anyway on every open (`key-result.tsx:35`) and falls back. The "since you hired Riley" eyebrow (`key-result.tsx:179`) is unreachable. Implement or remove.

### D8-8 (refinement) — `degraded:true` on the success leg

`metrics-riley.ts:147-152` returns `degraded:true, degradedHint:""` with a real value+target; the contract survives only via a component comment ("never gate on roi.degraded — Riley marks all ROI degraded", `key-result.tsx:164`). Any new RoiBar consumer honoring the flag re-hides Riley's CAC. Flip the success leg to `degraded:false`. `qualifiedPct=0` (:69) also still rides the wire as a documented shape-filler.

## What is sound (with evidence)

- **Approval-moment economics (#841)** — end-to-end, honest-null, NaN-guarded (D8-5 trace above).
- **Fail-closed display honesty** — off-allowlist outcome copy drops the row (`outcome-activity-row.ts:28-30`); malformed pipeline targetEntities dropped with warn (`pipeline.ts:96-107`); integrity-failed parked lifecycles render degraded cards, never vanish (`decisions.ts:41-48`); parked feed truncation expiry-sorted and logged (:17-34).
- **Riley fully covered in agent-home prose** — greeting variants (`greeting.ts:94-100,156-227`), wins ack "Adjusted." (`wins.ts:73`), $-at-risk pipeline tiles with intent-verb synthesis (`pipeline-riley.ts:48-80`).
- **Workflow-approval commit path** — rides the real lifecycle respond path with binding hash, stale-binding and approved-but-didn't-run states surfaced honestly (`inbox-screen.tsx:104-143`).
- **Reports attribution** — riley/alex revenue split on first-touch ad identity (`attribution-rule.ts:5-10`); PaidVisitRow carries `attributionBasis` incl. honest `campaign_missing` (`schemas/reports/v1.ts:88-103`); single ÷100 conversion documented at the API boundary.
- **No demo/live shape-drift risk** — riley surfaces have no demo branches; fixture mode is hard-denied on Vercel production before any opt-in (`data-mode/shared.ts:33-38`).

## Priority order for this domain

1. **D8-1** kill or rewire the zombie chat widget (S) — pilot-visible breakage.
2. **D8-3** attributed-denominator CAC + render-without-target + seed targets (M).
3. **D8-2** minimal read-only conversational Riley (L) — where trust is won.
4. **D8-6** economics on the parked pause card before the pause flag flips (S).
5. **D8-7/8** dead window + degraded-flag hygiene (S each).
