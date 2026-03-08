"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

const WORKING_STYLES = [
  { id: "concise", label: "Concise & Direct", description: "Brief updates, no fluff." },
  { id: "friendly", label: "Friendly & Warm", description: "Conversational and approachable." },
  { id: "professional", label: "Professional & Detailed", description: "Thorough and formal." },
];

interface StepOperatorProps {
  operatorName: string;
  onNameChange: (name: string) => void;
  workingStyle: string;
  onStyleChange: (style: string) => void;
}

export function StepOperator({
  operatorName,
  onNameChange,
  workingStyle,
  onStyleChange,
}: StepOperatorProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20">
        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium">Name your AI operator</p>
          <p className="text-xs text-muted-foreground">
            This is the lead member of your AI team. They coordinate everything.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="operator-name">Operator name</Label>
        <Input
          id="operator-name"
          placeholder="Ava"
          value={operatorName}
          onChange={(e) => onNameChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">You can change this anytime in Settings.</p>
      </div>

      <div className="space-y-2">
        <Label>How should they communicate?</Label>
        <div className="space-y-2">
          {WORKING_STYLES.map((style) => (
            <Card
              key={style.id}
              className={cn(
                "cursor-pointer transition-colors",
                workingStyle === style.id
                  ? "border-primary bg-primary/5"
                  : "hover:border-primary/30",
              )}
              onClick={() => onStyleChange(style.id)}
            >
              <CardContent className="p-3">
                <p className="text-sm font-medium">{style.label}</p>
                <p className="text-xs text-muted-foreground">{style.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
