"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { Playbook } from "@switchboard/schemas";

interface PlaybookResponse {
  playbook: Playbook;
  step: number;
  complete: boolean;
}

interface PlaybookUpdate {
  playbook?: Playbook;
  step?: number;
}

async function fetchPlaybook(): Promise<PlaybookResponse> {
  const res = await fetch("/api/dashboard/playbook");
  if (!res.ok) throw new Error("Failed to fetch playbook");
  return res.json();
}

async function updatePlaybook(body: PlaybookUpdate): Promise<PlaybookResponse> {
  const res = await fetch("/api/dashboard/playbook", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update playbook");
  return res.json();
}

export function usePlaybook() {
  return useQuery({
    queryKey: queryKeys.playbook.current(),
    queryFn: fetchPlaybook,
  });
}

export function useUpdatePlaybook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePlaybook,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.playbook.current(), data);
    },
  });
}
