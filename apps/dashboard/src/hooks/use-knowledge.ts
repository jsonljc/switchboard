"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface KnowledgeDocument {
  documentId: string;
  fileName: string;
  sourceType: string;
  chunkCount: number;
  uploadedAt: string;
}

async function fetchDocuments(agentId?: string): Promise<{ documents: KnowledgeDocument[] }> {
  const params = agentId ? `?agentId=${agentId}` : "";
  const res = await fetch(`/api/dashboard/knowledge${params}`);
  if (!res.ok) throw new Error("Failed to fetch documents");
  return res.json();
}

export function useKnowledgeDocuments(agentId?: string) {
  return useQuery({
    queryKey: queryKeys.knowledge.documents(agentId),
    queryFn: () => fetchDocuments(agentId),
  });
}

export function useUploadKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { content: string; fileName: string; agentId?: string }) => {
      const res = await fetch("/api/dashboard/knowledge/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.all });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await fetch(`/api/dashboard/knowledge?documentId=${documentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.all });
    },
  });
}
