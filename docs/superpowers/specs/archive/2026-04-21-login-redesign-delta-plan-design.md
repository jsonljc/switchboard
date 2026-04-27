# Spec Fidelity Delta Plan — Onboarding, Dashboard, Settings

**Date:** 2026-04-21
**Status:** Design approved
**Depends on:** Onboarding redesign spec (2026-04-20), Dashboard OwnerToday spec (2026-04-20), Navigation cleanup (PR shipped 2026-04-21)

---

## Scope

This is a spec-to-code delta plan, not a green-field build.

The onboarding flow (4 screens), dashboard (OwnerToday), and settings playbook all exist. The work is:

1. **Visual/UX fidelity** — bring existing surfaces to approved spec (spacing, typography, motion, breakpoints, card treatments)
2. **Targeted functional wiring** — only where the spec depends on missing backend/behavior (website scan, simulation, interview engine, revenue breakdown)
3. **Documented as a handoff-ready delta plan** — what exists, what matches, what needs polish, what needs wiring, who owns each delta

---

## Critical / Build-Breaking Issues

Fix these first. The dashboard cannot compile or layout correctly without them.

| ID  | Issue                                                                                                                                                                               | Fix                                                                                                                                                                                                                      | Owner    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| C1  | `useEntrancePlayed` hook doesn't exist — OwnerToday imports it and fails to compile                                                                                                 | Create the hook: sessionStorage-backed boolean, `hasPlayed` + `markPlayed`, first-mount-only gate                                                                                                                        | FE       |
| C2  | `dashboard-frame`, `dashboard-content-grid`, `dashboard-main`, `dashboard-rail`, `dashboard-activity-inline` CSS classes undefined — layout is stacked divs, activity renders twice | Define in globals.css: frame max-width (88rem calm-grid at >=1440px, 76rem editorial below, 100% mobile, 48px side padding), content-grid 2-col with 320px sticky rail, responsive show/hide for inline vs rail activity | FE       |
| C3  | `FadeIn` doesn't accept `translateY` prop — commit `6e449559` claims to add it but component on disk hardcodes 16px                                                                 | Add `translateY` prop to FadeIn interface, wire it into the style                                                                                                                                                        | FE       |
| C4a | `StatCard` ignores `animateCountUp`, `countUpDelay`, `isRevenue` props from OwnerToday                                                                                              | Either implement count-up animation and revenue tint, or remove the props from OwnerToday. Decision: implement (see M3, L-rev below)                                                                                     | FE       |
| C4b | `FunnelStrip` ignores `animate` prop from OwnerToday                                                                                                                                | Declare prop in interface, wire entrance animation                                                                                                                                                                       | FE       |
| C4c | `RevenueSummary` ignores `dailyBreakdown` and `animate` props                                                                                                                       | Declare props, render 7-day mini bars (see F12)                                                                                                                                                                          | FE + API |
| C4d | `ActivityFeed` ignores `animate` prop                                                                                                                                               | Declare prop, wire entrance stagger                                                                                                                                                                                      | FE       |
| C4e | `ActionCard` ignores `riskCategory` prop                                                                                                                                            | Declare prop, add left severity border colored by risk level (see F13)                                                                                                                                                   | FE       |

---

## Layout & Spacing Delta

### Dashboard spacing

The approved dashboard spec uses a layered rhythm:

- **48px** below header before stat row
- **32px** between stat row and content grid
- **24px** between paired blocks (approvals/bookings, revenue/tasks)
- **32px** between major content sections (action zone → funnel → revenue-tasks)

