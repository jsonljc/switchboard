"use client";

import { useState, useRef, useEffect } from "react";
import { useOperatorChat } from "./use-operator-chat";
import { MessageBubble } from "./message-bubble";

export function OperatorChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, isLoading, sendCommand } = useOperatorChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    sendCommand(trimmed);
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-blue-600 p-3 text-white shadow-lg hover:bg-blue-700"
        aria-label="Operator Chat"
      >
        {isOpen ? "Close" : "Chat"}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-16 right-4 z-50 flex h-96 w-80 flex-col rounded-lg border bg-white shadow-xl dark:bg-gray-800">
          {/* Header */}
          <div className="border-b px-4 py-2">
            <h3 className="text-sm font-semibold">Operator Chat</h3>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-center text-xs text-gray-400">
                Type a command like &quot;show pipeline&quot; or &quot;pause low-performing
                ads&quot;
              </p>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t p-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command..."
              disabled={isLoading}
              className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700"
            />
          </form>
        </div>
      )}
    </>
  );
}
