"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { redirect, useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, AlertTriangle, User, MessageSquare, Hand, DollarSign } from "lucide-react";

interface Contact {
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

interface Deal {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  status: string;
  currentIntent: string | null;
  firstReplyAt: string | null;
  lastActivityAt: string;
  messages?: Array<{ role: string; text: string; timestamp: string }>;
}

type LeadStage = "NEW" | "QUALIFIED" | "BOOKED" | "LOST";

const STAGE_MAP: Record<string, LeadStage> = {
  consultation_booked: "BOOKED",
  booked: "BOOKED",
  appointment_scheduled: "BOOKED",
  qualified: "QUALIFIED",
  lead: "NEW",
  closed_lost: "LOST",
};

const STAGE_BADGE_CLASS: Record<LeadStage, string> = {
  NEW: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  QUALIFIED: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  BOOKED: "bg-green-100 text-green-800 hover:bg-green-100",
  LOST: "bg-red-100 text-red-800 hover:bg-red-100",
};

export default function LeadDetailPage() {
  const { status: authStatus } = useSession();
  const params = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidAmount, setMarkPaidAmount] = useState("");
  const [markPaidRef, setMarkPaidRef] = useState("");
  const [markPaidLoading, setMarkPaidLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch contact
      const contactRes = await fetch(`/api/dashboard/crm/contacts/${params.id}`);
      if (!contactRes.ok) throw new Error("Contact not found");
      const contactData = await contactRes.json();
      const c: Contact = contactData.contact;
      setContact(c);

      // Fetch deals for this contact
      const dealsRes = await fetch(`/api/dashboard/crm/deals?contactId=${params.id}`);
      if (dealsRes.ok) {
        const dealsData = await dealsRes.json();
        setDeals(dealsData.data ?? []);
      }

      // Fetch conversation by principalId match (externalId or channel-specific ID)
      const lookupId = c.externalId ?? c.phone ?? c.email;
      if (lookupId) {
        const convsRes = await fetch(
          `/api/dashboard/conversations?principalId=${encodeURIComponent(lookupId)}&limit=1`,
        );
        if (convsRes.ok) {
          const convsData = await convsRes.json();
          const match = (convsData.conversations ?? [])[0] as Conversation | undefined;
          if (match) {
            // Fetch full conversation with messages
            const fullRes = await fetch(`/api/dashboard/conversations/${match.id}`);
            if (fullRes.ok) {
              const fullData = await fullRes.json();
              setConversation(fullData);
            } else {
              setConversation(match);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lead");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (authStatus === "unauthenticated") redirect("/login");

  const stage: LeadStage = deals.length > 0 ? (STAGE_MAP[deals[0]!.stage] ?? "NEW") : "NEW";

  const isOverridden = conversation?.status === "human_override";

  const toggleOverride = async () => {
    if (!conversation) return;
    setOverrideLoading(true);
    try {
      const res = await fetch(`/api/dashboard/conversations/${conversation.id}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ override: !isOverridden }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversation((prev) => (prev ? { ...prev, status: data.status } : prev));
      }
    } finally {
      setOverrideLoading(false);
    }
  };

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
        fetchData();
      }
    } finally {
      setMarkPaidLoading(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href="/leads"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Leads
        </Link>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!contact) return null;

  const displayName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || "Unknown";

  // Parse conversation messages from the conversations endpoint
  // Messages are stored as JSON in the ConversationState
  const messages: Array<{ role: string; text: string; timestamp: string }> =
    conversation?.messages ?? [];

  return (
    <div className="space-y-6">
      <Link
        href="/leads"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Leads
      </Link>

      {/* Contact card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {displayName}
            </CardTitle>
            <Badge className={STAGE_BADGE_CLASS[stage]}>{stage}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground block">Channel</span>
              <span className="capitalize">{contact.channel ?? "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Email</span>
              <span>{contact.email ?? "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Phone</span>
              <span>{contact.phone ?? "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Source</span>
              <span>{contact.sourceAdId ? "Ad" : "Organic"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Assigned</span>
              <span>{contact.assignedStaffId ?? "Unassigned"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Created</span>
              <span>{new Date(contact.createdAt).toLocaleDateString()}</span>
            </div>
            {deals.length > 0 && (
              <div>
                <span className="text-muted-foreground block">Deal Stage</span>
                <span className="capitalize">{deals[0]!.stage.replace(/_/g, " ")}</span>
              </div>
            )}
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
                        disabled={
                          markPaidLoading || !markPaidAmount || parseFloat(markPaidAmount) <= 0
                        }
                        className="w-full"
                      >
                        {markPaidLoading ? "Recording..." : "Record Payment"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Take over / handoff control */}
      {conversation && (
        <div className="flex items-center gap-3">
          <Button
            variant={isOverridden ? "default" : "outline"}
            size="sm"
            onClick={toggleOverride}
            disabled={overrideLoading}
          >
            <Hand className="h-4 w-4 mr-2" />
            {isOverridden ? "Resume AI" : "Take Over"}
          </Button>
          {isOverridden && (
            <span className="text-sm text-muted-foreground">
              AI is paused. Messages are recorded but not auto-replied.
            </span>
          )}
        </div>
      )}

      {/* Conversation thread */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Conversation
            {conversation && (
              <Badge variant="outline" className="ml-2">
                {conversation.status.replace(/_/g, " ")}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conversation history found.</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "assistant" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === "assistant"
                        ? "bg-muted text-foreground"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                    <span className="text-[10px] opacity-60 block mt-1">
                      {new Date(msg.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
