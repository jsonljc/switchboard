"use client";
import { useState } from "react";

interface OwnerTaskRowProps {
  id: string;
  title: string;
  dueAt: string | null;
  isOverdue: boolean;
  onComplete: (id: string) => void;
}

export function OwnerTaskRow({ id, title, dueAt, isOverdue, onComplete }: OwnerTaskRowProps) {
  const [completed, setCompleted] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 20px",
        opacity: completed ? 0.5 : 1,
        transition: "opacity 200ms ease-out",
      }}
    >
      <button
        onClick={() => {
          setCompleted(true);
          onComplete(id);
        }}
        disabled={completed}
        style={{
          width: "20px",
          height: "20px",
          borderRadius: "4px",
          border: completed ? "none" : "1px solid var(--sw-border)",
          background: completed ? "var(--sw-accent)" : "transparent",
          cursor: completed ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "background 200ms ease-out, border-color 200ms ease-out",
        }}
      >
        {completed && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 6l3 3 5-5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <span
        style={{
          flex: 1,
          fontSize: "16px",
          color: "var(--sw-text-primary)",
          textDecoration: completed ? "line-through" : "none",
        }}
      >
        {title}
      </span>
      {dueAt && (
        <span
          style={{
            fontSize: "13px",
            color: isOverdue ? "hsl(0, 38%, 40%)" : "var(--sw-text-muted)",
          }}
        >
          {isOverdue
            ? "Overdue"
            : new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}
