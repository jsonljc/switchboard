"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useCreateConnection, useTestConnection } from "@/hooks/use-connections";

interface ServiceRegistryEntry {
  serviceId: string;
  displayName: string;
  authType: string;
  requiredFields: { key: string; label: string; type: "text" | "password"; placeholder?: string }[];
  cartridgeId: string;
  description: string;
}

// Mirrors @switchboard/cartridge-sdk service-registry.ts
const SERVICE_REGISTRY: ServiceRegistryEntry[] = [
  {
    serviceId: "stripe",
    displayName: "Stripe",
    authType: "api_key",
    requiredFields: [
      { key: "secretKey", label: "Secret Key", type: "password", placeholder: "sk_live_..." },
    ],
    cartridgeId: "payments",
    description: "Process payments, refunds, and manage subscriptions.",
  },
  {
    serviceId: "meta-ads",
    displayName: "Meta Ads",
    authType: "api_key",
    requiredFields: [
      { key: "accessToken", label: "Access Token", type: "password", placeholder: "EAA..." },
      { key: "adAccountId", label: "Ad Account ID", type: "text", placeholder: "act_123456789" },
    ],
    cartridgeId: "ads-spend",
    description: "Manage ad campaigns, budgets, and audience targeting.",
  },
  {
    serviceId: "broker-api",
    displayName: "Broker API",
    authType: "api_key",
    requiredFields: [
      { key: "apiKey", label: "API Key", type: "password" },
      { key: "apiSecret", label: "API Secret", type: "password" },
      { key: "baseUrl", label: "Base URL", type: "text", placeholder: "https://api.broker.example.com" },
    ],
    cartridgeId: "quant-trading",
    description: "Execute trades, manage portfolios, and access market data.",
  },
];

interface StepConnectionProps {
  cartridgeId: string;
  onConnectionCreated?: (connectionId: string) => void;
}

export function StepConnection({ cartridgeId, onConnectionCreated }: StepConnectionProps) {
  const service = SERVICE_REGISTRY.find((s) => s.cartridgeId === cartridgeId);
  const createConnection = useCreateConnection();
  const testConnection = useTestConnection();
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ healthy: boolean; detail?: string } | null>(null);

  if (!service) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          No connection configuration needed for this cartridge. You can skip this step.
        </p>
      </div>
    );
  }

  const handleSave = async () => {
    const result = await createConnection.mutateAsync({
      serviceId: service.serviceId,
      serviceName: service.displayName,
      authType: service.authType,
      credentials,
    });
    const id = (result.connection as any)?.id;
    if (id) {
      setConnectionId(id);
      onConnectionCreated?.(id);
    }
  };

  const handleTest = async () => {
    if (!connectionId) return;
    setTestResult(null);
    const result = await testConnection.mutateAsync(connectionId);
    setTestResult(result);
  };

  const allFieldsFilled = service.requiredFields.every((f) => credentials[f.key]?.trim());

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect your {service.displayName} account. {service.description}
      </p>

      {service.requiredFields.map((field) => (
        <div key={field.key} className="space-y-2">
          <Label htmlFor={`cred-${field.key}`}>{field.label}</Label>
          <Input
            id={`cred-${field.key}`}
            type={field.type === "password" ? "password" : "text"}
            placeholder={field.placeholder}
            value={credentials[field.key] ?? ""}
            onChange={(e) =>
              setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
            }
          />
        </div>
      ))}

      <div className="flex gap-2">
        {!connectionId ? (
          <Button
            onClick={handleSave}
            disabled={!allFieldsFilled || createConnection.isPending}
            className="flex-1 min-h-[44px]"
          >
            {createConnection.isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </span>
            ) : (
              "Save Credentials"
            )}
          </Button>
        ) : (
          <Button
            onClick={handleTest}
            disabled={testConnection.isPending}
            variant="outline"
            className="flex-1 min-h-[44px]"
          >
            {testConnection.isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Testing...
              </span>
            ) : (
              "Test Connection"
            )}
          </Button>
        )}
      </div>

      {connectionId && !testResult && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          Credentials saved
        </div>
      )}

      {testResult && (
        <div className={`flex items-center gap-2 text-sm ${testResult.healthy ? "text-green-600" : "text-red-600"}`}>
          {testResult.healthy ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {testResult.healthy ? "Connection healthy" : testResult.detail || "Connection failed"}
        </div>
      )}

      {createConnection.isError && (
        <p className="text-sm text-red-600">{createConnection.error.message}</p>
      )}
    </div>
  );
}
