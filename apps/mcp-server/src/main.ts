import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  DEFAULT_REDACTION_CONFIG,
  InMemoryPolicyCache,
  InMemoryGovernanceProfileStore,
  ExecutionService,
  CartridgeReadAdapter,
} from "@switchboard/core";
import { SwitchboardMcpServer } from "./server.js";
import { McpApiClient } from "./api-client.js";
import { ApiReadAdapter } from "./adapters/api-read-adapter.js";
import {
  createApiOrchestrator,
  createApiStorage,
  createApiGovernanceProfileStore,
  createApiLedger,
} from "./adapters/api-governance-adapter.js";

async function main() {
  const apiUrl = process.env["SWITCHBOARD_API_URL"];
  const apiKey = process.env["SWITCHBOARD_API_KEY"];

  if (apiUrl) {
    // -- API mode: delegate all operations to the Switchboard API --
    console.error(`[mcp-server] API mode: delegating to ${apiUrl}`);

    const client = new McpApiClient({ baseUrl: apiUrl, apiKey });

    const orchestrator = createApiOrchestrator(client);
    const storage = createApiStorage(client);
    const ledger = createApiLedger(client);
    const governanceProfileStore = createApiGovernanceProfileStore(client);
    const readAdapter = new ApiReadAdapter(client);

    // ExecutionService is used by side-effect tools -- create a proxy
    // that delegates to the API via POST /api/execute.
    const executionService = {
      async execute(params: {
        actionType: string;
        parameters: Record<string, unknown>;
        principalId: string;
        organizationId?: string | null;
      }) {
        const { data } = await client.post<{
          outcome: string;
          envelopeId: string;
          traceId?: string;
          executionResult?: unknown;
          approvalId?: string;
          approvalRequest?: unknown;
          deniedExplanation?: string;
        }>(
          "/api/execute",
          {
            actorId: params.principalId,
            organizationId: params.organizationId ?? null,
            action: {
              actionType: params.actionType,
              parameters: params.parameters,
              sideEffect: true,
            },
          },
          client.idempotencyKey("mcp_exec"),
        );

        return {
          outcome: data.outcome,
          envelopeId: data.envelopeId,
          traceId: data.traceId,
          executionResult: data.executionResult,
          approvalId: data.approvalId,
          approvalRequest: data.approvalRequest,
          deniedExplanation: data.deniedExplanation,
        };
      },
    } as unknown as ExecutionService;

    const server = new SwitchboardMcpServer({
      executionService,
      readAdapter,
      orchestrator,
      storage,
      ledger,
      governanceProfileStore,
    });

    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));

    await server.start();
    return;
  }

  // -- In-memory mode (dev/testing) --
  console.error("[mcp-server] In-memory mode (set SWITCHBOARD_API_URL for API delegation)");

  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
  const guardrailState = createGuardrailState();
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // Seed default governance policies (no cartridges registered in employee mode)
  await seedDefaultStorage(storage);

  // -- Orchestrator + services --
  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    policyCache,
    governanceProfileStore,
  });

  const executionService = new ExecutionService(orchestrator, storage);
  const readAdapter = new CartridgeReadAdapter(storage, ledger);

  // -- MCP Server --
  const server = new SwitchboardMcpServer({
    executionService,
    readAdapter,
    orchestrator,
    storage,
    ledger,
    governanceProfileStore,
    cartridgeRegistry: storage.cartridges,
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    process.exit(0);
  });
  process.on("SIGINT", () => {
    process.exit(0);
  });

  await server.start();
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
