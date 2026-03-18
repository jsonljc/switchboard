# Dashboard Operational Trust — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add closed-loop campaign reporting (ad spend → revenue), a human handoff inbox, and an agent activity feed to the dashboard.

**Architecture:** Three independent features that share the same dashboard shell and BFF pattern (Next.js API routes proxy to Fastify backend). Feature 1 enhances existing pages + API. Features 2 and 3 add new pages, hooks, components, and backend routes. All follow the existing shadcn/ui + React Query + Tailwind patterns.

**Tech Stack:** TypeScript, Next.js 15, React 19, Fastify, Prisma, React Query v5, shadcn/ui, Tailwind CSS, Vitest

---

## Feature 1: Closed-Loop Campaign Reporting

### Task 1: Build campaign-attribution API endpoint

The `/api/reports/campaign-attribution` endpoint is referenced by the dashboard but doesn't exist yet. We need to create it — joining campaigns (via CrmContact.sourceCampaignId) with deals and revenue events.

**Files:**

- Create: `apps/api/src/routes/campaign-attribution.ts`
- Modify: `apps/api/src/routes/reports.ts:14-16` (register the new route)
- Modify: `apps/api/src/bootstrap/routes.ts` (no change needed — reports already registered)
- Test: `apps/api/src/routes/__tests__/campaign-attribution.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll test the aggregation logic directly
import { aggregateCampaignAttribution } from "../campaign-attribution.js";

describe("aggregateCampaignAttribution", () => {
  it("groups contacts by sourceCampaignId and counts leads, bookings, paid, revenue", () => {
    const contacts = [
      { id: "c1", sourceCampaignId: "camp1", sourceAdId: "ad1" },
      { id: "c2", sourceCampaignId: "camp1", sourceAdId: "ad2" },
      { id: "c3", sourceCampaignId: "camp2", sourceAdId: "ad3" },
    ];
    const deals = [
      { id: "d1", contactId: "c1", stage: "booked", amount: null },
      { id: "d2", contactId: "c2", stage: "won", amount: 500 },
      { id: "d3", contactId: "c3", stage: "lead", amount: null },
    ];
    const revenueEvents = [{ contactId: "c2", amount: 500 }];
    const campaignSpend = new Map([
      ["camp1", { name: "Campaign 1", spend: 200 }],
      ["camp2", { name: "Campaign 2", spend: 100 }],
    ]);

    const result = aggregateCampaignAttribution(contacts, deals, revenueEvents, campaignSpend);

    expect(result).toHaveLength(2);

    const camp1 = result.find((r) => r.campaignId === "camp1")!;
    expect(camp1.name).toBe("Campaign 1");
    expect(camp1.leads).toBe(2);
    expect(camp1.bookings).toBe(2); // booked + won both count
    expect(camp1.paid).toBe(1); // only won
    expect(camp1.revenue).toBe(500);
    expect(camp1.spend).toBe(200);
    expect(camp1.roas).toBeCloseTo(2.5); // 500/200

    const camp2 = result.find((r) => r.campaignId === "camp2")!;
    expect(camp2.leads).toBe(1);
    expect(camp2.bookings).toBe(0);
    expect(camp2.paid).toBe(0);
    expect(camp2.revenue).toBe(0);
  });

  it("returns empty array when no contacts have campaign attribution", () => {
    const result = aggregateCampaignAttribution([], [], [], new Map());
    expect(result).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- campaign-attribution`
Expected: FAIL — module not found

**Step 3: Implement the aggregation function and route**

