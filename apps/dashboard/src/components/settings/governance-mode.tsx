"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const modes = [
  {
    value: "observe",
    label: "Let them handle it",
    description: "Your operator handles routine work and only surfaces exceptions.",
  },
  {
    value: "guarded",
    label: "Ask me for big decisions",
    description: "Routine work can run, but spend and major changes come back to you.",
  },
  {
    value: "locked",
    label: "Ask me for everything",
    description: "Nothing happens without your approval. Maximum oversight.",
  },
];

interface GovernanceModeProps {
  currentMode: string;
  onSave: (mode: string) => void;
  isLoading?: boolean;
}

export function GovernanceMode({ currentMode, onSave, isLoading }: GovernanceModeProps) {
  const normalizedCurrentMode = currentMode === "strict" ? "guarded" : currentMode;
  const [selected, setSelected] = useState(normalizedCurrentMode);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How your assistant works</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={selected} onValueChange={setSelected} className="space-y-3">
          {modes.map((mode) => (
            <div
              key={mode.value}
              className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <RadioGroupItem value={mode.value} id={mode.value} className="mt-0.5" />
              <Label htmlFor={mode.value} className="cursor-pointer flex-1">
                <span className="font-medium">{mode.label}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{mode.description}</p>
              </Label>
            </div>
          ))}
        </RadioGroup>
        <Button
          className="w-full min-h-[44px]"
          disabled={isLoading || selected === normalizedCurrentMode}
          onClick={() => onSave(selected)}
        >
          {isLoading ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
