import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password";

describe("password utilities", () => {
  it("should hash and verify a password correctly", async () => {
    const plain = "my-secret-password";
    const hash = await hashPassword(plain);

    expect(hash).not.toBe(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
  });

  it("should reject an incorrect password", async () => {
    const hash = await hashPassword("correct-password");

    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("should produce different hashes for the same input (random salt)", async () => {
    const plain = "same-password";
    const hash1 = await hashPassword(plain);
    const hash2 = await hashPassword(plain);

    expect(hash1).not.toBe(hash2);
    // Both should still verify
    expect(await verifyPassword(plain, hash1)).toBe(true);
    expect(await verifyPassword(plain, hash2)).toBe(true);
  });
});
