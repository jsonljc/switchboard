"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface AgentControlsProps {
  agentId: string;
  currentStatus: string;
  onStatusChange: (status: string) => void;
}

export function AgentControls({
  agentId: _agentId,
  currentStatus,
  onStatusChange,
}: AgentControlsProps) {
  const { toast } = useToast();

  const handleToggle = (newStatus: string) => {
    onStatusChange(newStatus);
    toast({ title: `Agent ${newStatus === "active" ? "activated" : "paused"}` });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            currentStatus === "active" ? "bg-positive" : "bg-muted-foreground/40",
          )}
        />
        <span className="text-[13px] font-medium text-foreground capitalize">{currentStatus}</span>
      </div>
      <div className="flex gap-2">
        {currentStatus !== "active" && (
          <Button size="sm" onClick={() => handleToggle("active")}>
            Activate
          </Button>
        )}
        {currentStatus === "active" && (
          <Button size="sm" variant="outline" onClick={() => handleToggle("paused")}>
            Pause
          </Button>
        )}
      </div>
    </div>
  );
}
