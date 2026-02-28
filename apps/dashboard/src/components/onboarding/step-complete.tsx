"use client";

import { useState, useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepIntegration } from "./step-integration";
import { useToast } from "@/components/ui/use-toast";

interface IntegrationGuide {
  runtimeType: string;
  title: string;
  description: string;
  steps: Array<{ title: string; description: string; code?: string; language?: string }>;
}

interface ProvisionResult {
  channels: Array<{
    channel: string;
    botUsername?: string;
    webhookUrl?: string;
    status: string;
    note?: string;
  }>;
}

interface StepCompleteProps {
  businessName: string;
  runtimeType: string;
  governanceProfile: string;
  cartridgeId: string;
  organizationId: string;
  provisionResult?: ProvisionResult | null;
}

export function StepComplete({
  businessName,
  runtimeType,
  governanceProfile,
  cartridgeId,
  organizationId,
  provisionResult,
}: StepCompleteProps) {
  const [guide, setGuide] = useState<IntegrationGuide | null>(null);
  const [guideRuntime, setGuideRuntime] = useState(runtimeType);
  const [isLoading, setIsLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setGuide(generateClientGuide(guideRuntime, organizationId));
    setIsLoading(false);
  }, [guideRuntime, organizationId]);

  const handleSimulate = async () => {
    setSimulating(true);
    try {
      const res = await fetch("/api/dashboard/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: `${cartridgeId}.test_action`,
          parameters: { test: true },
          principalId: "onboarding-test",
          cartridgeId,
        }),
      });
      if (!res.ok) throw new Error("Simulation failed");
      const data = await res.json();
      toast({
        title: "Simulation complete",
        description: `Decision: ${data.finalDecision ?? data.explanation ?? "Success"}`,
      });
    } catch (err: any) {
      toast({
        title: "Simulation",
        description: "Test simulation completed (no live cartridge action).",
      });
    } finally {
      setSimulating(false);
    }
  };

  const isManaged = runtimeType === "managed";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm">Business: {businessName}</span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm">Runtime: {runtimeType}</span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm">Governance: {governanceProfile}</span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm">Cartridge: {cartridgeId}</span>
        </div>
      </div>

      {isManaged && provisionResult ? (
        <div className="border-t pt-4 space-y-4">
          <h3 className="text-sm font-medium">Channel Status</h3>
          {provisionResult.channels.map((ch) => (
            <div key={ch.channel} className="p-3 rounded-lg border space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm capitalize">{ch.channel}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  ch.status === "active"
                    ? "bg-green-100 text-green-700"
                    : "bg-yellow-100 text-yellow-700"
                }`}>
                  {ch.status}
                </span>
              </div>
              {ch.botUsername && (
                <p className="text-xs text-muted-foreground">Bot: {ch.botUsername}</p>
              )}
              {ch.webhookUrl && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Webhook URL:</p>
                  <code className="text-xs bg-muted p-2 rounded block break-all">{ch.webhookUrl}</code>
                  {ch.note && (
                    <p className="text-xs text-muted-foreground">{ch.note}</p>
                  )}
                </div>
              )}
              {ch.channel === "telegram" && ch.status === "active" && (
                <p className="text-xs text-muted-foreground">
                  Open Telegram and message {ch.botUsername ?? "your bot"} to test it.
                </p>
              )}
            </div>
          ))}
        </div>
      ) : isManaged ? (
        <div className="border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Your channels will be provisioned when you complete setup.
          </p>
        </div>
      ) : (
        <>
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium mb-3">Integration Guide</h3>
            <StepIntegration
              guide={guide}
              isLoading={isLoading}
              runtimeType={guideRuntime}
              onRuntimeChange={setGuideRuntime}
            />
          </div>

          <Button
            variant="outline"
            onClick={handleSimulate}
            disabled={simulating}
            className="w-full min-h-[44px]"
          >
            {simulating ? "Running simulation..." : "Run Test Simulation"}
          </Button>
        </>
      )}
    </div>
  );
}

function generateClientGuide(runtimeType: string, organizationId: string): IntegrationGuide {
  const baseUrl = typeof window !== "undefined" ? window.location.origin.replace(/:\d+$/, ":3000") : "http://localhost:3000";

  if (runtimeType === "openclaw") {
    return {
      runtimeType: "openclaw",
      title: "OpenClaw Integration",
      description: "Add the Switchboard MCP server to your openclaw.json.",
      steps: [
        {
          title: "Add to openclaw.json",
          description: "Add the Switchboard MCP server configuration.",
          language: "json",
          code: JSON.stringify({
            mcpServers: {
              switchboard: {
                command: "npx",
                args: ["-y", "@switchboard/mcp-server"],
                env: {
                  SWITCHBOARD_API_URL: baseUrl,
                  SWITCHBOARD_API_KEY: "<your-api-key>",
                  SWITCHBOARD_ORG_ID: organizationId,
                },
              },
            },
          }, null, 2),
        },
      ],
    };
  }

  if (runtimeType === "mcp") {
    return {
      runtimeType: "mcp",
      title: "MCP Server Integration",
      description: "Add Switchboard as an MCP server to Claude Desktop or Cursor.",
      steps: [
        {
          title: "Claude Desktop / Cursor config",
          description: "Add this to your MCP configuration file.",
          language: "json",
          code: JSON.stringify({
            mcpServers: {
              switchboard: {
                command: "npx",
                args: ["-y", "@switchboard/mcp-server"],
                env: {
                  SWITCHBOARD_API_URL: baseUrl,
                  SWITCHBOARD_API_KEY: "<your-api-key>",
                  SWITCHBOARD_ORG_ID: organizationId,
                },
              },
            },
          }, null, 2),
        },
      ],
    };
  }

  if (runtimeType === "managed") {
    return {
      runtimeType: "managed",
      title: "Managed Integration",
      description: "Switchboard manages the channels for you. No code required.",
      steps: [
        {
          title: "Channels provisioned",
          description: "Your messaging channels are set up and ready to use. Check the Channel Status section above for details.",
        },
      ],
    };
  }

  return {
    runtimeType: "http",
    title: "HTTP API Integration",
    description: "Call the Switchboard REST API from your application.",
    steps: [
      {
        title: "Execute an action",
        description: "POST to /api/execute with your action payload.",
        language: "bash",
        code: `curl -X POST ${baseUrl}/api/execute \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": {
      "actionType": "cartridge.action",
      "parameters": {},
      "sideEffect": true,
      "magnitude": "medium"
    },
    "organizationId": "${organizationId}"
  }'`,
      },
    ],
  };
}
