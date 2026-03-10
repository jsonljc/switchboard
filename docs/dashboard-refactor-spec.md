# Switchboard Dashboard — Full Refactor Spec

## Phase 1 — Executive Assessment

### Current state

- **Stack:** Next.js App Router, Tailwind, Radix-based UI, React Query.
- **Navigation:** Mission Control (home), AI Team, Approvals, Settings. **Activity is not in nav** (only linked from Mission Control “View all”).
- **Routes:** `/`, `/team`, `/approvals`, `/approvals/[id]`, `/activity`, `/settings`, `/setup`, `/login`.
- **Setup:** 8-step wizard at `/setup`: business type, operator name, capabilities, governance, connection, budget, Telegram, all set.

### What’s wrong

1. **Visual system**
   - Primary is bright violet (`239 84% 67%`) — feels SaaS, not calm.
   - Card shadow and dense cards feel like an admin panel.
   - Inter everywhere; no editorial warmth.

2. **Information architecture**
   - Activity is a key surface but not in primary nav.
   - Settings uses “Boundaries” and “Autonomy Level” — internal language.

3. **Technical leakage**
   - Login: “Sign in to manage your AI agents.”
   - Primary Operator card: “Automation Level” (Copilot/Supervised/Autonomous), “Autonomy Progress”, “Score”, “Successes”, “Failures”, “Fail Rate.”
   - Approvals respond dialog shows “Binding hash” (dev-only).
   - Approval cards and activity show raw `riskCategory` (“critical risk”, “high risk” is OK; “bindingHash” is not).
   - Agent strip: “All specialists are idle”; role names (Strategist, Monitor, Optimizer) are semi-technical.

4. **Copy and tone**
   - Outcomes panel: “Approvals handled” uses pending count (copy bug).
   - Empty states are minimal (“No pending approvals”, “No recent activity”) — could be warmer and more guiding.
   - Wizard title “Get Started” is generic.

5. **AI identity / character**
   - Onboarding has operator name + working style (Concise/Friendly/Professional) but no curated visual identity or “portrait” choice.
   - Team page is functional but doesn’t feel like “choosing a premium assistant identity.”

6. **Mission Control**
   - Correct sections (status hero, agent strip, active work, outcomes, activity) but layout is widget-heavy; could be a calmer, typography-led operations brief.

### What to keep

- Page set: Mission Control, AI Team, Approvals, Activity, Settings.
- Setup wizard concept and step order (business → operator → capabilities → governance → connection → budget → Telegram → done).
- Skin catalog and business-type step.
- Governance step copy (“Let them handle it”, “Ask me for big decisions”, “Ask me for everything”).
- Operator step (name + working style).
- Event translator (plain-English activity).
- Approval card structure and flow.
- Auth and session handling.

---

## Phase 2 — Final UX Direction

### North star

A calm, premium AI control tower inspired by Anthropic Claude: warm restraint, editorial whitespace, typography-led hierarchy, minimal chrome, non-technical language, and a curated AI identity layer. Web supports onboarding, visibility, approvals, identity, and settings — not daily campaign operations.

### Principles

- **Calm intelligence:** No visual noise; soft neutrals; muted accents.
- **Trust and clarity:** User always knows what the AI team is doing and what needs attention.
- **Plain language only:** No agent runtime, orchestration, cartridge, pipeline, API, or binding hash.
- **AI team as character:** One primary operator; specialists in the background; identity (name, tone, style, optional visual motif) is curated, not built like a game character creator.
- **Fewer, better screens:** No bloated nav; large calm sections over dense widgets.

---

## Phase 3 — Refactor Plan

### Final information architecture

**Primary nav (5 items):**

1. **Mission Control** — Home. What’s happening, what needs attention, outcomes, recent activity.
2. **AI Team** — Primary operator + specialists; identity, working style, what they do.
3. **Activity** — Timeline of what the AI did and what you decided.
4. **Approvals** — Pending and history.
5. **Settings** — General, how your assistant works (boundaries), connections.

**Onboarding flow (unchanged order, improved copy and visuals):**

1. Welcome
2. Business basics (name + type)
3. Choose your AI operator (name + tone/style)
4. Choose responsibilities (capabilities)
5. How much freedom (governance)
6. Connect your ads (optional)
7. Set your budget
8. Connect Telegram (optional)
9. You’re all set

**Mission Control layout:**

- One hero status block (one line + short subline): “Ava is running smoothly” / “Ava needs your attention.”
- Optional “Who’s working” strip (only when non-idle) — link to AI Team.
- Two main areas: “Needs your input” (approvals preview) and “Right now” (outcomes snapshot: spent today, tasks completed, pending approvals count).
- “Recent activity” with “View all” to Activity.
- No KPI grid; typography and spacing lead.

**AI Team page:**

