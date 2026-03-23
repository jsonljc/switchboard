"use client";

import type { ChatMessage } from "./use-operator-chat";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOperator = message.role === "operator";

  return (
    <div className={`flex ${isOperator ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isOperator
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
        <span className="mt-1 block text-xs opacity-60">
          {message.timestamp.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
