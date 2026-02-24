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
} from "@switchboard/core";
import { bootstrapAdsSpendCartridge, DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";
import { SwitchboardMcpServer } from "./server.js";

async function main() {
  // ── Storage ──────────────────────────────────────────────────────────
  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
  const guardrailState = createGuardrailState();
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // ── Cartridge registration ───────────────────────────────────────────
  const adsAccessToken = process.env["META_ADS_ACCESS_TOKEN"];
  const adsAccountId = process.env["META_ADS_ACCOUNT_ID"];
  const { cartridge: adsCartridge, interceptors } = await bootstrapAdsSpendCartridge({
    accessToken: adsAccessToken ?? "mock-token-dev-only",
    adAccountId: adsAccountId ?? "act_mock_dev_only",
    requireCredentials: process.env.NODE_ENV === "production",
  });
  storage.cartridges.register("ads-spend", new GuardedCartridge(adsCartridge, interceptors));
  await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

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
