"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

/**
 * Defensive response types for GET /api/dashboard/escalations/:id.
 *
 * The upstream `conversationHistory` is raw JSONB (`unknown[]` at the
 * api-client boundary) and the snapshot fields are stubbed/empty for most
 * current producers — so every field below the escalation id is optional and
 * the sheet renders if-present. Correctness traps:
 *   - turns use `text` (not `content`); role "user" = lead, "owner" = operator.
 *   - `timestamp` is ISO.
 */
export interface ConversationTurn {
  role?: string;
  text?: string;
  timestamp?: string;
}

export interface LeadSnapshot {
  leadId?: string;
  name?: string;
  phone?: string;
  email?: string;
  serviceInterest?: string;
  channel?: string;
  source?: string;
}

export interface QualificationSnapshot {
  qualificationStage?: string;
  leadScore?: number;
  signalsCaptured?: Record<string, unknown>;
}

export interface ConversationSummary {
  turnCount?: number;
  keyTopics?: string[];
  objectionHistory?: string[];
  sentiment?: string;
  suggestedOpening?: string;
}

export interface EscalationDetail {
  id: string;
  reason?: string;
  status?: string;
  slaDeadlineAt?: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  createdAt?: string;
  leadSnapshot?: LeadSnapshot;
  qualificationSnapshot?: QualificationSnapshot;
  conversationSummary?: ConversationSummary;
}

export interface EscalationDetailResponse {
  escalation: EscalationDetail;
  conversationHistory: ConversationTurn[];
}

async function fetchEscalationDetail(id: string): Promise<EscalationDetailResponse> {
  const res = await fetch(`/api/dashboard/escalations/${id}`);
  if (!res.ok) throw new Error(`Failed to load escalation (HTTP ${res.status})`);
  return res.json();
}

/**
 * Read query for a single escalation detail. Owned by the HandoffDetailSheet
 * (single mounted instance — never list-iterated). Mirrors `use-decision-feed`:
 * scoped query key + `enabled` guard so it never fires without a session or id.
 */
export function useEscalationDetail(id: string) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.escalations.detail(id) ?? ["__disabled_escalation_detail__", id],
    queryFn: () => fetchEscalationDetail(id),
    enabled: !!keys && !!id,
  });
}
