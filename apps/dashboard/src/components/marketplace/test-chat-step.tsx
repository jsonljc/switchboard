"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Rocket, Loader2 } from "lucide-react";
import type { WizardStepProps } from "./deploy-wizard-shell";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface TestChatStepProps extends WizardStepProps {
  onDeploy: () => void;
}

export function TestChatStep({ data, onDeploy }: TestChatStepProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || isLoading || !data.persona) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/dashboard/marketplace/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: data.persona,
          messages: updatedMessages,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? `Request failed: ${res.status}`);
      }

      const { reply } = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get response");
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Test your agent. This is a sandbox — nothing is sent to real customers.
      </div>

      {/* Chat messages */}
      <div className="border border-border rounded-lg h-80 overflow-y-auto p-4 space-y-3 bg-surface">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Say something to test your agent...
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      {/* Input */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isLoading}
        />
        <Button onClick={handleSend} disabled={!input.trim() || isLoading}>
          Send
        </Button>
      </div>

      {/* Deploy button */}
      <div className="border-t border-border pt-4">
        <Button onClick={onDeploy} size="lg" className="w-full">
          <Rocket className="h-4 w-4 mr-2" />
          Deploy — I'm happy with this agent
        </Button>
      </div>
    </div>
  );
}
