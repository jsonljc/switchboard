import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type {
  ExecutionService,
  CartridgeReadAdapter,
  GovernanceProfileStore,
  CartridgeRegistry,
} from "@switchboard/core";
import { resolveAuth, loadMcpApiKeys } from "./auth.js";
import type { McpAuthContext } from "./auth.js";
import { SessionGuard } from "./session-guard.js";
import {
  toolDefinitions,
  SIDE_EFFECT_TOOLS,
  READ_TOOLS,
  GOVERNANCE_TOOLS,
  MANUAL_ACTION_TYPES,
  handleSideEffectTool,
  handleReadTool,
  handleGovernanceTool,
  handleCrmSideEffectTool,
  handleCrmReadTool,
  handlePaymentsSideEffectTool,
  handlePaymentsReadTool,
} from "./tools/index.js";
import { CRM_SIDE_EFFECT_TOOLS, CRM_READ_TOOLS } from "./tools/crm.js";
import { PAYMENTS_SIDE_EFFECT_TOOLS, PAYMENTS_READ_TOOLS } from "./tools/payments.js";
import type { ReadToolDeps } from "./tools/index.js";
import type { GovernanceToolDeps } from "./tools/index.js";
import { generateToolsFromRegistry } from "./auto-register.js";
import type { AutoRegisteredTool } from "./auto-register.js";

/**
 * Minimal orchestrator interface — satisfied by both LifecycleOrchestrator
 * and the API-backed proxy from api-governance-adapter.ts.
 */
export interface MinimalOrchestrator {
  simulate(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId?: string;
  }): Promise<unknown>;
  requestUndo(envelopeId: string): Promise<unknown>;
  executeApproved(envelopeId: string): Promise<unknown>;
  propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
    cartridgeId?: string;
    message?: string;
    emergencyOverride?: boolean;
  }): Promise<{ denied: boolean; envelope: { id: string } }>;
}

/**
 * Minimal storage interface — satisfied by both StorageContext
 * and the API-backed proxy from api-governance-adapter.ts.
 */
export interface MinimalStorage {
  approvals: {
    getById(id: string): Promise<unknown>;
    listPending(organizationId?: string): Promise<unknown>;
  };
  envelopes: {
    getById(id: string): Promise<unknown>;
  };
  cartridges: {
    get(id: string): unknown;
    list(): string[];
  };
}

/**
 * Minimal ledger interface — satisfied by both AuditLedger
 * and the API-backed proxy from api-governance-adapter.ts.
 */
export interface MinimalLedger {
  query(filter: Record<string, unknown>): Promise<unknown>;
}

export interface SwitchboardMcpServerOptions {
  executionService: ExecutionService;
  readAdapter: CartridgeReadAdapter | { query(params: any): Promise<unknown> };
  orchestrator: MinimalOrchestrator;
  storage: MinimalStorage;
  ledger: MinimalLedger;
  governanceProfileStore: GovernanceProfileStore;
  cartridgeRegistry?: CartridgeRegistry;
}

export class SwitchboardMcpServer {
  private mcpServer: McpServer;
  private executionService: ExecutionService;
  private readDeps: ReadToolDeps;
  private governanceDeps: GovernanceToolDeps;
  private apiKeys: ReturnType<typeof loadMcpApiKeys>;
  private sessionGuard: SessionGuard;
  private autoRegisteredMap: Map<string, string> = new Map();
  private allSideEffectTools: Set<string>;

  constructor(options: SwitchboardMcpServerOptions) {
    this.executionService = options.executionService;
    this.sessionGuard = SessionGuard.fromEnv();
    this.readDeps = {
      readAdapter: options.readAdapter as CartridgeReadAdapter,
      orchestrator: options.orchestrator as any,
      storage: options.storage as any,
      sessionGuard: this.sessionGuard,
    };
    this.governanceDeps = {
      orchestrator: options.orchestrator as any,
      readAdapter: options.readAdapter as CartridgeReadAdapter,
      governanceProfileStore: options.governanceProfileStore,
      ledger: options.ledger as any,
      storage: options.storage as any,
    };
    this.apiKeys = loadMcpApiKeys();

    // Start with manual side-effect tools
    this.allSideEffectTools = new Set(SIDE_EFFECT_TOOLS);

    this.mcpServer = new McpServer({
      name: "switchboard",
      version: "0.1.0",
    });

    this.registerTools(options.cartridgeRegistry);
  }

