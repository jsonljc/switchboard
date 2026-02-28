"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";

type RiskTolerance = {
  none: string;
  low: string;
  medium: string;
  high: string;
  critical: string;
};

const presets: { name: string; description: string; values: RiskTolerance }[] = [
  {
    name: "Conservative",
    description: "Requires approval for everything except low-risk actions",
    values: { none: "none", low: "none", medium: "standard", high: "elevated", critical: "mandatory" },
  },
  {
    name: "Moderate",
    description: "Balanced approach - auto-approves low and medium risk",
    values: { none: "none", low: "none", medium: "none", high: "standard", critical: "elevated" },
  },
  {
    name: "Aggressive",
    description: "Only requires approval for critical actions",
    values: { none: "none", low: "none", medium: "none", high: "none", critical: "standard" },
  },
];

interface RiskToleranceProps {
  currentValues: RiskTolerance;
  onSave: (values: RiskTolerance) => void;
  isLoading?: boolean;
}

export function RiskToleranceSettings({ currentValues, onSave, isLoading }: RiskToleranceProps) {
  const currentPreset = presets.find(
    (p) => JSON.stringify(p.values) === JSON.stringify(currentValues)
  );
  const [selected, setSelected] = useState(currentPreset?.name ?? "Custom");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Risk Tolerance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={selected}
          onValueChange={setSelected}
          className="space-y-3"
        >
          {presets.map((preset) => (
            <div key={preset.name} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
              <RadioGroupItem value={preset.name} id={preset.name} className="mt-0.5" />
              <Label htmlFor={preset.name} className="cursor-pointer flex-1">
                <span className="font-medium">{preset.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {preset.description}
                </p>
              </Label>
            </div>
          ))}
        </RadioGroup>
        <Button
          className="w-full min-h-[44px]"
          disabled={isLoading || selected === currentPreset?.name}
          onClick={() => {
            const preset = presets.find((p) => p.name === selected);
            if (preset) onSave(preset.values);
          }}
        >
          {isLoading ? "Saving..." : "Save Risk Tolerance"}
        </Button>
      </CardContent>
    </Card>
  );
}
