// ---------------------------------------------------------------------------
// Connector Port — standard contract for native connectors
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "../events.js";

/**
 * Declares what a connector provides — identity, capabilities, config shape.
 * Used for registration and validation.
 */
export interface ConnectorPort {
  connectorType: string;
  version: string;
  displayName: string;
  supportedEvents: string[];
  requiredConfig: string[];
  optionalConfig: string[];
}

/**
 * Handles events by translating them to platform-specific API calls.
 * Each connector type has one adapter implementation.
 */
export interface ConnectorAdapter {
  connectorType: string;
  supportedEvents: string[];
  handleEvent(event: RoutedEventEnvelope): Promise<{ success: boolean; error?: string }>;
}

export interface ConnectorConfigValidation {
  valid: boolean;
  errors: string[];
}

export function validateConnectorConfig(
  port: ConnectorPort,
  config: Record<string, unknown>,
): ConnectorConfigValidation {
  const errors: string[] = [];

  for (const key of port.requiredConfig) {
    if (!(key in config) || config[key] === undefined || config[key] === null) {
      errors.push(`Missing required config: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