  private getAuth(): McpAuthContext {
    // In stdio mode, auth is resolved once at startup from env.
    // The API key can be passed via MCP_API_KEY env var.
    const key = process.env["MCP_API_KEY"];
    return resolveAuth(key, this.apiKeys);
  }

  private registerTools(cartridgeRegistry?: CartridgeRegistry): void {
    // Auto-generate tools from cartridge registry if available
    let autoTools: AutoRegisteredTool[] = [];
    if (cartridgeRegistry) {
      autoTools = generateToolsFromRegistry(cartridgeRegistry, MANUAL_ACTION_TYPES);

      // Mark auto-registered mutations in the side-effect set
      for (const tool of autoTools) {
        this.autoRegisteredMap.set(tool.name, tool.actionType);
        this.allSideEffectTools.add(tool.name);
      }

      if (autoTools.length > 0) {
        console.error(
          `[mcp-server] Auto-registered ${autoTools.length} tools from cartridge manifests`,
        );
      }
    }

    // Register all tools (manual + auto) using registerTool() API
    const allDefs = [...toolDefinitions, ...autoTools];
    for (const def of allDefs) {
      this.mcpServer.registerTool(
        def.name,
        {
          description: def.description,
          inputSchema: def.inputSchema.properties
            ? Object.fromEntries(
                Object.entries(
                  def.inputSchema.properties as Record<
                    string,
                    { type: string; description?: string }
                  >,
                ).map(([key, prop]) => {
                  let schema: z.ZodTypeAny;
                  switch (prop.type) {
                    case "number":
                      schema = z.number().optional();
                      break;
                    case "object":
                      schema = z.record(z.string(), z.unknown()).optional();
                      break;
                    case "array":
                      schema = z.array(z.unknown()).optional();
                      break;
                    default:
                      schema = z.string().optional();
                  }
                  return [key, schema];
                }),
              )
            : {},
          annotations: def.annotations,
        },
        async (args) => {
          return this.handleToolCall(def.name, args as Record<string, unknown>);
        },
      );
    }
  }

  private async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const auth = this.getAuth();
    const isMutation = this.allSideEffectTools.has(toolName);

    // Session guard: check limits before dispatch
    const check = this.sessionGuard.checkCall(toolName, args, isMutation);
    if (!check.allowed) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: check.reason }) }],
      };
    }

    // Forced escalation: when mutation threshold exceeded, inject _forceApproval
    if (isMutation && this.sessionGuard.escalationActive) {
      args = { ...args, _forceApproval: true };
    }

    try {
      let result: unknown;

      // Auto-registered tools: dispatch through ExecutionService.execute()
      const autoActionType = this.autoRegisteredMap.get(toolName);
      if (autoActionType) {
        const response = await this.executionService.execute({
          actorId: auth.actorId,
          organizationId: auth.organizationId ?? null,
          requestedAction: {
            actionType: autoActionType,
            parameters: args,
            sideEffect: true,
          },
          message: `MCP tool call: ${toolName}`,
        });
        result = {
          outcome: response.outcome,
          envelopeId: response.envelopeId,
          traceId: response.traceId,
          summary: response.executionResult?.summary,
          approvalId: response.approvalId,
          deniedExplanation: response.deniedExplanation,
          governanceNote: response.governanceNote,
        };
      } else if (CRM_SIDE_EFFECT_TOOLS.has(toolName)) {
        result = await handleCrmSideEffectTool(toolName, args, auth, this.executionService);
      } else if (CRM_READ_TOOLS.has(toolName)) {
        result = await handleCrmReadTool(toolName, args, auth, this.readDeps);
      } else if (PAYMENTS_SIDE_EFFECT_TOOLS.has(toolName)) {
        result = await handlePaymentsSideEffectTool(toolName, args, auth, this.executionService);
      } else if (PAYMENTS_READ_TOOLS.has(toolName)) {
        result = await handlePaymentsReadTool(toolName, args, auth, this.readDeps);
      } else if (SIDE_EFFECT_TOOLS.has(toolName)) {
        result = await handleSideEffectTool(toolName, args, auth, this.executionService);
      } else if (READ_TOOLS.has(toolName)) {
        result = await handleReadTool(toolName, args, auth, this.readDeps);
      } else if (GOVERNANCE_TOOLS.has(toolName)) {
        result = await handleGovernanceTool(toolName, args, auth, this.governanceDeps);
      } else {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      // Record successful call
      this.sessionGuard.recordCall(toolName, args, isMutation);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      };
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }
}
