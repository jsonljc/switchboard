# PR 2: Spacing + Typography — UX Polish Pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all existing dashboard and onboarding components to approved spec for spacing, typography, content logic, and text. No functional behavior changes — visual fidelity only.

**Architecture:** Pure frontend edits. Each task modifies one or two component files with targeted spacing/typography/content fixes. No new files, no API changes, no new dependencies.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-04-21-login-redesign-delta-plan-design.md` — items L3, L4, L6, L8, L9, T1–T7
**Depends on:** PR 1 (Foundation) must be merged first

---

### Task 1: Fix PlaybookPanel section gaps — 16px → 48px (L3)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/playbook-panel.tsx`

- [ ] **Step 1: Read the current PlaybookPanel**

Read `apps/dashboard/src/components/onboarding/playbook-panel.tsx` fully to find the `space-y-4` class that controls section gaps.

- [ ] **Step 2: Change section gap from space-y-4 to space-y-12**

Find the container div that wraps the `PlaybookSection` components. It will have a `space-y-4` class (16px gaps). Change it to `space-y-12` (48px gaps).

Find and replace `space-y-4` with `space-y-12` on the sections container. This should be the div wrapping all the `<PlaybookSection>` components, not any inner content.

- [ ] **Step 3: Verify visually**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard dev`
Navigate to `/onboarding`, advance to step 2 (Training). Confirm playbook sections have generous 48px gaps between them.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/onboarding/playbook-panel.tsx && git commit -m "$(cat <<'EOF'
fix(onboarding): increase playbook section gaps from 16px to 48px

Matches approved onboarding spec: 48px minimum between sections
for the spacious, document-like feel.
EOF
)"
```

---

### Task 2: Fix PlaybookSection content padding — 20px → 24px (L4)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/playbook-section.tsx`
- Modify: `apps/dashboard/src/components/onboarding/__tests__/playbook-section.test.tsx`

- [ ] **Step 1: Change px-5 to px-6 in PlaybookSection**

In `apps/dashboard/src/components/onboarding/playbook-section.tsx`, line 50:

Change the header button padding:

```typescript
className =
  "flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-[var(--sw-surface)]";
```

to:

```typescript
className =
  "flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-[var(--sw-surface)]";
```

Change the content area padding on line 65:

```typescript
      {!collapsed && <div className="px-5 pb-5">{children}</div>}
```

to:

```typescript
      {!collapsed && <div className="px-6 pb-6">{children}</div>}
```

- [ ] **Step 2: (Optional — P3 polish, include only if already touching file) Swap status dot/label order (T7)**

In the same file, the status indicator currently renders label text first, then dot. Swap to dot-first. Skip this step if it distracts from higher-priority work:

Change:

```typescript
        <span className="flex items-center gap-2">
          <span className="text-[14px]" style={{ color: config.dotColor }}>
            {config.label}
          </span>
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: config.dotColor }}
          />
        </span>
```

to:

```typescript
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: config.dotColor }}
          />
          <span className="text-[14px]" style={{ color: config.dotColor }}>
            {config.label}
          </span>
        </span>
```

- [ ] **Step 3: Update test if it checks element order**

Read `apps/dashboard/src/components/onboarding/__tests__/playbook-section.test.tsx` — if any test relies on the label appearing before the dot, update accordingly.

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run src/components/onboarding/__tests__/playbook-section.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/onboarding/playbook-section.tsx apps/dashboard/src/components/onboarding/__tests__/playbook-section.test.tsx && git commit -m "$(cat <<'EOF'
fix(onboarding): increase PlaybookSection padding to 24px, swap dot/label order

Content padding 20px → 24px per spec. Status indicator now shows
dot before label text for visual consistency.
EOF
)"
```

---

### Task 3: Fix ApprovalScenario option gaps — 8px → 16px (L6)

**Files:**

- Modify: `apps/dashboard/src/components/onboarding/approval-scenario.tsx`

- [ ] **Step 1: Change space-y-2 to space-y-4**

In `apps/dashboard/src/components/onboarding/approval-scenario.tsx`, line 33:

Change:

```typescript
      <div className="space-y-2">
```

to:

```typescript
      <div className="space-y-4">
```

- [ ] **Step 2: Add hover border state**

On the button element (line 42), add a hover class for the border. Change:

```typescript
className =
  "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all duration-200";
```

to:

```typescript
className =
  "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all duration-200 hover:border-[var(--sw-border-strong)]";
```

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run src/components/onboarding/__tests__/approval-scenario.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/onboarding/approval-scenario.tsx && git commit -m "$(cat <<'EOF'
fix(onboarding): increase approval option gaps to 16px, add hover border

Matches approved spec: 16px minimum between interactive elements,
hover shows --sw-border-strong.
EOF
)"
```

