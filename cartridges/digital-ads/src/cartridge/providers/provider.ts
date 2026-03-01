// ---------------------------------------------------------------------------
// AdPlatformProvider Interface
// ---------------------------------------------------------------------------
// Wraps PlatformClient with connection validation and health checking.
// Each provider knows how to validate credentials and produce a client.
// ---------------------------------------------------------------------------

import type { PlatformClient, PlatformCredentials, PlatformType } from "../../platforms/types.js";
import type { EntityLevel } from "../../core/types.js";
import type { PlatformHealth } from "../types.js";

export interface AdPlatformProvider {
  readonly platform: PlatformType;

  /** Validate credentials and return a connected client */
  connect(
    credentials: PlatformCredentials,
    entityId: string
  ): Promise<{
    client: PlatformClient;
    accountName: string;
    entityLevels: EntityLevel[];
  }>;

  /** Lightweight connectivity check */
  checkHealth(
    credentials: PlatformCredentials,
    entityId: string
  ): Promise<PlatformHealth>;

  /** Create a client from credentials (no validation) */
  createClient(credentials: PlatformCredentials): PlatformClient;
}
