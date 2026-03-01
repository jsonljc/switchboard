// ---------------------------------------------------------------------------
// Session State Management
// ---------------------------------------------------------------------------
// Manages platform connections within a session.
// ---------------------------------------------------------------------------

import type { PlatformType, PlatformCredentials } from "../../platforms/types.js";
import type { SessionState, ConnectionState } from "../types.js";
import type { EntityLevel } from "../../core/types.js";

export function createSessionState(): SessionState {
  return {
    connections: new Map(),
  };
}

export function setConnection(
  session: SessionState,
  platform: PlatformType,
  credentials: PlatformCredentials,
  accountName?: string,
  entityLevels?: EntityLevel[]
): void {
  session.connections.set(platform, {
    platform,
    credentials,
    status: "connected",
    accountName,
    entityLevels,
    connectedAt: Date.now(),
  });
}

export function setConnectionError(
  session: SessionState,
  platform: PlatformType,
  credentials: PlatformCredentials,
  error: string
): void {
  session.connections.set(platform, {
    platform,
    credentials,
    status: "error",
    connectedAt: Date.now(),
    error,
  });
}

export function getConnection(
  session: SessionState,
  platform: PlatformType
): ConnectionState | undefined {
  return session.connections.get(platform);
}

export function getCredentials(
  session: SessionState,
  platform: PlatformType
): PlatformCredentials | undefined {
  return session.connections.get(platform)?.credentials;
}
