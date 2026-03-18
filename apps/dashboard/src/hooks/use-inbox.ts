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
  if (!res.ok) throw new Error("Failed to fetch inbox count");
  const data = await res.json();
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
