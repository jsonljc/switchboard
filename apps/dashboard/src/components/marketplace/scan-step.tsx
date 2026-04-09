"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scanWebsite } from "@/app/(auth)/deploy/[slug]/actions";
import type { WizardStepProps } from "./deploy-wizard-shell";

export function ScanStep({ onUpdate, onNext }: WizardStepProps) {
  const [url, setUrl] = useState("");
  const [isScanning, startScan] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleScan() {
    setError(null);
    startScan(async () => {
      try {
        const profile = await scanWebsite(url);
        onUpdate({
          url,
          persona: {
            businessName: profile.businessName,
            businessType: "small_business",
            productService: profile.whatTheySell,
            valueProposition: profile.valueProposition,
            tone: profile.tone === "warm" ? "casual" : "professional",
            qualificationCriteria: {},
            disqualificationCriteria: {},
            escalationRules: {
              frustrated: true,
              askForPerson: true,
              mentionCompetitor: false,
              outsideKnowledge: false,
            },
            bookingLink: null,
            customInstructions: null,
          },
        });
        onNext();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to scan website");
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">First, your website — I'll study up.</p>
      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="https://yourbusiness.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isScanning}
        />
        <Button onClick={handleScan} disabled={!url || isScanning}>
          {isScanning ? "Learning..." : "Learn my business"}
        </Button>
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