| ID  | Component                                                   | Current                        | Target                                                                                                                     | Fix                               |
| --- | ----------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| L1  | OwnerToday frame                                            | No max-width, `px-6 md:px-12`  | 88rem calm-grid at >=1440px with 320px sticky rail, 76rem editorial below, 100% stacked mobile. 48px side padding desktop. | Define `dashboard-frame` CSS      |
| L2a | Header → stat row gap                                       | 32px                           | 48px                                                                                                                       | Change marginTop                  |
| L2b | Stat row → content grid gap                                 | 32px                           | 32px                                                                                                                       | Already correct                   |
| L2c | Paired block gaps (approvals/bookings, revenue/tasks)       | 24px                           | 24px                                                                                                                       | Already correct                   |
| L2d | Content sections gap (action zone → funnel → revenue/tasks) | 32px                           | 32px                                                                                                                       | Already correct                   |
| L5  | OwnerShell `content-width`                                  | `max-width: 42rem` (672px)     | Dashboard needs wider frame — dashboard-frame overrides content-width for dashboard route                                  | CSS override or conditional class |
| L7  | Activity rail vs inline                                     | Both render simultaneously     | Rail at >=1440px, inline below. CSS show/hide.                                                                             | Part of C2                        |
| L8  | BookingPreview row limit                                    | Shows all bookings             | Max 5 rows                                                                                                                 | `slice(0, 5)`                     |
| L9  | OwnerTaskList row limit                                     | Shows all tasks, no "View all" | Max 5 + "View all →" link                                                                                                  | Add limit + link                  |

### Onboarding spacing

The approved onboarding spec uses a more spacious rhythm:

- **48px** minimum section gaps in playbook panel
- **24px** card internal padding
- **16px** minimum between interactive elements

| ID  | Component                       | Current            | Target                        | Fix                                        |
| --- | ------------------------------- | ------------------ | ----------------------------- | ------------------------------------------ |
| L3  | PlaybookPanel section gaps      | `space-y-4` (16px) | 48px minimum between sections | Change to `space-y-12` or explicit margins |
| L4  | PlaybookSection content padding | `px-5` (20px)      | 24px (`px-6`)                 | Padding fix                                |
| L6  | ApprovalScenario option gaps    | `space-y-2` (8px)  | 16px minimum (`space-y-4`)    | Spacing fix                                |

---

## Typography & Content Delta

| ID  | Component                              | Current                                    | Target                                                                                                                                                                                                              | Fix                                      |
| --- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| T1  | DashboardHeader summary priority       | approvals → bookings → inquiries → overdue | approvals → escalations → bookings → inquiries → overdue (top 3 non-zero)                                                                                                                                           | Add escalations to priority list         |
| T2  | DashboardHeader "All clear" fallback   | Hardcoded "this morning"                   | Vary by time of day: "this morning" / "this afternoon" / "this evening"                                                                                                                                             | Use same hour logic as greeting          |
| T3  | Error state greeting font size         | 28px                                       | 24px (matches normal greeting)                                                                                                                                                                                      | Fix font size                            |
| T4  | "All caught up" empty state text size  | 15px                                       | 16px. Keep the subtle checkmark icon — approved spec retains it.                                                                                                                                                    | Fix text size only                       |
| T5  | BookingRow time font family            | Instrument Sans (`--font-display`)         | Inter (body font), 16px semibold                                                                                                                                                                                    | Remove `fontFamily: var(--font-display)` |
| T6  | BookingRow completed status label      | "Done"                                     | "Completed"                                                                                                                                                                                                         | Label text change                        |
| T7  | PlaybookSection status dot/label order | Label then dot (text left, dot right)      | Dot then label (dot left, text right). **P3 — low-value visual correction, defer if needed.**                                                                                                                       | Swap flex order                          |
| T8  | Root layout `--font-display`           | DM Sans loaded via Google Fonts            | Spec references Instrument Sans throughout. **Verify-first task**: confirm which font is canonical before swapping. Font-family change is cross-cutting and high-risk. Keep separate from normal typography polish. | Verify, then change if confirmed         |

---

## Functional Wiring Gaps

### P1 — Required for spec fidelity, high impact

