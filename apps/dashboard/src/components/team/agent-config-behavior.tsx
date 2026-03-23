"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  getBehaviorOptions,
  getRoleDescription,
  type BehaviorOption,
  type BehaviorChoice,
} from "./agent-behavior-options.js";

interface AgentConfigBehaviorProps {
  agentRole: string;
  config: Record<string, unknown>;
  onConfigChange: (key: string, value: unknown) => void;
}

function findSelectedChoice(option: BehaviorOption, currentValue: unknown): string {
  const match = option.choices.find((c) => {
    if (Array.isArray(c.value) && Array.isArray(currentValue)) {
      return JSON.stringify(c.value) === JSON.stringify(currentValue);
    }
    return c.value === currentValue;
  });
  return match?.id ?? option.choices[1]?.id ?? option.choices[0]?.id ?? "";
}

function OptionGroup({
  option,
  selectedId,
  onSelect,
}: {
  option: BehaviorOption;
  selectedId: string;
  onSelect: (choice: BehaviorChoice) => void;
}) {
  return (
    <div className="space-y-3">
      <Label className="text-[13px] font-medium text-foreground">{option.label}</Label>
      <div className="space-y-2">
        {option.choices.map((choice) => (
          <button
            key={choice.id}
            onClick={() => onSelect(choice)}
            className={cn(
              "w-full text-left px-4 py-3 rounded-lg border transition-all",
              selectedId === choice.id
                ? "border-foreground/30 bg-muted/50"
                : "border-border hover:border-foreground/15",
            )}
          >
            <p className="text-[13px] font-medium text-foreground">{choice.label}</p>
            <p className="text-[12px] text-muted-foreground">{choice.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentConfigBehavior({
  agentRole,
  config,
  onConfigChange,
}: AgentConfigBehaviorProps) {
  const options = getBehaviorOptions(agentRole);
  const roleDescription = getRoleDescription(agentRole);

  if (roleDescription) {
    return (
      <div className="space-y-4">
        <Label className="text-[13px] font-medium text-foreground">About this agent</Label>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{roleDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {options.map((option) => (
        <OptionGroup
          key={option.configKey}
          option={option}
          selectedId={findSelectedChoice(option, config[option.configKey])}
          onSelect={(choice) => onConfigChange(option.configKey, choice.value)}
        />
      ))}
    </div>
  );
}
