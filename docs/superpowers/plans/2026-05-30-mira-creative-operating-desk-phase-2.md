# Mira — Director's Desk (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/mira` from a single full-screen review feed into the **Director's Desk** — a calm control surface with exactly four modules (brief box, the one hero "Ready to review" CTA, an in-production tray, and a kept-drafts shelf) — move the feed to `/mira/review`, add a governed draft-only `createCreativeDraftRequest` behind a hybrid brief box with an Intent-Preview cost-confirm, and add an explicit **Keep / Pass** review gesture that gives the shelf honest content. Keep v1 boring enough to be trustworthy: no learning/performance/distribution capability or copy, and no Riley/publish side effects anywhere.

**Architecture:** Four sequential, independently-shippable PRs on branch `docs/mira-creative-operating-desk`:

- **PR1 — Route migration.** Add `/mira/review` (renders the existing `MiraFeedPage`); repoint `/mira` at a new minimal `MiraDeskPage` shell (Identity header + a "Ready to review" CTA fed by the existing `useMiraFeed` count); keep the feed onboarding-exempt; leave the per-draft deep link `/mira/creatives/[id]` untouched; add the route-level migration tests.
- **PR2 — Desk read surface.** Add a pure, surface-agnostic **desk read-model** in `@switchboard/core` (`buildMiraDeskModel`) over the existing `MiraCreativeReadModel` seam; expose it via read-only `GET /agents/mira/desk` + dashboard proxy + `useMiraDesk`; build the **In-production tray** and migrate the hero **Ready-to-review** CTA onto the desk hook; extend the copy-hygiene CI guard. **No shelf yet** (the shelf needs the Keep gesture from PR4 to be honest).
- **PR3 — Open-brief mutation.** Add `createCreativeDraftRequest` — a typed, audited, idempotent, draft-only, no-cross-agent `POST /agents/mira/brief` (resolves the org's `skillSlug:"creative"` deployment **fail-closed**, maps a lightweight brief → `CreativeBriefInput`, reuses the cost-gated pipeline) — plus the **hybrid brief box** (one required line + Goal/Vibe chips + example chips) and an **Intent-Preview** readback that doubles as the cost-confirm and the off-scope redirect.
- **PR4 — Keep / Pass.** A small hand-written migration adds a review-decision field; a draft-only, no-cross-agent decision mutation files a `draft_ready` clip to **Keep** (→ the shelf, reversible) or **Pass** (gone); acting removes it from the feed (inbox-zero); the **Kept-drafts shelf** reads kept drafts. This is the slice that makes the shelf honest. Includes the Phase-2 fixture-ban test.

**Tech Stack:** Next.js 14 app-router (RSC enablement gating via `fetchEnabledAgentsServer`, client modules for interactivity), TanStack React Query (tenant-scoped key factory), Fastify (`apps/api`), Prisma (`CreativeJob` + `PrismaDeploymentResolver`), Inngest (the cost-gated creative pipeline), Vitest + `@testing-library/react`.

---

## Pre-flight (run once, before Task 1)

This worktree is **not yet initialized** (no `node_modules`). From the worktree root:

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/mira-creative-operating-desk
pnpm worktree:init   # or `pnpm install` if Postgres is down (see CLAUDE.md worktree doctrine)
git branch --show-current   # MUST print: docs/mira-creative-operating-desk
```

All paths below are **relative to the worktree root**. Commit after every task. Do **not** push or open the implementation PRs until a human reviews (see Execution Handoff). Per branch doctrine the **spec + this plan land on `main` first**, as one focused docs PR, before any implementation begins.

---

## Source of truth & locked decisions

- **Spec:** `docs/superpowers/specs/2026-05-29-mira-creative-operating-desk-design.md` (this branch). This plan implements **Phase 2 only**.
- **Decision 1 (sequencing):** four PRs ship in this plan; the live brief mutation (PR3) and the Keep/Pass gesture (PR4) are both in scope.
- **Decision 2 (the shelf is Keep-backed, NOT status-backed) — corrects an earlier draft.** The seam's status-mapper **never emits `shipped`**: a completed polished job resolves to `draft_ready` (`build-read-model.ts:48-49` — `shipped` is "reserved for a later publish phase and is never emitted in M1"), and for a polished job the video only exists at completion, so `draft_ready` IS the review feed's primary content. There is therefore **no terminal "approved" status** to read a shelf from. A read-only map of finished jobs would be dishonest. Instead the shelf is populated by an **explicit one-tap Keep gesture** (Option B) on `draft_ready` clips, backed by a new review-decision field (PR4). Mental model:
  - **Continue** = "keep producing this direction" (mid-pipeline, cost-confirmed) — already shipped.
  - **Keep** = "I like this finished draft" — the verdict on a `draft_ready` clip. Creative-only, **firewalled** from the Phase-4 Riley handoff (no Riley, no publish), and **reversible** (un-keep).
  - **Pass** = "not this one" — low-stakes dismissal.
  - **Inbox-zero contract:** acting (Keep or Pass) **removes the draft from the review feed**; Keep files it to the shelf (still findable); Pass just dismisses it.
- **Decision 3 (Desk IA):** exactly four modules, exactly one loud element (the hero "Ready to review" CTA, which **links out** to `/mira/review` — the feed is enter-and-exit, no inline expand), no chat history on the Desk. Module order top→bottom:
  1. **Brief box** (pinned top) — empty heading: "What should Mira work on next?" (PR3)
  2. **Ready to review** (the ONLY hero CTA) — empty: "Nothing to review yet. New drafts land here when Mira finishes."
  3. **In-production tray** (calm, muted) — empty: "Mira's not working on anything right now. Send her a brief above."
  4. **Kept-drafts shelf** (quietest, bottom) — empty: "Drafts you keep will live here. Sending them to Riley comes later." (PR4)

### Contract A — Phase-2 desk-item state (spec §"Phase 2 desk-item state contract")

**Allowed** (the TypeScript union): `empty · brief_submitted · in_production · ready_to_review · reviewed_continue · reviewed_stopped · approved_draft · handoff_unavailable`.

**Forbidden** (Phases 4/5 — must be **unrepresentable** in the union, never emitted, never rendered): `sent_to_riley · in_use · learning · winner · fatigued · published`.

Of the allowed states the seam **status** derives only `in_production · ready_to_review · reviewed_stopped` (and, defensively, `approved_draft` for the never-emitted `shipped` status). `empty` is the aggregate no-jobs state; `brief_submitted` is set optimistically by the brief mutation (PR3); `reviewed_continue` is the transient post-Continue state owned by the feed; **`approved_draft` is produced by the Keep gesture** (PR4), not by status; `handoff_unavailable` is the shelf's permanent Phase-2 affordance, surfaced **only as shelf sub-copy — never as a red/blocked status chip**.

### Contract B — Phase-2 copy guardrails (spec §"Phase 2 copy guardrails")

Desk UI **and fixtures** must not contain these words (stricter than the global honest-impact rule, because Phase 2 has **no** performance data): _publish, launch, distribute, performance, winner, fatigued, learning, improved, drove, recovered, saved._ **Allowed:** "Riley", "Keep", "kept", "Sending to Riley comes later". Phase 2 ships **no** "Coming later" copy that names a banned capability — future affordances use neutral phrasing. This keeps the CI guard a simple "these words never appear" scan (Task 12 + Task 25).

All user-facing strings live in the **dashboard** (`apps/dashboard`). `@switchboard/core`/`schemas`/`db` stay surface-agnostic and emit **structured codes only** (see [[feedback_surface_agnostic_backend]]).

---

## File Structure

**PR1 — Route migration**

- Create: `apps/dashboard/src/app/(auth)/mira/review/page.tsx` — feed route (gate + `<MiraFeedPage />` + back affordance).
- Create: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx` — Desk client component (shell in PR1; modules added in PR2/3/4).
- Create: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-desk-page.test.tsx`.
- Modify: `apps/dashboard/src/app/(auth)/mira/page.tsx` — render `<MiraDeskPage />` instead of `<MiraFeedPage />`.
- Modify: `apps/dashboard/src/components/layout/app-shell.tsx:50` — add `/mira/review` to `ONBOARDING_GATE_EXEMPT_EXACT`.
- Modify: `apps/dashboard/src/app/(auth)/__tests__/agent-routes.test.ts` — assert `/mira`, `/mira/review`, and the unchanged `/mira/creatives/[id]` pages exist.

**PR2 — Desk read surface**

- Create: `packages/core/src/creative-read-model/desk-model.ts` — `MiraDeskItemState`, `MiraDeskSeamState`, `MiraDeskProblemCode`, `MiraDeskItem`, `MiraDeskModel`, `deriveDeskItemState`, `buildMiraDeskModel`.
- Create: `packages/core/src/creative-read-model/__tests__/desk-model.test.ts`.
- Modify: `packages/core/src/creative-read-model/index.ts` — export the new symbols.
- Modify: `apps/api/src/routes/agent-home/creatives.ts` — add read-only `GET /agents/:agentId/desk`.
- Modify: `apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts` — desk endpoint tests.
- Modify: `apps/dashboard/src/lib/api-client/governance.ts` — add `getMiraDesk()`.
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/desk/route.ts` — proxy.
- Modify: `apps/dashboard/src/lib/query-keys.ts` — add `miraFeed.desk()`.
- Create: `apps/dashboard/src/hooks/use-mira-desk.ts` + `__tests__/use-mira-desk.test.tsx`.
- Create: `apps/dashboard/src/lib/cockpit/mira/desk-copy.ts` — structured-code → string maps (banned-word-free) + `__tests__/desk-copy.test.ts`.
- Create: `apps/dashboard/src/components/cockpit/mira/mira-in-production-tray.tsx` + `mira-ready-to-review.tsx` (+ co-located tests).
- Modify: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx` — compose modules; migrate to `useMiraDesk`.
- Modify: `apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx` — add Desk sources + Phase-2 banned words.

**PR3 — Open-brief mutation + hybrid brief box**

- Create: `packages/schemas/src/mira-brief.ts` — `MiraBriefRequestSchema`, `MiraBriefGoal`, `MiraBriefVibe`, `MiraBriefResult`, `mapMiraBriefToCreativeBrief`, `classifyBriefIntent` + `__tests__/mira-brief.test.ts`.
- Modify: `packages/schemas/src/index.ts` — export the brief module.
- Create: `apps/api/src/routes/agent-home/mira-brief.ts` (`@route-class: lifecycle`) + `__tests__/mira-brief-route.test.ts`.
- Modify: `apps/api/src/bootstrap/routes.ts` — register `miraBriefRoute`.
- Modify: `packages/core/src/index.ts` — export `PrismaDeploymentResolver` if not already exported.
- Modify: `apps/dashboard/src/lib/api-client/governance.ts` — add `createCreativeDraftRequest()`.
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/brief/route.ts` — proxy (forwards `Idempotency-Key`).
- Create: `apps/dashboard/src/hooks/use-create-creative-draft-request.ts` + test.
- Modify: `apps/dashboard/src/lib/cockpit/mira/desk-copy.ts` — add Goal/Vibe labels + intent/redirect copy.
- Create: `apps/dashboard/src/components/cockpit/mira/mira-brief-box.tsx` + test.
- Modify: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx` — mount the brief box at the top.
- Modify: `apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx` — add `mira-brief-box.tsx`.

**PR4 — Keep / Pass + kept-drafts shelf**

- Create: `packages/db/prisma/migrations/<ts>_creative_job_review_decision/migration.sql` — hand-written; add `reviewDecision` + `reviewDecidedAt`.
- Modify: `packages/db/prisma/schema.prisma` — `CreativeJob.reviewDecision` + `reviewDecidedAt`.
- Modify: `packages/schemas/src/creative-job.ts` — add the two fields to `CreativeJobSchema`.
- Modify: `packages/core/src/creative-read-model/types.ts` — add `reviewDecision` to `MiraCreativeJobSummary` + `keptDrafts` to `MiraDeskModel`.
- Modify: `packages/core/src/creative-read-model/build-read-model.ts` — pass `reviewDecision` through.
- Modify: `packages/core/src/creative-read-model/desk-model.ts` — kept bucket + passed-exclusion.
- Modify: `packages/core/src/creative-read-model/__tests__/desk-model.test.ts` — kept/passed cases.
- Modify: `apps/api/src/routes/agent-home/creatives.ts` — `isReviewable` excludes decided drafts (inbox-zero).
- Create: `apps/api/src/routes/agent-home/mira-decision.ts` (`@route-class: lifecycle`) + `__tests__/mira-decision-route.test.ts`.
- Modify: `apps/api/src/bootstrap/routes.ts` — register `miraDecisionRoute`.
- Modify: `apps/dashboard/src/lib/api-client/governance.ts` — add `setCreativeReviewDecision()`.
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/[id]/decision/route.ts` — proxy.
- Create: `apps/dashboard/src/hooks/use-review-decision.ts` + test.
- Modify: `apps/dashboard/src/components/cockpit/mira/mira-clip-actions.tsx` — Keep/Pass on `review_draft` clips.
- Modify: `apps/dashboard/src/lib/cockpit/mira/desk-copy.ts` — kept-shelf copy.
- Create: `apps/dashboard/src/components/cockpit/mira/mira-kept-shelf.tsx` + test.
- Modify: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx` — mount the shelf at the bottom.
- Modify: `apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx` — add the shelf source.
- Create: `apps/dashboard/src/components/cockpit/__tests__/mira-fixture-ban.test.ts` — scan Mira seeds for forbidden states + banned words.
- Modify: `packages/db/src/seed/seed-mira-demo-creatives.ts` — seed one kept draft (so the shelf populates locally).

---

# PR1 — Route migration

> Independently shippable: `/mira` becomes a calm Desk shell with the one hero CTA into the feed at `/mira/review`; the per-draft deep link is unchanged; nothing regresses. Branch is already correct; commit per task.

### Task 1: Move the review feed to `/mira/review`

**Files:**

- Create: `apps/dashboard/src/app/(auth)/mira/review/page.tsx`
- Test: `apps/dashboard/src/app/(auth)/__tests__/agent-routes.test.ts` (modify)

- [ ] **Step 1: Write the failing route-existence tests**

In `apps/dashboard/src/app/(auth)/__tests__/agent-routes.test.ts`, add inside the `describe` block:

```ts
it("/mira/review page directory exists (feed moved here in Phase 2)", () => {
  expect(existsSync(join(AUTH_ROOT, "mira", "review", "page.tsx"))).toBe(true);
});

it("/mira/creatives/[id] deep link is UNCHANGED (no ?draftId on the feed — YAGNI)", () => {
  expect(existsSync(join(AUTH_ROOT, "mira", "creatives", "[id]", "page.tsx"))).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- agent-routes`
Expected: FAIL — `/mira/review/page.tsx` does not exist yet (the `[id]` assertion already passes; the directory exists).

- [ ] **Step 3: Create the feed route**

`apps/dashboard/src/app/(auth)/mira/review/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { MiraFeedPage } from "@/components/cockpit/mira/mira-feed-page";

// Phase 2: the vertical review feed (M1) lives here. `/mira` is now the Director's
// Desk. Same opt-in gate as the Desk — 404 unless this org has Mira enabled.
export default async function MiraReviewPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("mira")) notFound();

  return (
    <div style={{ position: "relative" }}>
      <Link
        href="/mira"
        aria-label="Back to Mira"
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 20,
          padding: "6px 12px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          fontSize: 13,
          textDecoration: "none",
        }}
      >
        ← Mira
      </Link>
      <MiraFeedPage />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- agent-routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/mira/review/page.tsx apps/dashboard/src/app/\(auth\)/__tests__/agent-routes.test.ts
git commit -m "feat(mira): add /mira/review feed route (phase 2 desk migration)"
```

---

### Task 2: Minimal Director's Desk shell at `/mira`

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx`
- Test: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-desk-page.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/src/components/cockpit/mira/__tests__/mira-desk-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraDeskPage } from "../mira-desk-page";

