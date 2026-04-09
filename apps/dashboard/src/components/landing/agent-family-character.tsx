"use client";

import { cn } from "@/lib/utils";
import { OperatorCharacter, type RoleFocus } from "@/components/character/operator-character";

interface AgentFamilyCharacterProps {
  name: string;
  roleFocus: RoleFocus;
  status: "live" | "coming";
  className?: string;
}

export function AgentFamilyCharacter({
  name,
  roleFocus,
  status,
  className,
}: AgentFamilyCharacterProps) {
  const isMuted = status === "coming";

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        className={cn("w-[120px] h-[160px] lg:w-[150px] lg:h-[200px]", isMuted && "opacity-40")}
        style={isMuted ? { animationDuration: "12s" } : undefined}
      >
        <OperatorCharacter roleFocus={roleFocus} />
      </div>
      <span className="text-sm font-medium text-foreground">{name}</span>
      <span
        className={cn(
          "text-xs font-mono px-2 py-0.5 rounded border-2",
          status === "live"
            ? "text-positive border-positive bg-positive-subtle"
            : "text-muted-foreground border-border bg-muted",
        )}
      >
        {status === "live" ? "Live" : "Coming"}
      </span>
    </div>
  );
}
