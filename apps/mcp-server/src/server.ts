import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ExecutionService, CartridgeReadAdapter, LifecycleOrchestrator, StorageContext } from "@switchboard/core";
import { resolveAuth, loadMcpApiKeys } from "./auth.js";
import type { McpAuthContext } from "./auth.js";
import {
  toolDefinitions,
  SIDE_EFFECT_TOOLS,
  READ_TOOLS,
  handleSideEffectTool,
  handleReadTool,
} from "./tools/index.js";
import type { ReadToolDeps } from "./tools/index.js";

export interface SwitchboardMcpServerOptions {
  executionService: ExecutionService;
  readAdapter: CartridgeReadAdapter;
  orchestrator: LifecycleOrchestrator;
  storage: StorageContext;
}

export class SwitchboardMcpServer {
  private mcpServer: McpServer;
  private executionService: ExecutionService;
  private readDeps: ReadToolDeps;
  private apiKeys: ReturnType<typeof loadMcpApiKeys>;

  constructor(options: SwitchboardMcpServerOptions) {
    this.executionService = options.executionService;
    this.readDeps = {
      readAdapter: options.readAdapter,
      orchestrator: options.orchestrator,
      storage: options.storage,
    };
    this.apiKeys = loadMcpApiKeys();

    this.mcpServer = new McpServer({
      name: "switchboard",
      version: "0.1.0",
    });

    this.registerTools();
  }

  private getAuth(): McpAuthContext {
    // In stdio mode, auth is resolved once at startup from env.
    // The API key can be passed via MCP_API_KEY env var.
    const key = process.env["MCP_API_KEY"];
    return resolveAuth(key, this.apiKeys);
  }

  private registerTools(): void {
    for (const def of toolDefinitions) {
      // Build a Zod schema from the JSON Schema input definition
      // We use z.object({}).passthrough() as a base since MCP SDK
      // will do its own validation from the inputSchema
      this.mcpServer.tool(
        def.name,
        def.description,
        def.inputSchema.properties
          ? Object.fromEntries(
              Object.entries(def.inputSchema.properties as Record<string, { type: string; description?: string }>).map(
                ([key, prop]) => {
                  let schema: z.ZodTypeAny;
                  switch (prop.type) {
                    case "number":
                      schema = z.number().optional();
                      break;
                    case "object":
                      schema = z.record(z.string(), z.unknown()).optional();
                      break;
                    default:
                      schema = z.string().optional();
                  }
                  return [key, schema];
                },
              ),
            )
          : {},
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

    try {
      let result: unknown;

      if (SIDE_EFFECT_TOOLS.has(toolName)) {
        result = await handleSideEffectTool(
          toolName,
          args,
          auth,
          this.executionService,
        );
      } else if (READ_TOOLS.has(toolName)) {
        result = await handleReadTool(toolName, args, auth, this.readDeps);
      } else {
        throw new Error(`Unknown tool: ${toolName}`);
      }

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
