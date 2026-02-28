"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface AuditEntryResponse {
  id: string;
  eventType: string;
  timestamp: string;
  actorType: string;
  actorId: string;
  entityType: string;
  entityId: string;
  riskCategory: string;
  summary: string;
  snapshot: Record<string, unknown>;
  envelopeId: string | null;
}

interface AuditResponse {
  entries: AuditEntryResponse[];
  total: number;
}

async function fetchAudit(params?: {
  eventType?: string;
  limit?: number;
}): Promise<AuditResponse> {
  const searchParams = new URLSearchParams();
  if (params?.eventType) searchParams.set("eventType", params.eventType);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const qs = searchParams.toString();
  const res = await fetch(`/api/dashboard/audit${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch audit");
  return res.json();
}

export function useAudit(params?: { eventType?: string; limit?: number }) {
  return useQuery({
    queryKey: queryKeys.audit.list({
      eventType: params?.eventType,
      limit: params?.limit?.toString(),
    }),
    queryFn: () => fetchAudit(params),
    refetchInterval: 30_000,
  });
}
