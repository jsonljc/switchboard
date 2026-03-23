"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AgentConfigPersonalityProps {
  displayName: string;
  tonePreset: string;
  onDisplayNameChange: (name: string) => void;
  onToneChange: (tone: string) => void;
}

const TONES = [
  { id: "warm-professional", label: "Warm", description: "Friendly & reassuring" },
  { id: "casual-conversational", label: "Casual", description: "Relaxed & approachable" },
  { id: "direct-efficient", label: "Direct", description: "Brief & to the point" },
] as const;

export function AgentConfigPersonality({
  displayName,
  tonePreset,
  onDisplayNameChange,
  onToneChange,
}: AgentConfigPersonalityProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-foreground">Name</Label>
        <Input
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          className="text-[14px]"
          placeholder="Agent name"
        />
      </div>

      <div className="space-y-3">
        <Label className="text-[13px] font-medium text-foreground">Personality</Label>
        <div className="space-y-2">
          {TONES.map((tone) => (
            <button
              key={tone.id}
              onClick={() => onToneChange(tone.id)}
              className={cn(
                "w-full text-left px-4 py-3 rounded-lg border transition-all",
                tonePreset === tone.id
                  ? "border-foreground/30 bg-muted/50"
                  : "border-border hover:border-foreground/15",
              )}
            >
              <p className="text-[13px] font-medium text-foreground">{tone.label}</p>
              <p className="text-[12px] text-muted-foreground">{tone.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
