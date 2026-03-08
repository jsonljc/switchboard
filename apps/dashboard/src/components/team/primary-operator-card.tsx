"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Pencil, Check, X } from "lucide-react";
import { useUpdateAgentRoster } from "@/hooks/use-agents";
import type { AgentRosterEntry } from "@/lib/api-client";

interface PrimaryOperatorCardProps {
  agent: AgentRosterEntry;
}

export function PrimaryOperatorCard({ agent }: PrimaryOperatorCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(agent.displayName);
  const updateAgent = useUpdateAgentRoster();

  const workingStyle = (agent.config as Record<string, unknown>)?.workingStyle as
    | string
    | undefined;

  const handleSave = () => {
    if (editName.trim() && editName.trim() !== agent.displayName) {
      updateAgent.mutate({ id: agent.id, displayName: editName.trim() });
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(agent.displayName);
    setIsEditing(false);
  };

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center h-14 w-14 rounded-xl bg-primary/10 text-primary flex-shrink-0">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 w-40"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave();
                      if (e.key === "Escape") handleCancel();
                    }}
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSave}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancel}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-bold">{agent.displayName}</h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsEditing(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Growth Operator</p>
            <p className="text-sm text-muted-foreground mt-2">{agent.description}</p>
            {workingStyle && (
              <p className="text-xs text-muted-foreground mt-2">
                Working style: <span className="font-medium text-foreground">{workingStyle}</span>
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
