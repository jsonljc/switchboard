"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Search, Users, Briefcase } from "lucide-react";

interface CrmContact {
  id: string;
  externalId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  phone: string | null;
  channel: string | null;
  status: string;
  tags: string[];
  createdAt: string;
}

interface CrmDeal {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: number | null;
  closeDate: string | null;
  contactIds: string[];
  createdAt: string;
}

export default function CrmPage() {
  const { status } = useSession();
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"contacts" | "deals">("contacts");

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      const qs = params.toString();
      const res = await fetch(`/api/dashboard/crm/contacts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch contacts");
      const data = await res.json();
      setContacts(data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contacts");
    }
  }, [searchQuery]);

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/crm/deals");
      if (!res.ok) throw new Error("Failed to fetch deals");
      const data = await res.json();
      setDeals(data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deals");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchContacts(), fetchDeals()]).finally(() => setLoading(false));
  }, [fetchContacts, fetchDeals]);

  if (status === "unauthenticated") redirect("/login");

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">CRM</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load CRM data</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                fetchContacts();
                fetchDeals();
              }}
            >
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
        <h1 className="text-2xl font-bold">CRM</h1>
        <p className="text-muted-foreground">Manage contacts and deals.</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex gap-2">
          <Button
            variant={activeTab === "contacts" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("contacts")}
          >
            <Users className="h-4 w-4 mr-2" />
            Contacts ({contacts.length})
          </Button>
          <Button
            variant={activeTab === "deals" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("deals")}
          >
            <Briefcase className="h-4 w-4 mr-2" />
            Deals ({deals.length})
          </Button>
        </div>
        {activeTab === "contacts" && (
          <div className="flex gap-2 ml-auto">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border rounded px-3 py-2 pl-9 text-sm w-64"
              />
            </div>
            <Button size="sm" onClick={fetchContacts}>
              Search
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : activeTab === "contacts" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts found.</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-6 gap-2 text-xs font-medium text-muted-foreground border-b pb-2">
                  <span>Name</span>
                  <span>Email</span>
                  <span>Company</span>
                  <span>Channel</span>
                  <span>Status</span>
                  <span>Created</span>
                </div>
                {contacts.map((c) => (
                  <div
                    key={c.id}
                    className="grid grid-cols-6 gap-2 text-sm py-2 border-b border-muted"
                  >
                    <span className="font-medium">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                    </span>
                    <span className="truncate">{c.email}</span>
                    <span>{c.company ?? "—"}</span>
                    <span className="capitalize">{c.channel ?? "—"}</span>
                    <span className="capitalize">{c.status}</span>
                    <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Deal Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deals found.</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-5 gap-2 text-xs font-medium text-muted-foreground border-b pb-2">
                  <span>Name</span>
                  <span>Stage</span>
                  <span>Amount</span>
                  <span>Close Date</span>
                  <span>Created</span>
                </div>
                {deals.map((d) => (
                  <div
                    key={d.id}
                    className="grid grid-cols-5 gap-2 text-sm py-2 border-b border-muted"
                  >
                    <span className="font-medium">{d.name}</span>
                    <span className="capitalize">{d.stage.replace(/-/g, " ")}</span>
                    <span>{d.amount != null ? `$${d.amount.toLocaleString()}` : "—"}</span>
                    <span>{d.closeDate ? new Date(d.closeDate).toLocaleDateString() : "—"}</span>
                    <span>{new Date(d.createdAt).toLocaleDateString()}</span>
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
