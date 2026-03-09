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
  requiredFields: {
    key: string;
    label: string;
    type: "text" | "password";
    placeholder?: string;
  }[];
  cartridgeId: string;
  description: string;
}

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
    cartridgeId: "digital-ads",
    description: "Manage ad campaigns, budgets, and audience targeting.",
  },
  {
    serviceId: "google-ads",
    displayName: "Google Ads",
    authType: "api_key",
    requiredFields: [
      {
        key: "developerToken",
        label: "Developer Token",
        type: "password",
        placeholder: "XXXXXXXXXXXXXXXX",
      },
      { key: "customerId", label: "Customer ID", type: "text", placeholder: "123-456-7890" },
    ],
    cartridgeId: "digital-ads",
    description: "Manage search, display, and shopping campaigns.",
  },
  {
    serviceId: "tiktok-ads",
    displayName: "TikTok Ads",
    authType: "api_key",
    requiredFields: [
      {
        key: "accessToken",
        label: "Access Token",
        type: "password",
        placeholder: "Your TikTok access token",
      },
      { key: "advertiserId", label: "Advertiser ID", type: "text", placeholder: "1234567890" },
    ],
    cartridgeId: "digital-ads",
    description: "Manage TikTok ad campaigns and creative content.",
  },
];

interface StepConnectionProps {
  cartridgeId: string;
  onConnectionCreated?: (connectionId: string) => void;
  onPlatformSelected?: (serviceId: string) => void;
}

export function StepConnection({
  cartridgeId,
  onConnectionCreated,
  onPlatformSelected,
}: StepConnectionProps) {
  const services = SERVICE_REGISTRY.filter((s) => s.cartridgeId === cartridgeId);
  const createConnection = useCreateConnection();
  const testConnection = useTestConnection();
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    services.length === 1 ? services[0].serviceId : null,
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ healthy: boolean; detail?: string } | null>(null);

  const service = services.find((s) => s.serviceId === selectedServiceId) ?? null;

  if (services.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          No connection configuration needed for this cartridge. You can skip this step.
        </p>
      </div>
    );
  }

  const handleSelectService = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setCredentials({});
    setConnectionId(null);
    setTestResult(null);
    onPlatformSelected?.(serviceId);
  };

  const handleSave = async () => {
    if (!service) return;
    const result = await createConnection.mutateAsync({
      serviceId: service.serviceId,
      serviceName: service.displayName,
      authType: service.authType,
      credentials,
    });
    const id = (result.connection as Record<string, unknown>)?.id as string | undefined;
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

  const allFieldsFilled = service?.requiredFields.every((f) => credentials[f.key]?.trim()) ?? false;

  // Platform selection when multiple services match
  if (services.length > 1 && !selectedServiceId) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Which ad platform do you use?</p>
        <div className="grid gap-2">
          {services.map((s) => (
            <button
              key={s.serviceId}
              onClick={() => handleSelectService(s.serviceId)}
              className="text-left border rounded-lg p-4 hover:border-primary/50 transition-colors"
            >
              <p className="text-sm font-medium">{s.displayName}</p>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!service) return null;

  return (
    <div className="space-y-4">
      {services.length > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{service.displayName}</p>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => {
              setSelectedServiceId(null);
              setCredentials({});
              setConnectionId(null);
              setTestResult(null);
            }}
          >
            Change platform
          </Button>
        </div>
      )}

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
            onChange={(e) => setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))}
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
        <div
          className={`flex items-center gap-2 text-sm ${testResult.healthy ? "text-green-600" : "text-red-600"}`}
        >
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
