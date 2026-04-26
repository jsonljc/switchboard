import { Inngest } from "inngest";
import type { FacebookOAuthConfig, TokenResult } from "@switchboard/ad-optimizer";
import { encryptCredentials, decryptCredentials } from "@switchboard/db";

const inngestClient = new Inngest({ id: "switchboard" });

const REFRESH_THRESHOLD_DAYS = 7;

interface DeploymentConnectionRecord {
  id: string;
  deploymentId: string;
  type: string;
  status: string;
  credentials: string;
  metadata: Record<string, unknown> | null;
}

export interface MetaTokenRefreshDeps {
  listMetaConnections: () => Promise<DeploymentConnectionRecord[]>;
  updateCredentials: (id: string, credentials: string) => Promise<void>;
  updateStatus: (id: string, status: string) => Promise<void>;
  refreshTokenIfNeeded: (
    config: FacebookOAuthConfig,
    currentToken: string,
    expiresAt: Date,
  ) => Promise<TokenResult | null>;
  getOAuthConfig: () => FacebookOAuthConfig;
  notifyOperator?: (message: string, context: Record<string, unknown>) => Promise<void>;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export async function executeMetaTokenRefresh(
  step: StepTools,
  deps: MetaTokenRefreshDeps,
): Promise<{ checked: number; refreshed: number; failed: number }> {
  const connections = await step.run("list-meta-connections", () => deps.listMetaConnections());

  let refreshed = 0;
  let failed = 0;

  for (const conn of connections) {
    if (conn.status !== "active") continue;

    await step.run(`refresh-${conn.id}`, async () => {
      const creds = decryptCredentials(conn.credentials);
      const accessToken = creds.accessToken as string | undefined;
      const expiresAtRaw = creds.tokenExpiresAt as string | undefined;

      if (!accessToken || !expiresAtRaw) {
        console.warn(
          `[meta-token-refresh] Connection ${conn.id} missing accessToken or tokenExpiresAt`,
        );
        return;
      }

      const expiresAt = new Date(expiresAtRaw);
      const msUntilExpiry = expiresAt.getTime() - Date.now();
      const daysUntilExpiry = msUntilExpiry / (24 * 60 * 60 * 1000);

      if (daysUntilExpiry > REFRESH_THRESHOLD_DAYS) {
        return;
      }

      try {
        const config = deps.getOAuthConfig();
        const result = await deps.refreshTokenIfNeeded(config, accessToken, expiresAt);
        if (result) {
          const newExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
          const updatedCreds = {
            ...creds,
            accessToken: result.accessToken,
            tokenExpiresAt: newExpiresAt.toISOString(),
          };
          const encrypted = encryptCredentials(updatedCreds);
          await deps.updateCredentials(conn.id, encrypted);
          refreshed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[meta-token-refresh] Failed to refresh connection ${conn.id}: ${msg}`);
        await deps.updateStatus(conn.id, "needs_reauth");
        if (deps.notifyOperator) {
          await deps
            .notifyOperator(`Meta token refresh failed for connection ${conn.id}`, {
              connectionId: conn.id,
              deploymentId: conn.deploymentId,
              error: msg,
            })
            .catch(() => {}); // don't let notification failure break the cron
        }
        failed++;
      }
    });
  }

  return { checked: connections.length, refreshed, failed };
}

export function createMetaTokenRefreshCron(deps: MetaTokenRefreshDeps) {
  return inngestClient.createFunction(
    {
      id: "meta-token-refresh",
      name: "Meta Ads Token Refresh",
      retries: 2,
      triggers: [{ cron: "0 3 * * *" }],
    },
    async ({ step }) => {
      return executeMetaTokenRefresh(step as unknown as StepTools, deps);
    },
  );
}
