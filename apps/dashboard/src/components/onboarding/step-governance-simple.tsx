"use client";

import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";

const GOVERNANCE_OPTIONS = [
  {
    id: "observe",
    label: "Let them handle it",
    description: "Your operator handles routine work and only surfaces exceptions.",
    icon: ShieldCheck,
  },
  {
    id: "guarded",
    label: "Ask me for big decisions",
    description: "Routine work can run, but spend and major changes come back to you.",
    icon: ShieldAlert,
  },
  {
    id: "locked",
    label: "Ask me for everything",
    description: "Nothing happens without your approval. Maximum oversight.",
    icon: Shield,
  },
];

interface StepGovernanceSimpleProps {
  selected: string;
  onChange: (value: string) => void;
}

export function StepGovernanceSimple({ selected, onChange }: StepGovernanceSimpleProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label>How much freedom should your AI team have?</Label>
        <p className="text-xs text-muted-foreground mt-1">
          You can always change this later in Boundaries.
        </p>
      </div>

      <div className="space-y-3">
        {GOVERNANCE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = selected === option.id;
          return (
            <Card
              key={option.id}
              className={cn(
                "cursor-pointer transition-colors",
                isSelected ? "border-primary bg-primary/5" : "hover:border-primary/30",
              )}
              onClick={() => onChange(option.id)}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div
                  className={cn(
                    "flex items-center justify-center h-9 w-9 rounded-lg flex-shrink-0",
                    isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
