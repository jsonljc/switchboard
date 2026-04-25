import type { FastifyPluginAsync } from "fastify";
import { google } from "googleapis";
import {
  PrismaDeploymentConnectionStore,
  encryptCredentials,
  decryptCredentials,
} from "@switchboard/db";

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
  // GET /api/connections/google-calendar/authorize — redirect to Google OAuth consent screen
  app.get<{ Querystring: { deploymentId?: string } }>(
    "/google-calendar/authorize",
    {
      schema: {
        description: "Redirect to Google OAuth consent screen for calendar access.",
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

      try {
        const config = getOAuthConfig();
        const oauth2Client = createOAuth2Client(config);

        const url = oauth2Client.generateAuthUrl({
          access_type: "offline",
          scope: CALENDAR_SCOPES,
          state: deploymentId,
          prompt: "consent",
        });

        return reply.redirect(url);
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
      const { code, state: deploymentId, error } = request.query;

      if (error) {
        app.log.warn({ error, deploymentId }, "Google Calendar OAuth error callback");
        return reply.code(400).send({
          error: "Google Calendar OAuth denied",
          detail: error,
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

        // Upsert: check if a google_calendar connection already exists for this deployment
        const existing = await connectionStore.findByDeploymentAndType(
          deploymentId,
          "google_calendar",
        );

        if (existing) {
          await connectionStore.updateCredentials(existing.id, credentials, {
            calendarId,
            calendarSummary,
          });
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
        const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
        const connection = await connectionStore.findByDeploymentAndType(
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