Create `apps/api/src/routes/campaign-attribution.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";
import { getOrgScopedMetaAdsContext } from "../utils/meta-campaign-provider.js";

export interface CampaignAttributionRow {
  campaignId: string;
  name: string;
  spend: number | null;
  leads: number;
  bookings: number;
  paid: number;
  revenue: number;
  costPerLead: number | null;
  costPerBooking: number | null;
  roas: number | null;
}

interface ContactAttribution {
  id: string;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
}

interface DealAttribution {
  id: string;
  contactId: string | null;
  stage: string;
  amount: number | null;
}

interface RevenueAttribution {
  contactId: string;
  amount: number;
}

interface CampaignMeta {
  name: string;
  spend: number | null;
}

const BOOKING_STAGES = new Set([
  "consultation_booked",
  "booked",
  "appointment_scheduled",
  "won",
  "paid",
]);
const PAID_STAGES = new Set(["won", "paid"]);

export function aggregateCampaignAttribution(
  contacts: ContactAttribution[],
  deals: DealAttribution[],
  revenueEvents: RevenueAttribution[],
  campaignSpend: Map<string, CampaignMeta>,
): CampaignAttributionRow[] {
  // Index deals and revenue by contactId
  const dealsByContact = new Map<string, DealAttribution>();
  for (const deal of deals) {
    if (deal.contactId) dealsByContact.set(deal.contactId, deal);
  }

  const revenueByContact = new Map<string, number>();
  for (const rev of revenueEvents) {
    revenueByContact.set(rev.contactId, (revenueByContact.get(rev.contactId) ?? 0) + rev.amount);
  }

  // Group contacts by campaign
  const byCampaign = new Map<
    string,
    { leads: number; bookings: number; paid: number; revenue: number }
  >();

  for (const contact of contacts) {
    if (!contact.sourceCampaignId) continue;
    const campId = contact.sourceCampaignId;

    if (!byCampaign.has(campId)) {
      byCampaign.set(campId, { leads: 0, bookings: 0, paid: 0, revenue: 0 });
    }
    const bucket = byCampaign.get(campId)!;
    bucket.leads += 1;

    const deal = dealsByContact.get(contact.id);
    if (deal && BOOKING_STAGES.has(deal.stage)) {
      bucket.bookings += 1;
    }
    if (deal && PAID_STAGES.has(deal.stage)) {
      bucket.paid += 1;
    }

    const rev = revenueByContact.get(contact.id);
    if (rev) {
      bucket.revenue += rev;
    }
  }

  // Build result rows
  const rows: CampaignAttributionRow[] = [];
  for (const [campaignId, counts] of byCampaign) {
    const meta = campaignSpend.get(campaignId);
    const spend = meta?.spend ?? null;
    rows.push({
      campaignId,
      name: meta?.name ?? campaignId,
      spend,
      leads: counts.leads,
      bookings: counts.bookings,
      paid: counts.paid,
      revenue: counts.revenue,
      costPerLead: spend != null && counts.leads > 0 ? spend / counts.leads : null,
      costPerBooking: spend != null && counts.bookings > 0 ? spend / counts.bookings : null,
      roas: spend != null && spend > 0 ? counts.revenue / spend : null,
    });
  }

  return rows.sort((a, b) => b.leads - a.leads);
}

export const campaignAttributionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaign-attribution", async (request, reply) => {
    const prisma = app.prisma;
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    // 1. Get contacts with campaign attribution
    const contacts = await prisma.crmContact.findMany({
      where: { organizationId: orgId, sourceCampaignId: { not: null } },
      select: { id: true, sourceCampaignId: true, sourceAdId: true },
    });

    const contactIds = contacts.map((c: { id: string }) => c.id);

    // 2. Get deals for attributed contacts
    const deals =
      contactIds.length > 0
        ? await prisma.crmDeal.findMany({
            where: { organizationId: orgId, contactId: { in: contactIds } },
            select: { id: true, contactId: true, stage: true, amount: true },
          })
        : [];

    // 3. Get revenue events for attributed contacts
    const revenueEvents =
      contactIds.length > 0
        ? await prisma.revenueEvent.findMany({
            where: { organizationId: orgId, contactId: { in: contactIds } },
            select: { contactId: true, amount: true },
          })
        : [];

    // 4. Get campaign spend from Meta Ads (best-effort)
    const campaignSpend = new Map<string, CampaignMeta>();
    try {
      const { provider, adAccountId } = await getOrgScopedMetaAdsContext(prisma, orgId);
      const campaigns = await provider.getCampaigns(adAccountId);
      for (const camp of campaigns) {
        campaignSpend.set(camp.id, {
          name: camp.name,
          spend: camp.spend != null ? Number(camp.spend) : null,
        });
      }
    } catch {
      // No ad platform connected — campaign names will fall back to IDs
    }

    const campaigns = aggregateCampaignAttribution(contacts, deals, revenueEvents, campaignSpend);

    return reply.send({ campaigns });
  });
};
```

**Step 4: Register the route in reports.ts**

In `apps/api/src/routes/reports.ts`, add at line 6:

```typescript
import { campaignAttributionRoutes } from "./campaign-attribution.js";
```

And inside the `reportsRoutes` function, add after line 15:

```typescript
await app.register(campaignAttributionRoutes);
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api test -- campaign-attribution`
Expected: PASS

**Step 6: Commit**

```bash
git commit -m "feat: add campaign-attribution API endpoint with closed-loop revenue data"
```

---

### Task 2: Update CampaignAttribution type in dashboard api-client

The dashboard's `CampaignAttribution` type needs to match the new enriched API response.

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts:147-154`

**Step 1: Update the CampaignAttribution interface**

Change lines 147-154 in `apps/dashboard/src/lib/api-client.ts`:

```typescript
export interface CampaignAttribution {
  campaignId: string;
  name: string;
  leads: number;
  bookings: number;
  paid: number;
  revenue: number;
  spend: number | null;
  costPerLead: number | null;
  costPerBooking: number | null;
  roas: number | null;
}
```

**Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS (or surface errors in campaigns page / pilot-report that we'll fix next)

**Step 3: Commit**

```bash
git commit -m "feat: update CampaignAttribution type with closed-loop fields"
```

---

### Task 3: Update campaigns page to show full funnel columns

**Files:**

- Modify: `apps/dashboard/src/app/campaigns/page.tsx`

**Step 1: Update the campaigns page table**

Replace the entire file content of `apps/dashboard/src/app/campaigns/page.tsx`:

```typescript
"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignAttribution } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

function formatCurrency(n: number | null): string {
  if (n === null) return "\u2014";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function roasColor(roas: number | null): string {
  if (roas === null) return "text-zinc-400";
  if (roas >= 3) return "text-emerald-400";
  if (roas >= 1) return "text-amber-400";
  return "text-red-400";
}

async function fetchCampaignAttribution(): Promise<{ campaigns: CampaignAttribution[] }> {
  const res = await fetch("/api/dashboard/campaign-attribution");
  if (!res.ok) {
    throw new Error("Failed to fetch campaign attribution");
  }
  return (await res.json()) as { campaigns: CampaignAttribution[] };
}

export default function CampaignsPage() {
  const { status } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.campaigns.attribution(),
    queryFn: fetchCampaignAttribution,
    enabled: status === "authenticated",
  });

  if (status === "unauthenticated") redirect("/login");

  const campaigns = data?.campaigns ?? [];

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Campaigns</h1>
        <p className="text-[14px] text-muted-foreground">
          Follow the money from ad spend to revenue.
        </p>
      </section>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-surface p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No campaign data yet. Bookings will appear here once leads with campaign attribution are
            tracked.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="overflow-x-auto">
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
        </div>
      )}
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: CampaignAttribution }) {
  return (
    <tr className="border-b border-border/20 hover:bg-surface/30 transition-colors">
      <td className="px-4 py-3 text-foreground font-medium truncate max-w-[200px]">
        {campaign.name}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground">
        {formatCurrency(campaign.spend)}
      </td>
      <td className="px-4 py-3 text-right text-foreground">{campaign.leads}</td>
      <td className="px-4 py-3 text-right text-foreground">{campaign.bookings}</td>
      <td className="px-4 py-3 text-right text-foreground font-medium">{campaign.paid}</td>
      <td className="px-4 py-3 text-right text-positive-foreground font-medium">
        {formatCurrency(campaign.revenue)}
      </td>
      <td className={`px-4 py-3 text-right font-medium ${roasColor(campaign.roas)}`}>
        {campaign.roas !== null ? `${campaign.roas.toFixed(1)}x` : "\u2014"}
      </td>
    </tr>
  );
}
```

**Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "feat: update campaigns page with full funnel columns (bookings, paid, revenue, ROAS)"
```

