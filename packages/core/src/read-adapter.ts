import { randomUUID } from "node:crypto";
import type { StorageContext } from "./storage/interfaces.js";
import type { AuditLedger } from "./audit/ledger.js";

/**
 * Describes a read-only operation against a cartridge provider.
 */
export interface ReadOperation {
  /** Which cartridge to target. */
  cartridgeId: string;
  /** The provider method to invoke (e.g. "getCampaign", "searchCampaigns"). */
  operation: string;
  /** Arguments passed to the provider method. */
  parameters: Record<string, unknown>;
  /** The actor performing the read. */
  actorId: string;
  /** Optional organization scope. */
  organizationId?: string | null;
  /** Optional correlation id. */
  traceId?: string;
}

export interface ReadResult {
  data: unknown;
  traceId: string;
}

/**
 * Governed read path for cartridge provider methods.
 * - Resolves cartridge from registry
 * - Calls the provider read method via enrichContext / resolveEntity
 * - Records an audit entry for the read
 * - Returns the data (secrets never leave Switchboard)
 */
export class CartridgeReadAdapter {
  constructor(
    private storage: StorageContext,
    private ledger: AuditLedger,
  ) {}

  async query(op: ReadOperation): Promise<ReadResult> {
    const traceId = op.traceId ?? `trace_${randomUUID()}`;

    // Resolve cartridge
    const cartridge = this.storage.cartridges.get(op.cartridgeId);
    if (!cartridge) {
      throw new Error(`Cartridge not found: ${op.cartridgeId}`);
    }

    let data: unknown;

    // Dispatch to the appropriate read method
    switch (op.operation) {
      case "getCampaign": {
        // enrichContext returns campaign metadata for a given campaignId
        data = await cartridge.enrichContext(
          "ads.campaign.read",
          op.parameters,
          {
            principalId: op.actorId,
            organizationId: op.organizationId ?? null,
            connectionCredentials: {},
          },
        );
        break;
      }
      case "searchCampaigns": {
        // Use resolveEntity to search — it returns matches
        if ("resolveEntity" in cartridge && typeof cartridge.resolveEntity === "function") {
          const query = (op.parameters["query"] as string) ?? "";
          const results = await (cartridge as { resolveEntity: (ref: string, type: string, ctx: Record<string, unknown>) => Promise<unknown> })
            .resolveEntity(query, "campaign", { principalId: op.actorId });
          data = results;
        } else {
          data = { campaigns: [] };
        }
        break;
      }
      default:
        throw new Error(`Unknown read operation: ${op.operation}`);
    }

    // Record audit entry for the read
    await this.ledger.record({
      eventType: "action.proposed",
      actorType: "user",
      actorId: op.actorId,
      entityType: "data.read",
      entityId: `${op.cartridgeId}:${op.operation}`,
      riskCategory: "none",
      summary: `Read ${op.operation} on ${op.cartridgeId}`,
      snapshot: {
        operation: op.operation,
        parameters: op.parameters,
        cartridgeId: op.cartridgeId,
      },
      organizationId: op.organizationId ?? undefined,
      traceId,
    });

    return { data, traceId };
  }
}
