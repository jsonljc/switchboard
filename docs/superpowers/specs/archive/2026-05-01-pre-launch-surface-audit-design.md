# Pre-Launch Surface Audit — Design

> Status: Draft (pending user review)
> Owner: Jason
> Date: 2026-05-01

## 1. Goal

Audit every user-facing surface of Switchboard against a defined depth tier and a defined set of dimensions, producing a triaged set of findings whose launch-blockers must be fixed before public launch. The audit is a **spec-producing activity**, not a fix-it activity: each session emits findings; fixes happen in follow-up branches/PRs.

## 2. Context

- The console wiring branch (`feat/console-preview`, plan `2026-04-30-console-wiring-option-b.md`) is feature-complete except for Task 15 (manual verification + final sweep). Option C — schema-side replacement of placeholder numbers cells — is deferred.
- Six pre-launch security risks (#1–#6) closed in PRs #318–#326. These were backend/route-level. **Frontend-side trust boundaries (route guards, RQ cache scoping, NextAuth session edges) are not yet audited.**
- The `docs/audits/2026-04-26-readiness/` set covers user-journey readiness from a journey lens. This audit is complementary: surface-by-surface, dimension-by-dimension, with a defined severity bar.
- No previous audit has covered visual, copy, interaction-state, responsive, a11y, or perf as first-class lenses across the user-facing surface area.

The product cannot ship to real users until launch-blockers from this audit are closed.

## 3. Scope

### In scope

Seven user-facing surfaces, audited in this order. Routes listed below are the surface's primary entry points; the **actual route inventory is re-confirmed at the start of each session** (see §9 pre-flight) since routes evolve faster than this spec.

1. **Dashboard core** (authenticated, high-traffic) — `/console`, `/decide`, `/escalations`, `/conversations`, plus any per-session secondary route the user actually touches daily.
2. **Dashboard secondary** (authenticated, lower-traffic) — `/dashboard`, `/tasks`, `/my-agent`, `/me`, `/settings`.
3. **Marketing / landing** (public, informational) — `/`, `/agents`, `/how-it-works`, `/pricing`, `/privacy`, `/terms`.
4. **Onboarding / setup** (account creation + first-run) — `/get-started`, `/signup`, `/login`, `/onboarding`.
5. **Chat surfaces** — operator-visible rendering of Telegram/WhatsApp/Slack messages within the dashboard (e.g., approval previews, conversation views).
6. **Notifications** — outbound email and any other system-originated user-facing messages.
7. **Operator / admin** — internal-only surfaces (any present at audit time).

### Out of scope

- Refactoring beyond what a finding directly demands.
- Performance optimization beyond identifying issues.
- Net-new features.
- Code-health audit (file sizes, layering, dead code) — deferred.
- Backend audit beyond the frontend↔backend contract lens. The contract lens reads schemas, hook signatures, and API response shapes — it does **not** audit business logic, query plans, or service-layer behavior. Route-level security was covered in launch-risks #1–#6.
- End-user chat clients themselves (Telegram/WhatsApp/Slack apps). Only the operator-visible rendering is in scope.

## 4. Surfaces and depth tiers

### Tier definitions

- **Deep** — click every flow, every state, every breakpoint; cover all in-scope dimensions for that surface. ~½ day per surface, expected 15–30 findings.
- **Standard** — golden path plus 1–2 obvious failure modes; cover the priority dimensions for that surface. ~2 hours per surface, expected 8–15 findings.
- **Light** — smoke-test critical path; cover at most 3 dimensions. ~30–60 min per surface, expected 3–6 findings.

### Per-surface mapping

| # | Surface | Tier | Dimensions in scope | Rationale |
|---|---------|------|---------------------|-----------|
| 1 | Dashboard core | Deep | A, B, C, D, E, F, G, H, I-light | Highest-traffic post-launch; broken state = churn. |
| 2 | Dashboard secondary | Standard | B, C, D, H, I-light | Must work; lower traffic. Skip deep visual + a11y. |
| 3 | Marketing / landing | Deep | A, C, E, G, B-light, F-light | First impression. Brand, copy, mobile, perf are load-bearing. Public pages must meet basic a11y (keyboard nav, contrast). Auth and contract n/a. |
| 4 | Onboarding / setup | Deep | B, C, D, E, H, I-light, G-light | Conversion gate. Errors here = users never reach product. Slow signup is a conversion issue, not polish. |
| 5 | Chat surfaces | Standard | B, C, D, H | Operator legibility + voice consistency. Skip visual polish, mobile, a11y. |
| 6 | Notifications | Standard | C, D, H, J | J is notifications-specific (deliverability + link safety). Operational safety: wrong-tenant links, broken links, magic-link/session edges, environment domain correctness, unsubscribe/legal footer. |
| 7 | Operator / admin | Light | B, H, I-light | Does it work, is access correct. Internal-only — no copy/visual polish. |

"I-light", "F-light", "G-light", "B-light" mean the dimension runs as a constrained pass:

- **I-light** — route guards, React Query cache scoping, and NextAuth session edges. Backend route auth was hardened in #1–#6.
- **F-light** — keyboard navigability, color contrast (axe automated only), focus visibility. Skip deep screen-reader walkthrough.
- **G-light** — Lighthouse mobile perf only (desktop optional); flag scores below 70 or LCP > 4s. Skip React Profiler / waterfall deep-dive.
- **B-light** — golden-path walkthrough only; skip alternative paths and dead-end mapping.

## 5. Dimensions and methodology

| Lens | Name | Method |
|------|------|--------|
| A | Visual / design quality | Manual click-through; screenshots; judgment against the established design system (warm-neutral / Claude-inspired). |
| B | IA / UX flow | Task-based walkthrough. Each surface gets ≥1 named user task; auditor completes it as that user. |
| C | Copy / voice | Manual read; fact-check every concrete claim against actual product behavior. |
| D | Interaction state | Force loading / empty / error / partial-data states via devtools and bad fixtures. Verify forms validate. |
| E | Responsive | Devtools at 375 / 768 / 1024 / 1440 widths. Note breakpoints that break, not pixel-perfection. |
| F | Accessibility | axe-core run (CLI or DevTools); keyboard-only walk; VoiceOver spot-check on primary flow. |
| G | Performance | Lighthouse desktop + mobile; network waterfall; React Profiler if a slow render is suspected. |
| H | Frontend↔backend contract | Code-read hooks ↔ API ↔ schema. Reconcile against UI claims (placeholders, "coming soon" labels, fields the API doesn't serve). |
| I | Auth / permissions (frontend-side) | Code-read route guards in `app-shell` + middleware; check React Query cache scoping by tenant/session; spot-check session-expiry and re-auth UX. |
| J | Notifications-specific (deliverability + link safety) | Applies only to surface 6 (Notifications). Manual + code-read pass over: (a) every link points to the correct environment domain (no staging URLs in prod templates), (b) tenant-scoped links carry the right tenant identifier and don't leak across tenants, (c) magic-link / session-bearing URLs expire correctly and survive replay-prevention checks, (d) unsubscribe + legal footer are present where the message type requires it, (e) all links resolve (no 404s). |

For each finding the auditor records *which lens caught it* (the Dimension field). A single issue can cite multiple lenses if it genuinely spans them — but pick the primary.

### Disambiguation rules (mandatory)

Common lens-overlap patterns and how to assign primary lens:

- **A vs C** — If the *wording itself* is wrong, primary is C (copy). If the wording is fine but its *visual treatment* (size, hierarchy, color, placement) is wrong, primary is A (visual).
- **B vs D** — If the user can't figure out *what to do next*, primary is B (flow). If the user knows what to do but a *state* (loading/error/empty) is missing, broken, or jarring, primary is D (state).
- **D vs H** — If the UI shows a placeholder/blank/error because the *backend doesn't serve the data*, primary is H (contract). If the backend serves data but the UI mishandles the response, primary is D (state).
- **H vs I-light** — If the issue is *which fields the API returns*, primary is H. If it's *who can see those fields*, primary is I.

When a finding genuinely needs two lenses to be understood, record both, primary first: `Dimension: A, C`.

## 6. Finding template

Each finding lives in its surface's findings doc as one entry:

```
ID: <prefix>-NN
Surface: <route or component>
Sub-surface: <zone, component, or "global">
Dimension: <primary>[, <secondary>]   (codes: A B C D E F G H I J)
Severity: <Launch-blocker | High | Medium | Low | Defer>
Affects: <all users | new users | returning users | tenant admins | operators only | other:____>
Status: <Open | Accepted (ship-with) | Fixed (PR #__) | False positive (rationale)>
Discovered-at: <commit SHA at time of finding>
What:
  <1–3 sentences describing the issue>
Evidence:
  - File: <path:line>            (code-readable issues)
  - Screenshot: <artifacts/...>  (visual / state issues)
  - Repro: <numbered steps>      (interactive issues)
Fix:
  <1–2 sentences — direction, not implementation>
Effort: <S | M | L>
```

**Evidence minimum (enforced):**

| Severity | Required evidence |
|----------|-------------------|
| Launch-blocker | At least **two** of {File, Screenshot, Repro}. One must be File or Repro (proof it's reproducible). |
| High / Medium  | At least **one** of {File, Screenshot, Repro}. |
| Low / Defer    | One sentence under "What" is sufficient; evidence optional. |

**Effort definitions** (informs triage ordering, not commitment):

- **S** — under ½ day of focused work for one engineer.
- **M** — ½ to 2 days.
- **L** — more than 2 days, or requires its own design spec.

**Status field** is updated post-discovery as findings move through the pipeline. The findings doc is the source of truth — Fixed status records the merged PR number; Accepted records date and rationale; False positive records why.

Surface prefixes (two-letter to avoid collision with single-letter dimension codes):

- `DC` — dashboard core
- `DS` — dashboard secondary
- `MK` — marketing
- `OB` — onboarding
- `CH` — chat surfaces
- `NT` — notifications
- `OP` — operator / admin

Findings IDs are sequential per surface: `DC-01`, `DC-02`, … No global numbering.

## 7. Severity scheme

| Severity | Definition | Launch impact |
|----------|------------|---------------|
| **Launch-blocker** | Broken flow, data leak, wrong-tenant exposure, factually false copy, broken auth boundary, dead-end on the critical path. | Must fix before launch. |
| **High** | Missing error/empty state, broken on mobile, embarrassing visual, friction that costs conversion, broken non-critical flow. | Should fix pre-launch; can ship with explicit acknowledgment. |
| **Medium** | Quality issue; degrades feel; no launch impact. | Backlog. |
| **Low** | Minor polish. | Backlog. |
| **Defer** | Designer's-eye stuff; v1.1+. | Out of pre-launch consideration. |

The **launch-blocker bar is calibrated, not loose.** A severity of Launch-blocker means the auditor would advise the user to delay launch rather than ship with it open. If the auditor would not advise delay, it's High or below.

### Calibrating examples

| Severity | Example finding |
|----------|-----------------|
| Launch-blocker | "`/console` shows tenant A's escalation count to a tenant-B user when the React Query cache hasn't been invalidated on session change." |
| Launch-blocker | "`/signup` form silently fails on duplicate email — no error message, button stays in 'Submitting…' state forever." |
| High | "`/decide` has no empty state when the queue is empty — page renders as a blank panel." |
| High | "Pricing page: claim 'connects to your Slack' is true only behind a flag the user hasn't seen yet." |
| Medium | "`/settings` form labels use sentence case in some sections, Title Case in others." |
| Low | "Footer copyright year is hardcoded." |
| Defer | "Microcopy on the Approvals card could be warmer." |

These are anchors, not exhaustive. When in doubt, ask: *if I shipped with this open, would I regret it within the first week of real users?* If yes → Launch-blocker. If "we'd live with it but it's annoying" → High.

## 8. Deliverables

```
docs/audits/2026-05-XX-pre-launch-surface/
  index.md                              ← top-level triage doc
  01-dashboard-core-findings.md
  02-dashboard-secondary-findings.md
  03-marketing-findings.md
  04-onboarding-findings.md
  05-chat-findings.md
  06-notifications-findings.md
  07-operator-admin-findings.md
  artifacts/
    01-dashboard-core/
      lighthouse-desktop.json
      lighthouse-mobile.json
      axe.json
      screenshots/...
    02-dashboard-secondary/
    ...
```

- One findings doc per surface (7 files).
- One top-level `index.md` containing: scope summary, per-surface finding counts by severity, the **launch-blocker queue** (ordered, with referenced fix specs/plans as they're written), and the **High backlog**.
- Automated artifacts (Lighthouse, axe, key screenshots) committed under `artifacts/<NN-surface>/` to support re-audits and reviewer sanity-checks.

The exact YYYY-MM-DD prefix on the directory is set when the audit starts (not when this spec lands).

## 9. Execution model

### One audit session per surface

Seven sessions, executed strictly in the order in §4. Each session:

1. **Pre-flight.** Read this spec + the previous surface's findings doc (for severity calibration). Enumerate the surface's actual routes at HEAD (e.g., `find apps/dashboard/src/app -name page.tsx`) to confirm the route list before auditing.
2. **Stand up the surface.** Spin up the dev server in a worktree (`apps/dashboard` on port 3002, plus the API on 3000 where needed).
3. **Run the dimensions.** Exercise the methods listed for that surface's tier.
4. **File findings.** Record findings in the per-surface doc using the template in §6.
5. **Capture artifacts.** Commit Lighthouse / axe / key screenshots under `artifacts/<NN-surface>/`.
6. **Commit.** Use `docs(audit):` Conventional Commit prefix.

Each surface session is **complete** when *every one* of the following is true:

1. **Per-dimension closure.** For each in-scope dimension, the findings doc contains at least one finding **or** an explicit `Checked: <dimension> — no findings` line. No dimension may be silent.
2. **Evidence rule.** Every Launch-blocker finding meets the evidence minimum in §6 (≥2 of {File, Screenshot, Repro}, with at least one proving reproducibility).
3. **Artifacts committed.** Lighthouse JSON (desktop + mobile) and axe JSON exist under `artifacts/<NN-surface>/` whenever G or F is in scope. Screenshots referenced by findings exist on disk.
4. **Severity assigned.** Every finding has a severity per §7.
5. **Calibration ritual passed.** The user has confirmed severities for that surface's Launch-blocker and High findings before the session is closed (see "Severity calibration" below).
6. **Discovered-at SHA recorded.** Every finding's `Discovered-at` field carries the commit SHA the finding was discovered against. Front-matter `discovered_at` is human-readable session bookkeeping; the load-bearing SHA is per-finding so post-close findings (§10 step 7) can carry their own discovery SHA distinct from the original session.
7. **Validation passed.** Findings doc parses without missing-field warnings (see §13 validation).

### Claude / human split (explicit)

| Dimension | Who drives | Who confirms | Notes |
|-----------|-----------|--------------|-------|
| A — Visual | Claude proposes findings from code + screenshots; **human takes screenshots in browser**. | Human | Claude does not replace human browser verification. |
| B — Flow | Claude maps routes/components → user-task graph. | Human (walks the task end-to-end) | Claude verifies the graph; human verifies the lived experience. |
| C — Copy | Claude reads strings + cross-references product behavior. | Human | Cross-reference catches false claims Claude might miss. |
| D — State | Human forces states via devtools / network throttling / bad fixtures. Claude prepares the script. | Human | Claude does not replace human browser verification. |
| E — Responsive | Human resizes devtools + captures breakpoint screenshots per the script Claude provides. | Human | Claude does not replace human browser verification. |
| F — A11y | Human runs axe in DevTools + does keyboard walk + VoiceOver. Claude prepares the script. | Human | Claude can also code-read for static a11y issues (missing labels). |
| G — Performance | Human runs Lighthouse + saves JSON. Claude reads the JSON and writes findings. | Human starts the run; Claude interprets. | Lighthouse must run on a fresh production-like build, not dev mode (see §13). |
| H — Contract | Claude reads hooks ↔ API ↔ schema; produces findings. | Human (sanity-checks against intent) | Code-only; no browser needed. |
| I-light — Auth | Claude reads route guards + RQ cache scoping; flags suspicions. | Human (verifies in browser via two-tenant repro) | Suspected leaks must be confirmed in-browser before escalating to Launch-blocker. |

**Severity calibration** runs on every surface, not just the first:

- After Claude proposes severities for a surface's findings, the human reviews any Launch-blocker or High finding and either confirms or downgrades.
- The first surface (dashboard core) anchors the bar — the human's calibration there is recorded as precedent in `index.md` under "Calibration precedents."
- Subsequent surfaces reference the precedent. If a later finding's severity contradicts a precedent, the human resolves it explicitly.

### Worktree handling

Per `CLAUDE.md` doctrine, each audit session may use a dedicated worktree off `main` to avoid mixing audit work with feature branches. Findings docs and artifacts are committed on a focused docs branch and merged via PR.

## 10. Triage pass

After all 7 surface audits land:

1. **Roll up.** Aggregate every finding into `index.md`, grouped by severity. Cross-surface duplicates are merged into a single entry that references both surface files.
2. **Re-calibrate, both directions.** Re-read every Launch-blocker as a set; demote any that don't survive the §7 bar. **Also** re-read every High finding; promote any that on second read meet the Launch-blocker bar. Calibration runs *across all surfaces at once*, not per-surface — this catches drift between early and late surfaces.
3. **Order.** Sequence Launch-blockers by (a) blast radius, (b) effort, (c) coupling — fix prerequisites first.
4. **Spec the fixes.** Each Launch-blocker (or sensible group) gets its own follow-up spec under `docs/superpowers/specs/` and plan under `docs/superpowers/plans/`. The triage doc cross-references them. *Trivial fixes (under 30 minutes, single-file, no behavior change)* may bypass the spec and be filed directly as a fix PR — see §13 trivial-fix bypass.
5. **Ship-with acknowledgments.** Any Launch-blocker the user wants to ship with despite the audit must be recorded as a structured entry in `index.md`:

   ```
   Ship-with: <finding-ID>
   Acknowledged-by: <user>
   Acknowledged-at: <YYYY-MM-DD>
   Rationale: <1–2 sentences>
   Mitigation: <monitoring, alerting, or runbook reference>
   Re-evaluate: <date or "post-launch week 1">
   ```

   The Status field on the finding is set to `Accepted (ship-with)` and links to this entry.

   **Hard prohibition.** The following Launch-blocker classes are **never** eligible for ship-with acceptance and must be Fixed before launch:

   - Data leak (any cross-tenant or cross-user data exposure).
   - Wrong-tenant exposure (UI rendering data scoped to a different tenant than the session).
   - Broken auth boundary (route accessible without correct session, or stale session retains access after sign-out).
   - Payment / billing issue (incorrect charge, lost charge, exposed payment instrument, broken subscription state).
   - Security issue with confirmed exploit path (XSS, CSRF, injection, secret exposure).

   If a finding in one of these classes is discovered, the audit is not closed until the finding's Status is `Fixed (PR #__)`. No exceptions.

6. **Backlog.** Highs land in `index.md` under "High backlog" with effort estimates. Mediums and Lows are listed but not specced.
7. **Post-close findings protocol.** New findings discovered *after* the triage doc is committed (e.g., during fix work or pre-launch QA) are appended to the relevant surface's findings doc with `Discovered-at` set to the current commit SHA and a `Post-close: true` flag. The triage doc is amended to include them; the audit's "closed" state is re-asserted.

The audit is **closed** when:

- The triage doc exists and is committed.
- Every Launch-blocker has a Status of `Fixed (PR #__)` or `Accepted (ship-with)` with a structured ship-with entry.
- The High backlog is acknowledged and either scheduled or accepted as launch-debt.
- The pre-launch re-audit gate (§13) has run on the launch candidate and produced no new Launch-blockers.

## 11. Success criteria

- Seven findings docs exist, each conforming to the template in §6 and passing the §13 validation check.
- Every in-scope dimension on every surface has either a finding or an explicit `Checked: <dimension> — no findings` entry. No silent dimensions.
- The triage index exists with per-severity counts, the Launch-blocker queue, calibration precedents, and structured ship-with entries (if any).
- Every Launch-blocker has Status `Fixed (PR #__)` or `Accepted (ship-with)`. No Launch-blocker remains `Open` at launch.
- The pre-launch re-audit gate (§13) has run on the launch candidate (specific git SHA, recorded) and produced no new Launch-blockers. The re-audit output is committed under `artifacts/re-audit-<SHA>/`.
- The High backlog is acknowledged: each High has either a scheduled fix, a downgrade-with-rationale, or a ship-with acknowledgment.

## 12. Risks and non-goals

- **Severity drift.** Mitigation: per-surface human calibration of Launch-blocker / High findings (§9 completeness rule 5); cross-surface re-calibration in both directions during triage (§10 step 2); calibration precedents recorded in `index.md`.
- **Audit fatigue.** Late surfaces get less attention than early ones. Mitigation: surfaces are ordered most-important-first (§4); per-dimension closure rule (§9 completeness rule 1) prevents silent skipping; the Defer severity absorbs noise without polluting the backlog.
- **Audit becomes refactor.** A single Launch-blocker can spiral into a multi-week rewrite. Mitigation: §3 excludes refactoring; the Fix field captures direction, not implementation; structural fixes get their own spec.
- **Snapshot rot.** Findings are time-stamped against a `Discovered-at` SHA. Mitigation: pre-launch re-audit gate (§13) re-runs automated dimensions on the launch SHA; if >2 weeks have elapsed or substantial UI ships between original audit and launch, manual lenses are re-run for the affected surfaces (§13 stale-finding rule).
- **Evidence weakness.** Findings without enough evidence become arguments rather than tickets. Mitigation: §6 evidence minimum table; §13 validation enforces it.
- **Interrupted sessions.** A surface session may be interrupted; the next session must resume cleanly. Mitigation: §13 resume protocol — every session writes a `progress.md` next to the findings doc tracking dimensions completed.
- **False positives accumulate.** Without an explicit FP path, false-positive findings clutter the doc. Mitigation: the Status field includes `False positive (rationale)`; FP entries are kept (not deleted) so the rationale is auditable.
- **Lighthouse / axe environment drift.** Running these on dev mode produces different numbers than production. Mitigation: §13 specifies the build mode and run command; artifacts include the command + environment.

## 13. Operating procedures

The rules below are referenced from earlier sections. They are operational, not design — but they're load-bearing for foolproofness, so they live in the spec.

### 13.1 Resume protocol

Each surface session creates a `progress.md` next to the findings doc:

```
docs/audits/2026-05-XX-pre-launch-surface/
  01-dashboard-core-findings.md
  01-dashboard-core-progress.md   ← session-local progress tracker
```

`progress.md` is a checklist of in-scope dimensions for that surface, updated after each dimension is exercised. If a session is interrupted, the next session reads `progress.md` to know what's already done. `progress.md` is committed (so resume works across machines) and deleted only when the surface is closed.

### 13.2 Validation check

Before a findings doc is committed, run the validation script:

- Every finding has all template fields populated (no blanks, no `<placeholder>` left in).
- Every Launch-blocker has ≥2 evidence types per §6.
- Severity is one of the five defined values.
- Dimension(s) are valid lens codes.
- Status is one of the four defined values.
- The Discovered-at SHA matches a real commit.

The script is implemented during planning (see writing-plans output). Failure blocks the commit.

### 13.3 Lighthouse / axe run protocol

- **Build mode:** Lighthouse runs against `pnpm --filter @switchboard/dashboard build && pnpm --filter @switchboard/dashboard start` (production build, not `next dev`). Dev-mode Lighthouse numbers are not valid evidence.
- **Profiles:** Both desktop and mobile profiles, default Lighthouse settings, no throttling overrides.
- **axe:** Run via the axe DevTools browser extension on the same production build, or via `@axe-core/cli` if integrated. Save the JSON report.
- **Environment notes:** Each artifact JSON is accompanied by a `meta.txt` recording: command run, build SHA, browser version, OS, date.

### 13.4 Trivial-fix bypass

A finding qualifies for trivial-fix bypass (skip-spec, skip-plan, file fix PR directly) when *all* of:

- Severity is High or below.
- Dimension is C (copy) or A (visual) or D (state) only.
- Fix is a single-file change.
- Fix takes under 30 minutes of focused work.
- Fix has no behavior change for existing users.

Launch-blockers are **never** eligible for the bypass. They get a spec.

### 13.5 Cross-surface dedup

During triage roll-up, findings are deduped:

- Two findings are duplicates if they describe the same root cause manifesting on multiple surfaces.
- Duplicates merge into a single triage entry that lists all surfaces affected.
- The original per-surface findings keep their IDs and reference the merged entry.

### 13.6 Stale-finding rule

If more than 2 calendar weeks elapse between a surface's audit completion and the launch candidate SHA, **and** that surface has had substantive UI changes (>1 commit touching `apps/dashboard/src/app/<surface-routes>` or its components), manual dimensions for that surface are re-run on the launch SHA. Automated dimensions (G, F via Lighthouse/axe) are always re-run regardless of elapsed time as part of the re-audit gate.

### 13.7 Pre-launch re-audit gate

Before launch:

1. Identify the launch-candidate commit SHA. Record it in `index.md` as `Re-audit-SHA`.
2. Re-run G (Lighthouse desktop + mobile) and F (axe) for every surface where they were in scope. Save outputs under `artifacts/re-audit-<SHA>/<NN-surface>/`.
3. Diff against the original artifacts. New issues at Launch-blocker severity block the launch.
4. Sample-check 1 surface manually (rotate through the 7 across re-audits). If new manual Launch-blockers appear, expand the manual re-check to all surfaces.
5. Commit the re-audit output and update `index.md` with the gate result.

### 13.8 Severity calibration ritual

After each surface session's findings are drafted but before the session is committed:

1. Claude lists all proposed Launch-blocker and High findings in a short summary.
2. The user reviews each in turn: confirm, downgrade, or upgrade.
3. Calibration decisions go into `index.md` under "Calibration precedents" with the surface, finding ID, the decision, and a one-line rationale.
4. Subsequent surfaces consult precedents before assigning severity to similar findings.

## 14. Open questions

None at spec time. Calibration choices (depth tier per surface, dimension scope, audit order) are locked per §4.
