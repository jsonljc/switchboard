"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SERVICE_FIELD_CONFIGS } from "@/lib/service-field-configs";

interface StepAdPlatformProps {
  adCredentials: Record<string, string>;
  onAdCredentialsChange: (creds: Record<string, string>) => void;
}

const metaAdsFields = SERVICE_FIELD_CONFIGS["meta-ads"] ?? [];

export function StepAdPlatform({ adCredentials, onAdCredentialsChange }: StepAdPlatformProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Label className="text-base">Connect your Meta Ads account</Label>
        <p className="text-[13px] text-muted-foreground">
          Your Ad Optimizer agent needs access to your Meta Ads account to monitor campaigns and
          suggest improvements. You can skip this and add it later from Settings.
        </p>
      </div>

      <div className="space-y-4">
        {metaAdsFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`wizard-${field.key}`}>
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id={`wizard-${field.key}`}
              type={field.type}
              value={adCredentials[field.key] ?? ""}
              onChange={(e) =>
                onAdCredentialsChange({ ...adCredentials, [field.key]: e.target.value })
              }
              placeholder={field.placeholder}
            />
            {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
