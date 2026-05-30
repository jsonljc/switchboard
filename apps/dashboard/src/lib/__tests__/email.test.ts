import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockCount = vi.fn();
const mockUpdateUser = vi.fn();
const mockSendEmail = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    emails: { send: mockSendEmail },
  })),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(),
}));

function makePrisma() {
  return {
    dashboardVerificationToken: {
      create: mockCreate,
      delete: mockDelete,
      count: mockCount,
    },
    dashboardUser: {
      update: mockUpdateUser,
    },
  } as never;
}

describe("email module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3002");
  });

  describe("sendVerificationEmail", () => {
    it("creates token and sends email when RESEND_API_KEY is set", async () => {
      mockCreate.mockResolvedValue({});
      mockSendEmail.mockResolvedValue({ id: "email_1" });

      const { sendVerificationEmail } = await import("../email");
      const result = await sendVerificationEmail(makePrisma(), "test@example.com");

      expect(result.sent).toBe(true);
      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockSendEmail).toHaveBeenCalledOnce();

      const emailArg = mockSendEmail.mock.calls[0]![0];
      expect(emailArg.to).toBe("test@example.com");
      expect(emailArg.subject).toContain("Verify");
      expect(emailArg.html).toContain("verify-email");
    });

    it("returns sent=false when RESEND_API_KEY is not set", async () => {
      vi.stubEnv("RESEND_API_KEY", "");

      const { sendVerificationEmail } = await import("../email");
      const result = await sendVerificationEmail(makePrisma(), "test@example.com");

      expect(result.sent).toBe(false);
      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe("verifyEmailToken", () => {
    it("verifies valid token and updates user", async () => {
      mockDelete.mockResolvedValue({
        identifier: "test@example.com",
        token: "valid-token",
        expires: new Date(Date.now() + 86400000),
      });
      mockUpdateUser.mockResolvedValue({});

      const { verifyEmailToken } = await import("../email");
      const result = await verifyEmailToken(makePrisma(), "test@example.com", "valid-token");

      expect(result.verified).toBe(true);
      expect(mockUpdateUser).toHaveBeenCalledWith({
        where: { email: "test@example.com" },
        data: { emailVerified: expect.any(Date) },
      });
    });

    it("rejects expired token", async () => {
      mockDelete.mockResolvedValue({
        identifier: "test@example.com",
        token: "expired-token",
        expires: new Date(Date.now() - 1000),
      });

      const { verifyEmailToken } = await import("../email");
      const result = await verifyEmailToken(makePrisma(), "test@example.com", "expired-token");

      expect(result.verified).toBe(false);
      expect(result.error).toContain("expired");
    });

    it("rejects invalid token", async () => {
      mockDelete.mockRejectedValue(new Error("Record not found"));

      const { verifyEmailToken } = await import("../email");
      const result = await verifyEmailToken(makePrisma(), "test@example.com", "bad-token");

      expect(result.verified).toBe(false);
      expect(result.error).toContain("Invalid");
    });
  });

  describe("checkRegistrationRateLimit", () => {
    it("allows when under limit", async () => {
      mockCount.mockResolvedValue(2);

      const { checkRegistrationRateLimit } = await import("../email");
      const allowed = await checkRegistrationRateLimit(makePrisma(), "test@example.com");

      expect(allowed).toBe(true);
    });

    it("blocks when at limit", async () => {
      mockCount.mockResolvedValue(3);

      const { checkRegistrationRateLimit } = await import("../email");
      const allowed = await checkRegistrationRateLimit(makePrisma(), "test@example.com");

      expect(allowed).toBe(false);
    });
  });

  describe("sendPasswordResetEmail", () => {
    it("sends a reset email with a /reset-password link when RESEND_API_KEY is set", async () => {
      mockSendEmail.mockResolvedValue({ id: "email_1" });

      const { sendPasswordResetEmail } = await import("../email");
      const result = await sendPasswordResetEmail("test@example.com", "tok123");

      expect(result.sent).toBe(true);
      expect(result.url).toContain("/reset-password?token=tok123");
      expect(mockSendEmail).toHaveBeenCalledOnce();
      const emailArg = mockSendEmail.mock.calls[0]![0];
      expect(emailArg.to).toBe("test@example.com");
      expect(emailArg.subject.toLowerCase()).toContain("reset");
      expect(emailArg.html).toContain("reset-password");
    });

    it("does not send but still returns the url when RESEND_API_KEY is not set", async () => {
      vi.stubEnv("RESEND_API_KEY", "");

      const { sendPasswordResetEmail } = await import("../email");
      const result = await sendPasswordResetEmail("test@example.com", "tok123");

      expect(result.sent).toBe(false);
      expect(result.url).toContain("/reset-password?token=tok123");
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });
});
