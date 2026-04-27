# Dashboard UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up orphan routes/components, fix buried navigation, add approval feedback, apply page transitions, and standardize styling.

**Architecture:** All changes are within `apps/dashboard/`. No backend changes. No new dependencies. Seven workstreams: delete dead code, extract campaigns into Performance tab, add Settings to Owner Me page, wire toast into approval mutations, add CSS fade-in to shell components, standardize section labels.

**Tech Stack:** Next.js 15 App Router, React, TanStack Query, Tailwind CSS, Vitest + Testing Library

---

### Task 1: Delete orphan redirect routes

**Files:**

- Delete: `apps/dashboard/src/app/activity/page.tsx`
- Delete: `apps/dashboard/src/app/mission/page.tsx`
- Delete: `apps/dashboard/src/app/conversations/page.tsx`
- Delete: `apps/dashboard/src/app/escalations/page.tsx`
- Delete: `apps/dashboard/src/app/inbox/page.tsx`
- Delete: `apps/dashboard/src/app/leads/page.tsx`
- Delete: `apps/dashboard/src/app/leads/[id]/page.tsx`
- Delete: `apps/dashboard/src/app/agents/page.tsx`
- Delete: `apps/dashboard/src/app/team/page.tsx`
- Delete: `apps/dashboard/src/app/team/[agentId]/page.tsx`
- Delete: `apps/dashboard/src/app/boundaries/page.tsx`
- Delete: `apps/dashboard/src/app/connections/page.tsx`
- Delete: `apps/dashboard/src/app/knowledge/page.tsx`
- Delete: `apps/dashboard/src/app/test-chat/page.tsx`
- Delete: `apps/dashboard/src/app/approvals/page.tsx`
- Delete: `apps/dashboard/src/app/approvals/[id]/page.tsx`
- Delete: `apps/dashboard/src/app/growth/page.tsx`
- Delete: `apps/dashboard/src/app/results/page.tsx`
- Delete: `apps/dashboard/src/app/setup/page.tsx`
- Delete: `apps/dashboard/src/app/setup/agents/page.tsx`
- Modify: `apps/dashboard/src/components/dev/dev-panel.tsx`

- [ ] **Step 1: Delete all orphan redirect route files**

Delete these files (all are single-file redirects with no other content):

```bash
rm apps/dashboard/src/app/activity/page.tsx
rm apps/dashboard/src/app/mission/page.tsx
rm apps/dashboard/src/app/conversations/page.tsx
rm apps/dashboard/src/app/escalations/page.tsx
rm apps/dashboard/src/app/inbox/page.tsx
rm apps/dashboard/src/app/leads/page.tsx
rm -rf apps/dashboard/src/app/leads/  # includes [id] subdirectory
rm apps/dashboard/src/app/agents/page.tsx
rm apps/dashboard/src/app/team/page.tsx
rm -rf apps/dashboard/src/app/team/  # includes [agentId] subdirectory
rm apps/dashboard/src/app/boundaries/page.tsx
rm apps/dashboard/src/app/connections/page.tsx
rm apps/dashboard/src/app/knowledge/page.tsx
rm apps/dashboard/src/app/test-chat/page.tsx
rm apps/dashboard/src/app/approvals/page.tsx
rm -rf apps/dashboard/src/app/approvals/  # includes [id] subdirectory
rm apps/dashboard/src/app/growth/page.tsx
rm apps/dashboard/src/app/results/page.tsx
rm -rf apps/dashboard/src/app/setup/  # includes agents subdirectory
```

Clean up any empty parent directories left behind.

- [ ] **Step 2: Update dev panel links**

In `apps/dashboard/src/components/dev/dev-panel.tsx`, replace the `NAV_LINKS` array:

```tsx
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/settings/team", label: "AI Team" },
  { href: "/crm", label: "CRM" },
  { href: "/decide", label: "Decide" },
  { href: "/performance", label: "Performance" },
  { href: "/settings", label: "Settings" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/login", label: "Login" },
];
```

- [ ] **Step 3: Verify build**