- Primary operator as hero: name, role (“Your main assistant”), working style, what they coordinate. Optional: curated visual motif (from a small set of abstract/editorial options) — no avatar builder.
- Specialists as simple cards: role in plain language (e.g. “Plans campaigns”, “Watches performance”, “Handles leads”), status, no internal metrics.
- Plan-gated specialists shown as “Coming with [Plan]” — no “Available in Pro Plan” dev language in primary copy.

**Approvals page:**

- Pending first; history second. Same structure.
- Cards: plain-language summary, “Needs a decision by [time]”, risk as “Higher impact” / “Lower impact” (or keep “high/critical risk” only where needed).
- Respond dialog: no binding hash; confirm with summary and risk only.

**Activity page:**

- Filters: All, Completed, Declined, Approved, Settings — all plain language.
- List uses existing event translator; no raw event types.

**Settings structure:**

- **General:** Business name, business type (read-only), AI operator name.
- **How your assistant works:** Approval style (same options as onboarding: Let them handle it / Ask me for big decisions / Ask me for everything), spend limits, forbidden behaviors. No “Autonomy Level” or “Boundaries” as section titles; use “How your assistant works” or “Approval style”.
- **Connections:** Integrations and channels as today.

### Design system direction

- **Backgrounds:** Warm ivory / soft gray (e.g. `40 20% 98%`), not pure white.
- **Text:** Charcoal primary (`220 18% 18%`), muted secondary (`220 10% 46%`).
- **Primary accent:** Muted indigo or slate (e.g. `230 35% 45%`) or soft amber for key actions; never neon.
- **Surfaces:** Cards soft (`0 0% 100%` or tinted), minimal or no shadow; subtle borders (`30 18% 90%`).
- **Typography:** One readable sans (e.g. Inter or DM Sans); optional editorial serif only for large hero lines if desired.
- **Spacing:** Generous; sections separated by space, not only borders.
- **Motion:** Subtle fades and transitions; no bouncy or flashy animation.
- **Icons:** Simple line icons; consistent weight.

### Character / AI identity

- **In onboarding:** Step “Choose your AI operator”: name + “How should they communicate?” (Concise & direct / Friendly & warm / Professional & detailed). Optional future: “Choose a style” with 3–4 curated visual motifs (abstract shapes or minimal portrait style), not customizable avatars.
- **On AI Team:** Primary operator card emphasizes name, “Your main assistant”, working style, and “What they do” in one sentence. If motif exists, show small, tasteful motif; otherwise icon only.
- **No:** RPG classes, anime, mascots, or freeform avatar builder.

### Copy tone

- Warm, calm, confident, plain-language, slightly conversational.
- Examples: “Choose how your assistant works”; “Your assistant will handle follow-ups unless you say otherwise”; “This needs your approval”; “Everything is running smoothly”; “Nothing needs your input right now.”
- Avoid: “Configure orchestration”; “Execution policy updated”; “Tool invocation complete”; “Binding hash.”

### Empty states

- Approvals: “Nothing needs your input right now. When your assistant needs a decision, it’ll show up here.”
- Activity: “When your assistant takes action or you respond to a request, it’ll show here.”
- Mission Control outcomes: Keep minimal but positive.

### Responsive

- Keep current behavior: bottom nav on mobile, sidebar on desktop; main content max-width with padding. Slightly increase padding and section spacing for calm.

---

## Phase 4 — Implementation Checklist

- [ ] Design tokens: warm background, charcoal text, muted primary (indigo/slate), soft borders, reduced shadow.
- [ ] Add Activity to primary nav.
- [ ] Mission Control: restructure as single-column calm brief; status hero; needs-your-input + right-now; activity feed; more whitespace.
- [ ] AI Team: primary operator as “Your main assistant”; specialist labels in plain language; remove or hide autonomy metrics; optional motif placeholder.
- [ ] Approvals: remove binding hash from respond dialog; risk copy “Higher impact” where appropriate.
- [ ] Activity: add to nav; filter labels plain (Completed, Declined, etc.).
- [ ] Settings: tab labels “General”, “How your assistant works”, “Connections”; governance section copy friendly.
- [ ] Login: “Sign in to Switchboard” or “Sign in to your account”; remove “manage your AI agents”.
- [ ] Onboarding: wizard shell calmer (softer progress, more spacing); step titles/copy aligned with spec.
- [ ] Primary operator card: “How much can they do without asking?” with same three options; hide “Autonomy Progress” / score/fail rate or move to collapsible “Details”.
- [ ] Agent strip: “Your team is idle” or “No one’s working on anything right now”; role labels plain where shown.
- [ ] Outcomes panel: fix “Approvals handled” to show completed count if available, or “Pending decisions” for pending.
- [ ] Global: replace technical copy with plain-language equivalents; warmer empty states.

---

*End of spec. Implementation follows in codebase.*
