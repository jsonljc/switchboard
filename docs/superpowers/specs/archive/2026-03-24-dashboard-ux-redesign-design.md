# Dashboard UX Redesign — Design Spec

**Date:** 2026-03-24
**Status:** Draft
**Scope:** Role-based views (Owner + Staff), navigation consolidation, CRM merge, settings area, dark mode

---

## 1. Problem Statement

The Switchboard dashboard has 12 top-bar navigation items and 25 routes serving two distinct users (SMB owner and staff member) with a single UI. The owner checks in on their phone 1-2x/day wanting a 10-second "how's my business" answer. The staff member manages leads and conversations on desktop. Neither is well-served:

- **Navigation overload:** 12 items is too many for either user. On mobile bottom tabs, they physically don't fit.
- **Wrong landing page:** The home page (`/`) is a character identity customizer — a one-time setup activity, not a daily destination.
- **Overlapping pages:** Leads, Conversations, Inbox, and Escalations all deal with customer interactions but are separate pages.
- **Setup mixed with daily use:** Knowledge, Test Chat, Agents config are alongside Leads and Approvals.
- **Technical jargon:** Conversations page shows raw `threadId`, `principalId`, `human_override` status.
- **No dark mode:** Despite a well-structured HSL token system ready for it.

---

## 2. Design Principles

1. **Two views, one product.** Owner and Staff get purpose-built navigation and density, sharing the same design system and data.
2. **Keep the visual identity.** Warm editorial aesthetic (warm neutrals, Inter + Cormorant Garamond, character system) is the brand. Structure changes, not style.
3. **Contact-centric CRM.** People, not threads. Every interaction rolls up to a contact.
4. **Setup pages belong in Settings.** Daily-use pages in the main nav; configuration behind a gear icon.
5. **Mobile-first for Owner, desktop-first for Staff.**

---

## 3. Information Architecture

### Owner View (mobile-first, 4 bottom tabs)

| Tab    | Route     | Purpose                                                   |
| ------ | --------- | --------------------------------------------------------- |
| Today  | `/`       | Outcome numbers, top approval, activity feed              |
| CRM    | `/crm`    | Simplified lead list, tap to view contact + conversation  |
| Decide | `/decide` | Approval cards with consequence context                   |
| Me     | `/me`     | Identity summary, team status (read-only), quick settings |

Owner routes:

```
/                     -> Today (owner home)
/crm                  -> Lead list (simplified)
/crm/[contactId]      -> Contact detail + conversation thread
/decide               -> Approval cards
/decide/[id]          -> Approval detail
/me                   -> Identity + team status + settings
```

### Staff View (desktop-first, 5 top-bar items + gear)

| Nav Item        | Route          | Purpose                                                 |
| --------------- | -------------- | ------------------------------------------------------- |
| Dashboard       | `/`            | Outcome banner + activity feed + approvals + scorecard  |
| CRM             | `/crm`         | Master-detail, tabbed: Leads, Chats, Escalations, Inbox |
| Campaigns       | `/campaigns`   | Campaign list + management                              |
| Performance     | `/performance` | Tabbed: Results, Growth                                 |
| Decide          | `/decide`      | Approvals with pending count                            |
| Settings (gear) | `/settings`    | Team, Knowledge, Channels, Identity, Test Chat, Account |

Staff routes:

```
/                        -> Dashboard (staff home)
/crm                     -> CRM with tabs
/crm/[contactId]         -> Contact detail (full)
/campaigns               -> Campaign list
/campaigns/[id]          -> Campaign detail
/performance             -> Tabbed: Results | Growth
/decide                  -> Approvals
/decide/[id]             -> Approval detail
/settings                -> Settings shell with sidebar
/settings/team           -> Agent roster (absorbs /team)
/settings/team/[agentId] -> Agent config (absorbs /team/[agentId])
/settings/knowledge      -> Knowledge upload
/settings/channels       -> Channel connections
/settings/identity       -> Character customization (absorbs /)
/settings/test-chat      -> Test chat
/settings/account        -> Governance, spend limits, forbidden list
```

### View Resolution

