# Mira — The Creative Operating Desk (North-Star UX)

**Date:** 2026-05-29
**Status:** Design / north-star vision
**Scope of this doc:** the full end-to-end Mira product experience (the "entire PCD experience" surfaced through Mira). The companion implementation plan targets **Phase 2 only** (Director's Desk v1); Phase 1 has already shipped.

---

## Thesis

**Mira is not a feed. Mira is a creative operating desk — with the feed as the screening room.**

> Desk to brief · feed to judge · shelf to learn · Riley to distribute.

Today `/mira` is a full-screen, TikTok-style vertical review feed (M1, PR #759). That feed is the right surface for _judging_ video drafts — but it is the wrong surface for _briefing_, for _tracking production_, and for _learning from performance_. Forcing all of those into one infinite stream makes Mira exciting for thirty seconds and then cognitively muddy.

The north-star gives each activity the surface it deserves. Mira becomes three connected spaces, and approved creative hands off to Riley for distribution — which in turn feeds Mira's next proposals. That coordination is the product story: not isolated tools, but a coordinated operating system for revenue creative.

## User & metaphor

The user is a **medspa owner** (Alex's vertical), not a creative professional. They supply **intent and taste**; they never touch creative tooling. Mira is **a creative director you brief**: you give intent ("promote our summer Botox special"), Mira's team produces options, you approve or redirect. You judge fit; you never operate a timeline.

## The lifecycle

```
proposal / open brief
   → production (peek-able)
   → review feed (Screening Room)
   → approved asset
   → handoff to Riley
   → performance informs future Mira proposals
```

## Agent separation (the core architecture decision)

| Agent     | Owns                                                                 |
| --------- | -------------------------------------------------------------------- |
| **Mira**  | concept → brief → production → review → **approved creative asset**  |
| **Riley** | distribution → ad-set / campaign usage → performance learning        |
| **Alex**  | medspa front office (organic/social distribution of approved assets) |

Mira must not become an ad-ops agent, and Riley must not become a creative agent. The handoff at "approved asset" keeps the boundary clean and creates the learning loop:

```
Riley outcomes → Mira proposals → brief → produce → review → approve → Riley distribution
```

---

## The three surfaces

### 1. Director's Desk — `/mira` (north-star home)

The front door and default surface. A calm hub, **not** a giant chat page and **not** an infinite feed. Modules, top to bottom:

1. **Open brief box** — "What should Mira make?" Conversational and lightweight. Accepts product, angle, audience, offer, and a creative reference. Submitting creates a production job. (Borrows chat's low-friction front door without making the whole product a thread.)
2. **Mira proposals** — proposal cards Mira generates from Riley's recent performance ("Based on Riley's last 7 days, I'd make…"). Each card states the angle, the reason, and the intended use. Accept → becomes a production job. _(Phase 3.)_
3. **In production** — a small tray, not the main event. "3 drafts generating." Plain stage copy by default; deeper shot-plan/QC detail only surfaces on a problem. Transparency without obligation, never an engineering console.
4. **Ready to review** — a prominent CTA into the Screening Room. "4 drafts ready" → opens the feed.
5. **Recently approved drafts** — a light, read-only shelf. In Phase 2 it shows only creatively-approved drafts with neutral copy ("Drafts you kept. Sending to Riley comes later."). The richer per-asset status (_waiting for Riley · in use · winner · fatigued_) is a **Phase 4–5 privilege**, unlocked only after the Riley attribution contract and governed handoff exist.

### 2. Screening Room — `/mira/review` (north-star route; shipped today at `/mira`)

The M1 vertical feed, kept as the **focused review mode**. It contains **only drafts ready to watch** — never proposals, briefing, or performance tracking.

Actions stay consequence-graded (as shipped):

- **scroll** = browse only
- **Continue** = cost-confirm
- **Stop** = irreversible-confirm
- **Approve / handoff** = governed action, added later (Phase 4)

### 3. Live / Library Shelf — `/mira/library` (or a Desk module first)

The post-approval archive. Starts lightweight, grows into the learning surface. Per approved asset, eventually:

- thumbnail / video
- original Mira angle
- handed-to-Riley date
- where Riley used it
- spend / CPA / ROAS / hook-rate _if available_ (see Open Dependencies)
- a "Mira learned from this" signal — **directional language only** (see Constraints)

This is where the loop visibly closes. _(Phases 4–5.)_

---

## Routing & migration

- **Today:** `/mira` renders `MiraFeedPage` (404s unless the org has Mira enabled via `OrgAgentEnablement`).
- **Phase 2:** `/mira` becomes the Director's Desk. The review feed moves to **`/mira/review`**. Add a redirect / backward-compatible alias so existing links and the M1 entry-point coherence (Home Team Pulse, MiraPanel drill-in) keep working — they should land on the Desk, with "Ready to review" routing into `/mira/review`.
- Route name chosen for clarity, not theatre: `/mira/review` (not `/screening`, not `/drafts/review`).

**Do not overbuild the Desk before the feed is valuable.** The feed is valuable now; the Desk is the next layer.

---

## Roadmap

### Phase 1 — Review Feed ✅ _shipped (PR #759)_

Seam-backed feed endpoint, UGC detail parity, vertical review feed, Continue/Stop confirm, entry-point coherence, demo data. Proves Mira has a real creative surface. **Already done — not in scope for the next plan.**

### Phase 2 — Director's Desk v1 _(next plan targets this)_

**Guiding principle: keep v1 boring enough to be trustworthy.** Phase 2 is a calm _control surface_ — create draft requests, see production status, enter the review feed, see recently approved drafts. It is the _beginning_ of the operating desk, not a preview of the autonomous creative OS. The single biggest risk is making the Desk _look_ alive (learning, performance, distribution) before the contracts behind it exist. Phase 2 must not imply any capability that Phases 3–5 own.

**Modules:**

- **Open brief box** — "What should Mira make?" (governed internal draft request — see contract below).
- **Ready to review** — CTA into the feed (`/mira/review`).
- **In production** tray — plain status only (see copy rules).
- **Recently approved drafts** shelf — read-only, lightweight; "Drafts you kept. Sending to Riley comes later." Deliberately _not_ "Recent approved": "approved" is overloaded in Switchboard (creatively-liked vs. ready-for-distribution vs. externally-approved-to-publish). Phase 2 means only **reviewed/creatively-liked drafts**; "Sent to Riley" (governed handoff) and "Published" are unavailable and must read as such.

**Routing:** `/mira` becomes the Desk; **move the feed to `/mira/review`** with a redirect/backward-compatible alias.

**No autonomous proposal system yet** — manual / open-brief only.

#### Phase 2 desk-item state contract

A desk item (a brief and the draft work it spawns) may be in exactly one of these **allowed** states:

`empty` · `brief_submitted` · `in_production` · `ready_to_review` · `reviewed_continue` · `reviewed_stopped` · `approved_draft` · `handoff_unavailable`

**Forbidden in Phase 2** (these belong to Phase 4/5 and may only appear as explicitly-disabled "coming later" copy):

`sent_to_riley` · `in_use` · `learning` · `winner` · `fatigued` · `published`

#### Phase 2 copy guardrails

Phase 2 UI and fixtures must **not** use these words (except inside disabled/future "Coming later" copy): _publish, launch, distribute, performance, winner, fatigued, learning, improved, drove, recovered, saved._ This is stricter than the global honest-impact rule because Phase 2 has no performance data at all.

- **In production tray** defaults to plain stage copy: "Writing concept" → "Generating draft" → "Checking quality" → "Ready to review." Deeper QC/shot-plan detail surfaces **only on a problem**: "Needs your input," "Reference image missing," "Couldn't generate safely," "Draft failed quality check." No engineering-console detail by default.
- **Recently approved shelf** shows only `approved_draft` items with neutral copy; no status chips like _in use / winner / fatigued_.

#### Open brief = governed internal draft request

The brief box submits a typed, auditable **internal** production mutation — not external governance, but not an unbounded fire-and-forget either. Name it `createCreativeDraftRequest` (NOT approve / handoff / publish). It captures and returns:

- **captures:** org ID, actor, brief text, optional creative reference, `requestSource: "mira.open_brief"`, idempotency key (submission may retry)
- **returns:** job ID, draft status, expected output count, cost/quota implication (if any)
- **guarantees:** no Riley side effect, no external publish side effect, draft-only

If creating drafts is cost-bearing, the brief box needs a lightweight **"Create drafts"** confirmation that surfaces the cost/quota implication — symmetric with the feed's cost-confirmed **Continue**.

#### Route migration is a product migration, not a UI refactor

The PR must include **route-level tests** (the meaning of `/mira` is changing):

- `/mira` renders the Desk when Mira is enabled
- `/mira` preserves the existing org-enablement 404 gate (disabled org behaves exactly as before)
- `/mira/review` renders the feed when enabled (and is itself gated)
- existing entry points (Home Team Pulse, MiraPanel drill-in, deep links) land on the Desk, not a broken feed
- "Ready to review" routes to `/mira/review`; direct `/mira/review` works

### Phase 3 — Proposal cards

Mira-generated proposals using Riley context. Examples:

- "Recent signals suggest your opening hooks could use a refresh — want 3 new hooks around price objection?"
- "Signals point to this offer landing better on FB than IG — want a more direct-response version?"
- "Recent signals lean toward demo-style clips — want 2 demo-first drafts?"

These are **directional prompts, not causal claims** — phrased as suggestions the owner accepts or declines, never as asserted asset-level outcomes (see Constraints and the Phase-3 coarse-signal rule below).

Depends on the Riley→Mira data contract (see Open Dependencies). **Until per-creative attribution exists, proposal cards must be framed on coarse account-level signals** — "Based on recent account patterns…", never "Based on your last creative's performance…". The UI must not imply asset-level learning it cannot back.

### Phase 4 — Approved-asset handoff

The real approved-asset state and the handoff to Riley. **Not "publish," not "launch."** Copy: _Send to Riley · Mark ready for distribution._ This is a **new cross-agent mutating path** — it must ride `PlatformIngress` / `WorkTrace`, not the legacy `/approve` lifecycle bridge that Continue/Stop currently use. Ships only when the governance layer (disclosure-at-publish, consent, QC/tier) is ready.

### Phase 5 — Live / Learning Shelf

Post-distribution outcomes on the shelf. Compounding loop; gives Switchboard memory and intelligence. **Copy stays directional and threshold-defined** — e.g. "This angle saw stronger signals," "Riley used this in recent campaigns," "Not enough data yet." Banned: "This creative drove revenue," "improved ROAS," "Mira learned this works." Status words like _winner_ and _fatigued_ may not appear in UI until each has a formal, defined threshold.

---

## Open dependencies

1. **Riley per-creative attribution (Phases 3 & 5).** _Confirmed gap._ Riley's outcome attribution today is **recommendation-level** — anchored to `Recommendation.actedAt` (`PendingActionRecord.resolvedAt`), scoped to `pause` and `refresh_creative` actions, **directional-only**. There is **no `creativeJobId → spend / CPA / ROAS / hook-rate` linkage**. The learning loop requires a new contract that attributes outcomes to a specific approved creative asset. This is upstream work in `packages/ad-optimizer` / Riley's attribution cron before Phases 3 and 5 can be real. Until it exists, proposals (Phase 3) can use coarser Riley signals (placement/offer/format trends) and the shelf (Phase 5) shows status without per-asset metrics.

2. **Governance layer for handoff (Phase 4).** Disclosure-at-publish (G1), consent (G2), forensic/tier/QC (G3) must land behind the seam before "Send to Riley" exists. Also: migrate Continue/Stop `/approve` onto `PlatformIngress`/`WorkTrace` before broad (non-pilot) enablement.

3. **Enablement.** Mira ships disabled-everywhere (`OrgAgentEnablement{mira}`); the Desk inherits the same gate as the feed.

## Constraints

- **Honest-impact guardrail.** Riley surfaces ban causal language ("saved / caused / recovered / improved / prevented") with a CI tripwire. Any Mira learning-shelf or proposal copy that references performance must stay **directional** and comply with the same rule.
- **Draft-only until governance.** No publish, launch, disclosure, lip-sync, or new submission path through Phase 3. Approval handoff (Phase 4) is the first governed mutating step and is gated.
- **Surfaces stay separated.** The feed never absorbs briefing/proposals/tracking; the Desk never becomes the review surface.
- **Don't show the OS before the contracts exist.** The single biggest product risk is the Desk _implying_ a full operating system (learning, performance, distribution) before Riley attribution and governed handoff are real. Each phase may only show capability its backend can honestly back; "approval" must never read as "approved for ads." Phase 2 enforces this via the state contract + copy guardrails above.

## Naming

| Internal concept | User-facing copy                |
| ---------------- | ------------------------------- |
| Director's Desk  | Mira (the home)                 |
| Screening Room   | Review drafts / Ready to review |
| Live Shelf       | Learning from performance       |
| Approved Asset   | (the asset)                     |
| Handoff to Riley | Sent to Riley                   |

Avoid theatrical nav labels: no "Screening Room" as a nav item, no "Director mode," "Creative cinema," or "Magic feed." Sharp, not theatrical.

## Non-goals

- Not a self-serve editing tool (no timeline, no per-tool controls).
- Not an ad-ops surface (distribution is Riley's; organic is Alex's).
- Not a publish/launch surface (until the governance layer ships).
- Not a single infinite feed and not a single chat thread.

---

## Final recommendation

Choose the **Director's Desk + Screening Room** model. Near-term, shipping the feed at `/mira` is acceptable (M1 only has review-ready drafts). Long-term, `/mira` becomes the Desk and the feed becomes `/mira/review`.

**Desk to brief. Feed to judge. Shelf to learn. Riley to distribute.**
