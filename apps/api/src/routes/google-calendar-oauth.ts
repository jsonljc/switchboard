// @route-class: ingress-receiver
import type { FastifyPluginAsync } from "fastify";
import { google } from "googleapis";
import { buildSignedState, verifySignedState } from "@switchboard/ad-optimizer";
import {
  PrismaDeploymentConnectionStore,
  PrismaDeploymentStore,
  encryptCredentials,
  decryptCredentials,
} from "@switchboard/db";
import { assertOrgAccess, resolveCallerOrgId } from "../utils/org-access.js";
import { resolveOAuthStateSecret } from "../utils/oauth-state-secret.js";

interface GoogleCalendarOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function getOAuthConfig(): GoogleCalendarOAuthConfig {
  const clientId = process.env["GOOGLE_CALENDAR_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CALENDAR_CLIENT_SECRET"];
  const redirectUri = process.env["GOOGLE_CALENDAR_REDIRECT_URI"];

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing Google Calendar OAuth config. Set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI.",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function createOAuth2Client(config: GoogleCalendarOAuthConfig) {
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export const googleCalendarOAuthRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/connections/google-calendar/authorize — mint a signed Google OAuth authorize URL.
  // Bearer-authed (the dashboard server-proxies it): verify the caller's org owns the deployment
  // BEFORE signing a state for it (Q2). Returns { authorizeUrl } for the dashboard to redirect to.
  app.get<{ Querystring: { deploymentId?: string } }>(
    "/google-calendar/authorize",
    {
      schema: {
        description:
          "Mint a signed Google Calendar OAuth authorize URL for a deployment the caller's org owns. " +
          "Returns { authorizeUrl }.",
        tags: ["Connections", "Google Calendar OAuth"],
      },
    },
    async (request, reply) => {
      const { deploymentId } = request.query;
      if (!deploymentId) {
        return reply
          .code(400)
          .send({ error: "deploymentId query parameter is required", statusCode: 400 });
      }

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const deployment = await new PrismaDeploymentStore(app.prisma).findById(deploymentId);
      if (!deployment) {
        return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
      }
      if (!assertOrgAccess(request, deployment.organizationId, reply)) {
        return;
      }

      try {
        const config = getOAuthConfig();
        const oauth2Client = createOAuth2Client(config);

        const authorizeUrl = oauth2Client.generateAuthUrl({
          access_type: "offline",
          scope: CALENDAR_SCOPES,
          state: buildSignedState(deploymentId, resolveOAuthStateSecret(process.env)),
          prompt: "consent",
        });

        return reply.send({ authorizeUrl });
      } catch (err) {
        app.log.error(err, "Failed to build Google Calendar authorization URL");
        return reply.code(500).send({ error: "OAuth configuration error", statusCode: 500 });
      }
    },
  );

