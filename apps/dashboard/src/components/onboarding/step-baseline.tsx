"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface BaselineData {
  leadsPerMonth: number | undefined;
  conversionRatePercent: number | undefined;
  monthlyAdSpend: number | undefined;
  replySpeedDescription: string | undefined;
}

interface StepBaselineProps {
  onBaselineChange: (baseline: BaselineData) => void;
}

export function StepBaseline({ onBaselineChange }: StepBaselineProps) {
  const [leads, setLeads] = useState("");
  const [conversion, setConversion] = useState("");
  const [spend, setSpend] = useState("");
  const [replySpeed, setReplySpeed] = useState("");

  const emitChange = (field: string, value: string) => {
    const updated = {
      leads: field === "leads" ? value : leads,
      conversion: field === "conversion" ? value : conversion,
      spend: field === "spend" ? value : spend,
      replySpeed: field === "replySpeed" ? value : replySpeed,
    };
    onBaselineChange({
      leadsPerMonth: updated.leads ? Number(updated.leads) : undefined,
      conversionRatePercent: updated.conversion ? Number(updated.conversion) : undefined,
      monthlyAdSpend: updated.spend ? Number(updated.spend) : undefined,
      replySpeedDescription: updated.replySpeed || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Quick baseline</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Rough numbers are fine — we&apos;ll use these to show your improvement.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>How many leads do you get per month?</Label>
          <Input
            type="number"
            placeholder="e.g. 50"
            value={leads}
            onChange={(e) => {
              setLeads(e.target.value);
              emitChange("leads", e.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>What % become paying patients?</Label>
          <Input
            type="number"
            placeholder="e.g. 10"
            value={conversion}
            onChange={(e) => {
              setConversion(e.target.value);
              emitChange("conversion", e.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>Monthly ad spend ($)</Label>
          <Input
            type="number"
            placeholder="e.g. 2000"
            value={spend}
            onChange={(e) => {
              setSpend(e.target.value);
              emitChange("spend", e.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>How quickly does your staff usually reply?</Label>
          <Input
            placeholder="e.g. 4-6 hours, next day"
            value={replySpeed}
            onChange={(e) => {
              setReplySpeed(e.target.value);
              emitChange("replySpeed", e.target.value);
            }}
          />
        </div>
      </div>
    </div>
  );
}