```
1. User logs in -> session includes role: "owner" | "staff"
2. localStorage override: switchboard.view-preference
3. AppShell routes to OwnerShell or StaffShell
4. Same URLs, different shells and component density
```

---

## 4. Route Migration

| Current Route     | New Location                 | Notes                          |
| ----------------- | ---------------------------- | ------------------------------ |
| `/` (identity)    | `/settings/identity`         | No longer landing page         |
| `/mission`        | `/`                          | Becomes home for both views    |
| `/leads`          | `/crm` (Leads tab)           | Merged into CRM                |
| `/conversations`  | `/crm` (Chats tab)           | Merged into CRM                |
| `/inbox`          | `/crm` (Inbox tab)           | Merged into CRM                |
| `/escalations`    | `/crm` (Escalations tab)     | Merged into CRM                |
| `/results`        | `/performance` (Results tab) | Merged into Performance        |
| `/growth`         | `/performance` (Growth tab)  | Merged into Performance        |
| `/agents`         | `/settings/team`             | Moved to settings              |
| `/knowledge`      | `/settings/knowledge`        | Moved to settings              |
| `/test-chat`      | `/settings/test-chat`        | Moved to settings              |
| `/connections`    | `/settings/channels`         | Moved to settings              |
| `/boundaries`     | `/settings/account`          | Moved to settings              |
| `/settings`       | `/settings/account`          | Moved under settings sidebar   |
| `/activity`       | Removed                      | Absorbed into Dashboard feed   |
| `/team`           | `/settings/team`             | Moved to settings              |
| `/team/[agentId]` | `/settings/team/[agentId]`   | Moved to settings              |
| `/approvals`      | `/decide`                    | Renamed                        |
| `/approvals/[id]` | `/decide/[id]`               | Renamed                        |
| `/setup/*`        | Unchanged                    | Onboarding flow, chrome-hidden |
| `/onboarding`     | Unchanged                    |                                |
| `/login`          | Unchanged                    |                                |

Old routes should redirect to new locations for bookmarks.

---

## 5. Shell Architecture

### AppShell (view router)

```
AppShell
  isOnboarding/login/setup? -> render children bare (unchanged)
  view === "owner"?         -> OwnerShell (bottom tabs)
  view === "staff"?         -> StaffShell (top bar)
```

### OwnerShell

- **Mobile (primary):** Content area + 4-item bottom tab bar. No top bar — maximize vertical space.
- **Desktop (secondary):** Same 4 tabs rendered as centered top bar. Content constrained to `content-width` (42rem).
- Tabs: Today, CRM, Decide, Me. Badge count on Decide.

### StaffShell

- **Desktop (primary):** Fixed top bar with 5 nav items + gear icon. Content at `page-width` (74rem).
- **Mobile (secondary):** Hamburger menu replacing top bar items. Menu includes nav items + Settings + "Switch to Owner view" + Sign out.

### View Toggle

- Staff: link in Settings sidebar footer ("Switch to Owner view")
- Owner: option in Me page ("Staff view -> full dashboard access")
- Flips localStorage preference, swaps shell. No page reload.

### Files

```
components/layout/
  app-shell.tsx          <- Modified: view routing logic
  owner-shell.tsx        <- New: bottom tabs + content
  staff-shell.tsx        <- New: top bar + content
  owner-tabs.tsx         <- New: 4-tab bottom bar
  staff-nav.tsx          <- New: 5-item top bar
  staff-mobile-menu.tsx  <- New: hamburger drawer
  settings-layout.tsx    <- New: sidebar + content for /settings/*
  shell.tsx              <- Deleted: replaced by staff-nav + owner-tabs
```

---

## 6. CRM Page Design

### Staff CRM (master-detail)

Left panel (40%): Contact list with tab filtering (Leads | Chats | Escalations | Inbox). Right panel (60%): Contact detail with Info, Conversation thread, Timeline sections.

Tabs change the list filter, not the layout. A contact in "Chats" is the same contact in "Leads" — viewed through a different lens.

**Contact-centric, not thread-centric:** Show person name, channel icon, stage badge, last message preview, relative time. Never show raw threadId, principalId, or technical status codes. `human_override` becomes "Escalated".

