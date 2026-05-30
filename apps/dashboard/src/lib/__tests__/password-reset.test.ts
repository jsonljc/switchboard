import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashResetToken, requestPasswordReset, resetPasswordWithToken } from "../password-reset";
import { verifyPassword } from "../password";

type ResetRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};
type UserRow = { id: string; email: string; passwordHash: string | null };

/**
 * In-memory Prisma fake implementing only the methods the reset lib calls.
 * Exercises real logic (expiry, single-use, hourly limit) — not mock assertions.
 */
function makeFakePrisma(users: UserRow[]) {
  const tokens: ResetRow[] = [];
  let seq = 0;
  const prisma = {
    _tokens: tokens,
    _users: users,
    dashboardUser: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        users.find((u) => (where.email ? u.email === where.email : u.id === where.id)) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { passwordHash: string };
      }) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error("user not found");
        u.passwordHash = data.passwordHash;
        return u;
      },
    },
    dashboardPasswordResetToken: {
      create: async ({
        data,
      }: {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }) => {
        const row: ResetRow = { id: `t${seq++}`, createdAt: new Date(), ...data };
        tokens.push(row);
        return row;
      },
      count: async ({ where }: { where: { userId: string; createdAt?: { gt: Date } } }) =>
        tokens.filter(
          (t) =>
            t.userId === where.userId && (!where.createdAt || t.createdAt > where.createdAt.gt),
        ).length,
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      deleteMany: async ({ where }: { where: { userId: string } }) => {
        let count = 0;
        for (let i = tokens.length - 1; i >= 0; i--) {
          if (tokens[i]!.userId === where.userId) {
            tokens.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
  };
  return prisma as unknown as PrismaClient & { _tokens: ResetRow[]; _users: UserRow[] };
}

describe("hashResetToken", () => {
  it("is deterministic and returns a 64-char hex sha256", () => {
    const hash = hashResetToken("abc");
    expect(hash).toBe(hashResetToken("abc"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different tokens", () => {
    expect(hashResetToken("abc")).not.toBe(hashResetToken("abd"));
  });
});

describe("requestPasswordReset", () => {
  it("issues a token for a known password user and stores only its hash", async () => {
    const prisma = makeFakePrisma([{ id: "u1", email: "a@b.co", passwordHash: "x" }]);
    const { token } = await requestPasswordReset(prisma, "a@b.co");
    expect(token).toBeTruthy();
    expect(prisma._tokens).toHaveLength(1);
    expect(prisma._tokens[0]!.tokenHash).toBe(hashResetToken(token!));
    expect(prisma._tokens[0]!.tokenHash).not.toBe(token);
    expect(prisma._tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null and stores nothing for an unknown email (no enumeration)", async () => {
    const prisma = makeFakePrisma([]);
    const { token } = await requestPasswordReset(prisma, "nobody@b.co");
    expect(token).toBeNull();
    expect(prisma._tokens).toHaveLength(0);
  });

  it("returns null for an account with no password (e.g. Google-only)", async () => {
    const prisma = makeFakePrisma([{ id: "u1", email: "g@b.co", passwordHash: null }]);
    const { token } = await requestPasswordReset(prisma, "g@b.co");
    expect(token).toBeNull();
    expect(prisma._tokens).toHaveLength(0);
  });

  it("stops issuing after the hourly limit", async () => {
    const prisma = makeFakePrisma([{ id: "u1", email: "a@b.co", passwordHash: "x" }]);
    const issued: (string | null)[] = [];
    for (let i = 0; i < 5; i++) issued.push((await requestPasswordReset(prisma, "a@b.co")).token);
    expect(issued.filter(Boolean)).toHaveLength(3);
    expect(issued[4]).toBeNull();
  });
});

describe("resetPasswordWithToken", () => {
  it("sets a new password for a valid token and consumes the user's tokens", async () => {
    const prisma = makeFakePrisma([{ id: "u1", email: "a@b.co", passwordHash: "old" }]);
    const { token } = await requestPasswordReset(prisma, "a@b.co");
    const result = await resetPasswordWithToken(prisma, token!, "newpassword123");
    expect(result.ok).toBe(true);
    const user = prisma._users.find((u) => u.id === "u1")!;
    expect(await verifyPassword("newpassword123", user.passwordHash!)).toBe(true);
    expect(prisma._tokens).toHaveLength(0);
  });

  it("rejects an unknown or already-used token", async () => {
    const prisma = makeFakePrisma([{ id: "u1", email: "a@b.co", passwordHash: "old" }]);
    const result = await resetPasswordWithToken(prisma, "does-not-exist", "newpassword123");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid|expired/i);
  });

  it("rejects an expired token", async () => {
    const prisma = makeFakePrisma([{ id: "u1", email: "a@b.co", passwordHash: "old" }]);
    const { token } = await requestPasswordReset(prisma, "a@b.co");
    prisma._tokens[0]!.expiresAt = new Date(Date.now() - 1000);
    const result = await resetPasswordWithToken(prisma, token!, "newpassword123");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it("rejects a weak new password and leaves the password unchanged", async () => {
    const prisma = makeFakePrisma([{ id: "u1", email: "a@b.co", passwordHash: "old" }]);
    const { token } = await requestPasswordReset(prisma, "a@b.co");
    const result = await resetPasswordWithToken(prisma, token!, "short");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/8 characters/i);
    expect(prisma._users[0]!.passwordHash).toBe("old");
    expect(prisma._tokens).toHaveLength(1);
  });
});