Run: `cd apps/dashboard && npx next build 2>&1 | tail -20`
Expected: Build succeeds with no errors about missing routes.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete orphan redirect routes and update dev panel links"
```

---

### Task 2: Delete orphan components

**Files:**

- Delete: `apps/dashboard/src/components/layout/shell.tsx`
- Delete: `apps/dashboard/src/components/mission-control/status-hero.tsx`
- Delete: `apps/dashboard/src/components/mission-control/outcomes-panel.tsx`

- [ ] **Step 1: Verify no imports exist**

Run grep for each component name to confirm zero imports:

```bash
grep -r "shell" apps/dashboard/src --include="*.tsx" --include="*.ts" -l | grep -v "__tests__" | grep -v "node_modules"
grep -r "StatusHero\|status-hero" apps/dashboard/src --include="*.tsx" --include="*.ts" -l
grep -r "OutcomesPanel\|outcomes-panel" apps/dashboard/src --include="*.tsx" --include="*.ts" -l
```

For `shell.tsx`, confirm only the file itself appears (no imports from other files). The other shells (`owner-shell`, `staff-shell`, `app-shell`, `wizard-shell`) should NOT match — they have different names.

- [ ] **Step 2: Delete the files**

```bash
rm apps/dashboard/src/components/layout/shell.tsx
rm apps/dashboard/src/components/mission-control/status-hero.tsx
rm apps/dashboard/src/components/mission-control/outcomes-panel.tsx
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete unused Shell, StatusHero, and OutcomesPanel components"
```

---

### Task 3: Extract campaigns content into Performance tab

**Files:**

- Create: `apps/dashboard/src/components/performance/campaigns-content.tsx`
- Modify: `apps/dashboard/src/app/performance/page.tsx`
- Modify: `apps/dashboard/src/components/layout/staff-nav.tsx` (remove Campaigns link)
- Modify: `apps/dashboard/src/components/layout/staff-mobile-menu.tsx` (remove Campaigns link)
- Delete: `apps/dashboard/src/app/campaigns/page.tsx`

- [ ] **Step 1: Create the campaigns content component**

Create `apps/dashboard/src/components/performance/campaigns-content.tsx`:

```tsx
"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignAttribution } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

function formatCurrency(n: number | null): string {
  if (n === null) return "\u2014";
  return `$${n.toFixed(2)}`;
}

function roasColor(roas: number | null): string {
  if (roas === null) return "text-muted-foreground";
  if (roas >= 3) return "text-positive";
  if (roas >= 1) return "text-caution";
  return "text-destructive";
}

async function fetchCampaignAttribution(): Promise<{ campaigns: CampaignAttribution[] }> {
  const res = await fetch("/api/dashboard/campaign-attribution");
  if (!res.ok) {
    throw new Error("Failed to fetch campaign attribution");
  }
  return (await res.json()) as { campaigns: CampaignAttribution[] };
}

