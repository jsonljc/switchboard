# Pre-Launch Hardening — Track 1 Phase B: Route & Navigation Coherence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every nav item resolves to a coherent destination. No orphaned pages. No duplicate surfaces. No dead links.

**Architecture:** 8 changes across dashboard pages, components, and routes. The Hire tab gets an auth marketplace page. Public `/marketplace` redirects to `/agents`. Tasks fold into Decide as a third tab. Orphaned pages get nav links. Dead anchors and duplicate settings surfaces are cleaned up.

**Tech Stack:** Next.js 14 (App Router), React, TanStack React Query, Tailwind CSS, shadcn/ui

---

### Task 1: Create auth marketplace page for Hire tab

**Files:**

- Create: `apps/dashboard/src/app/(auth)/marketplace/page.tsx`

The Hire tab points to `/marketplace` which currently resolves to the public layout. We need an auth-gated marketplace browse page.

- [ ] **Step 1: Create the auth marketplace page**

Create `apps/dashboard/src/app/(auth)/marketplace/page.tsx`:

```typescript
"use client";

import { PublicMarketplaceBrowse } from "@/components/marketplace/public-marketplace-browse";

export default function MarketplacePage() {
  return <PublicMarketplaceBrowse />;
}
```

Note: This reuses the existing `PublicMarketplaceBrowse` component which already has category filtering and listing cards. It renders inside the auth layout (with OwnerTabs bottom nav) because it's under `(auth)/`.

- [ ] **Step 2: Verify the Hire tab now renders inside auth layout**

The `owner-tabs.tsx` already points to `/marketplace` (line 11). With this new page under `(auth)/`, authenticated users will match this route instead of the `(public)/` one. Verify by checking that Next.js route resolution prioritizes `(auth)/marketplace/page.tsx` for authenticated users.

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build 2>&1 | tail -20`
Expected: Build succeeds, no route conflicts

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/marketplace/page.tsx && git commit -m "$(cat <<'EOF'
feat: add auth marketplace page for Hire tab
EOF
)"
```

---

### Task 2: Redirect public /marketplace to /agents

**Files:**

- Modify: `apps/dashboard/src/app/(public)/marketplace/page.tsx` (replace with redirect)

- [ ] **Step 1: Replace public marketplace with redirect**

Replace the contents of `apps/dashboard/src/app/(public)/marketplace/page.tsx`:

```typescript
import { redirect } from "next/navigation";

export default function PublicMarketplacePage() {
  redirect("/agents");
}
```

- [ ] **Step 2: Remove unused metadata export if present**

The current file has a `metadata` export. Since we're redirecting, remove it — redirects don't render, so metadata is pointless.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(public\)/marketplace/page.tsx && git commit -m "$(cat <<'EOF'
fix: redirect public /marketplace to /agents (canonical catalog)
EOF
)"
```

---

### Task 3: Fold /tasks into Decide as a third tab

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/decide/page.tsx` (add Tasks tab)
- Modify: `apps/dashboard/src/app/(auth)/tasks/page.tsx` (replace with redirect)

This is the most complex task in Phase B. The Decide page currently has 2 tabs (Pending, History). We add a third tab (Tasks) that contains the task review UI from the standalone tasks page.

- [ ] **Step 1: Read the current Decide page and Tasks page**

Read both files to understand the exact code that needs to merge:

- `apps/dashboard/src/app/(auth)/decide/page.tsx` — 280 lines, 2 tabs
- `apps/dashboard/src/app/(auth)/tasks/page.tsx` — 145 lines, task review UI

- [ ] **Step 2: Add task imports and state to Decide page**

At the top of `apps/dashboard/src/app/(auth)/decide/page.tsx`, add imports from the tasks page:

```typescript
import { TaskCard } from "@/components/tasks/task-card";
import { CreativeTaskCard } from "@/components/tasks/creative-task-card";
import { TaskReviewDialog } from "@/components/tasks/task-review-dialog";
```

Also add to the existing marketplace hook import:

```typescript
import { useTasks, useReviewTask } from "@/hooks/use-marketplace";
```

And add the MarketplaceTask type:

