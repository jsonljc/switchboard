"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { AuditEntryResponse } from "./use-audit";

export interface SpendSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  dailyTrend: { date: string; amount: number }[];
  actionsToday: number;
  deniedToday: number;
}

function computeSpendSummary(entries: AuditEntryResponse[]): SpendSummary {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let today = 0;
  let thisWeek = 0;
  let thisMonth = 0;
  let actionsToday = 0;
  let deniedToday = 0;
  const dailyMap = new Map<string, number>();

  // Initialize last 7 days
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - i);
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }

  for (const entry of entries) {
    const ts = new Date(entry.timestamp);
    const dateKey = ts.toISOString().slice(0, 10);
    const isExecuted = entry.eventType === "action.executed";
    const isDenied = entry.eventType === "action.denied";

    // Extract spend amount from snapshot
    const snapshot = entry.snapshot as Record<string, unknown>;
    const spend =
      (snapshot?.dollarsAtRisk as number) ??
      (snapshot?.amount as number) ??
      0;

    if (isExecuted && spend > 0) {
      if (ts >= monthStart) thisMonth += spend;
      if (ts >= weekStart) thisWeek += spend;
      if (ts >= todayStart) today += spend;

      if (dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, (dailyMap.get(dateKey) ?? 0) + spend);
      }
    }

    if (ts >= todayStart) {
      if (isExecuted) actionsToday++;
      if (isDenied) deniedToday++;
    }
  }

  const dailyTrend = Array.from(dailyMap.entries()).map(([date, amount]) => ({
    date,
    amount,
  }));

  return { today, thisWeek, thisMonth, dailyTrend, actionsToday, deniedToday };
}

async function fetchSpendSummary(): Promise<SpendSummary> {
  const res = await fetch("/api/dashboard/audit?limit=500");
  if (!res.ok) throw new Error("Failed to fetch spend data");
  const data = await res.json();
  return computeSpendSummary(data.entries);
}

export function useSpend() {
  return useQuery({
    queryKey: queryKeys.spend.summary(),
    queryFn: fetchSpendSummary,
    refetchInterval: 60_000,
  });
}