// The Desk reads the existing feed count for its Ready-to-review CTA (PR1).
const feedMock = vi.fn();
vi.mock("@/hooks/use-mira-feed", () => ({ useMiraFeed: () => feedMock() }));
vi.mock("@/hooks/use-agent-greeting", () => ({ useAgentGreeting: () => ({ data: null }) }));
vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: vi.fn() }),
}));

describe("MiraDeskPage (shell)", () => {
  beforeEach(() => feedMock.mockReset());

  it("shows the ready-to-review count and links to /mira/review", () => {
    feedMock.mockReturnValue({
      data: { feed: { reviewableCount: 4, renderingCount: 1 } },
      isLoading: false,
      isError: false,
    });
    render(<MiraDeskPage />);
    expect(screen.getByText(/4 drafts ready/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review/i })).toHaveAttribute("href", "/mira/review");
  });

  it("renders a calm empty state when nothing is ready", () => {
    feedMock.mockReturnValue({
      data: { feed: { reviewableCount: 0, renderingCount: 0 } },
      isLoading: false,
      isError: false,
    });
    render(<MiraDeskPage />);
    expect(screen.getByText(/nothing to review yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- mira-desk-page`
Expected: FAIL — `../mira-desk-page` cannot be resolved.

- [ ] **Step 3: Implement the Desk shell**

`apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Identity } from "@/components/cockpit/identity";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraFeed } from "@/hooks/use-mira-feed";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_ACCENT, MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";

// Phase 2 Director's Desk. PR1 ships the shell: identity header + the one hero
// Ready-to-review CTA into the feed (/mira/review). PR2 adds the In-production
// tray; PR3 adds the brief box at the top; PR4 adds the Kept-drafts shelf.
export function MiraDeskPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const mission = useAgentMission("mira");
  const feedQ = useMiraFeed();
  const [missionOpen, setMissionOpen] = useState(false);

  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;
  const reviewable = feedQ.data?.feed.reviewableCount ?? 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        background: MIRA_ACCENT.paper,
      }}
    >
      <div style={{ position: "relative", background: "#fff" }}>
        <Identity
          statusKey="IDLE"
          halted={haltCtx.halted}
          subtitle={MIRA_MISSION_SUBTITLE}
          line={line}
          onHaltToggle={haltCtx.toggleHalt}
          missionInteractive={!!mission.data}
          onOpenMission={() => setMissionOpen((o) => !o)}
          displayName="Mira"
          avatarAccent={{ soft: MIRA_ACCENT.soft, deep: MIRA_ACCENT.deep }}
        />
        {mission.data ? (
          <MissionPopover
            open={missionOpen}
            onClose={() => setMissionOpen(false)}
            mission={mission.data.mission}
            agentLabel="Mira"
          />
        ) : null}
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <section
          aria-label="Ready to review"
          style={{
            background: "#fff",
            borderRadius: 14,
            padding: 16,
            border: `1px solid ${MIRA_ACCENT.soft}`,
          }}
        >
          {reviewable > 0 ? (
            <Link
              href="/mira/review"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                textDecoration: "none",
                color: MIRA_ACCENT.deep,
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {reviewable} draft{reviewable === 1 ? "" : "s"} ready to review
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <p style={{ margin: 0, color: MIRA_ACCENT.deep, fontSize: 14 }}>
              Nothing to review yet. New drafts land here when Mira finishes.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
```

> **Note on `Identity`/`MissionPopover` props:** these mirror `mira-feed-page.tsx:40-59` exactly. If a prop name differs at execution time, copy the live call from `mira-feed-page.tsx` verbatim.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- mira-desk-page`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-desk-page.test.tsx
git commit -m "feat(mira): minimal director's desk shell with ready-to-review cta"
```

---

### Task 3: Repoint `/mira` at the Desk

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/mira/page.tsx`
- Test: `apps/dashboard/src/app/(auth)/__tests__/agent-routes.test.ts` (already asserts `/mira/page.tsx` exists)

- [ ] **Step 1: Swap the rendered component**

In `apps/dashboard/src/app/(auth)/mira/page.tsx`, replace the import and the returned element:

```tsx
import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { MiraDeskPage } from "@/components/cockpit/mira/mira-desk-page";

// Phase 2: `/mira` is the Director's Desk (calm control surface). The vertical
// review feed moved to `/mira/review`; the per-draft deep link stays
// `/mira/creatives/[id]`. Mira is opt-in per org — 404 unless enabled.
export default async function MiraPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("mira")) notFound();

  return <MiraDeskPage />;
}
```

- [ ] **Step 2: Verify typecheck + existing route test**

Run: `pnpm --filter @switchboard/dashboard test -- agent-routes && pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS — `/mira`, `/mira/review`, and `/mira/creatives/[id]` all exist; no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/mira/page.tsx
git commit -m "feat(mira): /mira now renders the director's desk"
```

---

### Task 4: Keep the feed onboarding-exempt + verify entry-point coherence

The feed bypasses the onboarding gate (`app-shell.tsx:50`). Moving it to `/mira/review` means the exemption must cover the new path, or an incomplete org gets redirected to `/onboarding` from the feed. Route-alias policy: the general `/mira` and existing entry points (Home Team Pulse, MiraPanel) all land on the **Desk**.

**Files:**

- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`
- Test: `apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx` (create if absent; otherwise add a case)

- [ ] **Step 1: Write the failing test**

Add to the app-shell test (create `apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx` if it does not exist, mirroring an existing layout test for the render harness). Assert the exempt set:

```ts
import { ONBOARDING_GATE_EXEMPT_EXACT } from "../app-shell";

describe("onboarding gate exemptions", () => {
  it("exempts both the Mira desk and the review feed", () => {
    expect(ONBOARDING_GATE_EXEMPT_EXACT.has("/mira")).toBe(true);
    expect(ONBOARDING_GATE_EXEMPT_EXACT.has("/mira/review")).toBe(true);
  });
});
```

> If `ONBOARDING_GATE_EXEMPT_EXACT` is not exported, add `export` to its declaration at `app-shell.tsx:50`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- app-shell`
Expected: FAIL — `/mira/review` is not in the set (and/or the const is not exported).

- [ ] **Step 3: Add `/mira/review` to the exempt set**

`apps/dashboard/src/components/layout/app-shell.tsx:50`:

```ts
const ONBOARDING_GATE_EXEMPT_EXACT = new Set(["/mira", "/mira/review"]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- app-shell`
Expected: PASS.

- [ ] **Step 5: Verify the `MiraPanel` drill-in still lands on the Desk**

`MiraPanel` (`apps/dashboard/src/components/agent-panel/mira-panel.tsx:26`) calls `router.push("/mira")`, which now lands on the Desk — correct (route-alias policy), no change needed. Confirm its test still passes:

Run: `pnpm --filter @switchboard/dashboard test -- mira-panel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/layout/app-shell.tsx apps/dashboard/src/components/layout/__tests__/app-shell.test.tsx
git commit -m "fix(mira): keep review feed onboarding-exempt after desk migration"
```

---

### Task 5 (PR1 close-out): full dashboard suite + build

- [ ] **Step 1: Run the dashboard test suite**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS. The M1 feed tests (`mira-feed-page`, `mira-creative-feed`, `mira-clip-*`) still pass unchanged — `MiraFeedPage` was not modified, only re-routed.

- [ ] **Step 2: Run the Next build (NOT in CI — see [[feedback_dashboard_build_not_in_ci]])**

Run: `pnpm --filter @switchboard/dashboard build`
Expected: build succeeds; `/mira`, `/mira/review`, and `/mira/creatives/[id]` appear in the route manifest. This catches the `.js`-extension and RSC/client-boundary issues unit tests miss ([[feedback_dashboard_no_js_on_any_import]]).

- [ ] **Step 3: Commit any formatting fixes**

```bash
pnpm format:check || pnpm format   # CI lint runs prettier; local lint does not ([[feedback_ci_prettier_not_in_local_lint]])
git add -A && git commit -m "chore(mira): pr1 formatting" --allow-empty
```

**PR1 is now shippable** as `feat(mira): director's desk routing migration (phase 2 PR1)`.

---

# PR2 — Desk read surface

> Adds the surface-agnostic desk read-model, its endpoint/hook, the In-production tray module, and migrates the hero Ready-to-review CTA onto the desk hook. **No shelf** — that needs the Keep gesture (PR4) to be honest.

### Task 6: Core desk read-model (pure, surface-agnostic)

**Files:**

- Create: `packages/core/src/creative-read-model/desk-model.ts`
- Test: `packages/core/src/creative-read-model/__tests__/desk-model.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/creative-read-model/__tests__/desk-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildMiraDeskModel, deriveDeskItemState, type MiraDeskItemState } from "../desk-model.js";
import type {
  MiraCreativeJobSummary,
  MiraCreativeReadModel,
  MiraCreativeCounts,
} from "../types.js";

const FORBIDDEN: string[] = [
  "sent_to_riley",
  "in_use",
  "learning",
  "winner",
  "fatigued",
  "published",
];

function job(over: Partial<MiraCreativeJobSummary>): MiraCreativeJobSummary {
  return {
    id: "j",
    title: "Summer Botox promo",
    stage: "production",
    status: "in_progress",
    reviewAction: { canContinue: false, canStop: false, label: "none" },
    source: { engine: "legacy_creative_job", mode: "polished" },
    createdAt: "2026-05-26T10:00:00Z",
    updatedAt: "2026-05-26T10:00:00Z",
    ...over,
  };
}

const counts: MiraCreativeCounts = {
  total: 0,
  shippedThisWeek: 0,
  shippedPrevWeek: 0,
  inFlight: 0,
  awaitingReview: 0,
  stopped: 0,
};

describe("deriveDeskItemState", () => {
  it("maps every seam status to an ALLOWED state and never a forbidden one", () => {
    const cases: Array<[MiraCreativeJobSummary, MiraDeskItemState]> = [
      [job({ status: "in_progress" }), "in_production"],
      [job({ status: "awaiting_review" }), "in_production"], // no video → still producing
      [job({ status: "awaiting_review", draft: { videoUrl: "x" } }), "ready_to_review"],
      [job({ status: "draft_ready", draft: { videoUrl: "x" } }), "ready_to_review"],
      [job({ status: "stopped" }), "reviewed_stopped"],
      [job({ status: "failed" }), "in_production"],
      // `shipped` is never emitted by the seam (build-read-model.ts:48); mapped
      // defensively so the switch stays exhaustive. The REAL approved_draft
      // producer is the Keep gesture (PR4), not status.
      [job({ status: "shipped", draft: { videoUrl: "x" } }), "approved_draft"],
    ];
    for (const [j, expected] of cases) {
      const state = deriveDeskItemState(j);
      expect(state).toBe(expected);
      expect(FORBIDDEN).not.toContain(state);
    }
  });
});

describe("buildMiraDeskModel", () => {
  it("buckets jobs into the tray and ready-count; failed items carry a quality_failed problem", () => {
    const jobs: MiraCreativeJobSummary[] = [
      job({ id: "p1", status: "in_progress" }),
      job({ id: "f1", status: "failed" }),
      job({ id: "r1", status: "draft_ready", draft: { videoUrl: "x" } }),
      job({ id: "r2", status: "draft_ready", draft: { videoUrl: "y" } }),
      job({ id: "s1", status: "stopped" }),
    ];
    const rm: MiraCreativeReadModel = { jobs, counts: { ...counts, total: 5 } };
    const desk = buildMiraDeskModel(rm);

    expect(desk.inProduction.map((i) => i.id).sort()).toEqual(["f1", "p1"]);
    expect(desk.inProduction.find((i) => i.id === "f1")?.problem).toBe("quality_failed");
    expect(desk.readyToReviewCount).toBe(2);
    expect(desk.isEmpty).toBe(false);
  });

  it("reports empty when there are no jobs", () => {
    expect(buildMiraDeskModel({ jobs: [], counts }).isEmpty).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @switchboard/core test -- desk-model`
Expected: FAIL — `../desk-model.js` does not exist.

- [ ] **Step 3: Implement the desk model**

`packages/core/src/creative-read-model/desk-model.ts`:

```ts
import type { CreativeJobStage } from "@switchboard/schemas";
import type { MiraCreativeJobSummary, MiraCreativeCounts, MiraCreativeReadModel } from "./types.js";

// ── Contract A: Phase-2 desk-item state ──────────────────────────────────────
// The ALLOWED union. The Phase 4/5 states (sent_to_riley, in_use, learning,
// winner, fatigued, published) are intentionally NOT members — they must be
// unrepresentable in Phase 2.
export type MiraDeskItemState =
  | "empty"
  | "brief_submitted"
  | "in_production"
  | "ready_to_review"
  | "reviewed_continue"
  | "reviewed_stopped"
  | "approved_draft"
  | "handoff_unavailable";

// States derivable from a seam STATUS snapshot. `approved_draft` is included only
// for the never-emitted `shipped` status (defensive exhaustiveness); the real
// approved_draft producer is the Keep gesture (PR4).
export type MiraDeskSeamState = Extract<
  MiraDeskItemState,
  "in_production" | "ready_to_review" | "approved_draft" | "reviewed_stopped"
>;

// Structured problem codes — NO user copy here (the dashboard maps these). Only
// `quality_failed` is emitted in Phase 2; the rest are reserved for when the
// seam carries richer failure detail.
export type MiraDeskProblemCode = "needs_input" | "reference_missing" | "unsafe" | "quality_failed";

export interface MiraDeskItem {
  id: string;
  title: string;
  stage: CreativeJobStage;
  state: MiraDeskItemState;
  thumbnailUrl?: string;
  problem?: MiraDeskProblemCode;
  updatedAt: string;
}

export interface MiraDeskModel {
  inProduction: MiraDeskItem[];
  readyToReviewCount: number;
  counts: MiraCreativeCounts;
  isEmpty: boolean;
}

/** Pure seam-status → desk-state. Exhaustive over MiraCreativeStatus; returns ONLY allowed states. */
export function deriveDeskItemState(job: MiraCreativeJobSummary): MiraDeskSeamState {
  const hasVideo = typeof job.draft?.videoUrl === "string";
  switch (job.status) {
    case "shipped":
      return "approved_draft"; // never emitted in M1; defensive only
    case "stopped":
      return "reviewed_stopped";
    case "draft_ready":
      return "ready_to_review";
    case "awaiting_review":
      return hasVideo ? "ready_to_review" : "in_production";
    case "in_progress":
    case "failed":
      return "in_production";
  }
}

function toItem(job: MiraCreativeJobSummary, state: MiraDeskItemState): MiraDeskItem {
  return {
    id: job.id,
    title: job.title,
    stage: job.stage,
    state,
    thumbnailUrl: job.draft?.thumbnailUrl,
    problem: job.status === "failed" ? "quality_failed" : undefined,
    updatedAt: job.updatedAt,
  };
}

/** Bucket the seam read-model into Phase-2 desk modules. Pure; no I/O, no copy.
 *  PR2 buckets in-production + ready-count only. PR4 adds the kept-drafts shelf. */
export function buildMiraDeskModel(rm: MiraCreativeReadModel): MiraDeskModel {
  const inProduction: MiraDeskItem[] = [];
  let readyToReviewCount = 0;

  for (const job of rm.jobs) {
    const state = deriveDeskItemState(job);
    if (state === "in_production") inProduction.push(toItem(job, state));
    else if (state === "ready_to_review") readyToReviewCount += 1;
    // reviewed_stopped: counted in counts.stopped, not its own module in v1.
    // approved_draft: not produced from status in M1 (Keep gesture, PR4).
  }

  return {
    inProduction,
    readyToReviewCount,
    counts: rm.counts,
    isEmpty: rm.jobs.length === 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- desk-model`
Expected: PASS.

- [ ] **Step 5: Export from the read-model barrel**

Add to `packages/core/src/creative-read-model/index.ts`:

```ts
export * from "./desk-model.js";
```

Run: `pnpm --filter @switchboard/core build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/creative-read-model/desk-model.ts packages/core/src/creative-read-model/__tests__/desk-model.test.ts packages/core/src/creative-read-model/index.ts
git commit -m "feat(core): mira desk read-model — seam buckets + phase-2 state contract"
```

---

### Task 7: `GET /agents/mira/desk` endpoint

**Files:**

- Modify: `apps/api/src/routes/agent-home/creatives.ts`
- Test: `apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `creatives-route.test.ts` (reuse the existing `buildTestServer`, prisma mock, `PILOT`/`OTHER`, and the enablement wiring the `GET /agents/mira/creatives` describe block already uses — it must report Mira enabled for `PILOT`). Add `draft_ready`/`stopped` rows to the fixture so the desk buckets are exercised:

```ts
describe("GET /agents/mira/desk", () => {
  let ctx: TestContext;
  // (mirror the beforeAll/afterAll + enablement setup used by the creatives describe block)

  it("returns the bucketed desk model for an enabled org", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/desk",
      headers: { "x-org-id": PILOT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      desk: { inProduction: unknown[]; readyToReviewCount: number; isEmpty: boolean };
    };
    expect(body.desk.readyToReviewCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.desk.inProduction)).toBe(true);
  });

  it("404s for a non-mira agent", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/desk",
      headers: { "x-org-id": PILOT },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s when the org is not enabled (no cross-org leak)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/desk",
      headers: { "x-org-id": OTHER },
    });
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect((res.json() as { desk: { isEmpty: boolean } }).desk.isEmpty).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @switchboard/api test -- creatives-route`
Expected: FAIL — `/agents/mira/desk` returns 404 (route not registered).

- [ ] **Step 3: Add the desk handler to `creatives.ts`**

The file is `@route-class: read-only` and already imports the reader, `requireOrganizationScope`, `getOrgTimezone`, and `isAgentHomeAccessible`. Extend the `@switchboard/core` import and register a third route inside `creativesRoute` (after the `:id` handler), reusing the same gating preamble:

```ts
// extend the existing @switchboard/core import:
import { buildMiraDeskModel } from "@switchboard/core";

// …inside creativesRoute, after the GET "/agents/:agentId/creatives/:id" handler:
app.get("/agents/:agentId/desk", async (request, reply) => {
  const params = ParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });
  if (params.data.agentId !== "mira")
    return reply.code(404).send({ error: "Desk not available for this agent" });

  const orgId = requireOrganizationScope(request, reply);
  if (!orgId) return;
  if (!app.orgAgentEnablementStore)
    return reply.code(503).send({ error: "Enablement store unavailable" });
  if (!(await isAgentHomeAccessible("mira", orgId, app.orgAgentEnablementStore)))
    return reply.code(404).send({ error: "Agent not available on home" });

  const prisma = app.prisma;
  if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

  const timezone = await getOrgTimezone(prisma, orgId);
  const reader = new PrismaMiraCreativeReadModelReader(prisma);
  try {
    const rm = await reader.read(orgId, { now: new Date(), timezone, visibleLimit: FEED_WINDOW });
    return reply.code(200).send({ desk: buildMiraDeskModel(rm) });
  } catch (err) {
    app.log.error({ err, requestId: request.id }, "mira desk read failed");
    return reply.code(500).send({ error: "Mira desk read failed", requestId: request.id });
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- creatives-route`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/agent-home/creatives.ts apps/api/src/routes/agent-home/__tests__/creatives-route.test.ts
git commit -m "feat(api): GET /agents/mira/desk read-only endpoint over the desk seam"
```

---

### Task 8: Dashboard client + proxy + query key + hook for the desk

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/governance.ts`
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/desk/route.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Create: `apps/dashboard/src/hooks/use-mira-desk.ts`, `apps/dashboard/src/hooks/__tests__/use-mira-desk.test.tsx`

- [ ] **Step 1: Add the client method**

In `governance.ts`, extend the existing `@switchboard/core` import and add the method beside `listMiraCreatives` (≈ line 348):

```ts
import type { MiraDeskModel } from "@switchboard/core";

  /** Reads the Mira Director's Desk read-model (read-only, org-scoped). */
  async getMiraDesk(): Promise<{ desk: MiraDeskModel }> {
    return this.request<{ desk: MiraDeskModel }>("/api/dashboard/agents/mira/desk");
  }
```

- [ ] **Step 2: Add the proxy route** — `apps/dashboard/src/app/api/dashboard/agents/mira/desk/route.ts` (mirror the creatives proxy verbatim):

```ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/** Dashboard proxy for `GET /api/dashboard/agents/mira/desk` (director's desk read-model). */
export async function GET() {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const data = await client.getMiraDesk();
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Add the query key** — in `query-keys.ts`, extend the `miraFeed` factory:

```ts
  miraFeed: {
    all: () => [orgId, "miraFeed"] as const,
    list: () => [orgId, "miraFeed", "list"] as const,
    detail: (id: string) => [orgId, "miraFeed", "detail", id] as const,
    desk: () => [orgId, "miraFeed", "desk"] as const,
  },
```

- [ ] **Step 4: Write the failing hook test** — `apps/dashboard/src/hooks/__tests__/use-mira-desk.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMiraDesk } from "../use-mira-desk";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({ miraFeed: { desk: () => ["org", "miraFeed", "desk"] } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMiraDesk", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches and returns the desk model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          desk: { inProduction: [], readyToReviewCount: 3, counts: {}, isEmpty: false },
        }),
      }),
    );
    const { result } = renderHook(() => useMiraDesk(), { wrapper });
    await waitFor(() => expect(result.current.data?.readyToReviewCount).toBe(3));
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- use-mira-desk`
Expected: FAIL — `../use-mira-desk` does not exist.

- [ ] **Step 6: Implement the hook** — `apps/dashboard/src/hooks/use-mira-desk.ts` (mirror `use-mira-feed.ts`):

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { MiraDeskModel } from "@switchboard/core";
import { useScopedQueryKeys } from "./use-query-keys";

/** Live Mira Director's Desk read-model. */
export function useMiraDesk() {
  const keys = useScopedQueryKeys();
  const query = useQuery({
    queryKey: keys?.miraFeed.desk() ?? ["__disabled_mira_desk__"],
    queryFn: async (): Promise<MiraDeskModel> => {
      const res = await fetch("/api/dashboard/agents/mira/desk");
      if (!res.ok) throw new Error(`Mira desk fetch failed (HTTP ${res.status})`);
      return ((await res.json()) as { desk: MiraDeskModel }).desk;
    },
    enabled: !!keys,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  };
}
```

> **Loading-gate gotcha** ([[feedback_react_query_enabled_false_isloading]]): when `keys` is null the query is disabled, so `isLoading` is `false` while `data` is `undefined`. Consumers MUST gate the loading UI on `!data && !error` (a catch-all), never on `isLoading` alone. Enforced in the Desk-page test (Task 12).

- [ ] **Step 7: Run the test + commit**

Run: `pnpm --filter @switchboard/dashboard test -- use-mira-desk`
Expected: PASS.

```bash
git add apps/dashboard/src/lib/api-client/governance.ts apps/dashboard/src/app/api/dashboard/agents/mira/desk/route.ts apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/hooks/use-mira-desk.ts apps/dashboard/src/hooks/__tests__/use-mira-desk.test.tsx
git commit -m "feat(mira): dashboard desk client, proxy, query key, and hook"
```

---

### Task 9: Desk copy map (structured code → string, banned-word-free)

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/mira/desk-copy.ts`, `apps/dashboard/src/lib/cockpit/mira/__tests__/desk-copy.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/dashboard/src/lib/cockpit/mira/__tests__/desk-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { STAGE_COPY, PROBLEM_COPY, DESK_COPY } from "../desk-copy";

const BANNED =
  /\b(publish|launch|distribute|performance|winner|fatigued|learning|improved|drove|recovered|saved)\b/i;

describe("desk copy guardrails", () => {
  it("maps every pipeline stage to plain status copy", () => {
    expect(STAGE_COPY.trends).toMatch(/concept|idea/i);
    expect(STAGE_COPY.production).toMatch(/generat/i);
    expect(STAGE_COPY.complete).toMatch(/ready/i);
  });

  it("maps the quality_failed problem to a plain message", () => {
    expect(PROBLEM_COPY.quality_failed).toMatch(/quality/i);
  });

  it("contains NO Phase-2 banned words anywhere", () => {
    const all = [
      ...Object.values(STAGE_COPY),
      ...Object.values(PROBLEM_COPY),
      ...Object.values(DESK_COPY),
    ].join(" | ");
    expect(all).not.toMatch(BANNED);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- desk-copy`
Expected: FAIL — `../desk-copy` does not exist.

- [ ] **Step 3: Implement the copy map** — `apps/dashboard/src/lib/cockpit/mira/desk-copy.ts`:

```ts
import type { CreativeJobStage } from "@switchboard/schemas";
import type { MiraDeskProblemCode } from "@switchboard/core";

// Plain, non-engineering stage copy for the In-production tray (spec §copy guardrails).
export const STAGE_COPY: Record<CreativeJobStage, string> = {
  trends: "Writing concept",
  hooks: "Writing concept",
  scripts: "Writing concept",
  storyboard: "Planning shots",
  production: "Generating draft",
  complete: "Ready to review",
};

// Problem copy only surfaces when something is wrong (default tray is plain status).
export const PROBLEM_COPY: Record<MiraDeskProblemCode, string> = {
  needs_input: "Needs your input",
  reference_missing: "Reference image missing",
  unsafe: "Couldn't generate safely",
  quality_failed: "Draft failed a quality check",
};

// Static Desk strings. No banned words; future affordances use neutral phrasing.
// (PR3 adds brief/intent copy here; PR4 adds the kept-shelf copy here.)
export const DESK_COPY = {
  inProductionTitle: "In production",
  inProductionEmpty: "Mira's not working on anything right now. Send her a brief above.",
  readyTitle: "Ready to review",
  readyEmptyBody: "Nothing to review yet. New drafts land here when Mira finishes.",
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- desk-copy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/cockpit/mira/desk-copy.ts apps/dashboard/src/lib/cockpit/mira/__tests__/desk-copy.test.ts
git commit -m "feat(mira): desk copy map — plain stage/problem strings, no banned words"
```

---

### Task 10: In-production tray module

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mira/mira-in-production-tray.tsx`, `__tests__/mira-in-production-tray.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraInProductionTray } from "../mira-in-production-tray";
import type { MiraDeskItem } from "@switchboard/core";

const item = (over: Partial<MiraDeskItem>): MiraDeskItem => ({
  id: "i",
  title: "Botox promo",
  stage: "production",
  state: "in_production",
  updatedAt: "2026-05-26",
  ...over,
});

describe("MiraInProductionTray", () => {
  it("shows plain stage copy per item by default", () => {
    render(<MiraInProductionTray items={[item({ id: "a", stage: "production" })]} />);
    expect(screen.getByText(/generating draft/i)).toBeInTheDocument();
    expect(screen.queryByText(/storyboard|inngest|stage/i)).not.toBeInTheDocument();
  });

  it("surfaces a problem message only when a problem is present", () => {
    render(<MiraInProductionTray items={[item({ id: "b", problem: "quality_failed" })]} />);
    expect(screen.getByText(/failed a quality check/i)).toBeInTheDocument();
  });

  it("renders the calm empty state when there is nothing in production", () => {
    render(<MiraInProductionTray items={[]} />);
    expect(screen.getByText(/not working on anything/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- mira-in-production-tray`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement** — `mira-in-production-tray.tsx`:

```tsx
"use client";

import type { MiraDeskItem } from "@switchboard/core";
import { STAGE_COPY, PROBLEM_COPY, DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";

// Calm, muted tray (NOT the hero). Plain stage copy by default; a problem
// message only when something is wrong. No engineering-console detail.
export function MiraInProductionTray({ items }: { items: MiraDeskItem[] }) {
  return (
    <section
      aria-label={DESK_COPY.inProductionTitle}
      style={{
        background: "#fff",
        borderRadius: 14,
        padding: 16,
        border: `1px solid ${MIRA_ACCENT.soft}`,
      }}
    >
      <h2 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "#666" }}>
        {DESK_COPY.inProductionTitle}
      </h2>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#666" }}>{DESK_COPY.inProductionEmpty}</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {items.map((it) => (
            <li
              key={it.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "#333",
              }}
            >
              <span>{it.title}</span>
              <span style={{ color: it.problem ? "#7A2E2E" : MIRA_ACCENT.base }}>
                {it.problem ? PROBLEM_COPY[it.problem] : STAGE_COPY[it.stage]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-in-production-tray` → PASS

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-in-production-tray.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-in-production-tray.test.tsx
git commit -m "feat(mira): in-production tray — calm plain stage copy, problem-on-error"
```

---

### Task 11: Ready-to-review hero module (extracted, desk-hook-fed)

**Files:**

- Create: `apps/dashboard/src/components/cockpit/mira/mira-ready-to-review.tsx`, `__tests__/mira-ready-to-review.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraReadyToReview } from "../mira-ready-to-review";

describe("MiraReadyToReview", () => {
  it("links OUT to /mira/review with the count when there are drafts", () => {
    render(<MiraReadyToReview count={4} />);
    expect(screen.getByRole("link", { name: /review/i })).toHaveAttribute("href", "/mira/review");
    expect(screen.getByText(/4 drafts ready/i)).toBeInTheDocument();
  });

  it("shows a calm empty state at zero (no link)", () => {
    render(<MiraReadyToReview count={0} />);
    expect(screen.getByText(/nothing to review yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** → FAIL

- [ ] **Step 3: Implement** — `mira-ready-to-review.tsx` (the ONE loud element; links out — no inline expand):

```tsx
"use client";

import Link from "next/link";
import { DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";

export function MiraReadyToReview({ count }: { count: number }) {
  return (
    <section
      aria-label={DESK_COPY.readyTitle}
      style={{
        background: "#fff",
        borderRadius: 14,
        padding: 18,
        border: `2px solid ${MIRA_ACCENT.deep}`,
      }}
    >
      {count > 0 ? (
        <Link
          href="/mira/review"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            textDecoration: "none",
            color: MIRA_ACCENT.deep,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700 }}>
            {count} draft{count === 1 ? "" : "s"} ready to review
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <p style={{ margin: 0, color: MIRA_ACCENT.deep, fontSize: 14 }}>
          {DESK_COPY.readyEmptyBody}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the test + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-ready-to-review` → PASS

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-ready-to-review.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-ready-to-review.test.tsx
git commit -m "feat(mira): extract ready-to-review hero module"
```

---

### Task 12: Compose the Desk (migrate to `useMiraDesk`) + extend copy-hygiene guard

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx`
- Modify: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-desk-page.test.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx`

- [ ] **Step 1: Update the Desk test to the desk hook + modules + forbidden-word DOM scan**

Replace the body of `mira-desk-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiraDeskPage } from "../mira-desk-page";

const deskMock = vi.fn();
vi.mock("@/hooks/use-mira-desk", () => ({ useMiraDesk: () => deskMock() }));
vi.mock("@/hooks/use-agent-greeting", () => ({ useAgentGreeting: () => ({ data: null }) }));
vi.mock("@/hooks/use-agent-mission", () => ({
  useAgentMission: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: false, toggleHalt: vi.fn() }),
}));

const FORBIDDEN =
  /\b(sent to riley|in use|winner|fatigued|published|distribute|performance|learning|improved|drove|recovered|saved)\b/i;

const counts = {
  total: 0,
  shippedThisWeek: 0,
  shippedPrevWeek: 0,
  inFlight: 0,
  awaitingReview: 0,
  stopped: 0,
};

describe("MiraDeskPage", () => {
  beforeEach(() => deskMock.mockReset());

  it("renders the in-production tray and the ready-to-review hero from the desk model", () => {
    deskMock.mockReturnValue({
      data: {
        inProduction: [
          { id: "p", title: "Promo", stage: "production", state: "in_production", updatedAt: "x" },
        ],
        readyToReviewCount: 2,
        counts: { ...counts, total: 3, inFlight: 1 },
        isEmpty: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<MiraDeskPage />);
    expect(screen.getByText(/2 drafts ready/i)).toBeInTheDocument();
    expect(screen.getByText(/generating draft/i)).toBeInTheDocument();
  });

  it("shows a loading state while keys are pending (data undefined, no error)", () => {
    deskMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
    render(<MiraDeskPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument(); // gated on !data && !error, not isLoading
  });

  it("never renders a forbidden Phase-4/5 word", () => {
    deskMock.mockReturnValue({
      data: { inProduction: [], readyToReviewCount: 0, counts, isEmpty: true },
      isLoading: false,
      isError: false,
      error: null,
    });
    const { container } = render(<MiraDeskPage />);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** → FAIL (Desk still uses `useMiraFeed`, modules not mounted)

- [ ] **Step 3: Rewrite `mira-desk-page.tsx` to compose modules over `useMiraDesk`**

```tsx
"use client";

import { useState } from "react";
import { Identity } from "@/components/cockpit/identity";
import { MissionPopover } from "@/components/cockpit/mission-popover";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentMission } from "@/hooks/use-agent-mission";
import { useMiraDesk } from "@/hooks/use-mira-desk";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_ACCENT, MIRA_MISSION_SUBTITLE } from "@/lib/cockpit/mira/mira-config";
import { MiraReadyToReview } from "./mira-ready-to-review";
import { MiraInProductionTray } from "./mira-in-production-tray";

// Phase-2 Director's Desk. Module order (Decision 3): brief box (PR3) · the one
// hero Ready-to-review CTA · calm In-production tray · Kept-drafts shelf (PR4).
export function MiraDeskPage() {
  const haltCtx = useHalt();
  const greetingQ = useAgentGreeting("mira");
  const mission = useAgentMission("mira");
  const deskQ = useMiraDesk();
  const [missionOpen, setMissionOpen] = useState(false);

  const line =
    greetingQ.data?.segments
      ?.map((s) => s.text)
      .join(" ")
      .trim() || null;
  const desk = deskQ.data;
  // Gate on (!data && !error) — NOT isLoading — because a keys-pending query is
  // disabled (isLoading false, data undefined). See [[feedback_react_query_enabled_false_isloading]].
  const pending = !desk && !deskQ.error;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        background: MIRA_ACCENT.paper,
      }}
    >
      <div style={{ position: "relative", background: "#fff" }}>
        <Identity
          statusKey="IDLE"
          halted={haltCtx.halted}
          subtitle={MIRA_MISSION_SUBTITLE}
          line={line}
          onHaltToggle={haltCtx.toggleHalt}
          missionInteractive={!!mission.data}
          onOpenMission={() => setMissionOpen((o) => !o)}
          displayName="Mira"
          avatarAccent={{ soft: MIRA_ACCENT.soft, deep: MIRA_ACCENT.deep }}
        />
        {mission.data ? (
          <MissionPopover
            open={missionOpen}
            onClose={() => setMissionOpen(false)}
            mission={mission.data.mission}
            agentLabel="Mira"
          />
        ) : null}
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {pending ? (
          <p style={{ color: MIRA_ACCENT.deep, fontSize: 14 }}>Loading Mira's desk…</p>
        ) : deskQ.error ? (
          <p style={{ color: "#7A2E2E", fontSize: 14 }}>
            Couldn&apos;t load Mira&apos;s desk. Try again.
          </p>
        ) : (
          <>
            {/* PR3 mounts <MiraBriefBox /> here, at the top. */}
            <MiraReadyToReview count={desk!.readyToReviewCount} />
            <MiraInProductionTray items={desk!.inProduction} />
            {/* PR4 mounts <MiraKeptShelf /> here, at the bottom. */}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes** → `pnpm --filter @switchboard/dashboard test -- mira-desk-page` → PASS (all three cases)

- [ ] **Step 5: Extend the copy-hygiene CI guard (Phase-2 words + Desk sources)**

In `apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx`, extend `SOURCES` and `FORBIDDEN`:

```ts
const SOURCES = [
  resolve(DASHBOARD_ROOT, "src/lib/cockpit/mira/mira-config.ts"),
  resolve(DASHBOARD_ROOT, "src/app/(auth)/mira/creatives/[id]/creative-detail-page.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-feed-page.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-clip-card.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-creative-feed.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-clip-actions.tsx"),
  // Phase 2 Director's Desk surfaces:
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-desk-page.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-in-production-tray.tsx"),
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-ready-to-review.tsx"),
  resolve(DASHBOARD_ROOT, "src/lib/cockpit/mira/desk-copy.ts"),
];

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "Publish (standalone word)", re: /\bPublish\b/i },
  { label: "Launch", re: /\bLaunch\b/i },
  { label: "Go live", re: /\bGo live\b/i },
  { label: "Approve creative", re: /Approve creative/i },
  // Phase-2 banned words (spec §"Phase 2 copy guardrails"). "Riley"/"Keep"/"kept"
  // are ALLOWED ("Sending to Riley comes later"); the capability VERBS are not.
  { label: "distribute", re: /\bdistribut/i },
  { label: "performance", re: /\bperformance\b/i },
  { label: "winner", re: /\bwinner\b/i },
  { label: "fatigued", re: /\bfatigued\b/i },
  { label: "learning", re: /\blearning\b/i },
  { label: "improved", re: /\bimproved\b/i },
  { label: "drove", re: /\bdrove\b/i },
  { label: "recovered", re: /\brecovered\b/i },
  { label: "saved", re: /\bsaved\b/i },
];
```

> The existing "nothing is published" reassurance copy in `mira-config.ts` matches "published", not standalone `Publish` — confirm it still passes. If any source trips a word, fix the copy (do **not** weaken the regex).

- [ ] **Step 6: Run the guard + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-copy-hygiene mira-desk-page`
Expected: PASS.

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-desk-page.test.tsx apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx
git commit -m "feat(mira): compose desk modules over the desk hook + extend copy guard"
```

---

### Task 13 (PR2 close-out): full suites + build

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build      # not in CI ([[feedback_dashboard_build_not_in_ci]])
pnpm typecheck
```

Expected: all PASS. If `typecheck` reports missing `@switchboard/core` exports (e.g. `MiraDeskModel`), run `pnpm reset` first ([[feedback_reset_vs_build_and_chat_flake]]).

- [ ] **Step 2: Commit any format fixes**

```bash
pnpm format:check || pnpm format
git add -A && git commit -m "chore(mira): pr2 formatting" --allow-empty
```

**PR2 is now shippable** as `feat(mira): director's desk read surface (phase 2 PR2)`.

---

# PR3 — Open-brief mutation + hybrid brief box

> Adds the governed, draft-only, idempotent, no-cross-agent `createCreativeDraftRequest`, and the hybrid brief box whose Intent-Preview readback IS the cost-confirm and doubles as the off-scope redirect. Reuses the cost-gated pipeline; resolves the creative deployment **fail-closed**.

### Task 14: Brief schema + mapping + intent classifier (surface-agnostic)

**Files:**

- Create: `packages/schemas/src/mira-brief.ts`, `packages/schemas/src/__tests__/mira-brief.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/schemas/src/__tests__/mira-brief.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MiraBriefRequestSchema,
  mapMiraBriefToCreativeBrief,
  classifyBriefIntent,
} from "../mira-brief.js";

describe("MiraBriefRequestSchema", () => {
  it("requires a non-empty `promoting` line; goal/vibe default", () => {
    const parsed = MiraBriefRequestSchema.parse({ promoting: "Summer Botox special" });
    expect(parsed.goal).toBe("more_bookings");
    expect(parsed.vibe).toBe("warm");
    expect(MiraBriefRequestSchema.safeParse({ promoting: "" }).success).toBe(false);
    expect(MiraBriefRequestSchema.safeParse({ promoting: "x", goal: "nope" }).success).toBe(false);
  });
});

describe("mapMiraBriefToCreativeBrief", () => {
  it("composes promoting + goal objective, maps vibe → brandVoice, medspa-safe defaults", () => {
    const brief = mapMiraBriefToCreativeBrief({
      promoting: "Summer Botox special",
      goal: "more_bookings",
      vibe: "warm",
    });
    expect(brief.productDescription).toBe("Summer Botox special — drive bookings");
    expect(brief.brandVoice).toMatch(/warm/i);
    expect(brief.targetAudience).toMatch(/aesthetic|prospect/i);
    expect(brief.platforms).toEqual(["meta"]);
    expect(brief.references).toEqual([]); // reference/asset upload is deferred in Phase 2
  });
});

describe("classifyBriefIntent (off-scope redirect)", () => {
  it("flags scheduling/results questions as off_scope (never to be answered)", () => {
    expect(classifyBriefIntent("When can I rebook my 3pm client?")).toBe("off_scope");
    expect(classifyBriefIntent("How much revenue did last month's ad make?")).toBe("off_scope");
    expect(classifyBriefIntent("What were the results of my campaign?")).toBe("off_scope");
  });

  it("treats a real creative brief as creative", () => {
    expect(classifyBriefIntent("Summer Botox special — $11/unit through July")).toBe("creative");
    expect(classifyBriefIntent("Promote our new lip filler treatment")).toBe("creative");
  });
});
```

- [ ] **Step 2: Run it to verify it fails** → `pnpm --filter @switchboard/schemas test -- mira-brief` → FAIL

- [ ] **Step 3: Implement** — `packages/schemas/src/mira-brief.ts`:

```ts
import { z } from "zod";
import {
  CreativeBriefInput,
  type CreativeBriefInput as CreativeBriefInputType,
} from "./creative-job.js";

// Two optional chips with defaults (spec / decided UX). The owner gives intent
// and taste — never platforms or tooling.
export const MiraBriefGoal = z.enum(["more_bookings", "fill_slow_days", "new_treatment", "brand"]);
export type MiraBriefGoal = z.infer<typeof MiraBriefGoal>;

export const MiraBriefVibe = z.enum(["warm", "luxe", "fun", "clinical"]);
export type MiraBriefVibe = z.infer<typeof MiraBriefVibe>;

// The hybrid brief: ONE required line + two optional chips. Reference/asset
// upload is intentionally deferred in Phase 2.
export const MiraBriefRequestSchema = z.object({
  promoting: z.string().min(1).max(500),
  goal: MiraBriefGoal.default("more_bookings"),
  vibe: MiraBriefVibe.default("warm"),
});
export type MiraBriefRequest = z.infer<typeof MiraBriefRequestSchema>;

// Wire result of createCreativeDraftRequest (the Phase-2 open-brief contract).
export interface MiraBriefResult {
  jobId: string;
  status: "brief_submitted";
  expectedDraftCount: number;
  cost: { upfront: number | null; generationGatedInReview: boolean };
  requestSource: "mira.open_brief";
}

const GOAL_OBJECTIVE: Record<MiraBriefGoal, string> = {
  more_bookings: "drive bookings",
  fill_slow_days: "fill slower days",
  new_treatment: "introduce a new treatment",
  brand: "build brand awareness",
};

const VIBE_VOICE: Record<MiraBriefVibe, string> = {
  warm: "Warm and trustworthy",
  luxe: "Elevated and luxe",
  fun: "Playful and fun",
  clinical: "Clear and clinical",
};

const DEFAULT_AUDIENCE = "Local prospects interested in aesthetic treatments";

/** Map the lightweight Desk brief into the pipeline's CreativeBriefInput (polished mode). */
export function mapMiraBriefToCreativeBrief(input: MiraBriefRequest): CreativeBriefInputType {
  const brief = MiraBriefRequestSchema.parse(input); // applies chip defaults
  return CreativeBriefInput.parse({
    productDescription: `${brief.promoting.trim()} — ${GOAL_OBJECTIVE[brief.goal]}`,
    targetAudience: DEFAULT_AUDIENCE,
    platforms: ["meta"],
    brandVoice: VIBE_VOICE[brief.vibe],
    references: [],
    productImages: [],
    generateReferenceImages: false,
  });
}

// Off-scope guard: the brief box NEVER answers questions about scheduling or
// results — Mira makes ad creative; the front office (Alex) and reporting own
// those. The Intent Preview uses this to redirect instead of submitting.
const OFF_SCOPE =
  /\b(book|booking|rebook|appointment|schedul|reschedul|cancel|availab|results?|roi|roas|revenue|report|spend|leads?|how much|how many|when can|what time|how did)\b/i;

export function classifyBriefIntent(promoting: string): "creative" | "off_scope" {
  return OFF_SCOPE.test(promoting) ? "off_scope" : "creative";
}
```

- [ ] **Step 4: Export from the schemas barrel** — add to `packages/schemas/src/index.ts`:

```ts
export * from "./mira-brief.js";
```

- [ ] **Step 5: Run the test + build + commit**

Run: `pnpm --filter @switchboard/schemas test -- mira-brief && pnpm --filter @switchboard/schemas build` → PASS

```bash
git add packages/schemas/src/mira-brief.ts packages/schemas/src/__tests__/mira-brief.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): mira open-brief schema, creative-brief mapping, intent classifier"
```

---

### Task 15: `POST /agents/mira/brief` — `createCreativeDraftRequest`

**Files:**

- Modify: `packages/core/src/index.ts` (export resolver if needed)
- Create: `apps/api/src/routes/agent-home/mira-brief.ts`, `apps/api/src/routes/agent-home/__tests__/mira-brief-route.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Confirm `PrismaDeploymentResolver` is exported from `@switchboard/core`**

Run: `grep -n "PrismaDeploymentResolver" packages/core/src/index.ts`

- If present: continue.
- If absent: add `export { PrismaDeploymentResolver } from "./platform/prisma-deployment-resolver.js";` to `packages/core/src/index.ts`, then `pnpm --filter @switchboard/core build`.

- [ ] **Step 2: Write the failing route test**

`apps/api/src/routes/agent-home/__tests__/mira-brief-route.test.ts` (mirror `creatives-route.test.ts` harness — enablement store reporting Mira enabled for `PILOT`, a prisma mock). The **no-cross-agent** assertion is mandatory:

```ts
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";
import { miraBriefRoute } from "../mira-brief.js";

const PILOT = "pilot";

describe("POST /agents/mira/brief", () => {
  let ctx: TestContext;
  // beforeAll: follow the LOCAL-mock pattern from creatives-route.test.ts (there is
  //   NO `ctx.spies` accessor and NO prisma-injection option on TestContext). Build a
  //   local `buildPrismaMock()` of vi.fn() stubs and attach it:
  //     (ctx.app as unknown as { prisma: unknown }).prisma = prismaMock;
  //   Stubs needed:
  //   - agentDeployment.findFirst({where:{organizationId:PILOT, skillSlug:"creative", ...}})
  //       resolves a row matching whatever shape resolveByOrgAndSlug expects, and resolves
  //       NOTHING for any other org (drives the fail-closed 409 path).
  //   - agentTask.create / creativeJob.create echo an { id } back.
  //   - recommendation.create / campaign.create as vi.fn() (for the no-cross-agent assert).
  //   Stub the Inngest client send to a no-op spy. Keep refs to the local stubs in scope
  //   so the it() blocks can assert on them directly (e.g. `const prismaMock = …` outside beforeAll).
  //   buildTestServer ALREADY registers idempotencyMiddleware (test-server.ts), so the replay
  //   test works without extra wiring.

  async function post(org: string, body: unknown, key?: string) {
    return ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/agents/mira/brief",
      headers: { "x-org-id": org, ...(key ? { "idempotency-key": key } : {}) },
      payload: body,
    });
  }

  it("creates a draft request and returns the open-brief contract", async () => {
    const res = await post(PILOT, { promoting: "Summer Botox special" });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      jobId: string;
      status: string;
      cost: { generationGatedInReview: boolean };
      requestSource: string;
    };
    expect(body.status).toBe("brief_submitted");
    expect(body.requestSource).toBe("mira.open_brief");
    expect(body.cost.generationGatedInReview).toBe(true);
    expect(typeof body.jobId).toBe("string");
  });

  it("makes NO cross-agent writes (no Riley / recommendation / campaign / publish)", async () => {
    await post(PILOT, { promoting: "Summer Botox special" });
    // Assert the prisma mock's recommendation/campaign/pendingAction namespaces were never written.
    // (Set these up as vi.fn() spies in beforeAll; only agentTask.create + creativeJob.create are allowed.)
    // Assert on the LOCAL prismaMock stubs (see beforeAll) — there is no ctx.spies.
    expect(prismaMock.recommendation.create).not.toHaveBeenCalled();
    expect(prismaMock.campaign.create).not.toHaveBeenCalled();
    expect(prismaMock.creativeJob.create).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the org has no creative deployment", async () => {
    const res = await post("org-without-creative", { promoting: "x" });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe("creative_deployment_not_provisioned");
  });

  it("400s on an invalid brief", async () => {
    const res = await post(PILOT, { promoting: "" });
    expect(res.statusCode).toBe(400);
  });

  it("dedupes a replayed POST with the same Idempotency-Key", async () => {
    const key = "replay-key-1";
    const first = await post(PILOT, { promoting: "Replay test" }, key);
    const second = await post(PILOT, { promoting: "Replay test" }, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json()); // served from the idempotency cache
  });
});
```

> `buildTestServer` already registers `idempotencyMiddleware` (`apps/api/src/__tests__/test-server.ts`), so the replay test needs no extra wiring. There is **no** `ctx.spies` accessor — use the local `buildPrismaMock()` pattern from `creatives-route.test.ts` (the no-cross-agent REQUIREMENT is: `recommendation.create`/`campaign.create` were never called; only `agentTask.create` + `creativeJob.create` fired).

- [ ] **Step 3: Run it to verify it fails** → `pnpm --filter @switchboard/api test -- mira-brief-route` → FAIL (route missing)

- [ ] **Step 4: Implement the route** — `apps/api/src/routes/agent-home/mira-brief.ts`:

```ts
// @route-class: lifecycle
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PrismaCreativeJobStore, PrismaAgentTaskStore } from "@switchboard/db";
import { PrismaDeploymentResolver } from "@switchboard/core";
import { inngestClient } from "@switchboard/creative-pipeline";
import {
  AgentKeySchema,
  MiraBriefRequestSchema,
  mapMiraBriefToCreativeBrief,
} from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });

// createCreativeDraftRequest — the Phase-2 open-brief mutation. Typed, audited,
// idempotent (global Idempotency-Key middleware), DRAFT-ONLY and NO-CROSS-AGENT:
// no Riley side effect, no recommendation/campaign write, no external publish.
// Resolves the org's "creative" deployment fail-closed (no deployment → no spend).
export const miraBriefRoute: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim())
        request.organizationIdFromAuth = headerVal.trim();
      else if (!request.organizationIdFromAuth) request.organizationIdFromAuth = "default";
      if (!request.principalIdFromAuth) request.principalIdFromAuth = "default";
    }
  });

  app.post("/agents/:agentId/brief", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success || params.data.agentId !== "mira")
      return reply.code(404).send({ error: "Brief intake not available for this agent" });

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.orgAgentEnablementStore)
      return reply.code(503).send({ error: "Enablement store unavailable" });
    if (!(await isAgentHomeAccessible("mira", orgId, app.orgAgentEnablementStore)))
      return reply.code(404).send({ error: "Agent not available on home" });
    if (!app.prisma) return reply.code(503).send({ error: "Database unavailable" });

    const parsed = MiraBriefRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid brief", details: parsed.error });

    // Resolve the creative deployment — fail closed (no spend without it).
    const resolver = new PrismaDeploymentResolver(app.prisma);
    let deployment;
    try {
      deployment = await resolver.resolveByOrgAndSlug(orgId, "creative");
    } catch {
      return reply.code(409).send({ error: "creative_deployment_not_provisioned" });
    }
    if (!deployment) return reply.code(409).send({ error: "creative_deployment_not_provisioned" });

    const actorId = request.principalIdFromAuth ?? "default";
    const brief = mapMiraBriefToCreativeBrief(parsed.data);

    const taskStore = new PrismaAgentTaskStore(app.prisma);
    const task = await taskStore.create({
      deploymentId: deployment.deploymentId,
      organizationId: orgId,
      listingId: deployment.listingId,
      category: "creative_strategy",
      input: { ...brief, requestSource: "mira.open_brief", actorId } as unknown as Record<
        string,
        unknown
      >,
    });

    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.create({
      taskId: task.id,
      organizationId: orgId,
      deploymentId: deployment.deploymentId,
      productDescription: brief.productDescription,
      targetAudience: brief.targetAudience,
      platforms: brief.platforms,
      brandVoice: brief.brandVoice ?? null,
      productImages: brief.productImages,
      references: brief.references,
      pastPerformance: null,
      generateReferenceImages: brief.generateReferenceImages,
    });

    // Kick off the cost-GATED pipeline. Only the cheap planning stage runs now;
    // the expensive video step blocks for the existing Continue cost-confirm in review.
    await inngestClient.send({
      name: "creative-pipeline/job.submitted",
      data: {
        jobId: job.id,
        taskId: task.id,
        organizationId: orgId,
        deploymentId: deployment.deploymentId,
        mode: "polished",
      },
    });

    return reply.code(201).send({
      jobId: job.id,
      status: "brief_submitted",
      expectedDraftCount: 1, // conservative v1 estimate; true count unknown until the scripts stage
      cost: { upfront: null, generationGatedInReview: true },
      requestSource: "mira.open_brief",
    });
  });
};
```

> **Verify the resolver/store signatures at execution time.** `resolveByOrgAndSlug` resolves the org's `skillSlug:"creative"` deployment and throws if there is no live deployment — read its actual return shape (`{ deploymentId, listingId, … }`) from `prisma-deployment-resolver.ts` before relying on field names; see [[reference_governance_trust_path]]. **Listing-status caveat:** the canonical-`"listed"` fix (#763) is on `main` but is **not** in this branch's base — confirm it is present in the branch you implement from (`grep "listed" packages/.../prisma-deployment-resolver.ts`) before seeding a `"listed"`-status deployment; an older base still gates `!== "active"` ([[feedback_deployment_resolver_listing_status_active_bug]]). If `PrismaAgentTaskStore.create` / `PrismaCreativeJobStore.create` field names differ, copy them from the existing brief path `apps/api/src/routes/creative-pipeline.ts` (the reference creation flow). The pipeline event name/shape must match what `apps/api/src/routes/creative-pipeline.ts` sends today.

- [ ] **Step 5: Register the route** — in `apps/api/src/bootstrap/routes.ts`, beside the `creativesRoute` registration:

```ts
import { miraBriefRoute } from "../routes/agent-home/mira-brief.js";
// …
// miraBriefRoute: POST /api/dashboard/agents/mira/brief — createCreativeDraftRequest (draft-only)
await app.register(miraBriefRoute, { prefix: "/api/dashboard" });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- mira-brief-route`
Expected: PASS (create, no-cross-agent, fail-closed, 400, replay-dedup).

- [ ] **Step 7: Verify route governance** — Run: `pnpm test -- route-class-validator` (the `.agent/tools/route-class-validator.ts` check). Expected: PASS. NOTE: the validator only enforces `operator-direct` and `read-only` classes today — a `lifecycle` route passes trivially (it is not deeply checked), so this is a "didn't regress the validator" gate, NOT positive confirmation of lifecycle governance. The real governance guarantees here are the draft-only + no-cross-agent assertions in the route test (Step 2).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/agent-home/mira-brief.ts apps/api/src/routes/agent-home/__tests__/mira-brief-route.test.ts apps/api/src/bootstrap/routes.ts packages/core/src/index.ts
git commit -m "feat(api): createCreativeDraftRequest — draft-only, no-cross-agent open-brief mutation"
```

