"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface GovernanceConfig {
  requireApproval: boolean;
  dailySpendLimit: string;
  maxTasksPerDay: string;
  autoPauseBelow: string;
}

interface DeployStepGovernanceProps {
  config: GovernanceConfig;
  onChange: (config: GovernanceConfig) => void;
}

export function DeployStepGovernance({ config, onChange }: DeployStepGovernanceProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-medium text-foreground">Governance Settings</h2>
        <p className="text-[13.5px] text-muted-foreground mt-1">
          Set guardrails for this agent. Smart defaults are pre-configured — adjust only what you
          need.
        </p>
      </div>

      <div className="space-y-5">
        {/* Require approval */}
        <div className="flex items-center justify-between gap-4 py-3 border-b border-border/50">
          <div>
            <Label className="text-[14px] font-medium">Require my approval</Label>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Override trust score — always require approval for this agent's output
            </p>
          </div>
          <Switch
            checked={config.requireApproval}
            onCheckedChange={(checked) => onChange({ ...config, requireApproval: checked })}
          />
        </div>

        {/* Daily spend limit */}
        <div>
          <Label htmlFor="dailySpendLimit" className="text-[13px]">
            Daily spend limit ($)
          </Label>
          <Input
            id="dailySpendLimit"
            type="number"
            min="0"
            value={config.dailySpendLimit}
            onChange={(e) => onChange({ ...config, dailySpendLimit: e.target.value })}
            placeholder="50"
            className="mt-1.5 max-w-[200px]"
          />
        </div>

        {/* Max tasks per day */}
        <div>
          <Label htmlFor="maxTasksPerDay" className="text-[13px]">
            Max tasks per day
          </Label>
          <Input
            id="maxTasksPerDay"
            type="number"
            min="1"
            value={config.maxTasksPerDay}
            onChange={(e) => onChange({ ...config, maxTasksPerDay: e.target.value })}
            placeholder="10"
            className="mt-1.5 max-w-[200px]"
          />
        </div>

        {/* Auto-pause threshold */}
        <div>
          <Label htmlFor="autoPauseBelow" className="text-[13px]">
            Auto-pause if trust drops below
          </Label>
          <Input
            id="autoPauseBelow"
            type="number"
            min="0"
            max="100"
            value={config.autoPauseBelow}
            onChange={(e) => onChange({ ...config, autoPauseBelow: e.target.value })}
            placeholder="30"
            className="mt-1.5 max-w-[200px]"
          />
          <p className="text-[12px] text-muted-foreground mt-1">
            Agent pauses automatically if score drops below this threshold.
          </p>
        </div>
      </div>
    </div>
  );
}
