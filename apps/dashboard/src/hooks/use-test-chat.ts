"use client";

import { useMutation } from "@tanstack/react-query";

interface TestChatResponse {
  reply: string;
  confidence: number;
  kbChunksUsed: number;
  kbContext: string;
  mode: string;
}

export function useSendTestMessage() {
  return useMutation({
    mutationFn: async (data: {
      agentId: string;
      message: string;
      conversationHistory?: Array<{ role: string; text: string }>;
    }): Promise<TestChatResponse> => {
      const res = await fetch("/api/dashboard/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
  });
}

export function useCreateCorrection() {
  return useMutation({
    mutationFn: async (data: { agentId: string; wrongAnswer: string; correctAnswer: string }) => {
      const res = await fetch("/api/dashboard/knowledge/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create correction");
      return res.json();
    },
  });
}

export function useGoLive() {
  return useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`/api/dashboard/agents/go-live/${agentId}`, {
        method: "PUT",
      });
      if (!res.ok) throw new Error("Failed to go live");
      return res.json();
    },
  });
}