### Owner CRM (mobile)

Flat contact list with filter chips (All, New, Qualified). No master-detail — tap goes to full-screen `/crm/[contactId]`. Each row shows: name, channel icon, stage, time, last message preview. Sorted by "needs attention" first.

### CRM Contact Detail (`/crm/[contactId]`)

Shared between both views (different density). Sections:

- **Info:** Name, phone, email, stage, source, created date
- **Conversation:** Full chat thread (bubbles, same style as current)
- **Timeline:** Stage changes, escalations, agent actions

---

## 7. Dashboard / Today Design

### Owner "Today" (mobile)

Vertical stack, optimized for 10-second scan:

1. **Greeting** — "Good morning, [name]"
2. **Numbers** — leads today, booked, revenue (large type, 3 stat cards)
3. **Needs you** — single most urgent approval (not 3 stacked). "1 more waiting" link.
4. **What happened** — activity feed, capped at 5 items, "See all" link
5. **Monthly scorecard** — below the fold, available on scroll

### Staff "Dashboard" (desktop)

1. **Outcome banner** — condensed to one line: "3 leads, 1 booked, $420 revenue, 2 pending approvals"
2. **Two-column grid:** Activity feed (left) + Needs attention (right, approvals + escalations merged)
3. **Monthly scorecard** — kept as-is
4. **Agent status strip** — bottom row, quick glance at agent health

### Reused Components

TodayBanner (add compact variant), TodayActivityFeed, MonthlyScorecard, MissionApprovalCard, AgentStatusStrip — all kept. New: Owner stat cards, escalation cards in right column.

---

## 8. Settings Consolidation

Sidebar layout at `/settings`:

| Sidebar Item | Route                 | Absorbs                            |
| ------------ | --------------------- | ---------------------------------- |
| Team         | `/settings/team`      | `/team`, `/agents`                 |
| Knowledge    | `/settings/knowledge` | `/knowledge`                       |
| Channels     | `/settings/channels`  | `/connections`, channel management |
| Identity     | `/settings/identity`  | `/` (character customization)      |
| Test Chat    | `/settings/test-chat` | `/test-chat`                       |
| Account      | `/settings/account`   | `/settings`, `/boundaries`         |

Desktop: 200px sidebar + content area. Mobile: stacked list, tap navigates to sub-page with back button.

Team sub-navigation: `/settings/team` shows roster, clicking agent navigates to `/settings/team/[agentId]` with breadcrumb "Settings > Team > [Agent Name]".

---

## 9. Owner "Me" Page

Single-column mobile page:

- **Identity summary:** Name, tone, autonomy — editable inline. Condensed version of the 3-column identity page.
- **Team status:** Read-only agent list with status dots (Ready/Working/Error).
- **Quick actions:** Channels, Theme toggle, Sign out, "Switch to Staff view".

---

## 10. Dark Mode

CSS variable swap using `.dark` class on `<html>`. Standard Tailwind dark mode.

```css
.dark {
  --background: 30 8% 8%;
  --foreground: 40 15% 90%;
  --surface: 30 6% 12%;
  --surface-raised: 30 6% 15%;
  --muted: 30 5% 20%;
  --muted-foreground: 30 6% 55%;
  --border: 30 5% 18%;
  /* ... all tokens mapped */
}
```

- Respects `prefers-color-scheme` by default
- Manual toggle in Settings (staff) / Me (owner)
- Stored in localStorage: `switchboard.theme`
- No component changes needed — all components already use CSS variables

---

## 11. What Does NOT Change

- **Visual identity:** Warm neutrals, Inter + Cormorant Garamond, editorial spacing, character system
- **Operator Chat Widget:** Global, rendered in RootLayout, available in both views
- **Onboarding flows:** `/setup/*`, `/onboarding`, `/login` — unchanged
- **API layer:** No backend changes. All data hooks remain the same.
- **Existing components:** TodayBanner, MonthlyScorecard, TodayActivityFeed, MissionApprovalCard, AgentCards, approval-card, agent-config-\* — all reused
