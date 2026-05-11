# Marketing Site Pre-Launch Fitness — Design

**Status:** Spec
**Date:** 2026-05-11
**Author:** brainstorming session (Jason + Claude)
**Implementation track:** single cut-first PR
**Phase:** related to Phase E roadmap but framed as truth-up, not redesign

---

## Goal

Make the public marketing surface honest, internally consistent, and aligned with the actual pilot go-to-market before WhatsApp/App Review unblocks real users. Bias toward deletion over replacement. **Do not redesign the home page.**

The current GTM is:

> email-only pilot → 3 fixed operational agents (Alex / Riley / Mira) → founder/operator-led setup → honest pilot pricing.

Cutting the fictional marketplace/self-serve surfaces is **truth-alignment**, not regression — those surfaces describe a product that does not exist yet.

## Non-Goals

- Migrating `/privacy` or `/terms` off `LandingChrome` (deferred).
- Marketing-surfacing `/reports`, `/contacts`, `/automations`, or other Phase-D Tools surfaces (those are operator UI, not marketing).
- New copy or redesign of the v6 home itself. Phase E1 (three-wedge redesign proper) and E2 (onboarding reframe) remain on the roadmap as separate work.
- Adding `/login` to the marketing topbar or otherwise changing auth UX.
- Building a real Status / status-page surface.

---

## Current state (audit findings)

**Public routes today:**

| Route                                      | State                                                                                                                                                                   | Verdict             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `/` (v6 landing)                           | Editorial single-page, Alex/Riley/Mira fixed roster, pilot mailto CTAs                                                                                                  | **Keep**            |
| `/agents` (`page.tsx` + `[slug]/page.tsx`) | Marketplace catalog pulling from `getListedAgents()` demo data; uses `LandingChrome`; lists slugs that conflict with canonical roster                                   | **Delete**          |
| `/how-it-works` (379 lines)                | "Browse by outcome" framing; lists fictional agents "Sales Closer", "Nurture Specialist"; uses `LandingChrome`                                                          | **Delete**          |
| `/pricing` (509 lines)                     | Self-serve tier-based ($49 / $149 / $399, conversation caps, CTAs to `/signup`); conflicts with home `#pricing` pilot model ($249 / $249 / $399, per-seat, mailto CTAs) | **Delete**          |
| `/signup` (247 lines)                      | Self-serve form; not the launch GTM                                                                                                                                     | **Delete**          |
| `/get-started` (5 lines)                   | Redirect to `/signup`; orphaned once `/signup` is gone                                                                                                                  | **Delete**          |
| `/privacy`                                 | Legal, `LandingChrome`-wrapped                                                                                                                                          | **Keep, untouched** |
| `/terms`                                   | Legal, `LandingChrome`-wrapped                                                                                                                                          | **Keep, untouched** |
| `/login`                                   | Existing-user sign-in (not marketing)                                                                                                                                   | **Keep, untouched** |

**Internal drift on the surviving home page:**

