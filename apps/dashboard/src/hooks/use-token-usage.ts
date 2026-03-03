"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface TokenUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenUsageTrendEntry {
  date: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenUsageData {
  daily: TokenUsageSummary;
  weekly: TokenUsageSummary;
  monthly: TokenUsageSummary;
  trend: TokenUsageTrendEntry[];
}

async function fetchTokenUsage(): Promise<TokenUsageData> {
  const [dailyRes, weeklyRes, monthlyRes, trendRes] = await Promise.all([
    fetch("/api/dashboard/token-usage?period=daily"),
    fetch("/api/dashboard/token-usage?period=weekly"),
    fetch("/api/dashboard/token-usage?period=monthly"),
    fetch("/api/dashboard/token-usage?days=7"),
  ]);

  const [dailyData, weeklyData, monthlyData, trendData] = await Promise.all([
    dailyRes.ok
      ? dailyRes.json()
      : { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    weeklyRes.ok
      ? weeklyRes.json()
      : { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    monthlyRes.ok
      ? monthlyRes.json()
      : { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    trendRes.ok ? trendRes.json() : { trend: [] },
  ]);

  return {
    daily: dailyData.usage,
    weekly: weeklyData.usage,
    monthly: monthlyData.usage,
    trend: trendData.trend,
  };
}

export function useTokenUsage() {
  return useQuery({
    queryKey: queryKeys.tokenUsage.all,
    queryFn: fetchTokenUsage,
    refetchInterval: 60_000,
  });
}
