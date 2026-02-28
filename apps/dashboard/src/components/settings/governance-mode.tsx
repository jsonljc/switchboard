"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const modes = [
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

interface GovernanceModeProps {
  currentMode: string;
  onSave: (mode: string) => void;
  isLoading?: boolean;
}

export function GovernanceMode({ currentMode, onSave, isLoading }: GovernanceModeProps) {
  const [selected, setSelected] = useState(currentMode);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Governance Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={selected}
          onValueChange={setSelected}
          className="space-y-3"
        >
          {modes.map((mode) => (
            <div
              key={mode.value}
              className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <RadioGroupItem value={mode.value} id={mode.value} className="mt-0.5" />
              <Label htmlFor={mode.value} className="cursor-pointer flex-1">
                <span className="font-medium">{mode.label}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {mode.description}
                </p>
              </Label>
            </div>
          ))}
        </RadioGroup>
        <Button
          className="w-full min-h-[44px]"
          disabled={isLoading || selected === currentMode}
          onClick={() => onSave(selected)}
        >
          {isLoading ? "Saving..." : "Save Governance Profile"}
        </Button>
      </CardContent>
    </Card>
  );
}
