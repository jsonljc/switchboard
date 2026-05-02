"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export interface ConversationListItem {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  organizationId: string | null;
  status: string;
  currentIntent: string | null;
  firstReplyAt: string | null;
  lastActivityAt: string;
}

export interface ConversationDetail {
  id: string;
  threadId: string;
  channel: string;
  principalId: string;
  organizationId: string | null;
  status: string;
  currentIntent: string | null;
  firstReplyAt: string | null;
  lastActivityAt: string;
  messages: Array<{ role: string; text: string; timestamp: string }>;
}

async function fetchConversations(filters?: {
  status?: string;
}): Promise<{ conversations: ConversationListItem[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== "all") params.set("status", filters.status);
  params.set("limit", "100");
  const qs = params.toString();
  const res = await fetch(`/api/dashboard/conversations${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error("Failed to fetch conversations");
  }
  const data = (await res.json()) as {
    conversations: ConversationListItem[];
    total: number;
  };
  return data;
}

async function fetchConversationDetail(id: string): Promise<ConversationDetail> {
  const res = await fetch(`/api/dashboard/conversations/${id}`);
  if (!res.ok) {
    throw new Error("Failed to fetch conversation");
  }
  return (await res.json()) as ConversationDetail;
}

export function useConversations(filters?: { status?: string }) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.conversations.list({ status: filters?.status }) ?? [
      "__disabled_conversations_list__",
    ],
    queryFn: () => fetchConversations(filters),
    refetchInterval: 30_000,
    enabled: !!keys,
  });
}

export function useConversationDetail(id: string | null) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.conversations.detail(id ?? "") ?? ["__disabled_conversations_detail__"],
    queryFn: () => fetchConversationDetail(id!),
    enabled: !!id && !!keys,
    refetchInterval: 15_000,
  });
}