function CampaignRow({ campaign }: { campaign: CampaignAttribution }) {
  return (
    <tr className="border-b border-border/20 hover:bg-surface/30 transition-colors">
      <td className="px-4 py-3 text-foreground font-medium truncate max-w-[200px]">
        {campaign.name}
      </td>
      <td className="px-4 py-3 text-right text-foreground">{formatCurrency(campaign.spend)}</td>
      <td className="px-4 py-3 text-right text-foreground">{campaign.leads}</td>
      <td className="px-4 py-3 text-right text-foreground font-medium">{campaign.bookings}</td>
      <td className="px-4 py-3 text-right text-foreground">{campaign.paid}</td>
      <td className="px-4 py-3 text-right text-positive font-medium">
        {formatCurrency(campaign.revenue)}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${roasColor(campaign.roas)}`}>
        {campaign.roas !== null ? `${campaign.roas.toFixed(1)}x` : "\u2014"}
      </td>
    </tr>
  );
}

export function CampaignsContent() {
  const { status } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.campaigns.attribution(),
    queryFn: fetchCampaignAttribution,
    enabled: status === "authenticated",
  });

  const campaigns = data?.campaigns ?? [];

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-3 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-surface p-8 text-center mt-4">
        <p className="text-muted-foreground text-sm">
          No campaign data yet. Bookings will appear here once leads with campaign attribution are
          tracked.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden overflow-x-auto mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 bg-surface/50">
            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Campaign
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Spend
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Leads
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Bookings
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Paid
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Revenue
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              ROAS
            </th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c: CampaignAttribution) => (
            <CampaignRow key={c.campaignId} campaign={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Note: Changed hardcoded Tailwind color classes (`text-emerald-400`, `text-amber-400`, `text-red-400`, `text-zinc-400`) to design system tokens (`text-positive`, `text-caution`, `text-destructive`, `text-muted-foreground`). Changed `text-positive-foreground` on revenue to `text-positive` (foreground variant is white, not green).

- [ ] **Step 2: Add Campaigns tab to Performance page**

Replace the entire content of `apps/dashboard/src/app/performance/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { ResultsContent } from "@/components/performance/results-content";
import { GrowthContent } from "@/components/performance/growth-content";
import { CampaignsContent } from "@/components/performance/campaigns-content";

type PerfTab = "results" | "growth" | "campaigns";

const TABS: { key: PerfTab; label: string }[] = [
  { key: "results", label: "Results" },
  { key: "growth", label: "Growth" },
  { key: "campaigns", label: "Campaigns" },
];

export default function PerformancePage() {
  const { status } = useSession();
  const [tab, setTab] = useState<PerfTab>("results");

  if (status === "unauthenticated") redirect("/login");

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Performance</h1>
        <p className="text-[14px] text-muted-foreground mt-1">Your results and growth metrics.</p>
      </section>

      <div className="flex items-center gap-0 border-b border-border/60">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative px-0 py-3 mr-6 text-[13.5px] transition-colors duration-fast whitespace-nowrap",
              tab === t.key
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-full" />
            )}
          </button>
        ))}
      </div>

      {tab === "results" && <ResultsContent />}
      {tab === "growth" && <GrowthContent />}
      {tab === "campaigns" && <CampaignsContent />}
    </div>
  );
}
```

- [ ] **Step 3: Remove Campaigns from staff navigation**

The staff nav and mobile menu have a standalone "Campaigns" link that's now redundant (campaigns lives under Performance).

In `apps/dashboard/src/components/layout/staff-nav.tsx`, remove the Campaigns entry from `NAV` (line 14):

```tsx
const NAV = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/crm", label: "CRM" },
  { href: "/performance", label: "Performance" },
  { href: "/decide", label: "Decide" },
] as const;
```

In `apps/dashboard/src/components/layout/staff-mobile-menu.tsx`, remove the Campaigns entry from `MENU_ITEMS` (line 15):

```tsx
const MENU_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/crm", label: "CRM" },
  { href: "/performance", label: "Performance" },
  { href: "/decide", label: "Decide" },
] as const;
```

- [ ] **Step 4: Delete the campaigns route**

```bash
rm -rf apps/dashboard/src/app/campaigns/
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: move campaign attribution into Performance tab"
```

---

### Task 4: Add Settings links to Owner Me page

**Files:**

- Modify: `apps/dashboard/src/app/me/page.tsx`

- [ ] **Step 1: Add Settings section**

In `apps/dashboard/src/app/me/page.tsx`, add a `Link` import and a Settings section. After the existing "Quick actions" section (the `<section className="space-y-2">` block that ends around line 105), add:

```tsx
import Link from "next/link";
```

Add this section before the closing `</div>` of the component return, after the Quick actions section:

```tsx
{
  /* Settings */
}
<section>
  <h2 className="section-label mb-3">Settings</h2>
  <div className="space-y-2">
    {[
      { href: "/settings/channels", label: "Channels" },
      { href: "/settings/knowledge", label: "Knowledge" },
      { href: "/settings/identity", label: "Identity" },
      { href: "/settings/team", label: "Team" },
      { href: "/settings/account", label: "Account" },
    ].map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className="block px-4 py-3.5 rounded-lg text-[15px] text-foreground hover:bg-surface border border-border/40 transition-colors"
      >
        {item.label}
      </Link>
    ))}
  </div>
</section>;
```

- [ ] **Step 2: Verify it renders**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add Settings links to Owner Me page"
```

---

### Task 5: Add toast + loading states to approval mutations

**Files:**

