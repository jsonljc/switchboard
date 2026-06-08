import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { verifyInternalSecret } from "./internal-secret-auth.js";

function req(authorization?: string): FastifyRequest {
  return { headers: authorization ? { authorization } : {} } as FastifyRequest;
}

describe("verifyInternalSecret", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns 'unconfigured' when INTERNAL_API_SECRET is unset", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    expect(verifyInternalSecret(req("Bearer x"))).toBe("unconfigured");
  });

  it("returns 'unauthorized' when the header is missing", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "s3cr3t");
    expect(verifyInternalSecret(req())).toBe("unauthorized");
  });

  it("returns 'unauthorized' on a wrong secret and on a length mismatch", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "s3cr3t");
    expect(verifyInternalSecret(req("Bearer wrong"))).toBe("unauthorized");
    expect(verifyInternalSecret(req("Bearer s3cr3t-longer"))).toBe("unauthorized");
  });

  it("returns 'ok' on an exact match", () => {
    vi.stubEnv("INTERNAL_API_SECRET", "s3cr3t");
    expect(verifyInternalSecret(req("Bearer s3cr3t"))).toBe("ok");
  });
});
