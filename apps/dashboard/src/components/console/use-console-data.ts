"use client";

import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import { useEscalations } from "@/hooks/use-escalations";
import { useOrgConfig } from "@/hooks/use-org-config";
import { useModuleStatus } from "@/hooks/use-module-status";
import { useAudit } from "@/hooks/use-audit";
import type { ConsoleData } from "./console-data";
import { consoleFixture } from "./console-data";
import {
  mapConsoleData,
  type ApprovalApiRow,
  type AuditEntry,
  type EscalationApiRow,
} from "./console-mappers";

/**
 * Single composer for the Console view-model.
 *
 * Option B (this file): wires real hooks where the backend already serves
 * the data. Numbers cells the backend can't yet produce render as `—`.
 * Recommendation cards aren't emitted (no aggregated `nova.drafts` feed yet).
 * Per-agent today-stats render as "pending option C".
 *
 * Option C (future): extends `DashboardOverview` to add
 * revenueToday / spendToday / replyTime / per-agent today-stats /
 * approval-gate stage progress / recommendation confidence /
 * activity agent attribution / aggregated ad-set rows.
 */
export function useConsoleData(): {
  data: ConsoleData;
  isLoading: boolean;
  error: Error | null;
} {
  const overview = useDashboardOverview();
  const escalations = useEscalations();
  const org = useOrgConfig();
  const modules = useModuleStatus();
  const audit = useAudit();

  const isLoading =
    overview.isLoading ||
    escalations.isLoading ||
    org.isLoading ||
    modules.isLoading ||
    audit.isLoading;

  const error =
    (overview.error as Error | null) ??
    (escalations.error as Error | null) ??
    (org.error as Error | null) ??
    (modules.error as Error | null) ??
    (audit.error as Error | null) ??
    null;

  if (isLoading || error || !overview.data || !org.data) {
    return { data: consoleFixture, isLoading, error };
  }

  const escalationRows: EscalationApiRow[] =
    (escalations.data as { escalations?: EscalationApiRow[] } | undefined)?.escalations ?? [];
  const approvalRows: ApprovalApiRow[] = overview.data.approvals as ApprovalApiRow[];

  const auditEntries: AuditEntry[] = (audit.data?.entries ?? []).map((e) => ({
    id: e.id,
    action: e.eventType,
    actorId: e.actorId ?? null,
    createdAt: e.timestamp,
    agent: e.agent ?? null,
  })) as AuditEntry[];

  const moduleList = (modules.data ?? []) as Array<{ id: string; state: string }>;
  const moduleEnabled = (id: string) => moduleList.some((m) => m.id === id && m.state === "live");
  const moduleMap = {
    alex: moduleEnabled("lead-to-booking"),
    nova: moduleEnabled("ad-optimizer"),
    mira: moduleEnabled("creative"),
  };

  const orgName = (org.data as { config?: { name?: string } })?.config?.name ?? "Switchboard";

  const data = mapConsoleData({
    orgName,
    now: new Date(),
    dispatch: "live", // TODO option C: read halt-state from useDispatchStatus or org config
    leadsToday: overview.data.today.leads.count,
    leadsYesterday: overview.data.today.leads.yesterdayCount,
    bookingsToday: overview.data.today.appointments.next
      ? [
          {
            startsAt: overview.data.today.appointments.next.startsAt,
            contactName: overview.data.today.appointments.next.contactName,
          },
        ]
      : [],
    revenue: overview.data.today.revenue,
    replyTime: overview.data.today.replyTime,
    escalations: escalationRows,
    approvals: approvalRows,
    modules: moduleMap,
    auditEntries,
    alex: overview.data.agentsToday.alex,
    nova: overview.data.agentsToday.nova,
    mira: overview.data.agentsToday.mira,
    todaySpend:
      overview.data.today.spend.updatedAt === null
        ? null
        : {
            amount: overview.data.today.spend.amount,
            currency: overview.data.today.spend.currency,
          },
  });

  return { data, isLoading: false, error: null };
}
