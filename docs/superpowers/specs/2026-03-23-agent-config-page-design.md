# Agent Config Page — Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Scope:** Per-agent configuration page with personality and behavior settings, accessible from the team page

---

## 1. Problem Statement

The native runtime (Phases 1-5) added conversation memory, workflow execution, scheduling, and approval gating. None of these capabilities have a user-facing configuration surface. The only agent customization today is the tone picker during onboarding — and there's no way to revisit it afterward.

Founders should be able to personalize each agent's personality and behavior from the dashboard, using plain-English options that map to backend configuration. This makes the product feel alive and gives founders ownership over their AI team.

---

## 2. Design Principles

1. **Human language, not technical knobs.** "How cautious?" not "maxDollarsAtRisk". "How often to follow up?" not "cronExpression".
2. **Per-role settings.** Each agent role has behavior options relevant to what it does. No generic one-size-fits-all form.
3. **Live preview.** Changes show immediately how the agent would behave — a preview message bubble, just like the onboarding tone picker.
4. **Save to existing config.** The `AgentRosterEntry.config` field (`Record<string, unknown>`) already exists. Settings save there via the existing `PUT /api/agents/roster/:id` endpoint.
5. **No new backend endpoints.** This is purely a dashboard feature that writes to existing roster config.

---

## 3. Route and Navigation

**Route:** `/team/[agentId]`

**Entry point:** Clicking any agent card on the `/team` page navigates to `/team/[agentId]`. This **replaces** the existing `AgentDetailSheet` slide-over panel — the sheet component is removed. The card's `onClick` handler changes from `setSelectedAgent(agent)` to `router.push(\`/team/${agent.id}\`)`. The `selectedAgent` state and `AgentDetailSheet` import are removed from the team page.

**Back navigation:** Back arrow + breadcrumb ("Team / Agent Name") at the top of the config page returns to `/team`.

---

## 4. Page Layout

Three-column layout on desktop (md+), stacked on mobile.

```
+-------------------+--------------------+-------------------+
|   PERSONALITY     |   AGENT IDENTITY   |   BEHAVIOR        |
|                   |                    |                   |
|   Display name    |   [Large Icon]     |   Role-specific   |
|   Tone picker     |   Name + Role      |   behavior        |
|   (warm/casual/   |   Status dot       |   options in      |
|    direct)        |   Quick stats      |   human-friendly  |
|                   |                    |   radio groups    |
|   Greeting        |   +-------------+  |                   |
|   preview         |   | Preview msg |  |   Escalation      |
|                   |   | bubble      |  |   preference      |
|                   |   +-------------+  |                   |
+-------------------+--------------------+-------------------+
```

On mobile (< md): stacks as Identity -> Personality -> Behavior.

---

## 5. Left Column — Personality

Shared across all agent roles.

### 5.1 Display Name

Editable text input. Defaults to the agent's current `displayName` from the roster.

### 5.2 Tone Picker

Three radio options (same as onboarding):
- **Warm & Professional** — friendly, reassuring
- **Casual & Conversational** — relaxed, approachable
- **Direct & Efficient** — brief, to the point

### 5.3 Greeting Preview

A chat-bubble preview showing how the agent would greet a customer, updating live as the tone changes. The onboarding component has a private `getPreviewGreeting()` function — this logic is **extracted and extended** into `agent-preview-templates.ts` with per-role variants. The onboarding component should be updated to import from the shared file.

**Config key:** `tonePreset: "warm-professional" | "casual-conversational" | "direct-efficient"` (matches existing backend key used by all agent handlers)

---

## 6. Center Column — Agent Identity

### 6.1 Agent Icon

Large version of the agent's icon from `AGENT_ICONS` (48x48 or 56x56 in a rounded container).

### 6.2 Name and Role

Agent display name (bold) and role label from `AGENT_ROLE_LABELS`.

### 6.3 Status

Current activity status dot + label (idle/working/analyzing/waiting).

### 6.4 Quick Stats

Simple counts sourced from `AgentStateEntry.metrics` (typed as `Record<string, unknown>`). Expected keys:
- `activeConversations: number` — for lead-facing agents (responder, strategist, booker)
- `actionsToday: number` — count of actions taken today
- `lastActiveAt: string` — ISO timestamp of last activity

If a key is missing from `metrics`, the stat is hidden (not shown as 0). These keys are populated by the backend agent state updater — if the backend doesn't yet populate them, the quick stats section gracefully shows nothing.

### 6.5 Preview Message Bubble

A styled chat bubble below the agent card showing a sample interaction. Updates live as personality and behavior settings change.

---

## 7. Right Column — Behavior (Per-Role)

Like a character trait in a game — one key behavior choice per agent that changes how they actually operate. Each is a labeled radio group with 3 options. Every option maps directly to a real backend config key that the agent handler already reads.

Keep it to **one trait per agent** (two max for the agents that matter most). Avoid anything that feels like an admin panel.

### 7.1 Responder (Lead Responder)

