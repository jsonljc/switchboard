import type { CrossCartridgeContext, CrossCartridgeEnricher, EnrichmentMapping } from "./types.js";
import type { CartridgeRegistry } from "../storage/interfaces.js";
import { DEFAULT_ENRICHMENT_MAPPINGS } from "./mappings.js";

/** Minimal interface for entity graph resolution (full impl lives in entity-graph module). */
export interface EntityGraphService {
  resolveToCartridge(
    sourceRef: { cartridgeId: string; entityType: string; entityId: string },
    targetCartridgeId: string,
    targetEntityType: string,
    organizationId: string,
  ): Promise<string | null>;
}

export interface DefaultCrossCartridgeEnricherConfig {
  entityGraphService: EntityGraphService;
  cartridgeRegistry: CartridgeRegistry;
  mappings?: EnrichmentMapping[];
  /** Per-source timeout in milliseconds (default: 2000). */
  timeoutMs?: number;
}

export class DefaultCrossCartridgeEnricher implements CrossCartridgeEnricher {
  private entityGraphService: EntityGraphService;
  private cartridgeRegistry: CartridgeRegistry;
  private mappings: EnrichmentMapping[];
  private timeoutMs: number;

  constructor(config: DefaultCrossCartridgeEnricherConfig) {
    this.entityGraphService = config.entityGraphService;
    this.cartridgeRegistry = config.cartridgeRegistry;
    this.mappings = config.mappings ?? DEFAULT_ENRICHMENT_MAPPINGS;
    this.timeoutMs = config.timeoutMs ?? 2000;
  }

  async enrich(params: {
    targetCartridgeId: string;
    actionType: string;
    parameters: Record<string, unknown>;
    organizationId: string;
    principalId: string;
  }): Promise<CrossCartridgeContext> {
    const context: CrossCartridgeContext = {};

    // Find all mappings where the target is the current cartridge
    const applicableMappings = this.mappings.filter(
      (m) => m.enabled && m.targetCartridgeId === params.targetCartridgeId,
    );

    for (const mapping of applicableMappings) {
      const sourceCartridgeId = mapping.sourceCartridgeId;

      try {
        // 1. Get the target entity ID from the action parameters
        const targetEntityId = params.parameters[mapping.targetEntityParam] as string | undefined;
        if (!targetEntityId) {
          context[sourceCartridgeId] = {
            _available: false,
            _error: `Target entity param "${mapping.targetEntityParam}" not found in parameters`,
          };
          continue;
        }

        // 2. Resolve via entity graph: target entity → source entity
        const sourceEntityId = await this.entityGraphService.resolveToCartridge(
          {
            cartridgeId: params.targetCartridgeId,
            entityType: this.inferEntityType(params.targetCartridgeId, mapping.targetEntityParam),
            entityId: targetEntityId,
          },
          sourceCartridgeId,
          mapping.sourceEntityType,
          params.organizationId,
        );

        if (!sourceEntityId) {
          context[sourceCartridgeId] = {
            _available: false,
            _error: `No entity mapping found from ${params.targetCartridgeId} to ${sourceCartridgeId}`,
          };
          continue;
        }

        // 3. Call the source cartridge's enrichContext with the resolved entity
        const sourceCartridge = this.cartridgeRegistry.get(sourceCartridgeId);
        if (!sourceCartridge) {
          context[sourceCartridgeId] = {
            _available: false,
            _error: `Source cartridge "${sourceCartridgeId}" not registered`,
          };
          continue;
        }

        const enriched = await Promise.race([
          sourceCartridge.enrichContext(
            params.actionType,
            { [mapping.sourceEntityType + "Id"]: sourceEntityId, entityId: sourceEntityId },
            {
              principalId: params.principalId,
              organizationId: params.organizationId,
              connectionCredentials: {},
            },
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Enrichment timeout")), this.timeoutMs),
          ),
        ]);

        // Merge with existing context for this source (if multiple mappings)
        const existing = context[sourceCartridgeId];
        context[sourceCartridgeId] = {
          ...(existing && existing._available ? existing : {}),
          _available: true,
          ...enriched,
        };
      } catch (err) {
        // Never throw — mark as unavailable
        const existing = context[sourceCartridgeId];
        if (!existing || !existing._available) {
          context[sourceCartridgeId] = {
            _available: false,
            _error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    return context;
  }

  /**
   * Infer the entity type from the cartridge and parameter name.
   * E.g., "customer-engagement" + "contactId" → "contact"
   */
  private inferEntityType(cartridgeId: string, paramName: string): string {
    // Common patterns: contactId → contact, entityId → customer
    if (paramName.endsWith("Id")) {
      const raw = paramName.slice(0, -2);
      if (raw === "entity") {
        // For generic "entityId", derive from cartridge
        switch (cartridgeId) {
          case "payments":
            return "customer";
          case "crm":
            return "contact";
          case "customer-engagement":
            return "contact";
          default:
            return raw;
        }
      }
      return raw;
    }
    return paramName;
  }
}
