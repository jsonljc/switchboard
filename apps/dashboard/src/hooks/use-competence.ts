"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export interface CompetenceRecord {
  principalId: string;
  actionType: string;
  score: number;
  totalAttempts: number;
  successfulAttempts: number;
  lastAttemptAt: string;
}

export interface CompetencePolicy {
  id: string;
  actionTypePattern: string;
  minScore: number;
  effect: string;
  organizationId: string | null;
  createdAt: string;
}

async function fetchCompetenceRecords(principalId?: string): Promise<CompetenceRecord[]> {
  const params = new URLSearchParams();
  if (principalId) params.set("principalId", principalId);
  const res = await fetch(`/api/dashboard/competence?${params}`);
  if (!res.ok) throw new Error("Failed to fetch competence records");
  const data = await res.json();
  return data.items;
}

async function fetchCompetencePolicies(): Promise<CompetencePolicy[]> {
  const res = await fetch("/api/dashboard/competence/policies");
  if (!res.ok) throw new Error("Failed to fetch competence policies");
  const data = await res.json();
  return data.policies;
}

export function useCompetenceRecords(principalId?: string) {
  return useQuery({
    queryKey: queryKeys.competence.records(principalId),
    queryFn: () => fetchCompetenceRecords(principalId),
    refetchInterval: 30_000,
  });
}

export function useCompetencePolicies() {
  return useQuery({
    queryKey: queryKeys.competence.policies(),
    queryFn: fetchCompetencePolicies,
  });
}

export function useCreateCompetencePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { actionTypePattern: string; minScore: number; effect: string }) => {
      const res = await fetch("/api/dashboard/competence/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.competence.all });
    },
  });
}

export function useDeleteCompetencePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/dashboard/competence/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete policy");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.competence.all });
    },
  });
}
