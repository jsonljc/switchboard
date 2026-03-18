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
  ): Promise<{ success: boolean }> => {
    const connectorConfig = config.configLookup(destinationId);
    if (!connectorConfig) {
      return { success: false };
    }

    const adapter = config.adapters.get(connectorConfig.connectorType);
    if (!adapter) {
      return { success: false };
    }

    try {
      const result = await adapter.handleEvent(event);
      return { success: result.success };
    } catch {
      return { success: false };
    }
  };
}