---

### Task 4: Add BookingPreview 5-row limit (L8)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/booking-preview.tsx`

- [ ] **Step 1: Add slice and overflow link**

In `apps/dashboard/src/components/dashboard/booking-preview.tsx`, change the bookings rendering block. Replace:

```typescript
          bookings.map((b, i) => (
            <div
              key={b.id}
              style={
                i < bookings.length - 1 ? { borderBottom: "1px solid var(--sw-border)" } : undefined
              }
            >
              <BookingRow
                time={formatTime(b.startsAt)}
                service={b.service}
                contact={b.contactName}
                status={classifyStatus(b)}
              />
            </div>
          ))
```

with:

```typescript
          bookings.slice(0, 5).map((b, i) => (
            <div
              key={b.id}
              style={
                i < Math.min(bookings.length, 5) - 1
                  ? { borderBottom: "1px solid var(--sw-border)" }
                  : undefined
              }
            >
              <BookingRow
                time={formatTime(b.startsAt)}
                service={b.service}
                contact={b.contactName}
                status={classifyStatus(b)}
              />
            </div>
          ))
```

- [ ] **Step 2: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/booking-preview.tsx && git commit -m "$(cat <<'EOF'
fix(dashboard): limit BookingPreview to 5 rows

Matches approved spec: show up to 5 booking rows.
EOF
)"
```

---

### Task 5: Add OwnerTaskList 5-task limit + "View all" (L9)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/owner-task-list.tsx`

- [ ] **Step 1: Add limit and link**

In `apps/dashboard/src/components/dashboard/owner-task-list.tsx`, add an import for `Link`:

```typescript
import Link from "next/link";
```

Change the task rendering to slice to 5 and add overflow link. Replace:

```typescript
        {tasks.map((task, i) => (
          <div
            key={task.id}
            style={
              i < tasks.length - 1 ? { borderBottom: "1px solid var(--sw-border)" } : undefined
            }
          >
            <OwnerTaskRow
              id={task.id}
              title={task.title}
              dueAt={task.dueAt}
              isOverdue={task.isOverdue}
              onComplete={onComplete}
            />
          </div>
        ))}
```

with:

```typescript
        {tasks.slice(0, 5).map((task, i) => (
          <div
            key={task.id}
            style={
              i < Math.min(tasks.length, 5) - 1
                ? { borderBottom: "1px solid var(--sw-border)" }
                : undefined
            }
          >
            <OwnerTaskRow
              id={task.id}
              title={task.title}
              dueAt={task.dueAt}
              isOverdue={task.isOverdue}
              onComplete={onComplete}
            />
          </div>
        ))}
      </div>
      {tasks.length > 5 && (
        <Link
          href="/tasks"
          style={{
            display: "inline-block",
            marginTop: "12px",
            fontSize: "14px",
            color: "var(--sw-accent)",
            textDecoration: "none",
          }}
        >
          View all {tasks.length} →
        </Link>
      )}
```

Note: The closing `</div>` for the card container moves up before the Link. Ensure the final structure is: `<SectionLabel>` → card container `<div>` with tasks `</div>` → optional Link → closing wrapper `</div>`.

- [ ] **Step 2: Verify build**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/owner-task-list.tsx && git commit -m "$(cat <<'EOF'
fix(dashboard): limit OwnerTaskList to 5 tasks with View all link

Shows up to 5 tasks. When more exist, shows "View all N →" link
pointing to /tasks.
EOF
)"
```

---

### Task 6: Fix DashboardHeader summary priority + fallback (T1, T2)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/dashboard-header.tsx`

- [ ] **Step 1: Update buildSummary to include escalations and vary fallback**

In `apps/dashboard/src/components/dashboard/dashboard-header.tsx`, replace the `buildSummary` function:

```typescript
function buildSummary(stats: DashboardOverview["stats"]): string {
  const signals: SignalEntry[] = [
    { count: stats.pendingApprovals, label: "approval" },
    { count: stats.bookingsToday, label: "booking" },
    { count: stats.newInquiriesToday, label: "new inquiry" },
    { count: stats.overdueTasks, label: "overdue task" },
  ];

  const active = signals
    .filter((s) => s.count > 0)
    .slice(0, 3)
    .map((s) => `${s.count} ${s.label}${s.count !== 1 ? "s" : ""}`)
    .join(" · ");

  return active || "All clear this morning.";
}
```

with:

