"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
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
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.playbook.current() ?? ["__disabled_playbook_current__"],
    queryFn: fetchPlaybook,
    enabled: !!keys,
  });
}

export function useUpdatePlaybook() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: updatePlaybook,
    onSuccess: (data) => {
      if (keys) queryClient.setQueryData(keys.playbook.current(), data);
    },
  });
}
