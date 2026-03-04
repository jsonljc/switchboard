"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, MessageSquare } from "lucide-react";

interface Conversation {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  status: string;
  currentIntent: string | null;
  firstReplyAt: string | null;
  lastActivityAt: string;
}

const STATUS_OPTIONS = [
  "",
  "active",
  "awaiting_clarification",
  "awaiting_approval",
  "completed",
  "expired",
];
const CHANNEL_OPTIONS = ["", "whatsapp", "telegram", "slack", "instagram", "messenger", "email"];

export default function ConversationsPage() {
  const { status: authStatus } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (channelFilter) params.set("channel", channelFilter);
      const qs = params.toString();
      const res = await fetch(`/api/dashboard/conversations${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load conversations");
      const data = await res.json();
      setConversations(data.conversations ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, channelFilter]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  if (authStatus === "unauthenticated") redirect("/login");

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Conversations</h1>
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Failed to load conversations</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchConversations}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusBadgeClass = (s: string) => {
    switch (s) {
      case "active":
        return "bg-green-100 text-green-800";
      case "awaiting_approval":
        return "bg-yellow-100 text-yellow-800";
      case "awaiting_clarification":
        return "bg-blue-100 text-blue-800";
      case "completed":
        return "bg-gray-100 text-gray-800";
      case "expired":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Conversations</h1>
        <p className="text-muted-foreground">
          {total} total conversation{total !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <label className="text-sm font-medium block mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt ? opt.replace(/_/g, " ") : "All statuses"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Channel</label>
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          >
            {CHANNEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt ? opt.charAt(0).toUpperCase() + opt.slice(1) : "All channels"}
              </option>
            ))}
          </select>
        </div>
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
              <MessageSquare className="h-4 w-4" />
              Conversations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No conversations found.</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-6 gap-2 text-xs font-medium text-muted-foreground border-b pb-2">
                  <span>Principal</span>
                  <span>Channel</span>
                  <span>Status</span>
                  <span>Intent</span>
                  <span>First Reply</span>
                  <span>Last Activity</span>
                </div>
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className="grid grid-cols-6 gap-2 text-sm py-2 border-b border-muted"
                  >
                    <span className="font-medium truncate">{c.principalId}</span>
                    <span className="capitalize">{c.channel}</span>
                    <span>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded-full ${statusBadgeClass(c.status)}`}
                      >
                        {c.status.replace(/_/g, " ")}
                      </span>
                    </span>
                    <span className="truncate">{c.currentIntent ?? "—"}</span>
                    <span>{c.firstReplyAt ? new Date(c.firstReplyAt).toLocaleString() : "—"}</span>
                    <span>{new Date(c.lastActivityAt).toLocaleString()}</span>
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