- Topbar "How it works" link → `#how` anchor that does not exist on the page.
- Topbar "Get started" CTA → `#closer`, which contains agent toggles but no commercial CTA; users have to scroll further to find the mailto pricing.
- Footer "Contact" → `href="#"` (placeholder).
- Footer "How it works" → `#how` (same broken anchor).
- Footer Status column → three placeholder `href="#"` links (Status, status.switchboard.live, @switchboard) implying telemetry/social surfaces that do not exist.
- Footer agent links → `#nova` (will become `#riley` after the E1a PR — already merged to `origin/main` as of 2026-05-11 in PR #426, just not pulled to local main).

**Dead support code after route cuts:**

- `apps/dashboard/src/components/landing/agent-marketplace-card.tsx` (only consumed by `/agents`)
- `apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx`
- `apps/dashboard/src/lib/demo-data.ts` (only consumed by `/agents` and `/agents/[slug]`)

`apps/dashboard/src/components/landing/landing-chrome.tsx` stays alive — still used by `/privacy` and `/terms`.

---

## Design

### Scope (single PR)

#### 1. Remove false surfaces

Delete the following directories/files:

- `apps/dashboard/src/app/(public)/agents/` (whole directory, including `[slug]/`)
- `apps/dashboard/src/app/(public)/how-it-works/`
- `apps/dashboard/src/app/(public)/pricing/`
- `apps/dashboard/src/app/(public)/signup/`
- `apps/dashboard/src/app/(public)/get-started/`

Delete dead support code:

- `apps/dashboard/src/components/landing/agent-marketplace-card.tsx`
- `apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx`
- `apps/dashboard/src/lib/demo-data.ts`

Before each delete, confirm no surviving imports via ripgrep (see Validation below). If demo-data has unexpected consumers outside the deleted routes, surface the finding to the user before removing it.

#### 2. Fix surviving home page links

In `apps/dashboard/src/components/landing/v6/topbar.tsx`:

- Change "How it works" link `href="#how"` → `href="#synergy"`.
- Change "Get started" CTA `href="#closer"` → `href="#pricing"` (lands users on the mailto cards).

In `apps/dashboard/src/components/landing/v6/footer.tsx`:

- Change Contact `href="#"` → `href="mailto:hello@switchboard.ai"`.
- Change "How it works" `href="#how"` → `href="#synergy"`.
- **Remove the entire Status `<FooterCol>`** (Status / status.switchboard.live / @switchboard). No real status surface exists; a placeholder column creates trust debt at launch.
- Confirm agent links read `#alex`, `#riley`, `#mira` (the E1a rename on origin/main should already cover this; verify after pull).

#### 3. Add drift guards

Extend `apps/dashboard/src/components/landing/v6/__tests__/no-banned-claims.test.ts` with **two distinct ban lists** to avoid false positives on legitimate CTAs.

**Banned copy fingerprints** (case-insensitive substring match in marketing source):

- `Sales Closer`
- `Nurture Specialist`
- `Browse by outcome`
- `Agent marketplace`
- `Browse agents`
- `Choose an agent`
- `Free trial`
- `Start free`
- `Self-serve` (and `Self serve`)

**Banned route hrefs** (match `href="..."` attribute literals; do not match the substring inside arbitrary copy):

- `href="/signup"`
- `href="/get-started"`
- `href="/agents"`
- `href="/pricing"`
- `href="/how-it-works"`

Note on `"Get started"`: this is a legitimate CTA label on the v6 topbar and closer. **Do not ban the phrase globally.** The href-based ban catches dishonest CTAs (pointing to deleted self-serve routes); the surviving label pointing to `#pricing` is honest.

Scope of the test scan stays as it is today: v6 landing source files plus `apps/(public)/page.tsx` and `apps/(public)/layout.tsx`. After this PR, those files plus `/privacy` and `/terms` are the only public surface; the existing scan covers the marketing-relevant files.

#### 4. Validate locally before merge

Per `CLAUDE.md` memory: **dashboard `next build` is NOT in CI.** Skipping it leaks `.js`-extension and import regressions.

Validation sequence (run from repo root):

```bash
# Hunt down dead references before the test catches them
rg '/signup|/get-started|/agents|/pricing|/how-it-works' apps/dashboard/src
rg 'demo-data|agent-marketplace-card|Sales Closer|Nurture Specialist|Browse by outcome|Agent marketplace|Browse agents|Choose an agent|Free trial|Self-serve|Start free' apps/dashboard/src

# Visual confirmation that only the intended public route-group dirs remain.
# Expected: (public), agents-removed; how-it-works-removed; pricing-removed;
# signup-removed; get-started-removed. Surviving children should be only
# privacy/ and terms/ (plus loose files like page.tsx, layout.tsx, loading.tsx).
find apps/dashboard/src/app/\(public\) -maxdepth 2 -type d

# Build + verify
pnpm --filter @switchboard/dashboard build
pnpm typecheck
pnpm lint
pnpm test
```

Manual smoke check on the running dev server:

1. Load `/` — confirm no console errors.
2. Click every topbar link → confirm it scrolls to a real section.
3. Click every footer link → confirm no `#` jumps to nowhere, mailto opens, agent anchors land correctly.
4. Hit each deleted route directly (`/agents`, `/pricing`, etc.) → confirm Next 404 page renders (acceptable launch behavior; no redirect needed for routes that never had public traffic).

If `rg` surfaces any reference outside the deleted-route source itself — e.g., middleware, sitemap config, metadata helpers, NextAuth redirect targets, tests of unrelated features, or copy in CLAUDE.md / docs — fix or update each one. Don't merge with orphans.

### Out of scope (deferred)

- Sitemap / robots.txt updates: only if a `sitemap.ts` or `sitemap.xml` exists in `apps/dashboard` and references deleted routes; check during `rg` step but do not introduce new sitemap infrastructure.
- `LandingChrome` migration for `/privacy` and `/terms`.
- `/reports`, `/contacts`, `/automations` marketing mentions.
- v6 home redesign or copy rewrite (Phase E1 proper).
- Onboarding reframe (Phase E2).
- Real Status / status-page work.

---

## PR shape

**One PR.** Rationale: PR-2 fixes links that point to surfaces PR-1 deletes. Splitting them leaves `main` in a temporarily-broken state (topbar "Get started" pointing into the same page anchor is fine, but the broader hygiene reads as one atomic story). Single PR also matches CLAUDE.md focused-PR doctrine because the deletions + link fixes share one unambiguous theme: "match marketing to current GTM."

Suggested PR title: `chore(dashboard): marketing truth-up — delete self-serve/marketplace surfaces, fix home links`

Suggested branch: `chore/marketing-truth-up`

Approximate diff: ~1,500 LOC deleted, ~50 LOC modified, ~30 LOC added (test extensions).

---

## Risks & mitigations

| Risk                                                                 | Likelihood                        | Mitigation                                                                                   |
| -------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| External link or backlink points to `/pricing` or `/how-it-works`    | Low (pre-launch, no real traffic) | Acceptable launch behavior: 404. Revisit if real traffic exists post-launch.                 |
| `demo-data.ts` has a consumer we missed                              | Low                               | `rg 'from.*demo-data'` before deletion; only `/agents` consumers found in audit.             |
| NextAuth redirect / middleware references `/signup`                  | Medium                            | First step of validation is the broad `rg` for deleted routes; fix any redirect targets.     |
| Banned-claims test false-positives a legitimate phrase               | Medium                            | Copy/href split lists exactly to prevent this. Test additions are explicit and reviewable.   |
| Dashboard `next build` fails on a Next-15 / .js-extension regression | Medium (per memory: not in CI)    | Run `pnpm --filter @switchboard/dashboard build` locally; treat as required before merge.    |
| E1a (Nova→Riley) not yet pulled to local main → conflicts            | Low                               | Pull `origin/main` before starting; E1a is at `5441a6c1` and is the prior commit to base on. |

---

## Success criteria

1. `/`, `/privacy`, `/terms`, `/login` are the only public routes.
2. No link on `/` lands on a deleted route or a non-existent `#` anchor.
3. `no-banned-claims.test.ts` fails if any fictional-agent or self-serve language returns.
4. `no-banned-claims.test.ts` fails if any `href` points to a deleted route.
5. `pnpm --filter @switchboard/dashboard build` succeeds locally.
6. `pnpm typecheck`, `pnpm lint`, `pnpm test` succeed.
7. Manual smoke check passes (every topbar/footer link resolves to a real destination).

---

## References

- Phase E roadmap: `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md` (§ Phase E — separate tracks)
- E1a (Nova→Riley rename, merged 2026-05-11): `docs/superpowers/plans/2026-05-11-e1a-nova-to-riley-rename.md`, commit `5441a6c1`, PR #426
- Canonical roster guidance: `MEMORY.md` → `project_canonical_agent_names.md` (Alex / Riley / Mira locked; Nova/Jordan stale)
- Dashboard build CI gap: `MEMORY.md` → `feedback_dashboard_build_not_in_ci.md`
- CLAUDE.md branch & worktree doctrine — single focused PR to `main`.
