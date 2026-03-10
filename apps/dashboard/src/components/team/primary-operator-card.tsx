"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Pencil, Check, X, Pause, Play } from "lucide-react";
import { useUpdateAgentRoster } from "@/hooks/use-agents";
import {
  useOperatorConfig,
  useUpdateOperatorConfig,
  useAutonomyAssessment,
} from "@/hooks/use-operator-config";
import type { AgentRosterEntry } from "@/lib/api-client";

const AUTOMATION_LEVELS = [
  {
    value: "copilot" as const,
    label: "Ask me for everything",
    description: "Your assistant will suggest actions and wait for your approval.",
  },
  {
    value: "supervised" as const,
    label: "Ask me for big decisions",
    description: "Routine work runs automatically. You’re asked before spending or major changes.",
  },
  {
    value: "autonomous" as const,
    label: "Let them handle it",
    description: "Your assistant runs within the limits you set. They’ll only ask when it matters.",
  },
];

interface PrimaryOperatorCardProps {
  agent: AgentRosterEntry;
}

export function PrimaryOperatorCard({ agent }: PrimaryOperatorCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(agent.displayName);
  const updateAgent = useUpdateAgentRoster();
  const { data: configData } = useOperatorConfig();
  const updateConfig = useUpdateOperatorConfig();
  const { data: autonomyData } = useAutonomyAssessment();

  const config = configData?.config;
  const autonomy = autonomyData?.assessment;

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

  const handleToggleActive = () => {
    if (!config) return;
    updateConfig.mutate({ active: !config.active });
  };

  const handleAutomationChange = (level: "copilot" | "supervised" | "autonomous") => {
    updateConfig.mutate({ automationLevel: level });
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
            <p className="text-sm text-muted-foreground">Your main assistant</p>
            <p className="text-sm text-muted-foreground mt-2">{agent.description}</p>
            {workingStyle && (
              <p className="text-xs text-muted-foreground mt-2">
                Communicates: <span className="font-medium text-foreground">{workingStyle}</span>
              </p>
            )}
          </div>
        </div>

        {config && (
          <div className="mt-6 pt-4 border-t space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${config.active ? "bg-green-500" : "bg-yellow-500"}`}
                />
                <span className="text-sm font-medium">{config.active ? "Running" : "Paused"}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleActive}
                disabled={updateConfig.isPending}
              >
                {config.active ? (
                  <>
                    <Pause className="h-3.5 w-3.5 mr-1.5" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Resume
                  </>
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">How much can they do without asking?</p>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
                {AUTOMATION_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    onClick={() => handleAutomationChange(level.value)}
                    disabled={updateConfig.isPending}
                    className={`text-left border rounded-lg p-3 transition-colors ${
                      config.automationLevel === level.value
                        ? "border-primary bg-primary/5"
                        : "hover:border-muted-foreground/30"
                    }`}
                  >
                    <p className="text-sm font-medium">{level.label}</p>
                    <p className="text-xs text-muted-foreground">{level.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {autonomy && (
              <details className="group space-y-3 pt-2">
                <summary className="text-sm font-medium text-muted-foreground cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  See progress details
                </summary>
                <div className="space-y-3 pl-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Progress</p>
                    {autonomy.autonomousEligible && (
                      <span className="text-xs font-medium text-primary">Ready for more autonomy</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-primary rounded-full h-2 transition-all"
                        style={{ width: `${autonomy.progressPercent}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{autonomy.reason}</p>
                  </div>
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
