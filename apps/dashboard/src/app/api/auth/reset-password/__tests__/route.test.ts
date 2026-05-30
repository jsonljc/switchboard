import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockReset = vi.fn();

vi.mock("@prisma/client", () => ({ PrismaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/password-reset", () => ({ resetPasswordWithToken: mockReset }));

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReset.mockResolvedValue({ ok: true });
  });

  async function call(body: unknown) {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return POST(req);
  }

  it("returns 400 when the token is missing and does not attempt a reset", async () => {
    const res = await call({ password: "newpassword123" });
    expect(res.status).toBe(400);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it("returns 400 with the lib's error for an invalid or expired token", async () => {
    mockReset.mockResolvedValue({
      ok: false,
      error: "This reset link has expired. Please request a new one.",
    });
    const res = await call({ token: "bad", password: "newpassword123" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/expired/i);
  });

  it("returns 200 on a successful reset", async () => {
    mockReset.mockResolvedValue({ ok: true });
    const res = await call({ token: "good", password: "newpassword123" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockReset).toHaveBeenCalledWith(expect.anything(), "good", "newpassword123");
  });
});
