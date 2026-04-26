import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockProvision = vi.fn();
const mockSendVerification = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => ({
    dashboardUser: { findUnique: mockFindUnique, update: mockUpdate },
  })),
}));

vi.mock("@/lib/provision-dashboard-user", () => ({
  provisionDashboardUser: mockProvision,
}));

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async () => "$2a$12$mockedhash"),
}));

vi.mock("@/lib/register", async () => {
  const actual = await vi.importActual<typeof import("@/lib/register")>("@/lib/register");
  return actual;
});

vi.mock("@/lib/email", () => ({
  sendVerificationEmail: mockSendVerification,
  checkRegistrationRateLimit: mockCheckRateLimit,
}));

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "beta");
    mockCheckRateLimit.mockResolvedValue(true);
    mockSendVerification.mockResolvedValue({ sent: false });
    mockProvision.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      organizationId: "org-1",
      principalId: "principal-1",
    });
  });

  async function callRegister(body: Record<string, unknown>) {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return POST(req);
  }

  it("returns 403 when launch mode is waitlist", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");
    const res = await callRegister({ email: "a@b.com", password: "12345678" });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("not available");
  });

  it("allows registration in public mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "public");
    mockFindUnique.mockResolvedValue(null);
    const res = await callRegister({ email: "new@example.com", password: "securepass!" });
    expect(res.status).toBe(201);
  });

  it("returns 400 for missing email", async () => {
    const res = await callRegister({ email: "", password: "12345678" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for short password", async () => {
    const res = await callRegister({ email: "a@b.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await callRegister({ email: "a@b.com", password: "12345678" });
    expect(res.status).toBe(429);
  });

  it("returns 409 for duplicate email", async () => {
    const duplicateError = new Error("Unique constraint failed") as Error & { code: string };
    duplicateError.code = "P2002";
    mockProvision.mockRejectedValue(duplicateError);
    const res = await callRegister({ email: "a@b.com", password: "12345678" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });

  it("returns 201 and provisions account for valid input", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await callRegister({ email: "new@example.com", password: "securepass!" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.email).toBe("test@example.com");
    expect(data.organizationId).toBe("org-1");
    expect(mockProvision).toHaveBeenCalledOnce();
    // passwordHash is now passed atomically through provisionDashboardUser
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendVerification).toHaveBeenCalledOnce();
  });

  it("includes verificationEmailSent in response", async () => {
    mockSendVerification.mockResolvedValue({ sent: true });
    const res = await callRegister({ email: "new@example.com", password: "securepass!" });
    const data = await res.json();
    expect(data.verificationEmailSent).toBe(true);
  });
});