---

### Task 16: Dashboard client + proxy + hook for the brief mutation

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/governance.ts`
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/brief/route.ts`
- Create: `apps/dashboard/src/hooks/use-create-creative-draft-request.ts`, `__tests__/use-create-creative-draft-request.test.tsx`

- [ ] **Step 1: Add the client method** (forwards a caller-supplied idempotency key so browser retries dedupe):

```ts
import type { MiraBriefRequest, MiraBriefResult } from "@switchboard/schemas";

  /** createCreativeDraftRequest — draft-only open-brief mutation (Phase 2). */
  async createCreativeDraftRequest(brief: MiraBriefRequest, idempotencyKey: string): Promise<MiraBriefResult> {
    return this.request<MiraBriefResult>("/api/dashboard/agents/mira/brief", {
      method: "POST",
      body: JSON.stringify(brief),
      headers: { "Idempotency-Key": idempotencyKey },
    });
  }
```

- [ ] **Step 2: Add the proxy** — `apps/dashboard/src/app/api/dashboard/agents/mira/brief/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { MiraBriefRequestSchema } from "@switchboard/schemas";
import { createIdempotencyKey } from "@/lib/idempotency";

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/** Dashboard proxy for `POST /api/dashboard/agents/mira/brief` (createCreativeDraftRequest). */
export async function POST(request: Request) {
  try {
    await requireDashboardSession();
    const parsed = MiraBriefRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid brief" }, { status: 400 });
    // Prefer the browser-supplied key so retries of the SAME submission dedupe.
    const idempotencyKey = request.headers.get("idempotency-key") ?? createIdempotencyKey();
    const client = await getApiClient();
    const data = await client.createCreativeDraftRequest(parsed.data, idempotencyKey);
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Write the failing hook test** — `apps/dashboard/src/hooks/__tests__/use-create-creative-draft-request.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreateCreativeDraftRequest } from "../use-create-creative-draft-request";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    miraFeed: { desk: () => ["org", "miraFeed", "desk"], all: () => ["org", "miraFeed"] },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCreateCreativeDraftRequest", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends an Idempotency-Key header and returns the contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        jobId: "j1",
        status: "brief_submitted",
        expectedDraftCount: 1,
        cost: { upfront: null, generationGatedInReview: true },
        requestSource: "mira.open_brief",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCreateCreativeDraftRequest(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ promoting: "Botox", goal: "more_bookings", vibe: "warm" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run it to verify it fails** → FAIL (hook missing)

- [ ] **Step 5: Implement the hook** — `apps/dashboard/src/hooks/use-create-creative-draft-request.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MiraBriefRequest, MiraBriefResult } from "@switchboard/schemas";
import { useScopedQueryKeys } from "./use-query-keys";
import { createIdempotencyKey } from "@/lib/idempotency";

/** createCreativeDraftRequest — draft-only. Generates a per-submission idempotency key. */
export function useCreateCreativeDraftRequest() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (brief: MiraBriefRequest): Promise<MiraBriefResult> => {
      const res = await fetch("/api/dashboard/agents/mira/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify(brief),
      });
      if (!res.ok) throw new Error(`Brief submission failed (HTTP ${res.status})`);
      return (await res.json()) as MiraBriefResult;
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.all() });
    },
  });
}
```

- [ ] **Step 6: Run the test + commit**

Run: `pnpm --filter @switchboard/dashboard test -- use-create-creative-draft-request` → PASS

```bash
git add apps/dashboard/src/lib/api-client/governance.ts apps/dashboard/src/app/api/dashboard/agents/mira/brief/route.ts apps/dashboard/src/hooks/use-create-creative-draft-request.ts apps/dashboard/src/hooks/__tests__/use-create-creative-draft-request.test.tsx
git commit -m "feat(mira): dashboard client, proxy, and hook for createCreativeDraftRequest"
```

---

### Task 17: Hybrid brief box + Intent Preview (mounts at top of Desk)

The brief box: one required line ("What are we promoting?"), two optional chips with defaults (Goal, Vibe), three tappable example chips that fill the line, and an **Intent-Preview readback** on submit. The Intent Preview IS the cost-confirm — `createCreativeDraftRequest` **never** fires before [Make the draft] (a HARD rule, tested). If the line reads as a scheduling/results question, the preview **redirects** (never answers).

**Files:**

- Modify: `apps/dashboard/src/lib/cockpit/mira/desk-copy.ts` (add labels + intent copy)
- Create: `apps/dashboard/src/components/cockpit/mira/mira-brief-box.tsx`, `__tests__/mira-brief-box.test.tsx`
- Modify: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx`

- [ ] **Step 1: Add labels + intent copy to `desk-copy.ts`**

Append to `apps/dashboard/src/lib/cockpit/mira/desk-copy.ts`:

```ts
import type { MiraBriefGoal, MiraBriefVibe } from "@switchboard/schemas";

export const BRIEF_HEADING_EMPTY = "What should Mira work on next?";
export const BRIEF_PROMOTING_LABEL = "What are we promoting?";
export const BRIEF_PROMOTING_PLACEHOLDER = "Summer Botox special — $11/unit through July";

export const GOAL_LABEL: Record<MiraBriefGoal, string> = {
  more_bookings: "More bookings",
  fill_slow_days: "Fill slow days",
  new_treatment: "New treatment",
  brand: "Brand",
};

export const VIBE_LABEL: Record<MiraBriefVibe, string> = {
  warm: "Warm & trustworthy",
  luxe: "Luxe",
  fun: "Fun",
  clinical: "Clinical",
};

// Three example chips that fill the line (kills blank-box freeze).
export const BRIEF_EXAMPLES = [
  "Summer Botox special — $11/unit through July",
  "Introduce our new lip filler treatment",
  "Fill weekday afternoon facial slots",
] as const;

/** The Intent-Preview readback (cost-confirm copy). Generation cost is gated in review. */
export function intentSummary(promoting: string, goalLabel: string, vibeLabel: string): string {
  return `Got it — a draft ad for "${promoting.trim()}", aimed at ${goalLabel.toLowerCase()}, ${vibeLabel.toLowerCase()} tone. You'll review the draft before anything goes further; generating the video is a separate step you confirm in review.`;
}

// Off-scope redirect — NEVER answers the question; points back to ad creative.
export const BRIEF_OFFSCOPE_REDIRECT =
  "That sounds like a scheduling or results question — your front desk and reports handle those. Mira makes the ad creative. Want a draft about an offer or treatment instead?";
```

- [ ] **Step 2: Write the failing test** — `__tests__/mira-brief-box.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MiraBriefBox } from "../mira-brief-box";

