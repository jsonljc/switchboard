"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Search, Users } from "lucide-react";

interface LeadContact {
  id: string;
  externalId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  channel: string | null;
  status: string;
  assignedStaffId: string | null;
  sourceAdId: string | null;
  createdAt: string;
}

interface LeadDeal {
  id: string;
  name: string;
  stage: string;
  contactIds: string[];
  createdAt: string;
}

type LeadStage = "NEW" | "QUALIFIED" | "BOOKED" | "LOST";

interface LeadRow {
  contact: LeadContact;
  stage: LeadStage;
  deal: LeadDeal | null;
}

const STAGE_PRIORITY: Record<string, { display: LeadStage; priority: number }> = {
  consultation_booked: { display: "BOOKED", priority: 3 },
  booked: { display: "BOOKED", priority: 3 },
  appointment_scheduled: { display: "BOOKED", priority: 3 },
  qualified: { display: "QUALIFIED", priority: 2 },
  lead: { display: "NEW", priority: 1 },
  closed_lost: { display: "LOST", priority: 0 },
};

const STAGE_BADGE_CLASS: Record<LeadStage, string> = {
  NEW: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  QUALIFIED: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  BOOKED: "bg-green-100 text-green-800 hover:bg-green-100",
  LOST: "bg-red-100 text-red-800 hover:bg-red-100",
};

const STAGE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All stages" },
  { value: "NEW", label: "New" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "BOOKED", label: "Booked" },
  { value: "LOST", label: "Lost" },
];

function resolveStage(
  deals: LeadDeal[],
  contactId: string,
): { stage: LeadStage; deal: LeadDeal | null } {
  const contactDeals = deals.filter((d) => d.contactIds.includes(contactId));
  if (contactDeals.length === 0) return { stage: "NEW", deal: null };

  let best: { stage: LeadStage; priority: number; deal: LeadDeal } | null = null;
  for (const deal of contactDeals) {
    const mapped = STAGE_PRIORITY[deal.stage] ?? { display: "NEW" as const, priority: 1 };
    if (!best || mapped.priority > best.priority) {
      best = { stage: mapped.display, priority: mapped.priority, deal };
    }
  }
  return best ? { stage: best.stage, deal: best.deal } : { stage: "NEW", deal: null };
}

export default function LeadsPage() {
  const { status: authStatus } = useSession();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const contactParams = new URLSearchParams();
      if (searchQuery) contactParams.set("search", searchQuery);
      const contactQs = contactParams.toString();

      const [contactsRes, dealsRes] = await Promise.all([
        fetch(`/api/dashboard/crm/contacts${contactQs ? `?${contactQs}` : ""}`),
        fetch("/api/dashboard/crm/deals"),
      ]);

      if (!contactsRes.ok) throw new Error("Failed to fetch contacts");
      if (!dealsRes.ok) throw new Error("Failed to fetch deals");

      const contactsData = await contactsRes.json();
      const dealsData = await dealsRes.json();

      const contacts: LeadContact[] = contactsData.data ?? [];
      const deals: LeadDeal[] = dealsData.data ?? [];

      const rows: LeadRow[] = contacts.map((contact) => {
        const { stage, deal } = resolveStage(deals, contact.id);
        return { contact, stage, deal };
      });

      setLeads(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  if (authStatus === "unauthenticated") redirect("/login");

  const filteredLeads = stageFilter ? leads.filter((l) => l.stage === stageFilter) : leads;

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Leads</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load leads</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchLeads}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leads</h1>
        <p className="text-muted-foreground">
          {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search leads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") fetchLeads();
            }}
            className="border rounded px-3 py-2 pl-9 text-sm w-64"
          />
        </div>
        <div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          >
            {STAGE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={fetchLeads}>
          Search
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leads found.</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-6 gap-2 text-xs font-medium text-muted-foreground border-b pb-2">
                  <span>Name</span>
                  <span>Channel</span>
                  <span>Stage</span>
                  <span>Source</span>
                  <span>Assigned</span>
                  <span>Created</span>
                </div>
                {filteredLeads.map((row) => (
                  <div
                    key={row.contact.id}
                    className="grid grid-cols-6 gap-2 text-sm py-2 border-b border-muted items-center"
                  >
                    <span className="font-medium truncate">
                      {[row.contact.firstName, row.contact.lastName].filter(Boolean).join(" ") ||
                        row.contact.email ||
                        "—"}
                    </span>
                    <span className="capitalize">{row.contact.channel ?? "—"}</span>
                    <span>
                      <Badge className={STAGE_BADGE_CLASS[row.stage]}>{row.stage}</Badge>
                    </span>
                    <span className="text-xs">{row.contact.sourceAdId ? "Ad" : "Organic"}</span>
                    <span className="truncate text-xs">{row.contact.assignedStaffId ?? "—"}</span>
                    <span className="text-xs">
                      {new Date(row.contact.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