| ID  | Feature                          | Current                                                                                 | Target                                                                                                                                                                   | Owner       |
| --- | -------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| F1  | Website scan                     | `scanUrl` passed to TrainingShell but no backend endpoint exists                        | Lightweight scan: fetch homepage + linked pages, structured extraction (services, hours, contact), confidence mapping, graceful fallback to no-scan interview            | BE + FE     |
| F2  | Interview engine                 | `InterviewEngine` class exists with simulated 1s delay, basic question flow             | Deterministic question progression by section, section readiness calculation, source/confidence metadata on extracted fields                                             | BE/FE audit |
| F3  | TestCenter simulation            | Props are `prompts={[]}`, `responses={[]}`, `isSimulating={false}` — completely stubbed | Real prompt generation from playbook, simulation via Alex skill runtime, response evaluation                                                                             | BE + FE     |
| F12 | Revenue `dailyBreakdown`         | OwnerToday passes it, RevenueSummary ignores it                                         | Render 7-day mini bar chart in RevenueSummary. API must return `revenue7d.dailyBreakdown` array.                                                                         | FE + API    |
| F13 | ActionCard `riskCategory` border | Passed but not declared or used                                                         | Add left severity border: `high` = destructive red, `medium` = amber, `low` = cool gray / neutral accent. Green is reserved for positive/confirmed states, not low risk. | FE          |

### P2 — Spec-defined behavior, medium impact

| ID  | Feature                                   | Current                             | Target                                                                                                                  | Owner |
| --- | ----------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----- |
| F4  | TestCenter "Re-run" button                | Missing                             | Appears after a fix has been made, re-sends the same prompt                                                             | FE    |
| F5  | TestCenter zero-test confirmation         | Missing                             | If zero tests on advance: "You haven't tested Alex yet." + "Test first" link + smaller "Go live anyway" visible for ~5s | FE    |
| F6  | FixThisSlideOver "Wrong info" path        | Generic textarea for all fix types  | Shows relevant playbook section for inline edit when "Wrong information" is selected                                    | FE    |
| F7  | AlexChat send button                      | No send button — Enter to send only | Send arrow icon appears when text is present (150ms fade-in)                                                            | FE    |
| F8  | AlexChat "New message" pill               | Missing                             | "↓ New message" pill when user is scrolled up and new message arrives                                                   | FE    |
| F9  | PlaybookPanel "Section updated" indicator | Missing                             | "↓ Services updated" indicator for below-viewport section updates, tappable to scroll there                             | FE    |
| F11 | GoLive playbook summary                   | Missing hours                       | Include hours in summary strip: "6 services · Mon-Sat 9am-6pm · Approval-first · WhatsApp"                              | FE    |
| F15 | ActivityFeed "See all" link target        | Points to `/dashboard` (circular)   | Either point to a dedicated activity page or remove the link until one exists                                           | FE    |

### P3 — Low urgency, depends on broader context

| ID  | Feature                  | Current                                | Target                                                                                                   | Owner    |
| --- | ------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| F10 | ChannelConnectCard icons | No channel icons                       | 20px monochrome icon per channel (WhatsApp, Telegram, Web Chat)                                          | FE       |
| F14 | Revenue currency         | Hardcoded `SGD` in `Intl.NumberFormat` | Use org-configured currency from org config. Never hardcode. Fallback to USD if org currency is missing. | FE + API |

---

## Motion Delta

Motion work comes **after** functional wiring. Build the behaviors first, then animate the real thing.