- Modify: `apps/dashboard/src/components/dashboard/owner-today.tsx`
- Modify: `apps/dashboard/src/components/dashboard/staff-dashboard.tsx`
- Modify: `apps/dashboard/src/app/decide/page.tsx`

- [ ] **Step 1: Add toast to owner-today.tsx**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`:

1. Add import: `import { useToast } from "@/components/ui/use-toast";`
2. Inside `OwnerToday`, add: `const { toast } = useToast();`
3. Replace the `respondMutation` definition with:

```tsx
const respondMutation = useMutation({
  mutationFn: async ({
    approvalId,
    action,
    bindingHash,
  }: {
    approvalId: string;
    action: string;
    bindingHash: string;
  }) => {
    const res = await fetch("/api/dashboard/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvalId,
        action,
        respondedBy: (session as { principalId?: string })?.principalId ?? "dashboard-user",
        bindingHash,
      }),
    });
    if (!res.ok) throw new Error("Failed to respond");
    return res.json();
  },
  onSuccess: (_data, variables) => {
    toast({
      title: variables.action === "approve" ? "Approved" : "Declined",
      description:
        variables.action === "approve"
          ? "The action will proceed."
          : "The action has been blocked.",
    });
  },
  onError: () => {
    toast({
      title: "Something went wrong",
      description: "Try again or check your connection.",
      variant: "destructive",
    });
  },
  onSettled: () => {
    setRespondingId(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
  },
});
```

4. Update the Approve button text to show loading state. Change:

```tsx
Approve;
```

to:

```tsx
{
  respondingId === topApproval.id && respondMutation.isPending ? "Approving..." : "Approve";
}
```

5. Similarly update the "Not now" button text:

```tsx
{
  respondingId === topApproval.id && respondMutation.isPending ? "Declining..." : "Not now";
}
```

- [ ] **Step 2: Add toast to staff-dashboard.tsx**

In `apps/dashboard/src/components/dashboard/staff-dashboard.tsx`:

1. Add import: `import { useToast } from "@/components/ui/use-toast";`
2. Inside `StaffDashboard`, add: `const { toast } = useToast();`
3. Replace the `respondMutation` definition with the same pattern as Step 1 (identical `onSuccess`, `onError` callbacks). Keep the existing `onSettled` which also invalidates `queryKeys.audit.all`.

```tsx
const respondMutation = useMutation({
  mutationFn: async ({
    approvalId,
    action,
    bindingHash,
  }: {
    approvalId: string;
    action: string;
    bindingHash: string;
  }) => {
    const res = await fetch("/api/dashboard/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvalId,
        action,
        respondedBy: (session as { principalId?: string })?.principalId ?? "dashboard-user",
        bindingHash,
      }),
    });
    if (!res.ok) throw new Error("Failed to respond");
    return res.json();
  },
  onSuccess: (_data, variables) => {
    toast({
      title: variables.action === "approve" ? "Approved" : "Declined",
      description:
        variables.action === "approve"
          ? "The action will proceed."
          : "The action has been blocked.",
    });
  },
  onError: () => {
    toast({
      title: "Something went wrong",
      description: "Try again or check your connection.",
      variant: "destructive",
    });
  },
  onSettled: () => {
    setRespondingId(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
  },
});
```

4. Update both Approve and "Not now" button texts in the approval cards `.map()`:

Approve button:

```tsx
{
  respondingId === approval.id && respondMutation.isPending ? "Approving..." : "Approve";
}
```

Not now button:

```tsx
{
  respondingId === approval.id && respondMutation.isPending ? "Declining..." : "Not now";
}
```

- [ ] **Step 3: Add toast to decide page**

In `apps/dashboard/src/app/decide/page.tsx`:

1. Add import: `import { useToast } from "@/components/ui/use-toast";`
2. Inside `DecidePage`, add: `const { toast } = useToast();`
3. Update the `respondMutation` `onSuccess` callback (currently it only invalidates queries and closes dialog). Replace:

```tsx
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
      setDialog(null);
    },
