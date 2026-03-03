import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  DEFAULT_REDACTION_CONFIG,
  GuardedCartridge,
  InMemoryPolicyCache,
  InMemoryGovernanceProfileStore,
  ExecutionService,
  CartridgeReadAdapter,
  SkinLoader,
  SkinResolver,
  ToolRegistry,
} from "@switchboard/core";
import {
  bootstrapDigitalAdsCartridge,
  DEFAULT_DIGITAL_ADS_POLICIES,
} from "@switchboard/digital-ads";
import {
  bootstrapQuantTradingCartridge,
  DEFAULT_TRADING_POLICIES,
} from "@switchboard/quant-trading";
import { bootstrapPaymentsCartridge, DEFAULT_PAYMENTS_POLICIES } from "@switchboard/payments";
import { bootstrapCrmCartridge, DEFAULT_CRM_POLICIES } from "@switchboard/crm";
import {
  bootstrapPatientEngagementCartridge,
  DEFAULT_PATIENT_ENGAGEMENT_POLICIES,
} from "@switchboard/patient-engagement";
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
    // ── API mode: delegate all operations to the Switchboard API ─────
    console.error(`[mcp-server] API mode: delegating to ${apiUrl}`);

    const client = new McpApiClient({ baseUrl: apiUrl, apiKey });

    const orchestrator = createApiOrchestrator(client);
    const storage = createApiStorage(client);
    const ledger = createApiLedger(client);
    const governanceProfileStore = createApiGovernanceProfileStore(client);
    const readAdapter = new ApiReadAdapter(client);

    // ExecutionService is used by side-effect tools — create a proxy
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

  // ── In-memory mode (dev/testing) ──────────────────────────────────
  console.error("[mcp-server] In-memory mode (set SWITCHBOARD_API_URL for API delegation)");

  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
  const guardrailState = createGuardrailState();
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // ── Cartridge registration ───────────────────────────────────────────
  const adsAccessToken = process.env["META_ADS_ACCESS_TOKEN"];
  const adsAccountId = process.env["META_ADS_ACCOUNT_ID"];
  const { cartridge: adsCartridge, interceptors } = await bootstrapDigitalAdsCartridge({
    accessToken: adsAccessToken ?? "mock-token-dev-only",
    adAccountId: adsAccountId ?? "act_mock_dev_only",
    requireCredentials: process.env.NODE_ENV === "production",
  });
  storage.cartridges.register(
    "digital-ads",
    new GuardedCartridge(adsCartridge as any, interceptors),
  );
  await seedDefaultStorage(storage, DEFAULT_DIGITAL_ADS_POLICIES);

  // Register quant-trading cartridge
  const { cartridge: tradingCartridge } = await bootstrapQuantTradingCartridge();
  storage.cartridges.register("quant-trading", new GuardedCartridge(tradingCartridge));
  await seedDefaultStorage(storage, DEFAULT_TRADING_POLICIES);

  // Register payments cartridge
  const { cartridge: paymentsCartridge } = await bootstrapPaymentsCartridge({
    secretKey: process.env["STRIPE_SECRET_KEY"] ?? "mock-key-dev-only",
    requireCredentials: process.env.NODE_ENV === "production",
  });
  storage.cartridges.register("payments", new GuardedCartridge(paymentsCartridge));
  await seedDefaultStorage(storage, DEFAULT_PAYMENTS_POLICIES);

  // Register CRM cartridge (built-in, no external credentials needed)
  const { cartridge: crmCartridge } = await bootstrapCrmCartridge();
  storage.cartridges.register("crm", new GuardedCartridge(crmCartridge));
  await seedDefaultStorage(storage, DEFAULT_CRM_POLICIES);

  // Register patient-engagement cartridge (mock providers for dev)
  const { cartridge: peCartridge, interceptors: peInterceptors } =
    await bootstrapPatientEngagementCartridge();
  storage.cartridges.register(
    "patient-engagement",
    new GuardedCartridge(peCartridge, peInterceptors),
  );
  await seedDefaultStorage(storage, DEFAULT_PATIENT_ENGAGEMENT_POLICIES);

  // --- Skin loading (optional, controlled by SKIN_ID env var) ---
  let skinToolFilter: import("@switchboard/core").ToolFilter | undefined;
  const skinId = process.env["SKIN_ID"];
  if (skinId) {
    const skinsDir = new URL("../../../skins", import.meta.url).pathname;
    const skinLoader = new SkinLoader(skinsDir);
    const skinResolver = new SkinResolver();
    const toolRegistry = new ToolRegistry();

    for (const cartridgeId of storage.cartridges.list()) {
      const cartridge = storage.cartridges.get(cartridgeId);
      if (cartridge) {
        toolRegistry.registerCartridge(cartridgeId, cartridge.manifest);
      }
    }

    const skin = await skinLoader.load(skinId);
    const resolvedSkin = skinResolver.resolve(skin, toolRegistry);
    skinToolFilter = resolvedSkin.toolFilter;
    console.error(
      `[mcp-server] Skin "${skinId}" loaded: ${resolvedSkin.tools.length} tools, profile=${resolvedSkin.governance.profile}`,
    );
  }

  // ── Orchestrator + services ──────────────────────────────────────────
  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    policyCache,
    governanceProfileStore,
  });

  const executionService = new ExecutionService(orchestrator, storage);
  const readAdapter = new CartridgeReadAdapter(storage, ledger);

  // ── MCP Server ───────────────────────────────────────────────────────
  const server = new SwitchboardMcpServer({
    executionService,
    readAdapter,
    orchestrator,
    storage,
    ledger,
    governanceProfileStore,
    cartridgeRegistry: storage.cartridges,
    toolFilter: skinToolFilter,
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