| ID  | Component                               | Current                                                          | Target                                                                                                                        | Owner |
| --- | --------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----- |
| M1  | FadeIn duration + translate             | 380ms, hardcoded 16px                                            | 300ms, configurable `translateY` (default 4px for dashboard entrance stagger)                                                 | FE    |
| M2  | FadeIn trigger model                    | IntersectionObserver (scroll reveal)                             | Page-load stagger for dashboard (first-mount-only via `useEntrancePlayed`). Keep scroll-reveal for long-scroll pages.         | FE    |
| M3  | StatCard count-up                       | Not implemented                                                  | Animated number roll on first mount. `animateCountUp` prop + `countUpDelay` for stagger.                                      | FE    |
| M4  | FadeIn reduced motion                   | Relies on global CSS `prefers-reduced-motion` rule               | Add explicit `prefers-reduced-motion` check in component: instant render (opacity 1, no translate, no transition)             | FE    |
| M5  | Onboarding screen transitions           | Instant conditional render                                       | 400ms crossfade between screens. Wrap step switch in transition container.                                                    | FE    |
| M6  | PlaybookSection collapse/expand         | Instant show/hide via conditional render                         | 200ms height transition with overflow hidden                                                                                  | FE    |
| M7  | ChatMessage entry animation             | Instant render                                                   | 300ms fade-in + 4px upward translate on new messages                                                                          | FE    |
| M8  | FixThisSlideOver animation              | Pops in/out (conditional render, transition class has no effect) | Desktop: 200ms slide from right. Mobile (v2): bottom half-sheet.                                                              | FE    |
| M9  | LaunchSequence beat choreography        | Status elements appear instantly via conditional render          | Sequenced transitions per spec beats: button morph → channel status → confirmation → test lead card slide-up → dashboard link | FE    |
| M10 | Button press scale (systemic)           | Not implemented on primary buttons                               | `active:scale-[0.98]` on all primary CTA buttons across onboarding and dashboard                                              | FE    |
| M11 | Category pills expand (OnboardingEntry) | Instant conditional render                                       | 300ms smooth expand (ease-out) when "No website?" is clicked                                                                  | FE    |

---

## Optional / V2

Not needed for spec fidelity. Defer.

| ID  | Feature                                     | Rationale                                                      |
| --- | ------------------------------------------- | -------------------------------------------------------------- |
| V1  | Funnel stage click-through to filtered view | Spec says "future — not wired in v1"                           |
| V2  | Revenue period selector                     | Spec says "no period selector in v1"                           |
| V3  | Mobile half-sheet for FixThisSlideOver      | Current slide-over works. Polish later.                        |
| V4  | Dashboard dark mode                         | Token system supports it but not polished                      |
| V5  | Activity feed dedicated page                | Can defer — "See all" link can be removed or pointed at a stub |

---

## PR Sequence

| PR       | Content                                                                                                                                                                                                          | Workstream            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **PR 1** | Compile + interface parity only. Critical fixes: C1–C3, C4a–C4e (declare prop interfaces, do not implement feature behavior — that lands in PR 4/5). Layout foundation: L1, L2a, L5, L7 (CSS class definitions). | Foundation            |
| **PR 2** | UX polish: L3, L4, L6, L8, L9 (spacing). T1–T7 (typography/content). T8 as verify-only task.                                                                                                                     | Spacing + Typography  |
| **PR 3** | Onboarding functional wiring: F1 (website scan), F2 (interview engine audit), F3 (TestCenter simulation). F4, F5, F6 (TestCenter polish). F7–F9, F11 (chat + playbook UX). F10 (channel icons).                  | Onboarding Wiring     |
| **PR 4** | Dashboard functional wiring: F12 (revenue dailyBreakdown + mini bars), F13 (ActionCard risk border), F14 (org currency), F15 (activity link). C4a–C4e feature implementation (count-up, animate, revenue tint).  | Dashboard Wiring      |
| **PR 5** | Motion system: M1–M11. All motion work in one pass after behaviors are wired.                                                                                                                                    | Motion + Choreography |
| **PR 6** | QA + cleanup: breakpoint validation (1280 / 1366 / 1440 / 1536), reduced-motion behavior audit, empty/loading/error state review, content truncation, zero-state pass across all modules.                        | QA                    |

---

## Component Ownership Map

### Onboarding route

