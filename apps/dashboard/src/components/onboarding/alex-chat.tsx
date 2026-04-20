"use client";

import { useState, useRef, useEffect } from "react";
import { AgentMark } from "@/components/character/agent-mark";
import { ChatMessage, type ChatMessageData } from "./chat-message";

interface AlexChatProps {
  messages: ChatMessageData[];
  onSendMessage: (text: string) => void;
  isTyping: boolean;
}

export function AlexChat({ messages, onSendMessage, isTyping }: AlexChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  useEffect(() => {
    if (isAtBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const messagesWithClusters = messages.map((msg, i) => ({
    ...msg,
    isFirstInCluster: i === 0 || messages[i - 1].role !== msg.role,
  }));

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messagesWithClusters.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isTyping && (
          <div className="flex items-center gap-2" data-testid="typing-indicator">
            <div className="shrink-0">
              <AgentMark agent="alex" size="xs" />
            </div>
            <div
              className="rounded-2xl px-4 py-3"
              style={{ backgroundColor: "var(--sw-surface-raised)" }}
            >
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_0ms] rounded-full bg-[var(--sw-text-muted)]" />
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_200ms] rounded-full bg-[var(--sw-text-muted)]" />
                <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_400ms] rounded-full bg-[var(--sw-text-muted)]" />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="border-t p-4" style={{ borderColor: "var(--sw-border)" }}>
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-[48px] w-full rounded-lg border bg-transparent px-4 text-[16px] outline-none transition-colors focus:border-[var(--sw-accent)]"
          style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-primary)" }}
        />
      </div>
    </div>
  );
}
