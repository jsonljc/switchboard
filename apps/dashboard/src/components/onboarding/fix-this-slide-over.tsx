"use client";

import { useState } from "react";

type FixType = "wrong_info" | "tone_off" | "missing_context";

interface FixThisSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  onFix: (type: FixType, value: string) => void;
}

const FIX_OPTIONS: { type: FixType; label: string; description: string }[] = [
  {
    type: "wrong_info",
    label: "Wrong information",
    description: "The facts in this response are incorrect",
  },
  { type: "tone_off", label: "Tone is off", description: "Alex should say this differently" },
  {
    type: "missing_context",
    label: "Missing context",
    description: "Alex should know something it doesn't",
  },
];

export function FixThisSlideOver({ isOpen, onClose, onFix }: FixThisSlideOverProps) {
  const [selectedType, setSelectedType] = useState<FixType | null>(null);
  const [input, setInput] = useState("");

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (selectedType && input.trim()) {
      onFix(selectedType, input.trim());
      setSelectedType(null);
      setInput("");
      onClose();
    }
  };

  return (
    <div
      className="absolute right-0 top-0 h-full w-[320px] border-l bg-white transition-transform duration-200"
      style={{ borderColor: "var(--sw-border)" }}
    >
      <div
        className="flex items-center justify-between border-b p-4"
        style={{ borderColor: "var(--sw-border)" }}
      >
        <span className="text-[16px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
          What needs fixing?
        </span>
        <button onClick={onClose} className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
          ✕
        </button>
      </div>

      {!selectedType ? (
        <div>
          {FIX_OPTIONS.map((option) => (
            <button
              key={option.type}
              onClick={() => setSelectedType(option.type)}
              className="w-full border-b p-4 text-left transition-colors hover:bg-[var(--sw-surface)]"
              style={{ borderColor: "var(--sw-border)" }}
            >
              <p className="text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
                {option.label}
              </p>
              <p className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
                {option.description}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <label className="mb-2 block text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
            {selectedType === "tone_off"
              ? "How should Alex have said this?"
              : selectedType === "missing_context"
                ? "What should Alex know here?"
                : "What's incorrect?"}
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-[120px] w-full resize-none rounded-lg border p-4 text-[16px] outline-none focus:border-[var(--sw-accent)]"
            style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-primary)" }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="mt-3 h-[48px] w-full rounded-lg text-[16px] font-medium"
            style={{
              backgroundColor: "var(--sw-text-primary)",
              color: "white",
              opacity: input.trim() ? 1 : 0.4,
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
