// ---------------------------------------------------------------------------
// Connector Dispatch Handler — routes events to native connector adapters
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "../events.js";
import type { ConnectorAdapter } from "../connectors/connector-port.js";
import type { ConnectorDestinationConfig } from "../route-plan.js";

export interface ConnectorHandlerConfig {
  adapters: Map<string, ConnectorAdapter>;
  configLookup: (destinationId: string) => ConnectorDestinationConfig | undefined;
}

export function createConnectorHandler(config: ConnectorHandlerConfig) {
  return async (
    event: RoutedEventEnvelope,
    destinationId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const connectorConfig = config.configLookup(destinationId);
    if (!connectorConfig) {
      return { success: false, error: `No config found for connector: ${destinationId}` };
    }

    const adapter = config.adapters.get(connectorConfig.connectorType);
    if (!adapter) {
      return {
        success: false,
        error: `No adapter registered for type: ${connectorConfig.connectorType}`,
      };
    }

    try {
      return await adapter.handleEvent(event);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