const mutateAsync = vi.fn();
const state = { isPending: false, isError: false };
vi.mock("@/hooks/use-create-creative-draft-request", () => ({
  useCreateCreativeDraftRequest: () => ({ mutateAsync, ...state }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({ useHalt: () => ({ halted: false }) }));

function typeLine(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/summer botox special/i), { target: { value } });
}

describe("MiraBriefBox", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue({ jobId: "j" });
    state.isPending = false;
    state.isError = false;
  });

  it("shows the Intent Preview on submit and does NOT fire the mutation until [Make the draft] (HARD rule)", () => {
    render(<MiraBriefBox />);
    typeLine("Summer Botox special");
    fireEvent.click(screen.getByRole("button", { name: /preview|make the draft/i }));
    expect(screen.getByText(/got it — a draft ad/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled(); // cost-confirm: never before [Make the draft]
  });

  it("submits only after [Make the draft] is clicked", async () => {
    render(<MiraBriefBox />);
    typeLine("Summer Botox special");
    fireEvent.click(screen.getByRole("button", { name: /^preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /make the draft/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        promoting: "Summer Botox special",
        goal: "more_bookings",
        vibe: "warm",
      }),
    );
    expect(await screen.findByText(/mira is on it|started a draft/i)).toBeInTheDocument();
  });

  it("redirects (never answers) and never submits when the line reads as an off-scope question", () => {
    render(<MiraBriefBox />);
    typeLine("When can I rebook my 3pm client?");
    fireEvent.click(screen.getByRole("button", { name: /^preview/i }));
    expect(screen.getByText(/front desk and reports handle those/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /make the draft/i })).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("disables Preview when the line is empty; an example chip fills it", () => {
    render(<MiraBriefBox />);
    expect(screen.getByRole("button", { name: /^preview/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /introduce our new lip filler/i }));
    expect(screen.getByRole("button", { name: /^preview/i })).not.toBeDisabled();
  });
});
```

- [ ] **Step 3: Run it to verify it fails** → FAIL

- [ ] **Step 4: Implement** — `mira-brief-box.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { MiraBriefGoal, MiraBriefVibe } from "@switchboard/schemas";
import { classifyBriefIntent } from "@switchboard/schemas";
import { useCreateCreativeDraftRequest } from "@/hooks/use-create-creative-draft-request";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";
import {
  BRIEF_HEADING_EMPTY,
  BRIEF_PROMOTING_PLACEHOLDER,
  BRIEF_EXAMPLES,
  GOAL_LABEL,
  VIBE_LABEL,
  intentSummary,
  BRIEF_OFFSCOPE_REDIRECT,
} from "@/lib/cockpit/mira/desk-copy";

const GOALS = Object.keys(GOAL_LABEL) as MiraBriefGoal[];
const VIBES = Object.keys(VIBE_LABEL) as MiraBriefVibe[];

type Phase = "edit" | "preview" | "offscope" | "submitted";

// Hybrid open-brief: one required line + Goal/Vibe chips + example chips, then an
// Intent-Preview readback that IS the cost-confirm (the mutation never fires
// before [Make the draft]) and doubles as the off-scope redirect.
export function MiraBriefBox() {
  const { halted } = useHalt();
  const create = useCreateCreativeDraftRequest();
  const [promoting, setPromoting] = useState("");
  const [goal, setGoal] = useState<MiraBriefGoal>("more_bookings");
  const [vibe, setVibe] = useState<MiraBriefVibe>("warm");
  const [phase, setPhase] = useState<Phase>("edit");

  const canPreview = promoting.trim().length > 0 && !halted;

  function preview() {
    if (!canPreview) return;
    setPhase(classifyBriefIntent(promoting) === "off_scope" ? "offscope" : "preview");
  }

  async function makeTheDraft() {
    await create.mutateAsync({ promoting: promoting.trim(), goal, vibe });
    setPhase("submitted");
    setPromoting("");
  }

  const chip = (active: boolean) => ({
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    cursor: "pointer",
    border: `1px solid ${MIRA_ACCENT.soft}`,
    background: active ? MIRA_ACCENT.deep : "transparent",
    color: active ? "#fff" : MIRA_ACCENT.deep,
  });
  const btn = {
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    color: "#fff",
    fontSize: 13,
    cursor: "pointer",
  } as const;

  return (
    <section
      aria-label="Brief Mira"
      style={{
        background: "#fff",
        borderRadius: 14,
        padding: 16,
        border: `1px solid ${MIRA_ACCENT.soft}`,
      }}
    >
      <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: MIRA_ACCENT.deep }}>
        {BRIEF_HEADING_EMPTY}
      </h2>

      {phase === "preview" ? (
        <div style={{ background: MIRA_ACCENT.paper, borderRadius: 10, padding: 12 }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: MIRA_ACCENT.deep }}>
            {intentSummary(promoting, GOAL_LABEL[goal], VIBE_LABEL[vibe])}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={create.isPending}
              onClick={makeTheDraft}
              style={{ ...btn, background: MIRA_ACCENT.deep }}
            >
              Make the draft
            </button>
            <button
              type="button"
              onClick={() => setPhase("edit")}
              style={{
                ...btn,
                background: "transparent",
                border: `1px solid ${MIRA_ACCENT.soft}`,
                color: MIRA_ACCENT.deep,
              }}
            >
              Tweak
            </button>
          </div>
          {create.isError && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "#7A2E2E" }}>
              Couldn&apos;t start the draft — try again.
            </p>
          )}
        </div>
      ) : phase === "offscope" ? (
        <div style={{ background: MIRA_ACCENT.paper, borderRadius: 10, padding: 12 }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: MIRA_ACCENT.deep }}>
            {BRIEF_OFFSCOPE_REDIRECT}
          </p>
          <button
            type="button"
            onClick={() => setPhase("edit")}
            style={{ ...btn, background: MIRA_ACCENT.deep }}
          >
            Edit the brief
          </button>
        </div>
      ) : (
        <>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
            What are we promoting?
          </label>
          <textarea
            placeholder={BRIEF_PROMOTING_PLACEHOLDER}
            value={promoting}
            onChange={(e) => {
              setPromoting(e.target.value);
              if (phase === "submitted") setPhase("edit");
            }}
            rows={2}
            style={{
              width: "100%",
              resize: "vertical",
              borderRadius: 8,
              border: `1px solid ${MIRA_ACCENT.soft}`,
              padding: 10,
              fontSize: 14,
            }}
          />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {BRIEF_EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setPromoting(ex)} style={chip(false)}>
                {ex}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {GOALS.map((g) => (
              <button key={g} type="button" onClick={() => setGoal(g)} style={chip(g === goal)}>
                {GOAL_LABEL[g]}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {VIBES.map((v) => (
              <button key={v} type="button" onClick={() => setVibe(v)} style={chip(v === vibe)}>
                {VIBE_LABEL[v]}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <button
              type="button"
              disabled={!canPreview}
              onClick={preview}
              style={{
                ...btn,
                background: canPreview ? MIRA_ACCENT.deep : "#bbb",
                cursor: canPreview ? "pointer" : "not-allowed",
              }}
            >
              Preview
            </button>
            {halted && (
              <span style={{ fontSize: 12, color: "#7A2E2E" }}>Resume Mira to brief her.</span>
            )}
            {phase === "submitted" && (
              <span style={{ fontSize: 13, color: MIRA_ACCENT.base }}>
                Mira is on it — she started a draft. You&apos;ll review it before anything goes
                further.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
```

> Copy check: this file is added to the copy-hygiene SOURCES in Step 6. "review", "draft", "tone", "bookings", "treatment", "brand" are fine; it must contain none of the banned words.

- [ ] **Step 5: Mount the brief box at the top of the Desk** — in `mira-desk-page.tsx`, import it and render it as the FIRST child inside the populated branch (replacing the `{/* PR3 mounts … */}` comment):

```tsx
import { MiraBriefBox } from "./mira-brief-box";
// …inside the populated <> branch, BEFORE <MiraReadyToReview …>:
<MiraBriefBox />;
```

Update the `mira-desk-page.test.tsx` cases to also mock the brief hook so the page renders:

```tsx
vi.mock("@/hooks/use-create-creative-draft-request", () => ({
  useCreateCreativeDraftRequest: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));
```

- [ ] **Step 6: Add the brief box to the copy-hygiene guard** — append to `SOURCES` in `mira-copy-hygiene.test.tsx`:

```ts
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-brief-box.tsx"),
```

- [ ] **Step 7: Run the tests + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-brief-box mira-desk-page mira-copy-hygiene desk-copy`
Expected: PASS.

```bash
git add apps/dashboard/src/lib/cockpit/mira/desk-copy.ts apps/dashboard/src/components/cockpit/mira/mira-brief-box.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-brief-box.test.tsx apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-desk-page.test.tsx apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx
git commit -m "feat(mira): hybrid brief box with intent-preview cost-confirm + off-scope redirect"
```

---

### Task 18 (PR3 close-out): full suites, build, typecheck

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build     # not in CI ([[feedback_dashboard_build_not_in_ci]])
pnpm typecheck
pnpm format:check                                # CI runs prettier ([[feedback_ci_prettier_not_in_local_lint]])
```

Expected: all PASS. If `typecheck` complains about cross-package exports, `pnpm reset` then retry ([[feedback_reset_vs_build_and_chat_flake]]).

- [ ] **Step 2: Commit any format fixes**

```bash
git add -A && git commit -m "chore(mira): pr3 formatting" --allow-empty
```

**PR3 is now shippable** as `feat(mira): open-brief mutation + hybrid brief box (phase 2 PR3)`.

---

# PR4 — Keep / Pass + kept-drafts shelf

> The slice that makes the shelf honest. A migration adds a review-decision field; a draft-only, no-cross-agent decision mutation files a `draft_ready` clip to **Keep** (→ shelf, reversible) or **Pass** (gone); acting removes it from the feed (inbox-zero); the Kept-drafts shelf reads kept drafts. Firewalled from the Phase-4 Riley handoff.

### Task 19: Migration + schema field (review decision)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_creative_job_review_decision/migration.sql`
- Modify: `packages/schemas/src/creative-job.ts`

- [ ] **Step 1: Add the fields to the Prisma model**

In `packages/db/prisma/schema.prisma`, inside `model CreativeJob { … }` (after the `mode` / UGC block, before `createdAt`):

```prisma
  // Phase-2 review decision (Keep/Pass). Creative-only, firewalled from Riley.
  // null = undecided (still in the feed); "kept" = on the shelf; "passed" = dismissed.
  reviewDecision   String?
  reviewDecidedAt  DateTime?
```

Add an index for the kept-shelf / feed-exclusion query (alongside the existing `@@index` block):

```prisma
  @@index([organizationId, reviewDecision])
```

- [ ] **Step 2: Hand-write the migration** (Postgres may be down; do NOT use `prisma migrate dev` which needs a TTY — [[feedback_prisma_migrate_dev_tty]]). Create `packages/db/prisma/migrations/20260530120000_creative_job_review_decision/migration.sql` (use a real, monotonically-increasing UTC timestamp for the dir prefix):

```sql
-- Phase-2 Mira Keep/Pass review decision on creative drafts.
ALTER TABLE "CreativeJob" ADD COLUMN "reviewDecision" TEXT;
ALTER TABLE "CreativeJob" ADD COLUMN "reviewDecidedAt" TIMESTAMP(3);

-- Index name must match what Prisma generates for @@index([organizationId, reviewDecision])
-- or db:check-drift fails ([[feedback_prisma_index_name_63_char_limit]]).
CREATE INDEX "CreativeJob_organizationId_reviewDecision_idx" ON "CreativeJob"("organizationId", "reviewDecision");
```

- [ ] **Step 3: Add the fields to the Zod `CreativeJobSchema`**

In `packages/schemas/src/creative-job.ts`, inside `CreativeJobSchema` (after `ugcFailure`, before `createdAt`):

```ts
  reviewDecision: z.enum(["kept", "passed"]).nullable().optional(),
  reviewDecidedAt: z.coerce.date().nullable().optional(),
```

- [ ] **Step 4: Regenerate + verify drift, then build**

```bash
pnpm db:generate
pnpm db:check-drift   # requires a running Postgres; confirms the hand migration matches the schema ([[feedback_worktree_init_postgres_down]])
pnpm --filter @switchboard/schemas build
```

Expected: client regenerates; no drift; schemas build. If Postgres is down, skip `db:check-drift` here and run it before pushing (it is CI-validated).

- [ ] **Step 5: Commit (schema + migration together — required)**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/schemas/src/creative-job.ts
git commit -m "feat(db): creative-job review decision field (mira keep/pass)"
```

---

### Task 20: Seam passthrough + feed inbox-zero filter + desk kept bucket

**Files:**

- Modify: `packages/core/src/creative-read-model/types.ts`
- Modify: `packages/core/src/creative-read-model/build-read-model.ts`
- Modify: `packages/core/src/creative-read-model/desk-model.ts`
- Modify: `packages/core/src/creative-read-model/__tests__/desk-model.test.ts`
- Modify: `apps/api/src/routes/agent-home/creatives.ts`

- [ ] **Step 1: Add `reviewDecision` to the summary + `keptDrafts` to the desk model**

In `packages/core/src/creative-read-model/types.ts`, add to `MiraCreativeJobSummary` (after `updatedAt`):

```ts
  /** Phase-2 Keep/Pass review decision. null/undefined = undecided (in the feed). */
  reviewDecision?: "kept" | "passed" | null;
```

- [ ] **Step 2: Pass it through in `build-read-model.ts`**

In `buildMiraCreativeReadModel`, add to the summary object literal (after `updatedAt: …`):

```ts
      reviewDecision: job.reviewDecision ?? null,
```

- [ ] **Step 3: Update the desk-model test for the kept bucket + passed-exclusion**

Add to `packages/core/src/creative-read-model/__tests__/desk-model.test.ts`:

```ts
import type { MiraDeskModel } from "../desk-model.js";

describe("buildMiraDeskModel — review decisions (PR4)", () => {
  it("kept drafts go to the shelf (approved_draft); passed drafts disappear; decided ⇒ not ready-to-review", () => {
    const jobs: MiraCreativeJobSummary[] = [
      job({ id: "r1", status: "draft_ready", draft: { videoUrl: "x" } }), // undecided → ready
      job({
        id: "k1",
        status: "draft_ready",
        draft: { videoUrl: "y", thumbnailUrl: "t1" },
        reviewDecision: "kept",
      }),
      job({ id: "x1", status: "draft_ready", draft: { videoUrl: "z" }, reviewDecision: "passed" }),
    ];
    const desk: MiraDeskModel = buildMiraDeskModel({ jobs, counts: { ...counts, total: 3 } });
    expect(desk.readyToReviewCount).toBe(1); // only the undecided one
    expect(desk.keptDrafts.map((i) => i.id)).toEqual(["k1"]); // kept → shelf
    expect(desk.keptDrafts[0]?.state).toBe("approved_draft");
    expect(desk.keptDrafts[0]?.thumbnailUrl).toBe("t1");
    // passed (x1) appears in neither bucket.
    expect(desk.inProduction).toEqual([]);
  });
});
```

- [ ] **Step 4: Implement the kept bucket + passed-exclusion in `desk-model.ts`**

Add `keptDrafts` to `MiraDeskModel`:

```ts
export interface MiraDeskModel {
  inProduction: MiraDeskItem[];
  readyToReviewCount: number;
  keptDrafts: MiraDeskItem[];
  counts: MiraCreativeCounts;
  isEmpty: boolean;
}
```

Rewrite the loop in `buildMiraDeskModel` to branch on the review decision FIRST (decided drafts leave the feed buckets):

```ts
const KEPT_SHELF_CAP = 8;

export function buildMiraDeskModel(rm: MiraCreativeReadModel): MiraDeskModel {
  const inProduction: MiraDeskItem[] = [];
  const keptDrafts: MiraDeskItem[] = [];
  let readyToReviewCount = 0;

  for (const job of rm.jobs) {
    if (job.reviewDecision === "passed") continue; // dismissed — gone from the desk
    if (job.reviewDecision === "kept") {
      // the verdict → shelf
      keptDrafts.push(toItem(job, "approved_draft"));
      continue;
    }
    const state = deriveDeskItemState(job); // undecided → status buckets
    if (state === "in_production") inProduction.push(toItem(job, state));
    else if (state === "ready_to_review") readyToReviewCount += 1;
  }

  return {
    inProduction,
    readyToReviewCount,
    keptDrafts: keptDrafts.slice(0, KEPT_SHELF_CAP),
    counts: rm.counts,
    isEmpty: rm.jobs.length === 0,
  };
}
```

> Window caveat ([[feedback_surface_agnostic_backend]] / FETCH_CAP): kept drafts are read from the same windowed `rm.jobs` (≤ FEED_WINDOW). Kept drafts older than the window aren't shown — acceptable at M1 pilot scale; revisit with a dedicated query if the shelf needs full history. No silent truncation beyond the documented cap.

- [ ] **Step 5: Inbox-zero on the feed — `isReviewable` excludes decided drafts**

In `apps/api/src/routes/agent-home/creatives.ts`, tighten `isReviewable` so acting on a clip removes it from the feed server-side (persists across refetch, not just the local `resolved` set):

```ts
export function isReviewable(job: MiraCreativeJobSummary): boolean {
  return (
    !job.reviewDecision && // Keep/Pass removes the draft from the feed (inbox-zero)
    (job.status === "awaiting_review" || job.status === "draft_ready") &&
    typeof job.draft?.videoUrl === "string"
  );
}
```

- [ ] **Step 6: Run the core + api suites**

Run: `pnpm --filter @switchboard/core test -- desk-model && pnpm --filter @switchboard/api test -- creatives-route`
Expected: PASS. (The existing `creatives-route` reviewable tests still pass — undecided fixtures have `reviewDecision: null`.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/creative-read-model/types.ts packages/core/src/creative-read-model/build-read-model.ts packages/core/src/creative-read-model/desk-model.ts packages/core/src/creative-read-model/__tests__/desk-model.test.ts apps/api/src/routes/agent-home/creatives.ts
git commit -m "feat(core): kept-drafts shelf bucket + feed inbox-zero filter on review decision"
```

---

### Task 21: `POST /agents/mira/creatives/:id/decision` — Keep / Pass / un-keep

A draft-only, no-cross-agent, org-scoped mutation that sets `reviewDecision`. `null` un-keeps (reversible). Writes ONLY the `CreativeJob` decision field — no Riley/recommendation/campaign/publish.

**Files:**

- Create: `apps/api/src/routes/agent-home/mira-decision.ts`, `__tests__/mira-decision-route.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Write the failing route test**

`apps/api/src/routes/agent-home/__tests__/mira-decision-route.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";
import { miraDecisionRoute } from "../mira-decision.js";

const PILOT = "pilot";

describe("POST /agents/mira/creatives/:id/decision", () => {
  let ctx: TestContext;
  // beforeAll: register miraDecisionRoute at "/api/dashboard"; enablement enabled for PILOT.
  //   Use the LOCAL buildPrismaMock() pattern (no ctx.spies). Attach via
  //   (ctx.app as unknown as { prisma }).prisma = prismaMock. Stubs:
  //   - creativeJob.updateMany resolves { count: 1 } for {id:"job1", organizationId:PILOT},
  //       { count: 0 } otherwise (drives the cross-org 404).
  //   - recommendation.create / campaign.create as vi.fn() for the no-cross-agent assert.
  //   Keep `prismaMock` in scope so the it() blocks assert on it directly.

  async function decide(org: string, id: string, decision: "kept" | "passed" | null) {
    return ctx.app.inject({
      method: "POST",
      url: `/api/dashboard/agents/mira/creatives/${id}/decision`,
      headers: { "x-org-id": org },
      payload: { decision },
    });
  }

  it("keeps a draft (200) and writes ONLY the decision field", async () => {
    const res = await decide(PILOT, "job1", "kept");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { decision: string }).decision).toBe("kept");
    expect(prismaMock.recommendation.create).not.toHaveBeenCalled();
    expect(prismaMock.creativeJob.updateMany).toHaveBeenCalledTimes(1);
  });

  it("passes a draft (200)", async () => {
    expect((await decide(PILOT, "job1", "passed")).statusCode).toBe(200);
  });

  it("un-keeps with decision:null (reversible)", async () => {
    expect((await decide(PILOT, "job1", null)).statusCode).toBe(200);
  });

  it("404s for a cross-org / missing job (count===0 guard)", async () => {
    expect((await decide(PILOT, "not-mine", "kept")).statusCode).toBe(404);
  });

  it("400s on an invalid decision", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/agents/mira/creatives/job1/decision",
      headers: { "x-org-id": PILOT },
      payload: { decision: "shipped" },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** → `pnpm --filter @switchboard/api test -- mira-decision-route` → FAIL (route missing)

- [ ] **Step 3: Implement the route** — `apps/api/src/routes/agent-home/mira-decision.ts`:

```ts
// @route-class: lifecycle
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema, id: z.string().min(1) });
// null un-keeps (reversible). Keep/Pass are the only set values.
const BodySchema = z.object({ decision: z.enum(["kept", "passed"]).nullable() });

// Keep/Pass review decision. DRAFT-ONLY and NO-CROSS-AGENT: writes ONLY the
// CreativeJob review-decision field — firewalled from the Phase-4 Riley handoff
// (no Riley, no recommendation/campaign, no publish). Org-scoped via updateMany
// + count===0 guard (cross-org ids → 404). See [[feedback_updatemany_drops_nomatch_abort]].
export const miraDecisionRoute: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim())
        request.organizationIdFromAuth = headerVal.trim();
      else if (!request.organizationIdFromAuth) request.organizationIdFromAuth = "default";
      if (!request.principalIdFromAuth) request.principalIdFromAuth = "default";
    }
  });

  app.post("/agents/:agentId/creatives/:id/decision", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success || params.data.agentId !== "mira")
      return reply.code(404).send({ error: "Review decision not available for this agent" });

    const body = BodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid decision" });

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.orgAgentEnablementStore)
      return reply.code(503).send({ error: "Enablement store unavailable" });
    if (!(await isAgentHomeAccessible("mira", orgId, app.orgAgentEnablementStore)))
      return reply.code(404).send({ error: "Agent not available on home" });
    if (!app.prisma) return reply.code(503).send({ error: "Database unavailable" });

    const decision = body.data.decision;
    // Org-scoped write; count===0 ⇒ cross-org or missing id ⇒ 404.
    const { count } = await app.prisma.creativeJob.updateMany({
      where: { id: params.data.id, organizationId: orgId },
      data: { reviewDecision: decision, reviewDecidedAt: decision ? new Date() : null },
    });
    if (count === 0) return reply.code(404).send({ error: "Creative not found" });

    return reply.code(200).send({ id: params.data.id, decision });
  });
};
```

- [ ] **Step 4: Register the route** — in `apps/api/src/bootstrap/routes.ts`:

```ts
import { miraDecisionRoute } from "../routes/agent-home/mira-decision.js";
// …
// miraDecisionRoute: POST …/creatives/:id/decision — Keep/Pass (draft-only, no-cross-agent)
await app.register(miraDecisionRoute, { prefix: "/api/dashboard" });
```

- [ ] **Step 5: Run the test + route-class check + commit**

Run: `pnpm --filter @switchboard/api test -- mira-decision-route && pnpm test -- route-class-validator`
Expected: PASS.

```bash
git add apps/api/src/routes/agent-home/mira-decision.ts apps/api/src/routes/agent-home/__tests__/mira-decision-route.test.ts apps/api/src/bootstrap/routes.ts
git commit -m "feat(api): mira keep/pass review decision — draft-only, no-cross-agent"
```

---

### Task 22: Dashboard client + proxy + hook for the decision

**Files:**

- Modify: `apps/dashboard/src/lib/api-client/governance.ts`
- Create: `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/[id]/decision/route.ts`
- Create: `apps/dashboard/src/hooks/use-review-decision.ts`, `__tests__/use-review-decision.test.tsx`

- [ ] **Step 1: Add the client method**

In `governance.ts`:

```ts
  /** Mira Keep/Pass review decision (draft-only). `null` un-keeps. */
  async setCreativeReviewDecision(id: string, decision: "kept" | "passed" | null): Promise<{ id: string; decision: "kept" | "passed" | null }> {
    return this.request(`/api/dashboard/agents/mira/creatives/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
  }
```

- [ ] **Step 2: Add the proxy** — `apps/dashboard/src/app/api/dashboard/agents/mira/creatives/[id]/decision/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

const BodySchema = z.object({ decision: z.enum(["kept", "passed"]).nullable() });

function errorResponse(err: unknown) {
  const status = err instanceof Error && err.message === "Unauthorized" ? 401 : 500;
  return NextResponse.json(err instanceof Error ? { error: err.message } : { error: "unknown" }, {
    status,
  });
}

/** Proxy for Mira Keep/Pass review decision. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireDashboardSession();
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    const client = await getApiClient();
    const data = await client.setCreativeReviewDecision(params.id, parsed.data.decision);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Write the failing hook test** — `apps/dashboard/src/hooks/__tests__/use-review-decision.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useReviewDecision } from "../use-review-decision";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    miraFeed: { all: () => ["org", "miraFeed"], desk: () => ["org", "miraFeed", "desk"] },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useReviewDecision", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs the decision to the per-draft decision endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: "j1", decision: "kept" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReviewDecision(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "j1", decision: "kept" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/agents/mira/creatives/j1/decision");
  });
});
```

- [ ] **Step 4: Run it to verify it fails** → FAIL

- [ ] **Step 5: Implement the hook** — `apps/dashboard/src/hooks/use-review-decision.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "./use-query-keys";

type Decision = "kept" | "passed" | null;

/** Mira Keep/Pass (and un-keep) review decision. Invalidates the feed + desk. */
export function useReviewDecision() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: Decision }) => {
      const res = await fetch(
        `/api/dashboard/agents/mira/creatives/${encodeURIComponent(id)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!res.ok) throw new Error(`Review decision failed (HTTP ${res.status})`);
      return (await res.json()) as { id: string; decision: Decision };
    },
    onSuccess: () => {
      if (keys) void queryClient.invalidateQueries({ queryKey: keys.miraFeed.all() });
    },
  });
}
```

- [ ] **Step 6: Run the test + commit**

Run: `pnpm --filter @switchboard/dashboard test -- use-review-decision` → PASS

```bash
git add apps/dashboard/src/lib/api-client/governance.ts "apps/dashboard/src/app/api/dashboard/agents/mira/creatives/[id]/decision/route.ts" apps/dashboard/src/hooks/use-review-decision.ts apps/dashboard/src/hooks/__tests__/use-review-decision.test.tsx
git commit -m "feat(mira): dashboard client, proxy, and hook for keep/pass decision"
```

---

### Task 23: Keep / Pass buttons on `review_draft` clips

`draft_ready` clips currently render no actions (`MiraClipActions` returns `null` when `!canContinue && !canStop`). Add the binary Keep/Pass rail for `reviewAction.label === "review_draft"`. Keep is one-tap (low-stakes, reversible later); Pass is one-tap. On success → `onResolve(jobId)` dismisses locally (the server filter persists it).

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/mira/mira-clip-actions.tsx`
- Modify: `apps/dashboard/src/components/cockpit/mira/__tests__/mira-clip-actions.test.tsx` (add cases; mirror existing harness)

- [ ] **Step 1: Write the failing test** (append to the existing clip-actions test; mock `use-review-decision`):

```tsx
// at top of the file, alongside the existing mocks:
const decideMock = vi.fn().mockResolvedValue({ id: "j", decision: "kept" });
vi.mock("@/hooks/use-review-decision", () => ({
  useReviewDecision: () => ({ mutate: decideMock, isPending: false, isError: false }),
}));

describe("MiraClipActions — Keep/Pass on review_draft", () => {
  beforeEach(() => decideMock.mockClear());
  const reviewable = { canContinue: false, canStop: false, label: "review_draft" as const };

  it("renders Keep + Pass (not Continue/Stop) for a draft_ready clip", () => {
    render(<MiraClipActions jobId="j" reviewAction={reviewable} onResolve={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^keep/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pass/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
  });

  it("keeps the draft and resolves the clip", () => {
    const onResolve = vi.fn();
    render(<MiraClipActions jobId="j" reviewAction={reviewable} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /^keep/i }));
    expect(decideMock).toHaveBeenCalledWith({ id: "j", decision: "kept" }, expect.anything());
  });
});
```

- [ ] **Step 2: Run it to verify it fails** → FAIL (no Keep/Pass yet)

- [ ] **Step 3: Implement** — in `mira-clip-actions.tsx`, import the hook and add a `review_draft` branch BEFORE the final `if (!canContinue && !canStop) return null;`:

```tsx
import { useReviewDecision } from "@/hooks/use-review-decision";
// …inside MiraClipActions, after `const approve = useApproveStage();`:
const decide = useReviewDecision();

// …add this branch right BEFORE `if (!reviewAction.canContinue && !reviewAction.canStop) return null;`:
if (reviewAction.label === "review_draft") {
  const decideAndResolve = (decision: "kept" | "passed") =>
    decide.mutate({ id: jobId, decision }, { onSuccess: () => onResolve(jobId) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
      <button
        style={{ ...btn, background: "#3C315C" }}
        disabled={decide.isPending}
        onClick={() => decideAndResolve("kept")}
      >
        Keep
      </button>
      <button
        style={{ ...btn, background: "rgba(0,0,0,0.55)" }}
        disabled={decide.isPending}
        onClick={() => decideAndResolve("passed")}
      >
        Pass
      </button>
      {decide.isError && (
        <span style={{ color: "#fff", fontSize: 11 }}>Couldn&apos;t save — try again.</span>
      )}
    </div>
  );
}
```

> The payload `{ id, decision }` matches `useReviewDecision`'s `mutationFn` (Task 22) and the test assertion `{ id: "j", decision: "kept" }`.

- [ ] **Step 4: Run the test + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-clip-actions` → PASS

```bash
git add apps/dashboard/src/components/cockpit/mira/mira-clip-actions.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-clip-actions.test.tsx
git commit -m "feat(mira): keep/pass review gesture on draft_ready clips"
```

---

### Task 24: Kept-drafts shelf module (with un-keep; never a red chip)

The quietest module, bottom of the Desk. Reads `desk.keptDrafts`. Each item is read-mostly with a subtle **un-keep** (reversible). `handoff_unavailable` shows ONLY as the neutral sub-copy "Sending to Riley comes later." — **never** a red/blocked status chip.

**Files:**

- Modify: `apps/dashboard/src/lib/cockpit/mira/desk-copy.ts` (kept-shelf copy)
- Create: `apps/dashboard/src/components/cockpit/mira/mira-kept-shelf.tsx`, `__tests__/mira-kept-shelf.test.tsx`
- Modify: `apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx`

- [ ] **Step 1: Add the kept-shelf copy** — append to `desk-copy.ts`'s `DESK_COPY` object (do NOT make a second `DESK_COPY`; extend the existing one):

```ts
// inside the existing `export const DESK_COPY = { … } as const;` add:
  keptTitle: "Kept drafts",
  keptSub: "Drafts you kept. Sending to Riley comes later.",
  keptEmpty: "Drafts you keep will live here. Sending them to Riley comes later.",
```

- [ ] **Step 2: Write the failing test** — `__tests__/mira-kept-shelf.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MiraKeptShelf } from "../mira-kept-shelf";
import type { MiraDeskItem } from "@switchboard/core";

const unkeep = vi.fn();
vi.mock("@/hooks/use-review-decision", () => ({
  useReviewDecision: () => ({ mutate: unkeep, isPending: false }),
}));

const a = (id: string): MiraDeskItem => ({
  id,
  title: `Draft ${id}`,
  stage: "complete",
  state: "approved_draft",
  thumbnailUrl: `t-${id}`,
  updatedAt: "2026-05-26",
});

describe("MiraKeptShelf", () => {
  beforeEach(() => unkeep.mockClear());

  it("shows kept drafts with the neutral 'sending to Riley comes later' sub-copy — and NO red/blocked status chip", () => {
    render(<MiraKeptShelf items={[a("1"), a("2")]} />);
    expect(screen.getByText(/sending to riley comes later/i)).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(
      screen.queryByText(/unavailable|blocked|in use|winner|fatigued/i),
    ).not.toBeInTheDocument();
  });

  it("un-keeps an item (reversible)", () => {
    render(<MiraKeptShelf items={[a("1")]} />);
    fireEvent.click(screen.getByRole("button", { name: /un-?keep/i }));
    expect(unkeep).toHaveBeenCalledWith({ id: "1", decision: null }, expect.anything());
  });

  it("renders the empty state with no forbidden status words", () => {
    render(<MiraKeptShelf items={[]} />);
    expect(screen.getByText(/drafts you keep will live here/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails** → FAIL

- [ ] **Step 4: Implement** — `mira-kept-shelf.tsx`:

```tsx
"use client";

import type { MiraDeskItem } from "@switchboard/core";
import { useReviewDecision } from "@/hooks/use-review-decision";
import { DESK_COPY } from "@/lib/cockpit/mira/desk-copy";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";

// Quietest module. Read-mostly: each kept draft has a subtle un-keep (reversible).
// `handoff_unavailable` is conveyed ONLY by the neutral sub-copy — never a red chip.
export function MiraKeptShelf({ items }: { items: MiraDeskItem[] }) {
  const decide = useReviewDecision();
  return (
    <section
      aria-label={DESK_COPY.keptTitle}
      style={{
        background: "transparent",
        borderRadius: 14,
        padding: 16,
        border: `1px solid ${MIRA_ACCENT.soft}`,
      }}
    >
      <h2 style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600, color: "#666" }}>
        {DESK_COPY.keptTitle}
      </h2>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "#888" }}>{DESK_COPY.keptSub}</p>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#888" }}>{DESK_COPY.keptEmpty}</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            gap: 10,
            overflowX: "auto",
          }}
        >
          {items.map((it) => (
            <li key={it.id} style={{ flex: "0 0 auto", width: 96 }}>
              {it.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.thumbnailUrl}
                  alt={it.title}
                  width={96}
                  height={128}
                  style={{ borderRadius: 8, objectFit: "cover", background: MIRA_ACCENT.soft }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  style={{ width: 96, height: 128, borderRadius: 8, background: MIRA_ACCENT.soft }}
                />
              )}
              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 11,
                  color: "#444",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {it.title}
              </span>
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: it.id, decision: null })}
                style={{
                  marginTop: 2,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: MIRA_ACCENT.base,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Un-keep
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Mount the shelf at the bottom of the Desk** — in `mira-desk-page.tsx`, import it and render it as the LAST child inside the populated branch (replacing the `{/* PR4 mounts … */}` comment):

```tsx
import { MiraKeptShelf } from "./mira-kept-shelf";
// …after <MiraInProductionTray …>:
<MiraKeptShelf items={desk!.keptDrafts} />;
```

Update the populated `mira-desk-page.test.tsx` case to add `keptDrafts: []` to the mocked desk model, and mock `use-review-decision` (`useReviewDecision: () => ({ mutate: vi.fn(), isPending: false })`).

- [ ] **Step 6: Add the shelf to the copy-hygiene guard** — append to `SOURCES`:

```ts
  resolve(DASHBOARD_ROOT, "src/components/cockpit/mira/mira-kept-shelf.tsx"),
```

- [ ] **Step 7: Run the tests + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-kept-shelf mira-desk-page mira-copy-hygiene desk-copy` → PASS

```bash
git add apps/dashboard/src/lib/cockpit/mira/desk-copy.ts apps/dashboard/src/components/cockpit/mira/mira-kept-shelf.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-kept-shelf.test.tsx apps/dashboard/src/components/cockpit/mira/mira-desk-page.tsx apps/dashboard/src/components/cockpit/mira/__tests__/mira-desk-page.test.tsx apps/dashboard/src/components/cockpit/__tests__/mira-copy-hygiene.test.tsx
git commit -m "feat(mira): kept-drafts shelf — read-mostly, un-keep, neutral handoff sub-copy"
```

---

### Task 25: Phase-2 fixture-ban test + seed a kept draft

A CI tripwire that scans the Mira seed/fixtures for **forbidden states** and **banned words** (the seam can carry fixture data that the copy-hygiene DOM guard never sees). Then seed one kept draft so the shelf populates locally.

**Files:**

- Create: `apps/dashboard/src/components/cockpit/__tests__/mira-fixture-ban.test.ts`
- Modify: `packages/db/src/seed/seed-mira-demo-creatives.ts`

- [ ] **Step 1: Write the failing fixture-ban test** — `mira-fixture-ban.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Repo root from apps/dashboard/src/components/cockpit/__tests__/.
const ROOT = resolve(__dirname, "../../../../../../");
const SEEDS = [
  resolve(ROOT, "packages/db/src/seed/seed-mira-demo-creatives.ts"),
  resolve(ROOT, "packages/db/src/seed/seed-mira-pilot-orgs.ts"),
];

const FORBIDDEN_STATES = /\b(sent_to_riley|in_use|winner|fatigued|published)\b/;
// "learning" excluded from the WORD list here only where it is a banned UI word;
// in seeds we ban the capability words + the forbidden states.
const BANNED_WORDS = /\b(distribute|performance|fatigued|improved|drove|recovered)\b/i;

describe("Mira seeds — Phase-2 fixture ban", () => {
  for (const file of SEEDS) {
    it(`${file.split("/").pop()} contains no forbidden states`, () => {
      expect(readFileSync(file, "utf8")).not.toMatch(FORBIDDEN_STATES);
    });
    it(`${file.split("/").pop()} contains no banned capability words`, () => {
      expect(readFileSync(file, "utf8")).not.toMatch(BANNED_WORDS);
    });
  }
});
```

> Adjust the `ROOT` depth and the `SEEDS` list to the real seed files at execution time (the two Mira seeds confirmed present are `seed-mira-demo-creatives.ts` and `seed-mira-pilot-orgs.ts`). If a future seed adds Mira fixtures, add it here.

- [ ] **Step 2: Run it to verify it passes (or surfaces a real violation)**

Run: `pnpm --filter @switchboard/dashboard test -- mira-fixture-ban`
Expected: PASS (current seeds are clean) — or a FAIL that flags real fixture copy to fix (fix the seed, never weaken the regex).

- [ ] **Step 3: Seed one kept draft so the shelf renders locally**

In `packages/db/src/seed/seed-mira-demo-creatives.ts`, add a third draft to the `drafts` array that is completed AND kept (so it leaves the feed and lands on the shelf). It must reuse the same fixed-id idempotency pattern and carry `reviewDecision: "kept"`, `reviewDecidedAt: new Date()`, and a `currentStage: "complete"` polished payload with an assembled video + thumbnail (so `deriveDraft` yields a thumbnail). Mirror the existing polished draft's `stageOutputs.production.assembledVideos[0]` shape; set `id: "dev_mira_demo_kept"`, `taskId: "dev_mira_demo_task_kept"`. The seed uses `prisma.creativeJob.upsert` with separate `create`/`update` payloads — add `reviewDecision: "kept"` + `reviewDecidedAt` to **both** branches, or a re-seed won't flip an already-present row. Keep all copy free of banned words ([[feedback_fixtures_as_product_copy]]).

- [ ] **Step 4: Run the fixture-ban test again + commit**

Run: `pnpm --filter @switchboard/dashboard test -- mira-fixture-ban`
Expected: PASS (the kept fixture uses "kept", which is allowed).

```bash
git add apps/dashboard/src/components/cockpit/__tests__/mira-fixture-ban.test.ts packages/db/src/seed/seed-mira-demo-creatives.ts
git commit -m "test(mira): phase-2 fixture-ban guard + seed a kept demo draft"
```

---

### Task 26 (PR4 close-out): full suites, build, typecheck, drift

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/db test
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build     # not in CI ([[feedback_dashboard_build_not_in_ci]])
pnpm typecheck
pnpm db:check-drift                              # requires Postgres; CI-validated otherwise
pnpm format:check
```

Expected: all PASS. If `typecheck` complains about cross-package exports (e.g. `keptDrafts` on `MiraDeskModel`, `reviewDecision` on the summary), `pnpm reset` then retry ([[feedback_reset_vs_build_and_chat_flake]]). The `db` store tests use mocked Prisma — ensure the decision mutation's `updateMany` is reflected if any store spy asserts call shapes ([[feedback_store_tightening_gate_needs_app_tests]]).

- [ ] **Step 2: Commit any format fixes**

```bash
git add -A && git commit -m "chore(mira): pr4 formatting" --allow-empty
```

**PR4 is now shippable** as `feat(mira): keep/pass + kept-drafts shelf (phase 2 PR4)`.

---

## Local acceptance (needs Postgres + seeds)

The Desk reads the same seam as the M1 feed; demo content comes from seeds, not a demo toggle.

- [ ] **Step 1: Bring up the stack** ([[feedback_dev_stack]]): API on :3000 with builds + seed encryption; dashboard on :3002.

- [ ] **Step 2: Seed an enabled org with a creative deployment + demo creatives**

```bash
pnpm db:migrate   # applies the review-decision migration
pnpm db:seed      # enables Mira + seeds demo creatives incl. the kept draft
```

The brief mutation resolves a **deployment `skillSlug:"creative"`** fail-closed (this is the deployment skill slug — NOT Mira's agent `role`, which also happens to be `"creative"`; they are different axes). So the pilot org needs a `skillSlug:"creative"` deployment (listing status `"listed"`) or `/mira/brief` returns `creative_deployment_not_provisioned` (409). If the dedicated creative-deployment seed is absent, ensure one exists for the pilot org (see [[project_alex_live_integration_fixes]] / [[reference_governance_trust_path]]). For the desk buckets to all populate, the pilot org needs at least one `in_progress`, one `failed`, one `draft_ready`, and one kept job.

- [ ] **Step 3: Verify in the browser** ([[reference_dashboard_visual_verification]]):
  - `/mira` renders the **Desk** — four modules in order: brief box, the one hero Ready-to-review CTA, the calm in-production tray, the kept-drafts shelf. NOT the black feed.
  - "Ready to review" → links out to `/mira/review`; the feed shows; the "← Mira" chip returns to the Desk. No inline expand on the Desk.
  - Brief box: type a promoting line (or tap an example chip) → pick Goal/Vibe → **Preview** → Intent-Preview readback → **Make the draft** → acknowledgement; a new draft appears in the tray within ~30s (planning stage), then becomes reviewable. **The mutation must not fire before [Make the draft].**
  - Brief box off-scope: type "When can I rebook my 3pm?" → **Preview** → the redirect copy shows; no [Make the draft]; nothing submitted.
  - Review feed: a `draft_ready` clip shows **Keep** + **Pass**. Keep → the clip leaves the feed AND appears on the Desk shelf; Pass → the clip leaves the feed and is NOT on the shelf. Un-keep on the shelf → the clip returns to the feed.
  - The shelf shows the neutral "Sending to Riley comes later." sub-copy — no red/blocked chip anywhere.
  - An org **without** the creative deployment: the brief submit surfaces the 409 ("Couldn't start the draft").
  - A disabled org: `/mira` and `/mira/review` both 404 (unchanged gate). `/mira/creatives/[id]` deep link still resolves for an enabled org.
  - Scan the rendered DOM for the forbidden words — none present.

- [ ] **Step 4: Update memory** — once merged, update [[project_mira_m1_launch]] (Desk shipped; `/mira` = Desk, feed = `/mira/review`; `createCreativeDraftRequest` live; Keep/Pass + kept shelf) and resolve the [[trigger_restart_mira_desk]] / [[trigger_restart]] notes.

---

## Self-Review (run against the spec)

**1. Spec coverage**

| Spec Phase-2 requirement                                                             | Task(s)                                         |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `/mira` → Director's Desk                                                            | 2, 3                                            |
| Feed → `/mira/review` (+ backward-compatible landing; per-draft deep link unchanged) | 1, 4                                            |
| Four-module Desk IA, one hero, enter-and-exit feed, no chat                          | 11 (hero), 12 (compose), 17 (brief), 24 (shelf) |
| Open brief box (governed `createCreativeDraftRequest`)                               | 14, 15, 16, 17                                  |
| Hybrid brief + Goal/Vibe chips + example chips + Intent Preview                      | 14, 17                                          |
| Intent Preview = cost-confirm (mutation never fires before [Make the draft])         | 17 (HARD-rule test)                             |
| Off-scope redirect (never answers scheduling/results)                                | 14 (`classifyBriefIntent`), 17                  |
| Ready-to-review hero CTA into the feed                                               | 11, 12                                          |
| In-production tray (plain status; problem-on-error)                                  | 6, 9, 10                                        |
| Recently-approved/kept shelf — Option B (explicit Keep), honest, reversible          | 19, 20, 21, 23, 24                              |
| Inbox-zero (Keep/Pass removes from feed)                                             | 20 (`isReviewable`), 21, 23                     |
| Keep firewalled from Riley; no publish                                               | 21 (no-cross-agent test), 24 (no red chip)      |
| Desk-item state contract (allowed/forbidden)                                         | 6 (+ DOM scan in 12)                            |
| Copy guardrails (banned words)                                                       | 9, 12, 17, 24                                   |
| Phase-2 fixture ban (forbidden states + banned words in seeds)                       | 25                                              |
| `createCreativeDraftRequest` contract (captures/returns/guarantees)                  | 15                                              |
| `createCreativeDraftRequest` no-cross-agent                                          | 15 (test)                                       |
| Route-migration tests                                                                | 1, 4, 7, 15                                     |
| Fail-closed when no creative deployment                                              | 15                                              |
| Idempotency (submission may retry)                                                   | 15 (replay test), 16                            |
| Enablement gate inherited by Desk + endpoints                                        | 3, 7, 15, 21                                    |
| Spec edit: soften Phase-3 proposal examples to directional language                  | spec change (see below)                         |
| No autonomous proposals / no publish path                                            | out of scope by construction — none added       |

**2. Placeholder scan:** every code step contains full code; every command has expected output; no TODO/TBD/"add error handling" placeholders. Test-harness wiring that depends on the live `buildTestServer` shape (Tasks 7, 15, 21) is described precisely with the required assertions, since those harness internals are codebase-specific. ✅

**3. Type consistency:** `MiraDeskModel`/`MiraDeskItem`/`MiraDeskItemState`/`MiraDeskSeamState`/`MiraDeskProblemCode`/`deriveDeskItemState`/`buildMiraDeskModel` (core) — note `MiraDeskModel` gains `keptDrafts` in PR4 (Task 20), and every consumer (`use-mira-desk`, `mira-desk-page`, `mira-kept-shelf`) is updated in the same PR. `MiraBriefRequest`/`MiraBriefGoal`/`MiraBriefVibe`/`MiraBriefResult`/`mapMiraBriefToCreativeBrief`/`classifyBriefIntent` (schemas) used identically in Tasks 14–17. `createCreativeDraftRequest(brief, idempotencyKey)` matches between client and proxy (16). `setCreativeReviewDecision(id, decision)` / `useReviewDecision({ id, decision })` consistent across Tasks 21–24. `reviewDecision` ("kept"|"passed"|null) is identical across schema (19), seam (20), route (21), hook (22). ✅

**4. Known interpretations to flag in PR descriptions:**

- The shelf is **Keep-backed, not status-backed** (Decision 2): `shipped` is never emitted, so `approved_draft` is produced by the Keep gesture (PR4), not by status. `deriveDeskItemState` maps `shipped` defensively only.
- Keep/Pass rides a small dedicated decision endpoint (analogous to Continue/Stop's `/approve`), NOT `PlatformIngress` — it is creative-only review triage, firewalled from the Phase-4 Riley handoff (which IS the governed `PlatformIngress`/`WorkTrace` path).
- Only `quality_failed` problem code is emitted in v1; the other three are reserved (Task 6).
- `expectedDraftCount: 1` is a conservative v1 estimate (true count unknown until the scripts stage).
- Kept-shelf window: kept drafts older than `FEED_WINDOW` (200) aren't shown — acceptable at M1 pilot scale (documented in Task 20).

**5. Spec edit (per decided direction):** soften the Phase-3 proposal examples in `docs/superpowers/specs/2026-05-29-mira-creative-operating-desk-design.md` to directional language (e.g. "recent signals suggest…" rather than "hooks are fatiguing/outperforming"), consistent with the spec's own Phase-3 constraint that proposals stay on coarse account-level signals. The shelf copy in the spec ("Drafts you liked.") is aligned to the Keep mental model ("Drafts you kept."). Both edits are made on this branch alongside the plan.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-30-mira-creative-operating-desk-phase-2.md`.**

Per branch doctrine, the spec + this plan land on `main` together as **one focused docs PR** from `docs/mira-creative-operating-desk` **before** implementation begins; the four implementation PRs then consume the spec from `main`.

Two execution options for the implementation PRs:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
2. **Inline Execution** — execute tasks in this session with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

Which approach?
