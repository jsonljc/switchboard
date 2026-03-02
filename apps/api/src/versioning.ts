import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    apiVersion: string;
  }
}

/** Current (latest) API version. */
const CURRENT_API_VERSION = "2025-01-01";

/** Supported API versions — extend this list as new versions are added. */
const SUPPORTED_VERSIONS = new Set(["2025-01-01"]);

/**
 * API versioning plugin.
 *
 * Reads `X-API-Version` header and decorates each request with `apiVersion`.
 * Unknown versions are rejected with 400. Missing header defaults to current.
 */
const apiVersionPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("apiVersion", CURRENT_API_VERSION);

  app.addHook("onRequest", async (request, reply) => {
    const header = request.headers["x-api-version"] as string | undefined;
    if (header) {
      if (!SUPPORTED_VERSIONS.has(header)) {
        return reply.code(400).send({
          error: `Unsupported API version: ${header}. Supported: ${[...SUPPORTED_VERSIONS].join(", ")}`,
          statusCode: 400,
        });
      }
      request.apiVersion = header;
    } else {
      request.apiVersion = CURRENT_API_VERSION;
    }
  });
};

export default fp(apiVersionPlugin, { name: "api-versioning" });
