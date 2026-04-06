"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WizardStepProps } from "./deploy-wizard-shell";

interface ConnectionStepProps extends WizardStepProps {
  connectionType: string;
  reason: string;
}

export function ConnectionStep({
  data,
  onUpdate,
  onNext,
  connectionType,
  reason,
}: ConnectionStepProps) {
  const existing = data.connections[connectionType];
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? "");

  function handleConnect() {
    onUpdate({
      connections: {
        ...data.connections,
        [connectionType]: { type: connectionType, apiKey },
      },
    });
    onNext();
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-medium text-foreground capitalize">{connectionType}</h3>
        <p className="text-sm text-muted-foreground mt-1">{reason}</p>
      </div>

      <div>
        <label className="text-sm text-muted-foreground block mb-1">API Key</label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={`Enter your ${connectionType} API key`}
        />
      </div>

      <Button onClick={handleConnect} disabled={!apiKey} className="w-full">
        Connect & Continue
      </Button>
    </div>
  );
}
