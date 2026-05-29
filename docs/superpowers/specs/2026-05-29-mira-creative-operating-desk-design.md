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
3. **In production** — a small tray, not the main event. "3 drafts generating." Optional peek into shot plan → stage → QC flags. Transparency without obligation.
4. **Ready to review** — a prominent CTA into the Screening Room. "4 drafts ready" → opens the feed.
5. **Approved / handed to Riley** — a light shelf of recent approved assets with status: _waiting for Riley · in use · learning · winner · fatigued_. _(Phases 4–5.)_

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

- `/mira` becomes the Desk.
- Modules: **Open brief box**, **Ready to review** (links into the feed), **In production** tray, **Recent approved** shelf (read-only, lightweight).
- **Move the feed to `/mira/review`** with a redirect/alias.
- **No autonomous proposal system yet** — manual / open-brief first.
- Briefing in v1 may be intent-capture that creates a production job through the existing creative pipeline path; keep it draft-only (no publish, no disclosure, no new mutating cross-agent path).

### Phase 3 — Proposal cards

Mira-generated proposals using Riley performance context. Examples:

- "Your Reels placements are scaling but hooks are fatiguing — make 3 new opening hooks around price objection."
- "This offer converts better on FB than IG — make a more direct-response version."
- "Demo clips are outperforming lifestyle clips — create 2 demo-first drafts."

Depends on the Riley→Mira data contract (see Open Dependencies).

### Phase 4 — Approved-asset handoff

The real approved-asset state and the handoff to Riley. **Not "publish," not "launch."** Copy: _Send to Riley · Mark ready for distribution._ This is a **new cross-agent mutating path** — it must ride `PlatformIngress` / `WorkTrace`, not the legacy `/approve` lifecycle bridge that Continue/Stop currently use. Ships only when the governance layer (disclosure-at-publish, consent, QC/tier) is ready.

### Phase 5 — Live / Learning Shelf

Post-distribution outcomes on the shelf. "This angle worked — Mira will propose more like it." Compounding loop; gives Switchboard memory and intelligence.

---

## Open dependencies

1. **Riley per-creative attribution (Phases 3 & 5).** _Confirmed gap._ Riley's outcome attribution today is **recommendation-level** — anchored to `Recommendation.actedAt` (`PendingActionRecord.resolvedAt`), scoped to `pause` and `refresh_creative` actions, **directional-only**. There is **no `creativeJobId → spend / CPA / ROAS / hook-rate` linkage**. The learning loop requires a new contract that attributes outcomes to a specific approved creative asset. This is upstream work in `packages/ad-optimizer` / Riley's attribution cron before Phases 3 and 5 can be real. Until it exists, proposals (Phase 3) can use coarser Riley signals (placement/offer/format trends) and the shelf (Phase 5) shows status without per-asset metrics.

2. **Governance layer for handoff (Phase 4).** Disclosure-at-publish (G1), consent (G2), forensic/tier/QC (G3) must land behind the seam before "Send to Riley" exists. Also: migrate Continue/Stop `/approve` onto `PlatformIngress`/`WorkTrace` before broad (non-pilot) enablement.

3. **Enablement.** Mira ships disabled-everywhere (`OrgAgentEnablement{mira}`); the Desk inherits the same gate as the feed.

## Constraints

- **Honest-impact guardrail.** Riley surfaces ban causal language ("saved / caused / recovered / improved / prevented") with a CI tripwire. Any Mira learning-shelf or proposal copy that references performance must stay **directional** and comply with the same rule.
- **Draft-only until governance.** No publish, launch, disclosure, lip-sync, or new submission path through Phase 3. Approval handoff (Phase 4) is the first governed mutating step and is gated.
- **Surfaces stay separated.** The feed never absorbs briefing/proposals/tracking; the Desk never becomes the review surface.

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
