import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRequestReset = vi.fn();
const mockSendReset = vi.fn();

vi.mock("@prisma/client", () => ({ PrismaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/password-reset", () => ({ requestPasswordReset: mockRequestReset }));
vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: mockSendReset }));

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockRequestReset.mockResolvedValue({ token: null });
    mockSendReset.mockResolvedValue({
      sent: true,
      url: "http://localhost:3002/reset-password?token=t",
    });
  });

  async function call(body: unknown) {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return POST(req);
  }

  it("returns 400 for an invalid email and does not attempt a reset", async () => {
    const res = await call({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(mockRequestReset).not.toHaveBeenCalled();
  });

  it("returns 200 without sending for an unknown email (no enumeration)", async () => {
    mockRequestReset.mockResolvedValue({ token: null });
    const res = await call({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendReset).not.toHaveBeenCalled();
  });

  it("returns 200 and emails the link for a known account without leaking the url", async () => {
    mockRequestReset.mockResolvedValue({ token: "tok123" });
    mockSendReset.mockResolvedValue({ sent: true, url: "http://x/reset-password?token=tok123" });
    const res = await call({ email: "real@example.com" });
    expect(res.status).toBe(200);
    expect(mockSendReset).toHaveBeenCalledWith("real@example.com", "tok123");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("exposes resetUrl in non-production when no email provider is configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mockRequestReset.mockResolvedValue({ token: "tok123" });
    mockSendReset.mockResolvedValue({ sent: false, url: "http://x/reset-password?token=tok123" });
    const res = await call({ email: "real@example.com" });
    expect((await res.json()).resetUrl).toBe("http://x/reset-password?token=tok123");
  });

  it("never exposes resetUrl in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockRequestReset.mockResolvedValue({ token: "tok123" });
    mockSendReset.mockResolvedValue({ sent: false, url: "http://x/reset-password?token=tok123" });
    const res = await call({ email: "real@example.com" });
    expect((await res.json()).resetUrl).toBeUndefined();
  });

  it("normalizes the email (trim + lowercase) before lookup", async () => {
    mockRequestReset.mockResolvedValue({ token: null });
    await call({ email: "  MixedCase@Example.COM " });
    expect(mockRequestReset).toHaveBeenCalledWith(expect.anything(), "mixedcase@example.com");
  });
});