  // GET /api/connections/google-calendar/callback — handle Google OAuth callback
  app.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
    };
  }>(
    "/google-calendar/callback",
    {
      schema: {
        description:
          "Handle Google Calendar OAuth callback — exchange code for tokens, store connection.",
        tags: ["Connections", "Google Calendar OAuth"],
      },
    },
    async (request, reply) => {
      const { code, state, error } = request.query;

      if (error) {
        app.log.warn({ error, state }, "Google Calendar OAuth error callback");
        return reply.code(400).send({
          error: "Google Calendar OAuth denied",
          detail: error,
          statusCode: 400,
        });
      }

      if (!code || !state) {
        return reply.code(400).send({ error: "Missing code or state parameter", statusCode: 400 });
      }

      // Auth-exempt leg: trust ONLY the signed state. verifySignedState rejects a forged / tampered
      // / expired / replayed state; the deploymentId it returns drives a trusted DB lookup below.
      const verified = verifySignedState(state, resolveOAuthStateSecret(process.env));
      if (!verified) {
        return reply.code(400).send({ error: "Invalid or expired OAuth state", statusCode: 400 });
      }
      const deploymentId = verified.deploymentId;

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      try {
        const config = getOAuthConfig();
        const oauth2Client = createOAuth2Client(config);

        // Exchange authorization code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        if (!tokens.refresh_token) {
          return reply.code(400).send({
            error: "No refresh token received. Please revoke access and try again.",
            statusCode: 400,
          });
        }

        // List calendars and pick primary (or first writable)
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        const calendarList = await calendar.calendarList.list();
        const calendars = calendarList.data.items ?? [];

        const primaryCalendar =
          calendars.find((c) => c.primary) ??
          calendars.find((c) => c.accessRole === "owner" || c.accessRole === "writer");

        const calendarId = primaryCalendar?.id ?? "primary";
        const calendarSummary = primaryCalendar?.summary ?? "Primary";

        // Encrypt and store credentials
        const credentials = encryptCredentials({
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token ?? "",
          calendarId,
          calendarSummary,
          expiryDate: tokens.expiry_date ? String(tokens.expiry_date) : "",
        });

        const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
        const deploymentStore = new PrismaDeploymentStore(app.prisma);

        // Resolve organizationId from deployment — needed for tenant-scoped mutations
        const deployment = await deploymentStore.findById(deploymentId);
        if (!deployment) {
          return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
        }

        // Upsert: check if a google_calendar connection already exists for this deployment
        const existing = await connectionStore.findByDeploymentAndType(
          deploymentId,
          "google_calendar",
        );

        if (existing) {
          await connectionStore.updateCredentials(
            deployment.organizationId,
            existing.id,
            credentials,
            {
              calendarId,
              calendarSummary,
            },
          );
        } else {
          await connectionStore.create({
            deploymentId,
            type: "google_calendar",
            credentials,
            metadata: { calendarId, calendarSummary },
          });
        }

        const dashboardUrl = process.env["DASHBOARD_URL"] ?? "http://localhost:3002";
        return reply.redirect(
          `${dashboardUrl}/connections/callback?connected=true&deploymentId=${deploymentId}&service=google_calendar`,
        );
      } catch (err) {
        app.log.error(err, "Google Calendar OAuth callback failed");
        return reply.code(500).send({
          error: "Failed to complete Google Calendar OAuth flow",
          detail: err instanceof Error ? err.message : String(err),
          statusCode: 500,
        });
      }
    },
  );

  // GET /api/connections/google-calendar/:deploymentId/calendars — list calendars for a deployment
  app.get<{ Params: { deploymentId: string } }>(
    "/google-calendar/:deploymentId/calendars",
    {
      schema: {
        description: "List Google Calendars for an existing deployment connection.",
        tags: ["Connections", "Google Calendar OAuth"],
      },
    },
    async (request, reply) => {
      const { deploymentId } = request.params;

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      try {
        // Tenant isolation (F2): gate the deployment against the authenticated org
        // BEFORE reading or decrypting its stored OAuth credentials.
        const deployment = await new PrismaDeploymentStore(app.prisma).findById(deploymentId);
        if (!deployment) {
          return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
        }
        if (!assertOrgAccess(request, deployment.organizationId, reply)) {
          return;
        }

        // Defense-in-depth: scope the credential read to the authenticated caller's org so it stays
        // tenant-safe at the store layer even if the route check above is ever dropped.
        const callerOrgId = resolveCallerOrgId(request, deployment.organizationId);
        const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
        const connection = await connectionStore.findByDeploymentAndTypeForOrg(
          callerOrgId,
          deploymentId,
          "google_calendar",
        );

        if (!connection) {
          return reply.code(404).send({
            error: "No google_calendar connection found for this deployment",
            statusCode: 404,
          });
        }

        const creds = decryptCredentials(connection.credentials);
        const refreshToken = creds["refreshToken"] as string;

        if (!refreshToken) {
          return reply
            .code(500)
            .send({ error: "Connection credentials missing refresh token", statusCode: 500 });
        }

        const config = getOAuthConfig();
        const oauth2Client = createOAuth2Client(config);
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        const calendarList = await calendar.calendarList.list();
        const calendars = (calendarList.data.items ?? []).map((c) => ({
          id: c.id,
          summary: c.summary,
          primary: c.primary ?? false,
          accessRole: c.accessRole,
        }));

        return reply.code(200).send({ calendars });
      } catch (err) {
        app.log.error(err, "Failed to list Google calendars");
        return reply.code(500).send({
          error: "Failed to list calendars",
          detail: err instanceof Error ? err.message : String(err),
          statusCode: 500,
        });
      }
    },
  );
};
