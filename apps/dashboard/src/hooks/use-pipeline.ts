"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface PipelineStage {
  stage: string;
  count: number;
  totalValue: number;
}

export interface PipelineSnapshot {
  organizationId: string;
  stages: PipelineStage[];
  totalContacts: number;
  totalRevenue: number;
  generatedAt: string;
}

async function fetchPipeline(): Promise<PipelineSnapshot> {
  const res = await fetch("/api/dashboard/pipeline");
  if (!res.ok) throw new Error("Failed to fetch pipeline");
  return res.json();
}

export function usePipeline() {
  return useQuery({
    queryKey: queryKeys.pipeline.snapshot(),
    queryFn: fetchPipeline,
    staleTime: 30_000,
  });
}
