// ---------------------------------------------------------------------------
// Bootstrap Setup — one-time admin provisioning endpoint
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

/**
 * POST /api/setup/bootstrap
 *
 * Creates the first DashboardUser and returns an API key.
 * Protected by INTERNAL_SETUP_SECRET env var. Only works when 0 dashboard
 * users exist (idempotent, one-time use).
 */
export const setupRoutes: FastifyPluginAsync = async (app) => {
  app.post("/bootstrap", async (request, reply) => {
    // Require INTERNAL_SETUP_SECRET to be set
    const setupSecret = process.env["INTERNAL_SETUP_SECRET"];
    if (!setupSecret) {
      return reply.code(503).send({
        error: "INTERNAL_SETUP_SECRET is not configured",
        statusCode: 503,
      });
    }

    // Verify the setup secret from Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "Missing Authorization header", statusCode: 401 });
    }

    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match?.[1]) {
      return reply.code(401).send({ error: "Invalid Authorization format", statusCode: 401 });
    }

    const providedSecret = match[1];
    if (
      providedSecret.length !== setupSecret.length ||
      !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(setupSecret))
    ) {
      return reply.code(401).send({ error: "Invalid setup secret", statusCode: 401 });
    }

    // Require database
    if (!app.prisma) {
      return reply.code(503).send({
        error: "Database is not configured (DATABASE_URL required)",
        statusCode: 503,
      });
    }

    // Only allow bootstrap when 0 dashboard users exist
    const userCount = await app.prisma.dashboardUser.count();
    if (userCount > 0) {
      return reply.code(409).send({
        error: "Bootstrap already completed. Dashboard users already exist.",
        statusCode: 409,
      });
    }

    // Parse request body
    const body = request.body as {
      email?: string;
      name?: string;
      password?: string;
    } | null;

    const email = body?.email ?? "admin@switchboard.local";
    const name = body?.name ?? "Admin";
    const password = body?.password;

    if (!password || password.length < 8) {
      return reply.code(400).send({
        error: "Password is required and must be at least 8 characters",
        statusCode: 400,
      });
    }

    // Generate API key and hash it
    const apiKey = `sb_${crypto.randomBytes(24).toString("hex")}`;
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    // Encrypt API key for storage (AES-256-GCM)
    const encryptionKey = process.env["CREDENTIALS_ENCRYPTION_KEY"];
    let apiKeyEncrypted: string;
    if (encryptionKey && encryptionKey.length >= 32) {
      const keyBuffer = crypto.createHash("sha256").update(encryptionKey).digest();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
      let encrypted = cipher.update(apiKey, "utf8", "hex");
      encrypted += cipher.final("hex");
      const authTag = cipher.getAuthTag().toString("hex");
      apiKeyEncrypted = `${iv.toString("hex")}:${authTag}:${encrypted}`;
    } else {
      // Fallback: store a placeholder (key won't be recoverable, but hash still works for auth)
      apiKeyEncrypted = "unencrypted:bootstrap";
    }

    // Hash password with scrypt (Node.js built-in, no external deps)
    const passwordHash = await hashPassword(password);

    // Create organization and principal
    const orgId = `org_${crypto.randomUUID().slice(0, 8)}`;
    const principalId = `principal_${crypto.randomUUID().slice(0, 8)}`;

    // Create the admin user
    const user = await app.prisma.dashboardUser.create({
      data: {
        email,
        name,
        organizationId: orgId,
        principalId,
        apiKeyEncrypted,
        apiKeyHash,
        passwordHash,
      },
    });

    app.log.info({ userId: user.id, email }, "Bootstrap: admin user created");

    return reply.code(201).send({
      message: "Bootstrap complete. Save your API key — it will not be shown again.",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        organizationId: orgId,
      },
      apiKey,
    });
  });
};