```typescript
import type { MarketplaceTask } from "@/lib/api-client";
```

- [ ] **Step 3: Add Tasks tab state and data fetching**

In the component body, add alongside existing hooks:

```typescript
const { data: taskData } = useTasks({ status: "awaiting_review" });
const { data: allTaskData } = useTasks();
const reviewTask = useReviewTask();
const [selectedTask, setSelectedTask] = useState<MarketplaceTask | null>(null);
```

Expand the tab type from `"pending" | "history"` to `"pending" | "history" | "tasks"`.

- [ ] **Step 4: Add Tasks tab trigger to the tab strip**

In the tab strip section (around line 194-196), add a third tab trigger after History:

```tsx
<button
  onClick={() => setTab("tasks")}
  className={`pb-2 text-sm font-medium transition-colors ${
    tab === "tasks"
      ? "text-foreground border-b-2 border-foreground"
      : "text-muted-foreground hover:text-foreground"
  }`}
>
  Tasks
  {taskData?.tasks &&
    taskData.tasks.filter((t) => t.status === "awaiting_review" && t.output).length > 0 && (
      <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {taskData.tasks.filter((t) => t.status === "awaiting_review" && t.output).length}
      </span>
    )}
</button>
```

- [ ] **Step 5: Add Tasks tab content**

Add a new tab content section alongside the existing Pending and History content. This renders the task cards with review dialog, matching the standalone tasks page pattern:

```tsx
{
  tab === "tasks" && (
    <div className="space-y-3">
      {(() => {
        const tasks = allTaskData?.tasks ?? [];
        const reviewable = tasks.filter((t) => t.status === "awaiting_review" && t.output);
        const display = reviewable.length > 0 ? reviewable : tasks;

        if (display.length === 0) {
          return <p className="text-sm text-muted-foreground py-8 text-center">No tasks yet.</p>;
        }

        return display.map((task) =>
          task.category === "creative_strategy" ? (
            <CreativeTaskCard key={task.id} task={task} onReview={() => setSelectedTask(task)} />
          ) : (
            <TaskCard key={task.id} task={task} onReview={() => setSelectedTask(task)} />
          ),
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 6: Add TaskReviewDialog**

Add the review dialog at the end of the component, before the closing fragment/div:

```tsx
{
  selectedTask && (
    <TaskReviewDialog
      task={selectedTask}
      open={!!selectedTask}
      onClose={() => setSelectedTask(null)}
      onSubmit={async (result, reviewResult) => {
        await reviewTask.mutateAsync({
          taskId: selectedTask.id,
          result,
          reviewResult,
        });
        setSelectedTask(null);
      }}
    />
  );
}
```

- [ ] **Step 7: Replace standalone /tasks with redirect**

Replace `apps/dashboard/src/app/(auth)/tasks/page.tsx`:

```typescript
import { redirect } from "next/navigation";

export default function TasksPage() {
  redirect("/decide");
}
```

- [ ] **Step 8: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck 2>&1 | grep -i error | head -20`
Expected: No new errors from our changes

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/decide/page.tsx apps/dashboard/src/app/\(auth\)/tasks/page.tsx && git commit -m "$(cat <<'EOF'
feat: fold /tasks into Decide as third tab, redirect old route
EOF
)"
```

---

### Task 4: Link /my-agent and /dashboard/roi from Today dashboard

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/owner-today.tsx` (add links)
- Modify: `apps/dashboard/src/components/dashboard/revenue-summary.tsx` (add ROI link)

- [ ] **Step 1: Read the current owner-today.tsx**

Read `apps/dashboard/src/components/dashboard/owner-today.tsx` to find:

- Where RevenueSummary is rendered (around line 332)
- Where to add a "Manage your agent" link (near header or assistant status)

- [ ] **Step 2: Add "Manage agent" link to the dashboard header area**

In `owner-today.tsx`, add a link to `/my-agent` near the greeting/header section. Find the header area and add:

```tsx
<Link
  href="/my-agent"
  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
>
  Manage agent →
</Link>
```

Place it in the dashboard header alongside or below the greeting. The exact placement depends on the current layout — read the file first.

- [ ] **Step 3: Add "See details" link to RevenueSummary**