**How thorough?** — How deeply to qualify leads before handing off.
- "Speed run" -> `qualificationThreshold: 25` (fewer questions, faster handoff)
- "Balanced" -> `qualificationThreshold: 40` (default)
- "Deep dive" -> `qualificationThreshold: 60` (more questions, budget/timeline probing)

**Backend key:** `qualificationThreshold: number` (read by `lead-responder/handler.ts`, default 40)

### 7.2 Strategist (Sales Closer)

**Follow-up style** — How persistently to chase leads.
- "Gentle" -> `followUpDays: [2, 5, 10]` (spaced out, low pressure)
- "Steady" -> `followUpDays: [1, 3, 7]` (default)
- "Relentless" -> `followUpDays: [1, 2, 4]` (frequent, high urgency)

**Backend key:** `followUpDays: number[]` (read by `sales-closer/handler.ts`, default `[1, 3, 7]`)

### 7.3 Optimizer (Ad Optimizer)

**Spend authority** — How much can the agent change before asking you.
- "Check with me first" -> `approvalThreshold: 50`
- "I trust your judgment" -> `approvalThreshold: 200`
- "Go for it" -> `approvalThreshold: 500`

**Backend key:** `approvalThreshold: number` (read by `ad-optimizer/handler.ts`, no default — undefined means no auto-approval)

### 7.4 Booker, Monitor, Guardian, Primary Operator

These roles show **personality settings only** (left column). The right column shows a short description of what the agent does instead of behavior options:

- **Booker:** "Schedules appointments based on your availability settings."
- **Monitor:** "Tracks revenue and flags issues automatically."
- **Guardian:** "Reviews risky actions before they execute."
- **Primary Operator:** "Coordinates the team. Its behavior is shaped by each specialist's settings."

No behavior radio groups — these agents either don't have meaningful user-facing config, or their config is too technical to surface. This avoids decision paralysis and keeps the page feeling light.

---

## 8. Config Storage

All settings save to `AgentRosterEntry.config` via `PUT /api/agents/roster/:id`. The UI writes the **exact keys the backend agents already read** — changes take effect immediately.

Example stored config for a Lead Responder:

```json
{
  "tonePreset": "casual-conversational",
  "qualificationThreshold": 40
}
```

Example stored config for a Sales Closer:

```json
{
  "tonePreset": "warm-professional",
  "followUpDays": [1, 3, 7]
}
```

**Save behavior:** Debounced mutation (500ms) on each change. Toast notification on save. No separate save button — changes feel instant.

**Defaults:** If a config key is not set, the UI shows the middle/"balanced" option as selected. This matches the backend defaults (`qualificationThreshold: 40`, `followUpDays: [1, 3, 7]`, `approvalThreshold: undefined`).

**Full-config send:** The PUT endpoint replaces the entire `config` object. To preserve keys not surfaced on this page (like `bookingLink`, `language`), the UI initializes its local `behaviorConfig` state from the full `agent.config` and always sends the complete object on every save. Every debounced save sends both `displayName` and `config` together to avoid partial-update race conditions.

---

## 9. Preview System

The center preview bubble updates based on personality (left) and behavior (right) settings. Each agent role has one preview scenario showing a typical interaction:

- **Responder:** Greeting + qualification question (depth changes with "How thorough?" setting)
- **Strategist:** Follow-up message (timing changes with "Follow-up style" setting)
- **Optimizer:** Budget change notification (threshold shown based on "Spend authority")
- **Booker / Monitor / Guardian / Primary Operator:** Greeting only (tone-driven)

Preview text is generated client-side from templates (no LLM call). Template functions live in `agent-preview-templates.ts`. Each template takes `(tonePreset, agentRole, behaviorConfig)` and returns a preview string.

---

## 10. File Structure

```
apps/dashboard/src/
  app/team/[agentId]/
    page.tsx                          -- Page component, fetches roster entry, renders layout
  components/team/
    agent-config-personality.tsx       -- Left column: name, tone, greeting preview
    agent-config-identity.tsx          -- Center column: icon, stats, preview bubble
    agent-config-behavior.tsx          -- Right column: per-role settings + escalation
    agent-preview-templates.ts         -- Preview message generators per role + tone + behavior
    agent-behavior-options.ts          -- Per-role behavior option definitions (labels, keys, values)
```

---

## 11. Component Dependencies

- `useAgentRoster()` + `useUpdateAgentRoster()` — existing hooks, no changes needed
- `useAgentState()` — for quick stats in center column
- `AGENT_ICONS`, `AGENT_ROLE_LABELS` — existing constants
- `cn()`, `Card`, `Label`, standard UI primitives

No new hooks, no new API endpoints, no new backend changes.

---

## 12. Mobile Layout

On screens < md breakpoint:
1. Agent identity (icon, name, status) — compact header
2. Personality section — full width
3. Behavior section — full width
4. Preview bubble — sticky bottom or inline after personality

---

## 13. Out of Scope

- Agent avatar/image upload (using existing Lucide icons)
- Approval queue UI (separate future work)
- Activity timeline integration (already exists on `/agents` page)
- Behavior settings for booker, monitor, guardian, primary operator (personality-only for now — add per-role behavior when meaningful backend config exists)
- New backend config keys — this page only writes keys the backend already reads
