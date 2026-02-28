export interface IntegrationStep {
  title: string;
  description: string;
  code?: string;
  language?: string;
}

export interface IntegrationGuide {
  runtimeType: string;
  title: string;
  description: string;
  steps: IntegrationStep[];
}

export interface IntegrationGuideParams {
  runtimeType: string;
  apiBaseUrl: string;
  apiKey: string;
  organizationId: string;
}

export function generateIntegrationGuide(params: IntegrationGuideParams): IntegrationGuide {
  const { runtimeType, apiBaseUrl, apiKey, organizationId } = params;

  switch (runtimeType) {
    case "openclaw":
      return generateOpenClawGuide(apiBaseUrl, apiKey, organizationId);
    case "mcp":
      return generateMcpGuide(apiBaseUrl, apiKey, organizationId);
    case "http":
      return generateHttpGuide(apiBaseUrl, apiKey, organizationId);
    case "managed":
      return generateManagedGuide(organizationId);
    default:
      return generateHttpGuide(apiBaseUrl, apiKey, organizationId);
  }
}

function generateOpenClawGuide(apiBaseUrl: string, apiKey: string, organizationId: string): IntegrationGuide {
  return {
    runtimeType: "openclaw",
    title: "OpenClaw Integration",
    description: "Connect your OpenClaw agent to Switchboard for governed tool execution.",
    steps: [
      {
        title: "Add the Switchboard MCP server to your openclaw.json",
        description: "Add the following to your openclaw.json configuration to enable the switchboard_execute tool.",
        language: "json",
        code: JSON.stringify({
          mcpServers: {
            switchboard: {
              command: "npx",
              args: ["-y", "@switchboard/mcp-server"],
              env: {
                SWITCHBOARD_API_URL: apiBaseUrl,
                SWITCHBOARD_API_KEY: apiKey,
                SWITCHBOARD_ORG_ID: organizationId,
              },
            },
          },
        }, null, 2),
      },
      {
        title: "Use the switchboard_execute tool",
        description: "Your agent can now call switchboard_execute to propose governed actions. The tool will return EXECUTED, PENDING_APPROVAL, or DENIED.",
        language: "json",
        code: JSON.stringify({
          tool: "switchboard_execute",
          arguments: {
            action_type: "your_cartridge.action_name",
            parameters: { key: "value" },
            actor_id: "agent-principal-id",
            organization_id: organizationId,
          },
        }, null, 2),
      },
      {
        title: "Handle approval responses",
        description: "When an action requires approval, you'll receive an approval_id. Poll or subscribe for the approval outcome.",
      },
    ],
  };
}

function generateMcpGuide(apiBaseUrl: string, apiKey: string, organizationId: string): IntegrationGuide {
  return {
    runtimeType: "mcp",
    title: "MCP Server Integration",
    description: "Add Switchboard as an MCP server to Claude Desktop, Cursor, or any MCP-compatible client.",
    steps: [
      {
        title: "Claude Desktop configuration",
        description: "Add this to your Claude Desktop MCP settings (~/Library/Application Support/Claude/claude_desktop_config.json).",
        language: "json",
        code: JSON.stringify({
          mcpServers: {
            switchboard: {
              command: "npx",
              args: ["-y", "@switchboard/mcp-server"],
              env: {
                SWITCHBOARD_API_URL: apiBaseUrl,
                SWITCHBOARD_API_KEY: apiKey,
                SWITCHBOARD_ORG_ID: organizationId,
              },
            },
          },
        }, null, 2),
      },
      {
        title: "Cursor configuration",
        description: "Add this to your Cursor MCP settings (.cursor/mcp.json in your project root).",
        language: "json",
        code: JSON.stringify({
          mcpServers: {
            switchboard: {
              command: "npx",
              args: ["-y", "@switchboard/mcp-server"],
              env: {
                SWITCHBOARD_API_URL: apiBaseUrl,
                SWITCHBOARD_API_KEY: apiKey,
                SWITCHBOARD_ORG_ID: organizationId,
              },
            },
          },
        }, null, 2),
      },
      {
        title: "Available tools",
        description: "Once connected, your AI assistant will have access to 15 governed tools including execute actions, manage approvals, query audit logs, and more.",
      },
    ],
  };
}

function generateHttpGuide(apiBaseUrl: string, apiKey: string, organizationId: string): IntegrationGuide {
  return {
    runtimeType: "http",
    title: "HTTP API Integration",
    description: "Integrate with Switchboard via direct HTTP API calls from your application.",
    steps: [
      {
        title: "Execute an action (curl)",
        description: "Use the /api/execute endpoint to propose and execute governed actions.",
        language: "bash",
        code: `curl -X POST ${apiBaseUrl}/api/execute \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": {
      "actionType": "your_cartridge.action_name",
      "parameters": { "key": "value" },
      "sideEffect": true,
      "magnitude": "medium"
    },
    "principalId": "your-principal-id",
    "organizationId": "${organizationId}"
  }'`,
      },
      {
        title: "Execute an action (TypeScript)",
        description: "Use fetch or any HTTP client to call the Switchboard API.",
        language: "typescript",
        code: `const response = await fetch("${apiBaseUrl}/api/execute", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    action: {
      actionType: "your_cartridge.action_name",
      parameters: { key: "value" },
      sideEffect: true,
      magnitude: "medium",
    },
    principalId: "your-principal-id",
    organizationId: "${organizationId}",
  }),
});

const result = await response.json();
// result.outcome: "EXECUTED" | "PENDING_APPROVAL" | "DENIED"`,
      },
      {
        title: "Check approval status",
        description: "When an action returns PENDING_APPROVAL, use the approval endpoint to check or respond.",
        language: "bash",
        code: `curl ${apiBaseUrl}/api/approvals/pending \\
  -H "Authorization: Bearer ${apiKey}"`,
      },
    ],
  };
}

function generateManagedGuide(organizationId: string): IntegrationGuide {
  return {
    runtimeType: "managed",
    title: "Managed Chat Interface",
    description: "Switchboard will host your AI agent with a built-in chat interface. Coming soon.",
    steps: [
      {
        title: "Coming soon",
        description: `Managed mode for organization ${organizationId} is not yet available. We'll set up a hosted chat interface with Telegram, Slack, or WhatsApp integration so you don't need to run any infrastructure.`,
      },
    ],
  };
}
