"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepBusinessProps {
  businessName: string;
  onChange: (name: string) => void;
}

export function StepBusiness({ businessName, onChange }: StepBusinessProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="businessName">Business Name</Label>
        <Input
          id="businessName"
          placeholder="Your business name"
          value={businessName}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          This will be used to identify your organization across Switchboard.
        </p>
      </div>
    </div>
  );
}