```

with:

```tsx
    onSuccess: (_data, variables) => {
      toast({
        title: variables.action === "approve" ? "Approved" : "Declined",
        description:
          variables.action === "approve"
            ? "The action will proceed."
            : "The action has been blocked.",
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
      setDialog(null);
    },
    onError: () => {
      toast({
        title: "Something went wrong",
        description: "Try again or check your connection.",
        variant: "destructive",
      });
    },
```

Note: The decide page uses `RespondDialog` which already has its own loading state (`isLoading` prop mapped to `respondMutation.isPending`), so no button text changes needed here.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add toast confirmations and loading states to approval actions"
```

---

### Task 6: Add CSS page fade-in to shell components

**Files:**

- Modify: `apps/dashboard/src/components/layout/owner-shell.tsx`
- Modify: `apps/dashboard/src/components/layout/staff-shell.tsx`

- [ ] **Step 1: Update owner-shell.tsx**

Replace the entire content of `apps/dashboard/src/components/layout/owner-shell.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { OwnerTabs } from "@/components/layout/owner-tabs";

export function OwnerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <main className="pb-20">
        <div key={pathname} className="content-width py-6 animate-fade-in">
          {children}
        </div>
      </main>
      <OwnerTabs />
    </div>
  );
}
```

The `key={pathname}` forces React to remount the div on route changes, replaying the `animate-fade-in` animation.

- [ ] **Step 2: Update staff-shell.tsx**

Replace the entire content of `apps/dashboard/src/components/layout/staff-shell.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { StaffNav } from "@/components/layout/staff-nav";
import { StaffMobileMenu } from "@/components/layout/staff-mobile-menu";

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <StaffNav />
      <StaffMobileMenu />
      <main className="md:pt-14">
        <div key={pathname} className="page-width py-10 md:py-14 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add CSS fade-in page transition to shell components"
```

---

### Task 7: Standardize section labels

**Files:**

- Audit: `apps/dashboard/src/components/dashboard/owner-today.tsx`
- Audit: `apps/dashboard/src/components/dashboard/staff-dashboard.tsx`
- Audit: `apps/dashboard/src/app/me/page.tsx`

- [ ] **Step 1: Audit all section headers**

Run this grep to find all `<h2` tags in dashboard components:

```bash
grep -rn "<h2" apps/dashboard/src/components/dashboard/ apps/dashboard/src/app/me/ apps/dashboard/src/app/decide/ apps/dashboard/src/app/crm/ apps/dashboard/src/app/performance/
```

For each match, verify the `<h2>` uses `className="section-label ..."`. If any use ad-hoc styles instead of the `section-label` class, fix them.

Based on the current codebase reading, all existing section headers already use `section-label`. The new Settings section added in Task 4 also uses `section-label`. So this task is primarily a verification pass.

- [ ] **Step 2: Verify the Owner greeting remains at text-[20px]**

In `apps/dashboard/src/components/dashboard/owner-today.tsx`, confirm the greeting line is:

```tsx
<p className="text-[20px] font-semibold text-foreground">{greeting}.</p>
```

This should NOT be changed to `text-[22px]` — the greeting is intentionally softer.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git commit -m "style: standardize section labels across dashboard"
```

If no changes were needed after the audit, skip this commit.

---

### Task 8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across entire monorepo

- [ ] **Step 2: Run full lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 3: Run dashboard tests**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: All tests pass

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Verify deleted routes don't exist**

```bash
ls apps/dashboard/src/app/activity 2>&1
ls apps/dashboard/src/app/mission 2>&1
ls apps/dashboard/src/app/conversations 2>&1
ls apps/dashboard/src/app/team 2>&1
ls apps/dashboard/src/app/approvals 2>&1
ls apps/dashboard/src/app/campaigns 2>&1
```

Expected: All return "No such file or directory"

- [ ] **Step 6: Verify no stale internal links**

```bash
grep -rn '"/activity"' apps/dashboard/src --include="*.tsx" --include="*.ts"
grep -rn '"/mission"' apps/dashboard/src --include="*.tsx" --include="*.ts"
grep -rn '"/team"' apps/dashboard/src --include="*.tsx" --include="*.ts" | grep -v settings/team
grep -rn '"/approvals"' apps/dashboard/src --include="*.tsx" --include="*.ts" | grep -v /decide
grep -rn '"/campaigns"' apps/dashboard/src --include="*.tsx" --include="*.ts"
```

Expected: Zero matches for each (all references should point to new routes)
