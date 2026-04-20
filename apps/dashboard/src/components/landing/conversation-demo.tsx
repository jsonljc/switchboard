"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  sender: "customer" | "alex";
  text: string;
}

const SCRIPT: { sender: "customer" | "alex"; text: string; delay: number }[] = [
  {
    sender: "alex",
    text: "Hi! Great timing — we're running a whitening special this month. Have you done whitening before, or would this be your first time?",
    delay: 1200,
  },
  { sender: "customer", text: "No, first time", delay: 1500 },
  {
    sender: "alex",
    text: "Perfect! Our first-timer package is $199 (normally $299). Want me to book you a free 15-min consultation this week?",
    delay: 1000,
  },
  { sender: "customer", text: "Yes please, Thursday works", delay: 1200 },
  {
    sender: "alex",
    text: "I can lock in Thursday at 2pm for you. You'll get a confirmation on WhatsApp shortly.",
    delay: 800,
  },
];

type DemoState = "idle" | "playing" | "complete";

export function ConversationDemo() {
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "customer",
      text: "Hi, I saw your ad for teeth whitening. How much is it?",
    },
  ]);
  const [state, setState] = useState<DemoState>("idle");
  const [showTyping, setShowTyping] = useState(false);
  const [scriptIndex, setScriptIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state !== "playing") return;

    if (scriptIndex >= SCRIPT.length) {
      setState("complete");
      return;
    }

    const step = SCRIPT[scriptIndex];

    if (step.sender === "alex") {
      setShowTyping(true);
      const timer = setTimeout(() => {
        setShowTyping(false);
        setMessages((prev) => [...prev, { sender: step.sender, text: step.text }]);
        setScriptIndex((i) => i + 1);
      }, step.delay);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setMessages((prev) => [...prev, { sender: step.sender, text: step.text }]);
        setScriptIndex((i) => i + 1);
      }, step.delay);
      return () => clearTimeout(timer);
    }
  }, [state, scriptIndex]);

  useEffect(() => {
    if (state !== "idle") return;
    const autoStart = setTimeout(() => {
      setState("playing");
    }, 3000);
    return () => clearTimeout(autoStart);
  }, [state]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, showTyping]);

  const handleInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const input = e.currentTarget;
    const value = input.value.trim();
    if (!value) return;
    input.value = "";

    setMessages((prev) => [...prev, { sender: "customer", text: value }]);

    if (state === "idle") {
      setState("playing");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Phone frame */}
      <div
        style={{
          width: "100%",
          maxWidth: "340px",
          background: "#FFFFFF",
          borderRadius: "2rem",
          border: "1px solid #DDD9D3",
          boxShadow: "0 8px 32px rgba(26,23,20,0.08)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.625rem",
            padding: "0.875rem 1rem",
            borderBottom: "1px solid #EDEAE5",
            background: "#F9F8F6",
          }}
        >
          <div
            style={{
              width: "2rem",
              height: "2rem",
              borderRadius: "9999px",
              background: "#EDEAE5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#6B6560",
            }}
          >
            A
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#1A1714" }}>Alex</span>
              <span style={{ fontSize: "0.75rem", color: "#9C958F" }}>Speed-to-Lead</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "9999px",
                  background: "#4CAF50",
                }}
              />
              <span style={{ fontSize: "0.625rem", color: "#4CAF50", fontWeight: 600 }}>
                Online
              </span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={containerRef}
          style={{
            height: "320px",
            overflowY: "auto",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.625rem",
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                alignSelf: msg.sender === "customer" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                padding: "0.625rem 0.875rem",
                borderRadius:
                  msg.sender === "customer" ? "1rem 1rem 0.25rem 1rem" : "1rem 1rem 1rem 0.25rem",
                background: msg.sender === "customer" ? "#DCF8C6" : "#F5F3F0",
                fontSize: "0.8125rem",
                lineHeight: 1.5,
                color: "#1A1714",
                animation: "fade-in 0.3s ease-out forwards",
              }}
            >
              {msg.text}
            </div>
          ))}
          {showTyping && (
            <div
              style={{
                alignSelf: "flex-start",
                padding: "0.625rem 0.875rem",
                borderRadius: "1rem 1rem 1rem 0.25rem",
                background: "#F5F3F0",
                display: "flex",
                gap: "0.25rem",
                alignItems: "center",
              }}
            >
              {[0, 1, 2].map((dot) => (
                <div
                  key={dot}
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "9999px",
                    background: "#9C958F",
                    animation: `typing-dot 1.2s ease-in-out ${dot * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div
          style={{
            borderTop: "1px solid #EDEAE5",
            padding: "0.625rem 1rem",
            background: "#F9F8F6",
          }}
        >
          <input
            type="text"
            placeholder="Type a message..."
            onKeyDown={handleInput}
            style={{
              width: "100%",
              border: "1px solid #DDD9D3",
              borderRadius: "1.5rem",
              padding: "0.5rem 0.875rem",
              fontSize: "0.8125rem",
              background: "#FFFFFF",
              outline: "none",
              color: "#1A1714",
            }}
          />
        </div>
      </div>

      {/* Result line */}
      {state === "complete" && (
        <p
          style={{
            marginTop: "1rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "#A07850",
            textAlign: "center",
            animation: "fade-in 0.5s ease-out forwards",
          }}
        >
          This conversation took 47 seconds. Your lead is booked.
        </p>
      )}
    </div>
  );
}
