"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const INTEGRATIONS = [
  { id: "gmail", name: "Gmail", description: "Send and receive emails" },
  { id: "slack", name: "Slack", description: "Post to channels and DMs" },
  { id: "notion", name: "Notion", description: "Read and write pages" },
  { id: "sheets", name: "Google Sheets", description: "Read and write spreadsheets" },
] as const;

interface DeployStepConnectProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function DeployStepConnect({ selectedIds, onChange }: DeployStepConnectProps) {
  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-medium text-foreground">Connect Tools</h2>
        <p className="text-[13.5px] text-muted-foreground mt-1">
          Choose which integrations this agent can access. You can change these later.
        </p>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        {INTEGRATIONS.map((integration) => {
          const selected = selectedIds.includes(integration.id);
          return (
            <button
              key={integration.id}
              onClick={() => toggle(integration.id)}
              className={cn(
                "flex items-center gap-3 p-4 rounded-xl border text-left transition-colors duration-fast min-h-[44px]",
                selected
                  ? "border-foreground/30 bg-surface-raised"
                  : "border-border bg-surface hover:border-border/80",
              )}
            >
              <div
                className={cn(
                  "h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                  selected ? "bg-foreground border-foreground" : "border-border",
                )}
              >
                {selected && <Check className="h-3 w-3 text-background" />}
              </div>
              <div>
                <p className="text-[14px] text-foreground font-medium">{integration.name}</p>
                <p className="text-[12px] text-muted-foreground">{integration.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[12px] text-muted-foreground">
        Integrations are optional. The agent can also receive work via copy-paste.
      </p>
    </div>
  );
}
