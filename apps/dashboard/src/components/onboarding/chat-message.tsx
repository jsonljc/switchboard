"use client";

import { AgentMark } from "@/components/character/agent-mark";

export interface ChatMessageData {
  id: string;
  role: "alex" | "user";
  text: string;
  isFirstInCluster?: boolean;
}

interface ChatMessageProps {
  message: ChatMessageData;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isAlex = message.role === "alex";

  return (
    <div className={`flex gap-2 ${isAlex ? "justify-start" : "justify-end"}`}>
      {isAlex && message.isFirstInCluster && (
        <div className="mt-1 shrink-0">
          <AgentMark agent="alex" size="xs" />
        </div>
      )}
      {isAlex && !message.isFirstInCluster && <div className="w-6 shrink-0" />}
      <div
        className="max-w-[85%] rounded-2xl px-4 py-3 text-[16px] leading-[24px]"
        style={
          isAlex
            ? { backgroundColor: "var(--sw-surface-raised)", color: "var(--sw-text-primary)" }
            : { backgroundColor: "rgba(160, 120, 80, 0.1)", color: "var(--sw-accent)" }
        }
      >
        {message.text}
      </div>
    </div>
  );
}
