"use client";

export interface TestPrompt {
  id: string;
  category: string;
  text: string;
  recommended: boolean;
}

interface PromptCardProps {
  prompt: TestPrompt;
  isActive: boolean;
  isTested: boolean;
  onClick: () => void;
}

export function PromptCard({ prompt, isActive, isTested, onClick }: PromptCardProps) {
  return (
    <div>
      {prompt.recommended && (
        <span
          className="mb-1 inline-block rounded-full px-2 py-0.5 text-[12px]"
          style={{ color: "var(--sw-accent)", backgroundColor: "rgba(160, 120, 80, 0.1)" }}
        >
          Start here
        </span>
      )}
      <button
        onClick={onClick}
        className="w-full rounded-lg border p-4 text-left text-[14px] transition-all duration-200"
        style={{
          borderColor: isActive ? "var(--sw-accent)" : "var(--sw-border)",
          borderLeftWidth: isActive ? "3px" : "1px",
          borderLeftColor: isActive ? "var(--sw-accent)" : undefined,
          backgroundColor: "var(--sw-surface-raised)",
          color: "var(--sw-text-primary)",
        }}
      >
        <span className="line-clamp-2">{prompt.text}</span>
        {isTested && (
          <span className="mt-1 block text-[12px]" style={{ color: "var(--sw-text-muted)" }}>
            ✓
          </span>
        )}
      </button>
    </div>
  );
}
