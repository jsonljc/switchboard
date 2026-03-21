"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useSendTestMessage, useCreateCorrection } from "@/hooks/use-test-chat";

interface Message {
  role: "user" | "assistant";
  text: string;
  confidence?: number;
  flagged?: boolean;
  corrected?: boolean;
}

interface TestChatWidgetProps {
  agentId: string;
}

export function TestChatWidget({ agentId }: TestChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [correctionInput, setCorrectionInput] = useState<Record<number, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const sendMessage = useSendTestMessage();
  const createCorrection = useCreateCorrection();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    const conversationHistory = messages.map((m) => ({
      role: m.role,
      text: m.text,
    }));

    sendMessage.mutate(
      {
        agentId,
        message: input,
        conversationHistory,
      },
      {
        onSuccess: (data) => {
          const assistantMessage: Message = {
            role: "assistant",
            text: data.reply,
            confidence: data.confidence,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        },
        onError: () => {
          toast({ title: "Failed to send message", variant: "destructive" });
        },
      },
    );
  };

  const handleFlag = (index: number) => {
    setMessages((prev) => prev.map((msg, i) => (i === index ? { ...msg, flagged: true } : msg)));
  };

  const handleSubmitCorrection = (index: number) => {
    const correction = correctionInput[index];
    if (!correction?.trim()) {
      toast({ title: "Please enter a correction", variant: "destructive" });
      return;
    }

    const wrongAnswer = messages[index].text;

    createCorrection.mutate(
      {
        agentId,
        wrongAnswer,
        correctAnswer: correction,
      },
      {
        onSuccess: () => {
          setMessages((prev) =>
            prev.map((msg, i) => (i === index ? { ...msg, corrected: true, flagged: false } : msg)),
          );
          setCorrectionInput((prev) => {
            const updated = { ...prev };
            delete updated[index];
            return updated;
          });
          toast({ title: "Correction saved" });
        },
        onError: () => {
          toast({ title: "Failed to save correction", variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="border rounded-lg bg-background">
      <div className="p-4 border-b">
        <h2 className="text-[16px] font-medium">Test Chat</h2>
        <p className="text-[13px] text-muted-foreground mt-1">
          Send messages to test your agent's responses
        </p>
      </div>

      <div className="h-[400px] overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-lg px-4 py-2",
                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              <p className="text-[14px]">{msg.text}</p>
              {msg.role === "assistant" && msg.confidence !== undefined && (
                <p className="text-[12px] text-muted-foreground mt-1">
                  Confidence: {Math.round(msg.confidence * 100)}%
                </p>
              )}
              {msg.role === "assistant" && msg.corrected && (
                <span className="inline-block mt-2 px-2 py-1 bg-green-100 text-green-800 text-[12px] rounded">
                  Corrected
                </span>
              )}
              {msg.role === "assistant" && !msg.corrected && !msg.flagged && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleFlag(idx)}
                  className="mt-2 h-7 text-[12px]"
                >
                  Flag wrong answer
                </Button>
              )}
              {msg.role === "assistant" && msg.flagged && !msg.corrected && (
                <div className="mt-2 space-y-2">
                  <Input
                    placeholder="Enter correct answer..."
                    value={correctionInput[idx] || ""}
                    onChange={(e) =>
                      setCorrectionInput((prev) => ({
                        ...prev,
                        [idx]: e.target.value,
                      }))
                    }
                    className="text-[13px]"
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSubmitCorrection(idx)}
                    disabled={createCorrection.isPending}
                    className="h-7 text-[12px]"
                  >
                    {createCorrection.isPending ? "Saving..." : "Submit correction"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t flex gap-2">
        <Input
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sendMessage.isPending}
        />
        <Button onClick={handleSend} disabled={sendMessage.isPending || !input.trim()}>
          {sendMessage.isPending ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