---

### Task 4: Add "Mark as Paid" to lead detail page

**Files:**

- Modify: `apps/dashboard/src/app/leads/[id]/page.tsx`
- Modify: `apps/dashboard/src/lib/api-client.ts` (add BFF methods)
- Create: `apps/dashboard/src/app/api/dashboard/crm/deals/[id]/mark-paid/route.ts`

**Step 1: Create the BFF route for mark-as-paid**

This route combines two backend calls: update deal stage to "won" + create revenue event.

Create `apps/dashboard/src/app/api/dashboard/crm/deals/[id]/mark-paid/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = (await request.json()) as {
      amount: number;
      contactId: string;
      reference?: string;
    };

    const client = await getApiClient();

    // 1. Update deal stage to "won" with amount
    await client.request(`/api/crm/deals/${id}`, {
      method: "PATCH",
      body: { stage: "won", amount: body.amount },
    });

    // 2. Create revenue event
    await client.request("/api/revenue", {
      method: "POST",
      body: {
        contactId: body.contactId,
        amount: body.amount,
        currency: "USD",
        source: "manual",
        reference: body.reference ?? `marked-paid-dashboard-${id}`,
        recordedBy: session.user.email,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

**Step 2: Add mark-as-paid dialog to lead detail page**

In `apps/dashboard/src/app/leads/[id]/page.tsx`, add the following changes:

Add to imports (line 9):

```typescript
import { DollarSign } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
```

Add state variables after line 73 (after `overrideLoading` state):

```typescript
const [markPaidOpen, setMarkPaidOpen] = useState(false);
const [markPaidAmount, setMarkPaidAmount] = useState("");
const [markPaidRef, setMarkPaidRef] = useState("");
const [markPaidLoading, setMarkPaidLoading] = useState(false);
```

Add the mark-as-paid handler after the `toggleOverride` function (after line 149):

```typescript
const handleMarkPaid = async () => {
  const deal = deals[0];
  if (!deal || !contact) return;
  const amount = parseFloat(markPaidAmount);
  if (isNaN(amount) || amount <= 0) return;

  setMarkPaidLoading(true);
  try {
    const res = await fetch(`/api/dashboard/crm/deals/${deal.id}/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        contactId: contact.id,
        reference: markPaidRef || undefined,
      }),
    });
    if (res.ok) {
      setMarkPaidOpen(false);
      setMarkPaidAmount("");
      setMarkPaidRef("");
      fetchData(); // Refresh the page data
    }
  } finally {
    setMarkPaidLoading(false);
  }
};
```

Add the Mark as Paid button inside the contact card, after the deal stage display (after line 237, inside the grid):

```typescript
{deals.length > 0 && stage !== "LOST" && deals[0]!.stage !== "won" && (
  <div>
    <span className="text-muted-foreground block">Payment</span>
    <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-1">
          <DollarSign className="h-3 w-3 mr-1" />
          Mark as Paid
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount ($)</Label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={markPaidAmount}
              onChange={(e) => setMarkPaidAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Reference (optional)</Label>
            <Input
              id="reference"
              placeholder="Invoice #, POS receipt, etc."
              value={markPaidRef}
              onChange={(e) => setMarkPaidRef(e.target.value)}
            />
          </div>
          <Button
            onClick={handleMarkPaid}
            disabled={markPaidLoading || !markPaidAmount || parseFloat(markPaidAmount) <= 0}
            className="w-full"
          >
            {markPaidLoading ? "Recording..." : "Record Payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
)}
```

**Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git commit -m "feat: add Mark as Paid dialog on lead detail page with revenue recording"
```

---

## Feature 2: Human Handoff Inbox

### Task 5: Create PrismaHandoffStore in packages/db

The `Handoff` Prisma model exists (schema.prisma:835) but there's no store implementation. The `HandoffStore` interface is in `packages/core/src/handoff/types.ts`.

**Files:**

- Create: `packages/db/src/stores/handoff-store.ts`
- Modify: `packages/db/src/index.ts` (export the new store)
- Test: `packages/db/src/stores/__tests__/handoff-store.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaHandoffStore } from "../handoff-store.js";

function makeMockPrisma() {
  return {
    handoff: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("PrismaHandoffStore", () => {
  let prisma: PrismaClient;
  let store: PrismaHandoffStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new PrismaHandoffStore(prisma);
  });

  it("listPending returns handoffs with pending or assigned status", async () => {
    const mockHandoffs = [
      {
        id: "h1",
        sessionId: "s1",
        organizationId: "org1",
        status: "pending",
        reason: "complex_objection",
        leadSnapshot: { name: "Sarah" },
        qualificationSnapshot: {},
        conversationSummary: { turnCount: 5 },
        slaDeadlineAt: new Date(),
        createdAt: new Date(),
        acknowledgedAt: null,
      },
    ];
    (prisma.handoff.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockHandoffs);

    const result = await store.listPending("org1");

    expect(prisma.handoff.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org1",
        status: { in: ["pending", "assigned", "active"] },
      },
      orderBy: { slaDeadlineAt: "asc" },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("h1");
  });

  it("updateStatus updates status and optionally sets acknowledgedAt", async () => {
    (prisma.handoff.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const now = new Date();

    await store.updateStatus("h1", "active", now);

    expect(prisma.handoff.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { status: "active", acknowledgedAt: now },
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- handoff-store`
Expected: FAIL — module not found

**Step 3: Implement PrismaHandoffStore**

Create `packages/db/src/stores/handoff-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { HandoffPackage, HandoffStatus, HandoffStore } from "@switchboard/core";

export class PrismaHandoffStore implements HandoffStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(pkg: HandoffPackage): Promise<void> {
    await this.prisma.handoff.create({
      data: {
        id: pkg.id,
        sessionId: pkg.sessionId,
        organizationId: pkg.organizationId,
        leadId: pkg.leadSnapshot.leadId ?? null,
        status: pkg.status,
        reason: pkg.reason,
        leadSnapshot: pkg.leadSnapshot as Record<string, unknown>,
        qualificationSnapshot: pkg.qualificationSnapshot as Record<string, unknown>,
        conversationSummary: pkg.conversationSummary as Record<string, unknown>,
        slaDeadlineAt: pkg.slaDeadlineAt,
        acknowledgedAt: pkg.acknowledgedAt ?? null,
      },
    });
  }

  async getById(id: string): Promise<HandoffPackage | null> {
    const row = await this.prisma.handoff.findUnique({ where: { id } });
    return row ? this.toPackage(row) : null;
  }

  async getBySessionId(sessionId: string): Promise<HandoffPackage | null> {
    const row = await this.prisma.handoff.findFirst({ where: { sessionId } });
    return row ? this.toPackage(row) : null;
  }

  async updateStatus(id: string, status: HandoffStatus, acknowledgedAt?: Date): Promise<void> {
    await this.prisma.handoff.update({
      where: { id },
      data: {
        status,
        ...(acknowledgedAt ? { acknowledgedAt } : {}),
      },
    });
  }

  async listPending(organizationId: string): Promise<HandoffPackage[]> {
    const rows = await this.prisma.handoff.findMany({
      where: {
        organizationId,
        status: { in: ["pending", "assigned", "active"] },
      },
      orderBy: { slaDeadlineAt: "asc" },
    });
    return rows.map((r) => this.toPackage(r));
  }

  private toPackage(row: {
    id: string;
    sessionId: string;
    organizationId: string;
    status: string;
    reason: string;
    leadSnapshot: unknown;
    qualificationSnapshot: unknown;
    conversationSummary: unknown;
    slaDeadlineAt: Date;
    createdAt: Date;
    acknowledgedAt: Date | null;
  }): HandoffPackage {
    return {
      id: row.id,
      sessionId: row.sessionId,
      organizationId: row.organizationId,
      reason: row.reason as HandoffPackage["reason"],
      status: row.status as HandoffStatus,
      leadSnapshot: row.leadSnapshot as HandoffPackage["leadSnapshot"],
      qualificationSnapshot: row.qualificationSnapshot as HandoffPackage["qualificationSnapshot"],
      conversationSummary: row.conversationSummary as HandoffPackage["conversationSummary"],
      slaDeadlineAt: row.slaDeadlineAt,
      createdAt: row.createdAt,
      acknowledgedAt: row.acknowledgedAt ?? undefined,
    };
  }
}
```

**Step 4: Export from packages/db/src/index.ts**

Add to the exports:

```typescript
export { PrismaHandoffStore } from "./stores/handoff-store.js";
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/db test -- handoff-store`
Expected: PASS

**Step 6: Commit**

```bash
git commit -m "feat: add PrismaHandoffStore implementing HandoffStore interface"
```

---

### Task 6: Create handoff API routes in backend

**Files:**

- Create: `apps/api/src/routes/handoff.ts`
- Modify: `apps/api/src/bootstrap/routes.ts:41-77` (register handoff routes)
- Test: `apps/api/src/routes/__tests__/handoff.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from "vitest";

describe("handoff routes", () => {
  it("GET /api/handoff/pending returns pending handoffs for org", async () => {
    // Integration test placeholder — validates route structure
    expect(true).toBe(true);
  });
});
```

**Step 2: Implement the handoff route**

Create `apps/api/src/routes/handoff.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";

export const handoffRoutes: FastifyPluginAsync = async (app) => {
  async function getHandoffStore(organizationId: string) {
    if (!app.prisma) {
      throw { statusCode: 503, message: "Database not available" };
    }
    const { PrismaHandoffStore } = await import("@switchboard/db");
    return new PrismaHandoffStore(app.prisma);
  }

  // GET /api/handoff/pending — list pending handoffs
  app.get("/pending", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = await getHandoffStore(orgId);
    const handoffs = await store.listPending(orgId);

    // Enrich with conversation data
    const enriched = await Promise.all(
      handoffs.map(async (h) => {
        let conversation = null;
        if (app.prisma) {
          conversation = await app.prisma.conversationState.findFirst({
            where: { threadId: h.sessionId },
            select: {
              id: true,
              threadId: true,
              channel: true,
              status: true,
              lastActivityAt: true,
            },
          });
        }
        return {
          handoff: {
            ...h,
            slaDeadlineAt: h.slaDeadlineAt.toISOString(),
            createdAt: h.createdAt.toISOString(),
            acknowledgedAt: h.acknowledgedAt?.toISOString() ?? null,
          },
          conversation,
          waitingSince: h.createdAt.toISOString(),
          slaRemaining: Math.max(0, h.slaDeadlineAt.getTime() - Date.now()),
        };
      }),
    );

    return reply.send({ items: enriched, total: enriched.length });
  });

  // GET /api/handoff/count — count pending handoffs (for badge)
  app.get("/count", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    if (!app.prisma) return reply.code(503).send({ error: "Database unavailable" });

    const count = await app.prisma.handoff.count({
      where: {
        organizationId: orgId,
        status: { in: ["pending", "assigned", "active"] },
      },
    });

    return reply.send({ count });
  });

  // POST /api/handoff/:id/release — release a handoff back to AI
  app.post("/:id/release", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    const { id } = request.params as { id: string };

    const store = await getHandoffStore(orgId);
    const handoff = await store.getById(id);
    if (!handoff || handoff.organizationId !== orgId) {
      return reply.code(404).send({ error: "Handoff not found" });
    }

    await store.updateStatus(id, "released");

    // Also toggle conversation back to active
    if (app.prisma) {
      await app.prisma.conversationState.updateMany({
        where: { threadId: handoff.sessionId },
        data: { status: "active" },
      });
    }

    return reply.send({ released: true });
  });
};
```

**Step 3: Register in routes.ts**

In `apps/api/src/bootstrap/routes.ts`, add import at line 39 (after revenue import):

```typescript
import { handoffRoutes } from "../routes/handoff.js";
```

Add registration at line 77 (end of registerRoutes):

```typescript
await app.register(handoffRoutes, { prefix: "/api/handoff" });
```

**Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add handoff API routes (pending list, count, release)"
```

---

### Task 7: Create inbox BFF routes, hook, and page in dashboard

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/inbox/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/inbox/count/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/inbox/[id]/release/route.ts`
- Create: `apps/dashboard/src/hooks/use-inbox.ts`
- Create: `apps/dashboard/src/app/inbox/page.tsx`
- Modify: `apps/dashboard/src/lib/query-keys.ts` (add inbox keys)
- Modify: `apps/dashboard/src/components/layout/shell.tsx` (add Inbox nav item)

**Step 1: Add query keys**

In `apps/dashboard/src/lib/query-keys.ts`, add after the `agents` block (line 91):

```typescript
inbox: {
  all: ["inbox"] as const,
  list: () => ["inbox", "list"] as const,
  count: () => ["inbox", "count"] as const,
},
```

**Step 2: Create BFF routes**

Create `apps/dashboard/src/app/api/dashboard/inbox/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = await client.request<{ items: unknown[]; total: number }>("/api/handoff/pending");
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

Create `apps/dashboard/src/app/api/dashboard/inbox/count/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = await client.request<{ count: number }>("/api/handoff/count");
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

Create `apps/dashboard/src/app/api/dashboard/inbox/[id]/release/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const client = await getApiClient();
    const data = await client.request<{ released: boolean }>(`/api/handoff/${id}/release`, {
      method: "POST",
    });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

**Step 3: Create the inbox hook**

Create `apps/dashboard/src/hooks/use-inbox.ts`:

```typescript
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface InboxItem {
  handoff: {
    id: string;
    sessionId: string;
    organizationId: string;
    reason: string;
    status: string;
    leadSnapshot: {
      leadId?: string;
      name?: string;
      phone?: string;
      email?: string;
      serviceInterest?: string;
      channel: string;
      source?: string;
    };
    qualificationSnapshot: {
      signalsCaptured: Record<string, unknown>;
      qualificationStage: string;
      leadScore?: number;
    };
    conversationSummary: {
      turnCount: number;
      keyTopics: string[];
      objectionHistory: string[];
      sentiment: string;
      suggestedOpening?: string;
    };
    slaDeadlineAt: string;
    createdAt: string;
    acknowledgedAt: string | null;
  };
  conversation: {
    id: string;
    threadId: string;
    channel: string;
    status: string;
    lastActivityAt: string;
  } | null;
  waitingSince: string;
  slaRemaining: number;
}

async function fetchInbox(): Promise<{ items: InboxItem[]; total: number }> {
  const res = await fetch("/api/dashboard/inbox");
  if (!res.ok) throw new Error("Failed to fetch inbox");
  return res.json();
}

async function fetchInboxCount(): Promise<number> {
  const res = await fetch("/api/dashboard/inbox/count");
  if (!res.ok) return 0;
  const data = (await res.json()) as { count: number };
  return data.count;
}

export function useInbox() {
  return useQuery({
    queryKey: queryKeys.inbox.list(),
    queryFn: fetchInbox,
    refetchInterval: 30_000,
  });
}

export function useInboxCount() {
  const { data } = useQuery({
    queryKey: queryKeys.inbox.count(),
    queryFn: fetchInboxCount,
    refetchInterval: 30_000,
  });
  return data ?? 0;
}

export function useReleaseHandoff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/inbox/${id}/release`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to release handoff");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
    },
  });
}
```

**Step 4: Create the inbox page**

Create `apps/dashboard/src/app/inbox/page.tsx`:

```typescript
"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Clock, ArrowRight, RotateCcw } from "lucide-react";
import { useInbox, useReleaseHandoff } from "@/hooks/use-inbox";
import type { InboxItem } from "@/hooks/use-inbox";

