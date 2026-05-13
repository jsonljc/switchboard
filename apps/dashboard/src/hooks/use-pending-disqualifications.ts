"use client";

import { useQuery } from "@tanstack/react-query";

export interface PendingDisqualification {
  conversationThreadId: string;
  contactId: string;
  currentState: string;
  evidence: {
    candidates?: Array<{ type: string; evidence: string }>;
    candidateType?: string;
    evidenceQuote?: string;
    priorQualificationStatus?: string;
    workTraceId?: string;
  } | null;
}

async function fetchPendingDisqualifications(): Promise<{ items: PendingDisqualification[] }> {
  const res = await fetch("/api/dashboard/lifecycle/disqualifications");
  if (!res.ok) throw new Error(`Failed to load pending disqualifications: ${res.status}`);
  return res.json();
}

export function usePendingDisqualifications() {
  return useQuery({
    queryKey: ["lifecycle", "disqualifications", "pending"],
    queryFn: fetchPendingDisqualifications,
    refetchInterval: 60_000,
  });
}
