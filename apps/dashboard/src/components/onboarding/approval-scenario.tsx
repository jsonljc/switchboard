"use client";

interface ScenarioOption {
  label: string;
  value: string;
}

interface ApprovalScenarioProps {
  question: string;
  prompt: string;
  options: ScenarioOption[];
  selected: string | undefined;
  onChange: (value: string) => void;
}

export function ApprovalScenario({
  question,
  prompt,
  options,
  selected,
  onChange,
}: ApprovalScenarioProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[16px] font-medium" style={{ color: "var(--sw-text-primary)" }}>
          {question}
        </p>
        <p className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
          {prompt}
        </p>
      </div>
      <div className="space-y-4">
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              data-scenario-option
              data-value={option.value}
              onClick={() => onChange(option.value)}
              className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all duration-200 hover:border-[var(--sw-border-strong)]"
              style={{
                borderColor: isSelected ? "var(--sw-accent)" : "var(--sw-border)",
                borderLeftWidth: isSelected ? "3px" : "1px",
                borderLeftColor: isSelected ? "var(--sw-accent)" : undefined,
                backgroundColor: "white",
              }}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                style={{ borderColor: isSelected ? "var(--sw-accent)" : "var(--sw-border)" }}
              >
                {isSelected && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "var(--sw-accent)" }}
                  />
                )}
              </span>
              <span className="text-[14px]" style={{ color: "var(--sw-text-primary)" }}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