```typescript
function buildSummary(
  stats: DashboardOverview["stats"],
  period: "morning" | "afternoon" | "evening",
): string {
  const escalations = (stats as Record<string, number>).activeEscalations ?? 0;
  const signals: SignalEntry[] = [
    { count: stats.pendingApprovals, label: "approval" },
    { count: escalations, label: "escalation" },
    { count: stats.bookingsToday, label: "booking" },
    { count: stats.newInquiriesToday, label: "new inquiry" },
    { count: stats.overdueTasks, label: "overdue task" },
  ];

  const active = signals
    .filter((s) => s.count > 0)
    .slice(0, 3)
    .map((s) => `${s.count} ${s.label}${s.count !== 1 ? "s" : ""}`)
    .join(" · ");

  return active || `All clear this ${period}.`;
}
```

Update the call site in the component to pass `period`:

Change:

```typescript
{
  buildSummary(overview.stats);
}
```

to:

```typescript
{
  buildSummary(overview.stats, overview.greeting.period);
}
```

- [ ] **Step 2: Run dashboard tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/dashboard-header.tsx && git commit -m "$(cat <<'EOF'
fix(dashboard): add escalations to summary priority, vary fallback by time

Summary now follows approved priority: approvals → escalations →
bookings → inquiries → overdue tasks. "All clear" message varies
by time of day.
EOF
)"
```

---

### Task 7: Fix error state greeting font size — 28px → 24px (T3)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/owner-today.tsx`

- [ ] **Step 1: Fix font size in error state**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`, in the `isError` block, change:

```typescript
            fontSize: "28px",
```

to:

```typescript
            fontSize: "24px",
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/dashboard/owner-today.tsx && git commit -m "$(cat <<'EOF'
fix(dashboard): error state greeting font size 28px → 24px

Matches normal greeting size per approved spec.
EOF
)"
```

---

### Task 8: Fix "All caught up" text size — 15px → 16px (T4)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/owner-today.tsx`

- [ ] **Step 1: Fix font size in empty approvals state**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`, in the empty approvals block, change:

```typescript
            <p style={{ fontSize: "15px", color: "var(--sw-text-secondary)", margin: 0 }}>
```

to:

```typescript
            <p style={{ fontSize: "16px", color: "var(--sw-text-secondary)", margin: 0 }}>
```

Keep the checkmark icon — the approved spec retains it.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/dashboard/owner-today.tsx && git commit -m "$(cat <<'EOF'
fix(dashboard): empty approvals text size 15px → 16px
EOF
)"
```

---

### Task 9: Fix BookingRow — remove display font, change "Done" to "Completed" (T5, T6)

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/booking-row.tsx`

- [ ] **Step 1: Remove fontFamily from time span**

In `apps/dashboard/src/components/dashboard/booking-row.tsx`, change:

```typescript
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "16px",
          fontWeight: 600,
          color: "var(--sw-text-primary)",
          minWidth: "72px",
        }}
      >
```

to:

```typescript
      <span
        style={{
          fontSize: "16px",
          fontWeight: 600,
          color: "var(--sw-text-primary)",
          minWidth: "72px",
        }}
      >
```

- [ ] **Step 2: Change "Done" to "Completed"**

In the same file, change:

```typescript
const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  completed: "Done",
};
```

to:

```typescript
const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  completed: "Completed",
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/dashboard/booking-row.tsx && git commit -m "$(cat <<'EOF'
fix(dashboard): BookingRow uses Inter for time, status label "Completed"

Time field no longer uses display font (spec says Inter 16px semibold).
Completed booking status label changed from "Done" to "Completed".
EOF
)"
```

---

### Task 10: Verify font-display (T8 — verify only)

**Files:**

- Read only: `apps/dashboard/src/app/layout.tsx`

This is a verify-only task. Do not change the font.

- [ ] **Step 1: Check which font --font-display resolves to**

In `apps/dashboard/src/app/layout.tsx`, check the Google Fonts import. The root layout loads DM Sans as `--font-display`. The approved specs reference "Instrument Sans" throughout.

In `apps/dashboard/src/app/globals.css`, line 76:

```css
--font-display: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
```

This already says Instrument Sans. But the root layout may load DM Sans via Google Fonts. Check the layout file to see which font is actually loaded.

- [ ] **Step 2: Document the finding**

If the layout loads DM Sans but the CSS variable says Instrument Sans, the browser will fall back to `ui-sans-serif` since Instrument Sans isn't loaded. This means the display font has been broken/falling back silently.

**Action:** Record the finding but do not change fonts in this PR. A font swap is cross-cutting and high-risk. File it as a separate task.

- [ ] **Step 3: No commit needed**

This is a verification task only.

---

### Task 11: Run full test suite and typecheck

- [ ] **Step 1: Typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 2: Run all dashboard tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test -- --run`
Expected: All tests PASS

- [ ] **Step 3: Lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS

- [ ] **Step 4: Build**

Run: `npx pnpm@9.15.4 build`
Expected: Full monorepo build PASS
