# Mira Creative Review Feed — Design

**Status:** Approved-with-tightening (2026-05-29). Pre-implementation design. Consumes Mira M1 (merged `ef65ceec`, PR #747). Incorporates the 2026-05-29 design review (scope tightening + locked product decisions + acceptance criteria).

**One-line goal:** Turn Mira's `/mira` surface into a full-screen, vertical, swipeable **TikTok/Reels-style feed of generated creative drafts** that a director scrolls to triage — keeping good drafts moving (Continue) and killing duds (Stop) — entirely within M1's draft-only, opt-in doctrine.

**The doctrine line that defines this product:** Mira is a **video-first creative _review_ surface, not a publishing surface**. Vertical swipe = browse only (free). Every consequence — Continue (real provider cost) and Stop (irreversible) — is a deliberate **tap + confirm**, never a gesture.

**Strategy/why (read-only, different repo):** `~/creativeagent/docs/plans/2026-05-28-mira-hybrid-launch-design.md`. This design touches **zero** creativeagent code.

---

## 1. Context & doctrine (do not violate)

Mira M1 shipped a draft-only, opt-in-per-org projection of the creative agent over the legacy `CreativeJob` pipeline, behind the `MiraCreativeReadModel` seam. This design is a **surface upgrade on top of M1** and keeps every M1 invariant:

- **Draft-only.** Actions are _Continue draft_, _Stop draft_, _Ready for review_. **Never** Publish / Launch / Go live / "Use this creative" / "Approve creative". The feed adds no publish path.
- **Opt-in per org.** Reachable only when `OrgAgentEnablement{agentKey:"mira", status:"enabled"}` exists. No global `day-one` flip. `seedOrgDayOneAgents` untouched.
- **Read / review-only.** No new creative submission from the Mira UI (no composer). The only writes are Continue/Stop on _existing_ jobs.
- **`Continue` = real cost.** Each Continue advances one generation stage → a real provider call + spend. **Stop is free but irreversible** — `stoppedAt` is set and there is **no resume** in M1.
- **No new mutating bypass path.** Continue/Stop ride the existing `lifecycle`-class `/creative-jobs/:id/approve` route (the doctrine-sanctioned legacy bridge the detail page already uses). Migrating that onto `PlatformIngress`/`WorkTrace` remains a pre-broad-enablement follow-up (out of scope here — §14).
- **Surface-agnostic backend.** `core`/`db`/`schemas` carry no UI references.

---

## 2. Problem / motivation

Today `/mira` is a plain text list of draft tiles; you tap a tile to reach `/mira/creatives/[id]`, where a single video plays with Continue/Stop. Three concrete gaps make this both unexciting and incoherent:

1. **The native format for UGC is video, not a list.** Mira's output is short vertical UGC clips. A vertical, full-screen, swipeable feed (the format users already know) is the natural way to review them — fast, thumb-native, satisfying. A bulleted list hides the actual product (the clip).

2. **The pipeline endpoint discards the video.** The seam (`buildMiraCreativeReadModel` → `MiraCreativeJobSummary`) already derives a `draft.videoUrl` for **both** polished and UGC jobs (`deriveDraft`/`deriveUgcDraft` in `packages/core/src/creative-read-model/status-mapper.ts`). But the agent-home pipeline route flattens each job to `{id, title, status, createdAt}` (`apps/api/src/routes/agent-home/pipeline.ts:142`), and the shared `PipelineViewModel` tile carries no video. So the feed **cannot** reuse `useAgentPipeline` — and we must not widen the shared tile model into something video-specific. The feed needs its own seam-backed read.

3. **The detail page is polished-only (the #4 parity gap).** `/mira/creatives/[id]` fetches the marketplace `CreativeJobSummary` wire type, which omits `mode`/`ugcPhase`/`ugcPhaseOutputs` (verified: `apps/dashboard/src/lib/api-client/marketplace-types.ts:51`). It reads `stageOutputs.production.assembledVideos[0]` directly — polished-only — so a completed **UGC** job shows "No draft clip yet — still in trends" (UGC `currentStage` stays `"trends"` for life). A feed that makes UGC clips first-class makes this inconsistency feel broken.

Separately, **the feed is unreachable from the app today** (the original follow-up #2 coherence gap): the Home Team Pulse chip hardcodes Mira to "Not set up" (`home-page.tsx:121` keys off static `launchTier`, not real enablement), and `MiraPanel` is a static "Coming soon" placeholder. An org with Mira **enabled** still sees no door into `/mira`.

---

## 3. Scope

**In scope (this feature):**

- **(A) Seam-backed feed read endpoint** — read-only API route returning **feed-ready** jobs (server-side filtered) + feed meta + a dashboard proxy + a `useMiraFeed` hook.
- **(B) The feed UI** — `/mira` becomes a slim Mira header (identity, halt, mission, "N drafts to review · M still rendering") + a full-bleed vertical video feed. Split into passive feed (3A) and action rail (3B).
- **(C) UGC detail parity (#4)** — back `/mira/creatives/[id]` with seam-derived draft data (single-item seam read) so UGC clips render identically to the feed.
- **(D) Entry-point coherence (original #2)** — make the Home Team Pulse chip + `MiraPanel` enablement-aware so an enabled org can reach the feed.
- **(E) Demo data + acceptance** — dev-only sample creative drafts (polished + UGC) for `org_dev`, a deployed-pilot enablement runbook, and the manual live-render acceptance pass (#3).

**Out of scope (explicitly deferred):**

- **Any publish / "use this one" / shortlist path.** The feed is triage-only. The architecture grows into a future _deliberate, governed_ "select/publish" rail action without re-architecting (see §14), but M1 ships none of it.
- **Migrating `/creative-jobs/:id/approve` onto `PlatformIngress`/`WorkTrace`** (M1 follow-up #5). Continue/Stop keep riding the existing lifecycle bridge — no _new_ bypass introduced.
- **New creative submission** from the Mira UI (no composer).
- **Reporting-grade counts** — the seam's counts stay window-bounded cockpit summaries (`FETCH_CAP`), not billing truth.
- **A thumbnail-grid view** — sequential director-style review is the product; a grid is a different product (§11 Q3).

---

## 4. UX design

### 4.1 The core principle (why TikTok-true, not Tinder)

In real triage, actions are asymmetric in both **frequency** and **cost**: you _browse_ constantly (free), _Stop_ duds occasionally (free **but irreversible**), and _Continue_ a chosen few (real spend, deliberate). Tinder-style swipe-to-decide only works when both directions are free, symmetric, and reversible — none of which holds here. Therefore:

> **The swipe is only ever _browse_ (vertical, zero-cost, zero-commitment). Every consequential action — Continue _and_ Stop — is a deliberate tap with a confirm. Money and irreversibility are never a raw gesture.**

For asymmetric, irreversible-or-costly triage this _is_ the correct interaction model, not a watered-down one.

### 4.2 The feed surface

```
┌─────────────────────────────────┐
│ Mira · Creative      ⏸ halt   ☰ │  ← slim header: identity, global halt, mission/menu
│ 3 drafts to review · 2 rendering │  ← server-computed feed meta
├─────────────────────────────────┤
│  ▸ status chip: "Ready for review"│ ← mode-correct status (§4.3 / §5.4)
│                                   │
│        ◢ UGC draft video ◣        │  ← full-bleed, autoplay, loop, muted, playsInline
│          (autoplaying)            │     tap = pause/play · tap speaker = unmute
│                                   │                         ⊘ Stop      ← irreversible-confirm
│                                   │                         ⊙ Continue  ← cost-confirm
│  "Spring promo · UGC"          ↗  │  ← title + mode badge; tap → /mira/creatives/[id]
└─────────────────────────────────┘
      ↑ flick up = next draft (free, no commitment)
```

- **Body = full-bleed vertical video feed** with CSS scroll-snap. One clip per "page".
- **Header is slim and persistent** — Mira identity, the **global halt** toggle (governance stays first-class), a mission/menu affordance, and a server-computed count line: **"{reviewableCount} drafts to review · {renderingCount} still rendering"**. The clip owns the screen; anything beyond identity/count/halt/menu lives behind the menu (§11 Q4).
- **Per clip:** a **status chip** (top — the seam's mode-correct `status`: _Ready for review_ / _In draft_; a granular _polished_ stage may be appended, but UGC phase granularity is deferred since the seam's `stage` field is polished-only, see §5.4), the autoplaying video (center), a metadata line (bottom-left, caption position: title + UGC/polished badge; tap → detail), and a right-side **action rail**.

### 4.3 The action rail + locked microcopy

Driven by the seam's `reviewAction` per job. The feed can be fun; **the money/irreversible actions must feel boring and explicit.**

**Continue** (`reviewAction.canContinue`) — opens a **cost-confirm sheet** (reuses the detail-page pattern; `useCostEstimate` supplies "~$X" once available, else honest-generic; continues at the default `basic` tier — no pro picker):

> **Continue draft**
> Runs the next generation step. This may create provider cost.
> _[Confirm continue]_ _[Cancel]_

**Stop** (`reviewAction.canStop`) — opens an **irreversible-confirm sheet**. No undo toast (there is no resume):

> **Stop this draft?**
> You can't continue it later. This can't be undone.
> _[Stop draft]_ _[Cancel]_

**`draft_ready`** clips (`label:"review_draft"`) — no Continue/Stop; a "Ready for review" affordance + tap-to-detail.

**Forbidden action copy** (would make spending feel casual): _Boost, Next, Approve, Use, Looks good, Ship, Go live, Publish, Launch._

The rail is the **only** place actions live. The scroll never acts.

**Mutation success behavior** (locked):

```
onSuccess (Continue or Stop):
  invalidate the useMiraFeed query
  optimistically remove the current card
  snap to the next available card
  toast: "Draft continued" / "Draft stopped"
  (no undo for Stop)
onError:
  keep the card, show an inline retry; never silently drop
```

### 4.4 Which clips appear, ordering, and limit semantics

- **Feed = reviewable jobs only**: `status ∈ {awaiting_review, draft_ready}` **and** a derived `draft.videoUrl` present. **Filtered server-side** (see §5.2) — the client does not infer feed membership.
- **`renderingCount`** = jobs actively generating with no clip yet (no `draft.videoUrl`, non-terminal). Surfaced in the header ("· 2 still rendering"), not shown as black-screen cards.
- **`stopped` / `failed`** → excluded from the review feed (terminal; nothing to triage).
- **Order:** newest first (`createdAt desc`, already the reader's order). No re-ranking in v1.
- **Limit semantics (locked):** filter **before** limiting. The endpoint reads a wide window from the seam (`visibleLimit` = the seam fetch window), filters to reviewable, then slices to the requested feed `limit` (default 20, cap 50). This prevents "18 of the 20 newest have no video → feed shows 2" while older reviewable clips exist. The seam's `FETCH_CAP=200` remains the outer bound (acceptable at pilot scale).

### 4.5 Video playback craft

- `muted` + `playsInline` + `loop` + `autoplay` so mobile autoplay is allowed; tap to unmute, tap to pause/play.
- **Only the in-view clip plays** (IntersectionObserver) — others pause to save battery/bandwidth and avoid audio overlap.
- Poster = `draft.thumbnailUrl` when present; a broken/expired `videoUrl` shows a fallback "this clip didn't load" card rather than a dead frame — one bad clip never blanks the feed.

### 4.6 States (incl. explicit halt behavior)

- **Loading:** a single skeleton clip card (never a flash of "empty").
- **Empty (enabled, no reviewable drafts):** honest "No drafts to review yet — Mira's drafts will appear here as they generate."
- **Error:** a per-feed retry card; one clip's failure never blanks the feed.
- **Halt ON (locked behavior):**
  - the video feed stays **browsable** (reading is always allowed);
  - **Continue is visible but disabled**, labeled **"Halted"** — tapping it shows "Resume Mira to continue drafts." (do **not** hide Continue, or users think the draft isn't continuable);
  - **Stop remains enabled** (a halt-aligned "kill").
- **Halt OFF:** normal Continue/Stop behavior.
- **Disabled org:** route 404s (unchanged from M1) — the feed is never reached.

### 4.7 Responsive

One surface, not a mobile-only fork. Wide screens render a **centered phone-width video column** with the action rail beside it (TikTok-web pattern); mobile is full-bleed. **No thumbnail grid** (§11 Q3).

---

## 5. Architecture

### 5.1 Data flow

```
CreativeJob/AssetRecord rows
  └─ PrismaMiraCreativeReadModelReader.read(orgId,{now,tz,visibleLimit})   [packages/db — exists]
       └─ buildMiraCreativeReadModel → MiraCreativeReadModel               [packages/core — exists]
            jobs: MiraCreativeJobSummary[] { id,title,stage,status,draft{videoUrl,…},reviewAction,source,… }
  NEW ▸ GET /agents/mira/creatives?limit=N      (list, read-only, enablement-gated, org-scoped)   [apps/api]
  NEW ▸ GET /agents/mira/creatives/:id          (single, for detail parity)                       [apps/api]
  NEW ▸ /api/dashboard/agents/mira/creatives[/:id]   (dashboard proxies)                          [apps/dashboard]
  NEW ▸ useMiraFeed()  → { jobs, counts, feed:{reviewableCount,renderingCount} }                  [apps/dashboard]
            └─ MiraFeedPage → MiraCreativeFeed → MiraClipCard → MiraClipActions
```

The seam was built for exactly this — "later phases widen the read-model or swap its implementation without touching Mira's surface." The feed is a **new consumer of the existing seam**; the happy path needs no seam change (a future additive `displayStage` is the one possible small extension — §5.4).

### 5.2 Backend — feed read endpoint (A)

- **Routes:** `GET /agents/mira/creatives` (list) and `GET /agents/mira/creatives/:id` (single) in `apps/api/src/routes/agent-home/` (new file, e.g. `creatives.ts`), `// @route-class: read-only`. Zero provider calls.
- **Gating:** mirror the pipeline route preamble exactly — `requireOrganizationScope`; `app.orgAgentEnablementStore` present → `isAgentHomeAccessible("mira", orgId, store)` (404 if not enabled, no leak); `app.prisma` present (503 if not). Then `new PrismaMiraCreativeReadModelReader(prisma)`.
- **Server-side filtering + limit (locked):** read the seam with a **wide** `visibleLimit` (the seam fetch window) so filtering sees the whole window; filter to reviewable; compute `feed` meta; slice to the requested `limit` (Zod-validated; default 20, cap 50).
- **Response shape (locked):**

  ```ts
  {
    jobs: MiraCreativeJobSummary[];   // reviewable only (draft.videoUrl + reviewable status), newest-first, sliced to limit
    counts: MiraCreativeCounts;       // seam window-bounded cockpit counts (unchanged semantics)
    feed: {
      reviewableCount: number;        // total reviewable in the window (pre-slice)
      renderingCount: number;         // actively generating, no clip yet
    };
  }
  ```

- **Single (`/:id`):** returns one `MiraCreativeJobSummary` (seam-derived `draft`), 404 if the job isn't in this org's window. Pilot-scale impl: `read(orgId)` then find-by-id (no new reader method needed); a dedicated `readOne` is a clean later optimization.
- **Wire type:** `MiraCreativeJobSummary` is defined in `@switchboard/core` (`creative-read-model/types.ts`). The dashboard consumes that shared type — imported from `@switchboard/core`, or mirrored exactly as `@/lib/agent-home/types` already mirrors the agent-home view-models if that is the repo's established cross-boundary convention — but **never a fresh divergent redeclaration** (doctrine invariant #11). The plan confirms the path by checking how the agent-home VMs cross into the dashboard today.
- **Proxies:** `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/route.ts` (+ `[id]/route.ts`), `dashboard-proxy` by directory convention, forwarding like the existing agent-home proxies.
- **Hook:** `useMiraFeed()` — `useQuery` against the list proxy, returning `{ jobs, counts, feed }`; scoped query keys; light auto-refetch so newly-generated drafts appear; mirrors `useAgentPipeline`.

### 5.3 Frontend — feed components (B)

Split to keep each file small (≤~150 lines; the 600-line CI error is `.ts`-only, but we split `.tsx` on principle):

- `apps/dashboard/src/components/cockpit/mira/mira-feed-page.tsx` — header + feed orchestration; owns halt/mission/identity (reuses `Identity`, `MissionPopover`, `useHalt`, `useAgentGreeting`, `useAgentMission`); renders the server-computed count line.
- `mira-creative-feed.tsx` — scroll-snap container; renders a `MiraClipCard` per (already server-filtered) job; IntersectionObserver play/pause coordination; loading/empty/error states.
- `mira-clip-card.tsx` — one full-bleed clip: video element, status chip, metadata overlay (tap → `/mira/creatives/[id]`).
- `mira-clip-actions.tsx` — the rail + the **Continue cost-confirm** and **Stop irreversible-confirm** sheets + halt-disabled Continue + the locked success/error behavior. Reuses `useApproveStage` (`{jobId, action}`) and `useCostEstimate` — unchanged.
- `apps/dashboard/src/app/(auth)/mira/page.tsx` swaps `MiraCockpitPage` → `MiraFeedPage`. The old `mira-cockpit-page.tsx` list **retires** (§11 Q2) — one surface, not a toggle.

### 5.4 UGC detail parity (C / #4) — locked: seam-backed

The detail page must **read the seam**, not a raw `CreativeJob` wire shape — so the feed and detail show the _same derived_ `draft.videoUrl`, with **no UGC/polished extraction duplicated on the client**.

- **Back the detail with the seam.** `MiraCreativeDetailPage` consumes a `MiraCreativeJobSummary` (from the new `GET /agents/mira/creatives/:id`, via a `useMiraCreative(id)` hook + dashboard proxy) and renders `draft.videoUrl` directly — UGC + polished identical to the feed. For in-feed taps, pass the already-loaded summary as `initialData`; cold deep-links fetch the single endpoint. Continue/Stop/cost wiring is **unchanged** — `useApproveStage`/`useCostEstimate` operate by `jobId`, independent of the read path.
- **Rejected:** widening the marketplace `CreativeJobSummary` + computing the draft client-side via `deriveDraft`. It ships raw blobs to the client and duplicates derivation — exactly what the seam exists to prevent.
- **Known limitation:** the seam's `stage` field is the polished `CreativeJobStage` (UGC `currentStage` stays `"trends"`), so a granular UGC _phase_ progress bar isn't available from the summary today. v1 drives the chip from the mode-correct `status`; a precise UGC phase indicator is a small **additive** seam field (`displayStage`, mode-aware) deferred to a follow-up.

### 5.5 Entry-point coherence (D / original #2)

- **Enablement signal (dashboard):** reuse the existing agent-home access as the source of truth — a Mira accessibility probe (`useAgentMission("mira")` or `useMiraFeed`: HTTP 200 ⇒ enabled, 404 ⇒ not). No new "enablement" endpoint. When loading/errored, fall back to `launchTier` (don't flash "Not set up").
- **Home Team Pulse chip** (`home-page.tsx`): replace `setUp = launchTier === "day-one"` for Mira with the real signal; remove the stale "Mira has no mission endpoint (404)" comment (false for enabled orgs).
- **`MiraPanel`** (`mira-panel.tsx`): enabled → "Mira is set up — open her workspace →" drilling to `/mira`; not enabled → keep the honest "Coming soon". Thread a drill-in handler/`router.push("/mira")` from the hosts (Home/Inbox/Results already render `AgentPanel`).
- **Avoids the metrics-window trap:** the drill-in panel renders no `KeyResult`, so the `useAgentMetrics(agentKey, "all")` vs Mira's `window:"week"`-only route never collides — no metrics-route change needed.

### 5.6 Demo data + enablement + acceptance (E)

- **Local enablement** is already wired (`seed.ts:92` → `seedMiraPilotOrgs(prisma, ["org_dev"])`).
- **Demo drafts (dev-only):** seed a few sample `CreativeJob` rows for `org_dev` — ≥1 **polished** (`stageOutputs.production.assembledVideos[0].videoUrl`) and ≥1 **UGC** (`ugcPhaseOutputs.production.assets[0].outputs.videoUrl`) — pointing at **hosted sample MP4 URLs** (not checked-in binaries, unless the repo already has a binary-fixture convention; §11 Q1), documented as non-production demo assets, dev-only/idempotent. Without this, the local feed renders empty.
- **Deployed pilot:** a one-shot runbook to run `seedMiraPilotOrgs(prisma, [<pilotOrgId>])` against the deployed DB; the user picks the org and runs/authorizes it. **No production write is performed automatically.**
- **Acceptance (#3):** the manual live-render pass against `org_dev` — see §12.

---

## 6. Actions & governance

| Action          | Gate                                                      | Cost           | Reversible         | Wiring                                                       |
| --------------- | --------------------------------------------------------- | -------------- | ------------------ | ------------------------------------------------------------ |
| Browse (scroll) | none                                                      | free           | n/a                | client only                                                  |
| Continue draft  | cost-confirm sheet (basic tier); **disabled when halted** | **real spend** | advances one stage | `useApproveStage({action:"continue"})` → existing `/approve` |
| Stop draft      | irreversible-confirm sheet                                | free           | **no** (no resume) | `useApproveStage({action:"stop"})` → existing `/approve`     |
| Open detail     | tap                                                       | free           | n/a                | `/mira/creatives/[id]`                                       |

- **No new mutating path.** Both writes ride the existing `lifecycle`-class `/creative-jobs/:id/approve` bridge (org-scoped, regression-locked) — the same path the detail page uses today. The PlatformIngress/WorkTrace migration of that route stays a separate pre-broad-enablement follow-up.
- **Halt** stays first-class in the feed header; behavior is locked in §4.6.
- **Mutation refresh** behavior is locked in §4.3.

---

## 7. Error handling & edge cases

- **Cross-org isolation:** enforced by the reader's `where:{organizationId}` filter; the single-item `/:id` 404s for other-org jobs. Covered by mocked-Prisma tests.
- **No-video / in-progress jobs:** excluded from `jobs` server-side; reflected in `renderingCount`; never faked.
- **Broken/expired `videoUrl`:** per-clip fallback card; never blanks the feed.
- **Autoplay blocked by browser policy:** muted+playsInline maximizes allowance; if still blocked, show poster + tap-to-play.
- **Empty / disabled / halted / loading:** see §4.6.
- **Deep-link to `/mira/creatives/[id]` with no feed loaded:** fetches the single seam endpoint — works standalone.

---

## 8. Testing

- **core:** seam (`deriveDraft`/`deriveUgcDraft`/`mapCreativeJobToMiraStatus`) already unit-tested; no new helper needed.
- **api:** new route tests (mocked Prisma — CI has no Postgres): disabled org → 404; enabled → 200; query uses org filter; `limit` clamps; **filter-before-limit** (older reviewable clip survives newer no-video clips); no-video jobs excluded from `jobs` but counted in `renderingCount`; response includes `draft.videoUrl` + `feed` meta; single `/:id` returns the seam summary and 404s cross-org; no provider imports/calls. Mirror `mira-route-matrix.test.ts` + the pipeline route tests.
- **dashboard (behavioral; coverage 40/35/40/40 — not CLAUDE.md's global):**
  - feed renders only server-filtered jobs; empty/loading/error; tap navigates to detail; **active clip receives `play()`, inactive receive `pause()`** (mock IntersectionObserver); broken video shows fallback; tap toggles muted/play. _Do not over-test browser-specific autoplay._
  - Continue opens the confirm (no direct mutation); Confirm Continue calls `useApproveStage({action:"continue"})`; Stop opens the irreversible confirm; Confirm Stop calls `{action:"stop"}`; **halted disables Continue, keeps Stop**; Stop has no undo; success removes card + snaps to next.
  - MiraPanel/Team-Pulse: enabled → "open workspace" + click → `/mira`; disabled → coming soon/not set up; no false "Not set up" for an enabled org.
  - parity: a completed **UGC** job renders a video on the detail data path (regression-locks #4); no publish copy.
- **`next build` is NOT in CI** — run `pnpm --filter @switchboard/dashboard build` locally (only it catches dashboard import/page errors).
- Pre-existing non-Mira flakes to ignore: `chat` `gateway-bridge-attribution` (full-suite load), `dashboard` `auth-onboarding` `KnowledgeKind` mock.

---

## 9. PR slicing (for the implementation plan)

**PR1 — Feed read endpoint.** `GET /agents/mira/creatives?limit=N` (+ `/:id`); enablement gate; org scope; limit validation; server-side filter; `{jobs, counts, feed:{reviewableCount,renderingCount}}`; dashboard proxies; `useMiraFeed`/`useMiraCreative`. _Tests per §8 api._ No UI.

**PR2 — UGC detail parity (#4).** Detail page consumes the single seam endpoint (`MiraCreativeJobSummary.draft.videoUrl`); polished + UGC both render; Continue/Stop/cost hooks unchanged; cross-org `/:id` → 404; no client-side draft derivation; no publish copy. Lands **before** the feed drives more traffic to detail.

**PR3A — Passive feed UI.** `/mira` → `MiraFeedPage`; header (identity/halt/mission + count line); full-screen scroll-snap feed; `MiraCreativeFeed`/`MiraClipCard`; video render; tap → detail; loading/empty/error; responsive centered desktop column. **No Continue/Stop yet.** _This isolates video-playback debugging from mutation debugging._

**PR3B — Action rail.** `MiraClipActions`; Continue cost-confirm; Stop irreversible-confirm; halt behavior (disabled Continue, enabled Stop); mutation success (invalidate + optimistic remove + snap-to-next + toast) and error handling.

**PR4 — Entry-point coherence (#2).** Enablement-aware Home Team Pulse chip; `MiraPanel` drill-in to `/mira`; remove stale mission-404 assumption; no `KeyResult` (avoids metrics-window issue).

**PR5 — Demo seed + acceptance.** Dev-only sample creative jobs (≥1 polished + ≥1 UGC, hosted sample URLs) for `org_dev`; deployed-pilot enablement runbook; manual acceptance pass (§12). No automatic production write.

(`writing-plans` produces the task-by-task plan with spec + code-quality review gates per PR, then `subagent-driven-development`. PR3 ships as 3A→3B; collapse only if 3A stays trivially small.)

---

## 10. Doctrine compliance checklist

- [x] Draft-only — no publish/launch/"use"/approve-creative copy or path (forbidden-words list in §4.3).
- [x] Opt-in — enablement-gated; no global flip; `seedOrgDayOneAgents` untouched.
- [x] Read/review-only — no new submission; only Continue/Stop on existing jobs.
- [x] No new mutating bypass — writes ride the existing `/approve` lifecycle bridge.
- [x] Surface-agnostic backend — core/db/schemas carry no UI refs; feed wire type sourced from the shared package.
- [x] Read-only route class + org-scoped + enablement-gated for the new endpoints.
- [x] Cross-app types in the shared package — no local redeclaration.
- [x] File-size discipline — feed split into small components; PR3 split 3A/3B.

---

## 11. Locked product decisions

- **Q1 — Sample video assets:** **hosted sample MP4 URLs**, not checked-in binaries (unless the repo already has a binary-fixture convention). Seed dev-only; document as non-production demo assets.
- **Q2 — Retire vs toggle old list view:** **retire** the list. The default (and only) Mira surface is the video review feed; "still rendering" is a compact header affordance, not a second view.
- **Q3 — Desktop ergonomics:** **centered phone-width feed** on desktop. No dense thumbnail grid — sequential director-style review is the product; a grid is a different product.
- **Q4 — Header density on mobile:** keep **Mira identity, review count, halt access, mission/menu icon**; everything else moves into the menu. The clip owns the screen.

---

## 12. Acceptance criteria (must-have before ship)

1. `/mira` is **unreachable** for non-enabled orgs (404).
2. `/mira` shows a **vertical feed** for enabled orgs with reviewable clips.
3. Feed includes **both polished and UGC** sample drafts (via the demo seed).
4. The **UGC detail page renders the same clip** as the feed.
5. **Continue never fires without confirm.**
6. Continue copy clearly states **real provider cost**.
7. **Stop never fires without confirm.**
8. Stop copy clearly states **irreversible** (no resume; no undo).
9. **Vertical scroll never triggers a mutation.**
10. **Halt** disables/suppresses Continue (visible, labeled "Halted") while keeping **browsing and Stop** available.
11. **No** publish/launch/use/approve-creative copy appears.
12. **No** new creative-submission UI appears.
13. **No** new mutating backend route is introduced (writes ride the existing `/approve`).
14. **Cross-org** detail access is blocked (other-org `/:id` → 404).

---

## 13. Out of scope / future

- **"Use this creative" (publish) path** — the genuinely exciting end-state. Lands later as a _deliberate, governed rail action_ (another tap + confirm, behind deferred governance phases G1–G3), slotting into the same rail without re-architecting the feed.
- **Shortlist/favorite** — a lightweight "selected" marker; deferred (no destination in M1).
- **`/approve` → PlatformIngress/WorkTrace migration** (M1 follow-up #5) — required before _broad_ (non-pilot) enablement; not before pilot.
- **Granular UGC phase indicator** — additive seam `displayStage` (§5.4).
- **Reporting-grade counts / `PcdPerformanceSnapshot`** — deferred with the M1 governance phases.
