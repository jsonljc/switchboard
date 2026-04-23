import type { FastifyPluginAsync } from "fastify";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
} from "@switchboard/ad-optimizer";
import type { FacebookOAuthConfig } from "@switchboard/ad-optimizer";
import {
  PrismaDeploymentConnectionStore,
  encryptCredentials,
  decryptCredentials,
} from "@switchboard/db";

function getOAuthConfig(): FacebookOAuthConfig {
  const appId = process.env["FACEBOOK_APP_ID"];
  const appSecret = process.env["FACEBOOK_APP_SECRET"];
  const redirectUri = process.env["FACEBOOK_REDIRECT_URI"];

  if (!appId || !appSecret || !redirectUri) {
    throw new Error(
      "Missing Facebook OAuth config. Set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_REDIRECT_URI.",
    );
  }

  return { appId, appSecret, redirectUri };
}

export const facebookOAuthRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/connections/facebook/authorize — redirect to Facebook OAuth dialog
  app.get<{ Querystring: { deploymentId?: string } }>(
    "/facebook/authorize",
    {
      schema: {
        description: "Redirect to Facebook OAuth dialog for ad account connection.",
        tags: ["Connections", "Facebook OAuth"],
      },
    },
    async (request, reply) => {
      const { deploymentId } = request.query;
      if (!deploymentId) {
        return reply
          .code(400)
          .send({ error: "deploymentId query parameter is required", statusCode: 400 });
      }

      try {
        const config = getOAuthConfig();
        const url = buildAuthorizationUrl(config, deploymentId);
        return reply.redirect(url);
      } catch (err) {
        app.log.error(err, "Failed to build Facebook authorization URL");
        return reply.code(500).send({ error: "OAuth configuration error", statusCode: 500 });
      }
    },
  );

  // GET /api/connections/facebook/callback — handle Facebook OAuth callback
  app.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
  }>(
    "/facebook/callback",
    {
      schema: {
        description: "Handle Facebook OAuth callback — exchange code for token, store connection.",
        tags: ["Connections", "Facebook OAuth"],
      },
    },
    async (request, reply) => {
      const { code, state: deploymentId, error, error_description } = request.query;

      if (error) {
        app.log.warn({ error, error_description, deploymentId }, "Facebook OAuth error callback");
        return reply.code(400).send({
          error: "Facebook OAuth denied",
          detail: error_description ?? error,
          statusCode: 400,
        });
      }

      if (!code || !deploymentId) {
        return reply.code(400).send({ error: "Missing code or state parameter", statusCode: 400 });
      }

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      try {
        const config = getOAuthConfig();

        // Exchange code for short-lived token
        const shortLived = await exchangeCodeForToken(config, code);

        // Exchange for long-lived (60-day) token
        const longLived = await exchangeForLongLivedToken(config, shortLived.accessToken);

        // List ad accounts and pick the first active one
        const accounts = await listAdAccounts(longLived.accessToken);
        const activeAccount = accounts.find((a) => a.status === 1);

        if (!activeAccount) {
          return reply.code(400).send({
            error: "No active ad accounts found for this Facebook user",
            statusCode: 400,
          });
        }

        const expiresAt = new Date(Date.now() + longLived.expiresIn * 1000).toISOString();

        // Encrypt and store credentials
        const credentials = encryptCredentials({
          accessToken: longLived.accessToken,
          accountId: `act_${activeAccount.accountId}`,
          accountName: activeAccount.name,
          currency: activeAccount.currency,
          expiresAt,
        });

        const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
        await connectionStore.create({
          deploymentId,
          type: "meta-ads",
          credentials,
          metadata: {
            accountId: `act_${activeAccount.accountId}`,
            accountName: activeAccount.name,
            expiresAt,
          },
        });

        const dashboardUrl = process.env["DASHBOARD_URL"] ?? "http://localhost:3002";
        return reply.redirect(
          `${dashboardUrl}/modules/improve-spend/setup?step=select-account&connected=true&deploymentId=${deploymentId}`,
        );
      } catch (err) {
        app.log.error(err, "Facebook OAuth callback failed");
        return reply.code(500).send({
          error: "Failed to complete Facebook OAuth flow",
          detail: err instanceof Error ? err.message : String(err),
          statusCode: 500,
        });
      }
    },
  );

  // GET /api/connections/facebook/:deploymentId/accounts — list ad accounts for a deployment
  app.get<{ Params: { deploymentId: string } }>(
    "/facebook/:deploymentId/accounts",
    {
      schema: {
        description: "List Facebook ad accounts for an existing deployment connection.",
        tags: ["Connections", "Facebook OAuth"],
      },
    },
    async (request, reply) => {
      const { deploymentId } = request.params;

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      try {
        const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
        const connection = await connectionStore.findByDeploymentAndType(deploymentId, "meta-ads");

        if (!connection) {
          return reply.code(404).send({
            error: "No meta-ads connection found for this deployment",
            statusCode: 404,
          });
        }

        const creds = decryptCredentials(connection.credentials);
        const accessToken = creds["accessToken"] as string;

        if (!accessToken) {
          return reply
            .code(500)
            .send({ error: "Connection credentials missing access token", statusCode: 500 });
        }

        const accounts = await listAdAccounts(accessToken);
        return reply.code(200).send({ accounts });
      } catch (err) {
        app.log.error(err, "Failed to list Facebook ad accounts");
        return reply.code(500).send({
          error: "Failed to list ad accounts",
          detail: err instanceof Error ? err.message : String(err),
          statusCode: 500,
        });
      }
    },
  );
};