In `apps/dashboard/src/components/dashboard/revenue-summary.tsx`, add a link to `/dashboard/roi`. Add `Link` import from `next/link` and add a link after the section label:

```tsx
import Link from "next/link";

// In the component, near the "Revenue (7d)" label:
<Link
  href="/dashboard/roi"
  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
>
  See details →
</Link>;
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/dashboard/owner-today.tsx apps/dashboard/src/components/dashboard/revenue-summary.tsx && git commit -m "$(cat <<'EOF'
feat: add /my-agent and /dashboard/roi links to Today dashboard
EOF
)"
```

---

### Task 5: Add Playbook to Me page settings list

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/me/page.tsx` (add link at lines 96-102)

- [ ] **Step 1: Add Playbook link**

In `apps/dashboard/src/app/(auth)/me/page.tsx`, find the settings links array (lines 96-102). Add Playbook as the first item:

```typescript
const settings = [
  { href: "/settings/playbook", label: "Playbook" },
  { href: "/settings/channels", label: "Channels" },
  { href: "/settings/knowledge", label: "Knowledge" },
  { href: "/settings/identity", label: "Identity" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/account", label: "Account" },
];
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/me/page.tsx && git commit -m "$(cat <<'EOF'
fix: add Playbook to Me page settings list
EOF
)"
```

---

### Task 6: Remove Connections tab from Account page

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/settings/account/page.tsx` (remove tab + imports)

The Channels page (`/settings/channels`) already renders both `ConnectionsList` and `ChannelManagement`. The Account page duplicates this in a Connections tab.

- [ ] **Step 1: Read the current Account page**

Read `apps/dashboard/src/app/(auth)/settings/account/page.tsx` to find:

- The imports for `ConnectionsList` and `ChannelManagement`
- The "connections" tab trigger
- The "connections" tab content

- [ ] **Step 2: Remove Connections tab**

1. Remove the imports for `ConnectionsList` and `ChannelManagement`
2. Remove the `<TabsTrigger value="connections">Connections</TabsTrigger>` from the tab list
3. Remove the entire `<TabsContent value="connections">` block

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck 2>&1 | grep -i error | head -10`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/settings/account/page.tsx && git commit -m "$(cat <<'EOF'
fix: remove duplicate Connections tab from Account (Channels is canonical)
EOF
)"
```

---

### Task 7: Fix #test-lead dead anchor in first-run banner

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/first-run-banner.tsx` (line 11)

- [ ] **Step 1: Fix the dead anchor**

In `apps/dashboard/src/components/dashboard/first-run-banner.tsx`, line 11 has:

```typescript
{ title: "Send a test lead", href: "#test-lead" }
```

Replace with a link to `/my-agent` which is the real test surface (it has the test chat widget):

```typescript
{ title: "Send a test lead", href: "/my-agent" }
```

This resolves to the user's actual deployment via the `/my-agent/page.tsx` redirect logic.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/dashboard/first-run-banner.tsx && git commit -m "$(cat <<'EOF'
fix: replace #test-lead dead anchor with /my-agent link
EOF
)"
```

---

### Task 8: Phase B Regression Check

**Files:** None — verification only

- [ ] **Step 1: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: No new errors

- [ ] **Step 2: Run tests**

Run: `npx pnpm@9.15.4 test`
Expected: All tests pass

- [ ] **Step 3: Verify nav destinations**

Check each tab destination resolves:

- Today → `/dashboard` (unchanged)
- Hire → `/marketplace` → auth marketplace page (new)
- Decide → `/decide` → includes Tasks tab (new)
- Me → `/me` → includes Playbook link (new)

- [ ] **Step 4: Verify redirects**

Check redirects work:

- `/marketplace` (public) → redirects to `/agents`
- `/tasks` → redirects to `/decide`

- [ ] **Step 5: Verify removed duplicates**

- Account settings no longer has Connections tab
- First-run banner "Send a test lead" links to `/my-agent` not `#test-lead`

- [ ] **Step 6: Verify new links**

- Revenue summary has "See details →" linking to `/dashboard/roi`
- Dashboard header has "Manage agent →" linking to `/my-agent`