| Component          | Role                           | Delta Type                                                                                                | Priority |
| ------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------- | -------- |
| OnboardingEntry    | Screen 1: URL input, skip path | UX polish (focus glow, pills animation, press scale)                                                      | P1       |
| TrainingShell      | Screen 2: split-screen layout  | UX polish (divider breathing room, footer transition, mobile readiness bar) + behavior (interview engine) | P1       |
| AlexChat           | Chat panel                     | UX polish (send button) + behavior (new-message pill)                                                     | P2       |
| ChatMessage        | Individual messages            | Motion (entry animation)                                                                                  | P2       |
| PlaybookPanel      | Playbook document              | Spacing (section gaps 48px) + behavior (section-updated indicator)                                        | P1       |
| PlaybookSection    | Collapsible section            | Spacing (24px padding) + typography (dot/label order) + motion (collapse animation)                       | P1       |
| ServiceCard        | Service entry within playbook  | UX polish (focus border, tint fade-out)                                                                   | P2       |
| ApprovalScenario   | Approval mode choice           | Spacing (16px option gaps, hover state)                                                                   | P2       |
| TestCenter         | Screen 3: simulation           | Functional wiring (real simulation path, re-run, zero-test gate)                                          | P1       |
| PromptCard         | Prompt selection card          | UX polish (hover state, checkmark position)                                                               | P2       |
| FixThisSlideOver   | Fix panel in TestCenter        | Behavior (playbook inline edit for "Wrong info") + motion (slide animation)                               | P2       |
| GoLive             | Screen 4: launch               | UX polish (summary with hours, button effects) + behavior (launch sequence)                               | P1       |
| ChannelConnectCard | Channel row in GoLive          | UX polish (icons, expand animation)                                                                       | P3       |
| LaunchSequence     | Launch animation               | Motion (beat choreography)                                                                                | P2       |

### Dashboard route

| Component       | Role                 | Delta Type                                                                                                                                | Priority |
| --------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| OwnerToday      | Page orchestrator    | Layout (frame, spacing, rail) — all via CSS classes                                                                                       | P1       |
| DashboardHeader | Greeting + summary   | Content (priority order, time-varying fallback)                                                                                           | P1       |
| StatCardGrid    | Stat card container  | Already correct (6 boxed cards, responsive grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`, 16px gap — matches approved spec)            | —        |
| StatCard        | Individual stat      | Feature (count-up animation, revenue tint)                                                                                                | P1       |
| SectionLabel    | Section heading      | Already correct                                                                                                                           | —        |
| ActionCard      | Approval/action item | Feature (risk border)                                                                                                                     | P1       |
| BookingPreview  | Today's bookings     | Behavior (5-row limit)                                                                                                                    | P2       |
| BookingRow      | Booking row          | Typography (font family, status label)                                                                                                    | P2       |
| FunnelStrip     | Pipeline snapshot    | Layout already correct (equal-width `flex: 1` columns, chevron separators, correct typography). Remaining delta: entrance animation only. | P2       |
| RevenueSummary  | Revenue card         | Feature (dailyBreakdown mini bars, org currency)                                                                                          | P1       |
| OwnerTaskList   | Task list            | Behavior (5-task limit, "View all" link)                                                                                                  | P2       |
| OwnerTaskRow    | Task row             | Already close to spec                                                                                                                     | —        |
| ActivityFeed    | Activity stream      | Feature (entrance animation, link target)                                                                                                 | P2       |
| ActivityEvent   | Activity row         | Already correct                                                                                                                           | —        |
| FirstRunBanner  | First-run overlay    | Already correct (Stone & Weight tokens)                                                                                                   | —        |

### Settings route

| Component    | Role                 | Delta Type                                                                                | Priority |
| ------------ | -------------------- | ----------------------------------------------------------------------------------------- | -------- |
| PlaybookView | Playbook in settings | Reuse playbook visual treatment from onboarding. Structured-only editing post-onboarding. | P2       |

---

## Decision Rules

When tradeoffs appear during implementation:

- **Distinctive > generic** — unless it threatens usability
- **Clarity > wow** — cut motion that reduces readability
- **Scanability > layout beauty** — choose information density that works in practice
- **Simplify > duplicate** — if a component starts acting like a second dashboard, demote it
- **Reduce > add** — if motion starts feeling noticeable, reduce it
