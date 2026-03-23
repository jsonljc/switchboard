"use client";

import { useState, useCallback } from "react";

export interface ChatMessage {
  id: string;
  role: "operator" | "system";
  text: string;
  timestamp: Date;
  status?: "completed" | "failed" | "rejected" | "awaiting_confirmation";
}

export function useOperatorChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendCommand = useCallback(async (rawInput: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "operator",
      text: rawInput,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/dashboard/operator-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput, channel: "dashboard" }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const body = (await res.json()) as {
        commandId: string;
        status: string;
        message: string;
      };

      const systemMsg: ChatMessage = {
        id: body.commandId,
        role: "system",
        text: body.message,
        timestamp: new Date(),
        status: body.status as ChatMessage["status"],
      };
      setMessages((prev) => [...prev, systemMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "system",
        text: "Sorry, something went wrong. Please try again.",
        timestamp: new Date(),
        status: "failed",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { messages, isLoading, sendCommand };
}