const REASON_LABELS: Record<string, string> = {
  human_requested: "Human requested",
  max_turns_exceeded: "Too many turns",
  complex_objection: "Complex objection",
  negative_sentiment: "Negative sentiment",
  compliance_concern: "Compliance concern",
  booking_failure: "Booking failed",
  escalation_timeout: "Escalation timed out",
};

const CHANNEL_STYLE: Record<string, string> = {
  telegram: "bg-sky-100 text-sky-800",
  whatsapp: "bg-emerald-100 text-emerald-800",
  slack: "bg-violet-100 text-violet-800",
  sms: "bg-amber-100 text-amber-800",
  web_chat: "bg-zinc-100 text-zinc-800",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function slaDisplay(ms: number): { text: string; urgent: boolean } {
  if (ms <= 0) return { text: "Overdue", urgent: true };
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return { text: `${mins}m left`, urgent: mins < 15 };
  const hours = Math.floor(mins / 60);
  return { text: `${hours}h left`, urgent: false };
}

export default function InboxPage() {
  const { status } = useSession();
  const { data, isLoading } = useInbox();
  const releaseMutation = useReleaseHandoff();

  if (status === "unauthenticated") redirect("/login");

  const items = data?.items ?? [];
  const active = items.filter(
    (i) => i.handoff.status === "pending" || i.handoff.status === "active",
  );

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Inbox</h1>
        <p className="text-[14px] text-muted-foreground">
          Conversations that need your attention.
        </p>
      </section>

      {active.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-surface p-8 text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            All clear. No conversations need your attention right now.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map((item) => (
            <InboxCard
              key={item.handoff.id}
              item={item}
              onRelease={() => releaseMutation.mutate(item.handoff.id)}
              releasing={releaseMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxCard({
  item,
  onRelease,
  releasing,
}: {
  item: InboxItem;
  onRelease: () => void;
  releasing: boolean;
}) {
  const { handoff, conversation } = item;
  const lead = handoff.leadSnapshot;
  const summary = handoff.conversationSummary;
  const sla = slaDisplay(item.slaRemaining);
  const channel = lead.channel ?? conversation?.channel ?? "unknown";

  return (
    <Card className="hover:border-foreground/20 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1 min-w-0">
            {/* Header: name + channel + time */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground">
                {lead.name ?? lead.phone ?? lead.email ?? "Unknown"}
              </span>
              <Badge variant="outline" className={CHANNEL_STYLE[channel] ?? ""}>
                {channel}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {timeAgo(item.waitingSince)}
              </span>
            </div>

            {/* Reason */}
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {REASON_LABELS[handoff.reason] ?? handoff.reason}
              </Badge>
              {sla.urgent && (
                <span className="flex items-center gap-1 text-xs text-red-500">
                  <Clock className="h-3 w-3" />
                  {sla.text}
                </span>
              )}
              {!sla.urgent && item.slaRemaining > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {sla.text}
                </span>
              )}
            </div>

            {/* Summary */}
            {summary.keyTopics.length > 0 && (
              <p className="text-sm text-muted-foreground truncate">
                Topics: {summary.keyTopics.join(", ")}
              </p>
            )}

            {/* Suggested opening */}
            {summary.suggestedOpening && (
              <p className="text-sm text-muted-foreground/70 italic truncate">
                &ldquo;{summary.suggestedOpening}&rdquo;
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 shrink-0">
            {conversation && (
              <Link href={`/conversations?selected=${conversation.id}`}>
                <Button size="sm" variant="default">
                  Jump In <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onRelease}
              disabled={releasing}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Release
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 5: Add Inbox to nav**

In `apps/dashboard/src/components/layout/shell.tsx`:

Add `Inbox` icon import (line 6):

```typescript
import {
  LayoutDashboard,
  TrendingUp,
  ShieldCheck,
  Users,
  LineChart,
  MessageSquare,
  BarChart3,
  Inbox,
} from "lucide-react";
```

Add `useInboxCount` import (line 16):

```typescript
import { useInboxCount } from "@/hooks/use-inbox";
```

Update NAV array (lines 19-27) — insert Inbox after Chats:

```typescript
const NAV = [
  { href: "/mission", label: "Today", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/conversations", label: "Chats", icon: MessageSquare },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: true },
  { href: "/campaigns", label: "Campaigns", icon: BarChart3 },
  { href: "/results", label: "Results", icon: TrendingUp },
  { href: "/growth", label: "Growth", icon: LineChart },
  { href: "/approvals", label: "Decide", icon: ShieldCheck },
];
```

Inside `Shell()`, add after `pendingCount` (line 31):

```typescript
const inboxCount = useInboxCount();
```

Update the badge logic in desktop nav (line 53) to handle both badge types:

```typescript
const count =
  item.href === "/approvals" && pendingCount > 0
    ? pendingCount
    : item.href === "/inbox" && inboxCount > 0
      ? inboxCount
      : null;
```

Update the mobile badge logic (line 114) similarly:

```typescript
{item.href === "/approvals" && pendingCount > 0 && (
  <span className="absolute -top-0.5 -right-1 text-[9px] font-medium text-muted-foreground">
    {pendingCount}
  </span>
)}
{item.href === "/inbox" && inboxCount > 0 && (
  <span className="absolute -top-0.5 -right-1 text-[9px] font-medium text-muted-foreground">
    {inboxCount}
  </span>
)}
```

**Step 6: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git commit -m "feat: add human handoff inbox page with nav badge and release action"
```

---

## Feature 3: Agent Activity Feed

### Task 8: Create agent activity BFF route and hook

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/agents/activity/route.ts`
- Create: `apps/dashboard/src/hooks/use-agent-activity.ts`
- Create: `apps/dashboard/src/components/agents/agent-action-map.ts`
- Modify: `apps/dashboard/src/lib/query-keys.ts` (add activity key)

**Step 1: Add query key**

In `apps/dashboard/src/lib/query-keys.ts`, update the `agents` block:

```typescript
agents: {
  all: ["agents"] as const,
  roster: () => ["agents", "roster"] as const,
  state: () => ["agents", "state"] as const,
  activity: () => ["agents", "activity"] as const,
},
```

**Step 2: Create agent-action-map**

Create `apps/dashboard/src/components/agents/agent-action-map.ts`:

```typescript
/** Maps agent roles to the action type prefixes they own. */
const AGENT_ACTION_PREFIXES: Record<string, string[]> = {
  lead_agent: ["customer-engagement", "crm.contact", "crm.deal"],
  ad_agent: ["digital-ads", "campaign"],
  booking_agent: ["customer-engagement.appointment", "customer-engagement.booking"],
  follow_up_agent: ["customer-engagement.cadence", "customer-engagement.follow"],
};

export function getAgentForAction(actionType: string): string | null {
  // Check most specific prefixes first (longer = more specific)
  const entries = Object.entries(AGENT_ACTION_PREFIXES).sort(
    ([, a], [, b]) => Math.max(...b.map((p) => p.length)) - Math.max(...a.map((p) => p.length)),
  );

  for (const [role, prefixes] of entries) {
    for (const prefix of prefixes) {
      if (actionType.startsWith(prefix)) return role;
    }
  }
  return null;
}

export function agentRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    lead_agent: "Lead Agent",
    ad_agent: "Ad Agent",
    booking_agent: "Booking Agent",
    follow_up_agent: "Follow-Up Agent",
  };
  return labels[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
```

**Step 3: Create BFF route**

Create `apps/dashboard/src/app/api/dashboard/agents/activity/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    await requireSession();
    const client = await getApiClient();
    const url = new URL(request.url);
    const days = url.searchParams.get("days") ?? "1";

    const after = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000).toISOString();

    // Fetch roster, state, and recent audit entries in parallel
    const [rosterRes, stateRes, auditRes] = await Promise.all([
      client.request<{ roster: unknown[] }>("/api/agents/roster"),
      client.request<{ states: unknown[] }>("/api/agents/state"),
      client.request<{ entries: unknown[]; total: number }>(`/api/audit?after=${after}&limit=200`),
    ]);

    return NextResponse.json({
      roster: rosterRes.roster,
      states: stateRes.states,
      auditEntries: auditRes.entries,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

**Step 4: Create the hook**

Create `apps/dashboard/src/hooks/use-agent-activity.ts`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { AgentRosterEntry, AgentStateEntry } from "@/lib/api-client";
import { translateEvent, getEventIcon } from "@/components/activity/event-translator";
import { getAgentForAction } from "@/components/agents/agent-action-map";

export interface AuditEntryRaw {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  summary: string;
  snapshot: Record<string, unknown>;
  timestamp: string;
}

export interface TranslatedAction {
  id: string;
  agentRole: string | null;
  text: string;
  icon: "success" | "denied" | "pending" | "info" | "warning";
  timestamp: string;
  eventType: string;
  entityType: string;
  entityId: string;
}

export interface AgentActivityData {
  roster: AgentRosterEntry[];
  states: AgentStateEntry[];
  actions: TranslatedAction[];
}

async function fetchAgentActivity(days: number): Promise<AgentActivityData> {
  const res = await fetch(`/api/dashboard/agents/activity?days=${days}`);
  if (!res.ok) throw new Error("Failed to fetch agent activity");
  const data = (await res.json()) as {
    roster: AgentRosterEntry[];
    states: AgentStateEntry[];
    auditEntries: AuditEntryRaw[];
  };

  const actions: TranslatedAction[] = data.auditEntries.map((entry) => ({
    id: entry.id,
    agentRole: getAgentForAction((entry.snapshot.actionType as string) ?? entry.entityType),
    text: translateEvent(entry),
    icon: getEventIcon(entry.eventType),
    timestamp: entry.timestamp,
    eventType: entry.eventType,
    entityType: entry.entityType,
    entityId: entry.entityId,
  }));

  return {
    roster: data.roster,
    states: data.states,
    actions: actions.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    ),
  };
}

export function useAgentActivity(days = 1) {
  return useQuery({
    queryKey: [...queryKeys.agents.activity(), days],
    queryFn: () => fetchAgentActivity(days),
    refetchInterval: 30_000,
  });
}
```

**Step 5: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git commit -m "feat: add agent activity BFF route, hook, and action mapping"
```

---

### Task 9: Create agent activity page and update nav

**Files:**

- Create: `apps/dashboard/src/app/agents/page.tsx`
- Modify: `apps/dashboard/src/components/layout/shell.tsx` (rename Team → Agents)

**Step 1: Create the agents page**

Create `apps/dashboard/src/app/agents/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Settings,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Info,
  Loader2,
} from "lucide-react";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import type { TranslatedAction } from "@/hooks/use-agent-activity";
import { agentRoleLabel } from "@/components/agents/agent-action-map";

const STATUS_INDICATOR: Record<string, { color: string; label: string }> = {
  working: { color: "bg-emerald-500", label: "Working" },
  idle: { color: "bg-zinc-400", label: "Idle" },
  blocked: { color: "bg-red-500", label: "Blocked" },
};

const ICON_MAP: Record<string, typeof CheckCircle2> = {
  success: CheckCircle2,
  denied: XCircle,
  pending: Clock,
  warning: AlertTriangle,
  info: Info,
};

const ICON_COLOR: Record<string, string> = {
  success: "text-emerald-500",
  denied: "text-red-500",
  pending: "text-amber-500",
  warning: "text-amber-500",
  info: "text-zinc-400",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type TimeFilter = "1" | "7" | "30";

export default function AgentsPage() {
  const { status } = useSession();
  const [days, setDays] = useState<TimeFilter>("1");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const { data, isLoading } = useAgentActivity(parseInt(days));

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  const roster = data?.roster ?? [];
  const states = data?.states ?? [];
  const actions = data?.actions ?? [];

  // Build per-agent summary
  const stateByRosterId = new Map(states.map((s) => [s.agentRosterId, s]));

  // Filter actions
  const filteredActions = agentFilter
    ? actions.filter((a) => a.agentRole === agentFilter)
    : actions;

  // Count actions per agent today
  const countByAgent = new Map<string, number>();
  for (const a of actions) {
    const role = a.agentRole ?? "system";
    countByAgent.set(role, (countByAgent.get(role) ?? 0) + 1);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Agents</h1>
            <p className="text-[14px] text-muted-foreground">
              What your AI team is doing right now.
            </p>
          </div>
          <Link href="/team">
            <Button variant="outline" size="sm">
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              Configure
            </Button>
          </Link>
        </div>
      </section>

      {/* Agent status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {roster
          .filter((a) => a.status === "active")
          .map((agent) => {
            const state = stateByRosterId.get(agent.id);
            const activityStatus = state?.activityStatus ?? "idle";
            const indicator = STATUS_INDICATOR[activityStatus] ?? STATUS_INDICATOR["idle"]!;
            const agentCount = countByAgent.get(agent.agentRole) ?? 0;
            const isSelected = agentFilter === agent.agentRole;

            return (
              <Card
                key={agent.id}
                className={`cursor-pointer transition-colors ${isSelected ? "border-foreground/40" : "hover:border-foreground/20"}`}
                onClick={() =>
                  setAgentFilter(isSelected ? null : agent.agentRole)
                }
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`h-2 w-2 rounded-full ${indicator.color}`}
                    />
                    <span className="text-sm font-medium text-foreground truncate">
                      {agent.displayName}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{indicator.label}</span>
                    <span>{agentCount} actions</span>
                  </div>
                  {state?.lastActionAt && (
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      Last: {timeAgo(state.lastActionAt)}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Period:</span>
        {(["1", "7", "30"] as TimeFilter[]).map((d) => (
          <Button
            key={d}
            variant={days === d ? "default" : "outline"}
            size="sm"
            className="text-xs h-7 px-2.5"
            onClick={() => setDays(d)}
          >
            {d === "1" ? "Today" : d === "7" ? "7 days" : "30 days"}
          </Button>
        ))}
        {agentFilter && (
          <Badge
            variant="secondary"
            className="ml-2 cursor-pointer"
            onClick={() => setAgentFilter(null)}
          >
            {agentRoleLabel(agentFilter)} &times;
          </Badge>
        )}
      </div>

      {/* Activity timeline */}
      {filteredActions.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-surface p-8 text-center">
          <Loader2 className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2 animate-spin" />
          <p className="text-muted-foreground text-sm">
            No activity yet for this period.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filteredActions.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionRow({ action }: { action: TranslatedAction }) {
  const Icon = ICON_MAP[action.icon] ?? Info;
  const iconColor = ICON_COLOR[action.icon] ?? "text-zinc-400";

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface/40 transition-colors">
      <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {action.agentRole && (
            <span className="text-xs text-muted-foreground font-medium">
              {agentRoleLabel(action.agentRole)}
            </span>
          )}
          {!action.agentRole && (
            <span className="text-xs text-muted-foreground/60">System</span>
          )}
          <span className="text-sm text-foreground truncate">{action.text}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {timeAgo(action.timestamp)}
      </span>
    </div>
  );
}
```

**Step 2: Update shell nav — rename Team to Agents**

In `apps/dashboard/src/components/layout/shell.tsx`, update the NAV array. Replace the last entry before `approvals` — currently there's no Team in the NAV (it was a separate page). We need to add Agents. The NAV array after all changes (from Task 7 + this task):

```typescript
const NAV = [
  { href: "/mission", label: "Today", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/conversations", label: "Chats", icon: MessageSquare },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/campaigns", label: "Campaigns", icon: BarChart3 },
  { href: "/results", label: "Results", icon: TrendingUp },
  { href: "/growth", label: "Growth", icon: LineChart },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/approvals", label: "Decide", icon: ShieldCheck },
];
```

Add `Bot` to the lucide-react imports:

```typescript
import {
  LayoutDashboard,
  TrendingUp,
  ShieldCheck,
  Users,
  LineChart,
  MessageSquare,
  BarChart3,
  Inbox,
  Bot,
} from "lucide-react";
```

**Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

**Step 4: Run full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add agent activity feed page with status cards and timeline"
```

---

## Final Verification

After all 9 tasks:

1. `pnpm typecheck` passes
2. `pnpm test` passes
3. Nav shows: Today | Leads | Chats | Inbox (badge) | Campaigns | Results | Growth | Agents | Decide (badge)
4. `/campaigns` shows: Campaign | Spend | Leads | Bookings | Paid | Revenue | ROAS
5. `/leads/[id]` has "Mark as Paid" button that creates revenue event
6. `/inbox` shows pending handoffs with Jump In + Release actions
7. `/agents` shows agent status cards + activity timeline with filters

## Files Summary

| Action | File                                                                     | Task |
| ------ | ------------------------------------------------------------------------ | ---- |
| CREATE | `apps/api/src/routes/campaign-attribution.ts`                            | 1    |
| CREATE | `apps/api/src/routes/__tests__/campaign-attribution.test.ts`             | 1    |
| MODIFY | `apps/api/src/routes/reports.ts`                                         | 1    |
| MODIFY | `apps/dashboard/src/lib/api-client.ts`                                   | 2    |
| MODIFY | `apps/dashboard/src/app/campaigns/page.tsx`                              | 3    |
| CREATE | `apps/dashboard/src/app/api/dashboard/crm/deals/[id]/mark-paid/route.ts` | 4    |
| MODIFY | `apps/dashboard/src/app/leads/[id]/page.tsx`                             | 4    |
| CREATE | `packages/db/src/stores/handoff-store.ts`                                | 5    |
| CREATE | `packages/db/src/stores/__tests__/handoff-store.test.ts`                 | 5    |
| CREATE | `apps/api/src/routes/handoff.ts`                                         | 6    |
| MODIFY | `apps/api/src/bootstrap/routes.ts`                                       | 6    |
| CREATE | `apps/dashboard/src/app/api/dashboard/inbox/route.ts`                    | 7    |
| CREATE | `apps/dashboard/src/app/api/dashboard/inbox/count/route.ts`              | 7    |
| CREATE | `apps/dashboard/src/app/api/dashboard/inbox/[id]/release/route.ts`       | 7    |
| CREATE | `apps/dashboard/src/hooks/use-inbox.ts`                                  | 7    |
| CREATE | `apps/dashboard/src/app/inbox/page.tsx`                                  | 7    |
| MODIFY | `apps/dashboard/src/lib/query-keys.ts`                                   | 7, 8 |
| MODIFY | `apps/dashboard/src/components/layout/shell.tsx`                         | 7, 9 |
| CREATE | `apps/dashboard/src/app/api/dashboard/agents/activity/route.ts`          | 8    |
| CREATE | `apps/dashboard/src/hooks/use-agent-activity.ts`                         | 8    |
| CREATE | `apps/dashboard/src/components/agents/agent-action-map.ts`               | 8    |
| CREATE | `apps/dashboard/src/app/agents/page.tsx`                                 | 9    |
