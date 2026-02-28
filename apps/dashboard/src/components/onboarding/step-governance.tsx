"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

const profiles = [
  {
    value: "observe",
    label: "Observe",
    description: "Most permissive. AI acts freely with minimal oversight. Good for testing.",
  },
  {
    value: "guarded",
    label: "Guarded",
    description: "Default mode. Normal guardrails apply, approval required for risky actions.",
  },
  {
    value: "strict",
    label: "Strict",
    description: "Elevated oversight. More actions require approval. Recommended for new setups.",
  },
  {
    value: "locked",
    label: "Locked",
    description: "Maximum security. All actions require approval. Use during incidents or audits.",
  },
];

interface StepGovernanceProps {
  selected: string;
  onChange: (value: string) => void;
}

export function StepGovernance({ selected, onChange }: StepGovernanceProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        Choose how much oversight your AI agent should have. You can change this later.
      </p>
      <RadioGroup
        value={selected}
        onValueChange={onChange}
        className="space-y-3"
      >
        {profiles.map((profile) => (
          <div
            key={profile.value}
            className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <RadioGroupItem value={profile.value} id={`gov-${profile.value}`} className="mt-0.5" />
            <Label htmlFor={`gov-${profile.value}`} className="cursor-pointer flex-1">
              <span className="font-medium">{profile.label}</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {profile.description}
              </p>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
