"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface DeployStepConfigProps {
  config: {
    taskDescription: string;
    acceptanceCriteria: string;
    outputFormat: string;
  };
  onChange: (config: DeployStepConfigProps["config"]) => void;
}

export function DeployStepConfig({ config, onChange }: DeployStepConfigProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-medium text-foreground">Configure Input</h2>
        <p className="text-[13.5px] text-muted-foreground mt-1">
          Tell the agent what kind of work you need done.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="taskDescription" className="text-[13px]">
            Default task description
          </Label>
          <Textarea
            id="taskDescription"
            value={config.taskDescription}
            onChange={(e) => onChange({ ...config, taskDescription: e.target.value })}
            placeholder="e.g., Write Instagram captions for product launches"
            className="mt-1.5"
            rows={3}
          />
        </div>

        <div>
          <Label htmlFor="acceptanceCriteria" className="text-[13px]">
            Acceptance criteria (optional)
          </Label>
          <Textarea
            id="acceptanceCriteria"
            value={config.acceptanceCriteria}
            onChange={(e) => onChange({ ...config, acceptanceCriteria: e.target.value })}
            placeholder="e.g., Must include product name and CTA, under 150 characters"
            className="mt-1.5"
            rows={2}
          />
        </div>

        <div>
          <Label htmlFor="outputFormat" className="text-[13px]">
            Expected output format
          </Label>
          <Input
            id="outputFormat"
            value={config.outputFormat}
            onChange={(e) => onChange({ ...config, outputFormat: e.target.value })}
            placeholder="e.g., Plain text, JSON, Markdown"
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  );
}
