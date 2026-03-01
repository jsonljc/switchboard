import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemorySecurityStore } from "../adapters/in-memory-security-store.js";
import { RedisSecurityStore } from "../adapters/redis-security-store.js";

describe("InMemorySecurityStore", () => {
  let store: InMemorySecurityStore;

  beforeEach(() => {
    store = new InMemorySecurityStore();
  });

  describe("checkNonce", () => {
    it("allows first occurrence of a nonce", async () => {
      expect(await store.checkNonce("msg_1", 60000)).toBe(true);
    });

    it("rejects duplicate nonce within TTL window", async () => {
      await store.checkNonce("msg_1", 60000);
      expect(await store.checkNonce("msg_1", 60000)).toBe(false);
    });

    it("allows different nonces", async () => {
      await store.checkNonce("msg_1", 60000);
      expect(await store.checkNonce("msg_2", 60000)).toBe(true);
    });

    it("allows same nonce after TTL expires", async () => {
      vi.useFakeTimers();
      try {
        await store.checkNonce("msg_1", 1000);
        vi.advanceTimersByTime(1500);
        expect(await store.checkNonce("msg_1", 1000)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("checkRateLimit", () => {
    it("allows requests within limit", async () => {
      expect(await store.checkRateLimit("ip_1", 3, 60000)).toBe(true);
      expect(await store.checkRateLimit("ip_1", 3, 60000)).toBe(true);
      expect(await store.checkRateLimit("ip_1", 3, 60000)).toBe(true);
    });

    it("rejects requests exceeding limit", async () => {
      await store.checkRateLimit("ip_1", 2, 60000);
      await store.checkRateLimit("ip_1", 2, 60000);
      expect(await store.checkRateLimit("ip_1", 2, 60000)).toBe(false);
    });

    it("resets after window expires", async () => {
      vi.useFakeTimers();
      try {
        await store.checkRateLimit("ip_1", 1, 1000);
        expect(await store.checkRateLimit("ip_1", 1, 1000)).toBe(false);
        vi.advanceTimersByTime(1500);
        expect(await store.checkRateLimit("ip_1", 1, 1000)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("tracks different keys independently", async () => {
      await store.checkRateLimit("ip_1", 1, 60000);
      expect(await store.checkRateLimit("ip_1", 1, 60000)).toBe(false);
      expect(await store.checkRateLimit("ip_2", 1, 60000)).toBe(true);
    });
  });
});

describe("RedisSecurityStore", () => {
  describe("checkNonce", () => {
    it("returns true when SET NX returns OK (new nonce)", async () => {
      const mockRedis = {
        set: vi.fn().mockResolvedValue("OK"),
        incr: vi.fn(),
        pexpire: vi.fn(),
        ttl: vi.fn(),
      };
      const store = new RedisSecurityStore(mockRedis);

      expect(await store.checkNonce("msg_1", 60000)).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith("nonce:msg_1", "1", "PX", 60000, "NX");
    });

    it("returns false when SET NX returns null (duplicate nonce)", async () => {
      const mockRedis = {
        set: vi.fn().mockResolvedValue(null),
        incr: vi.fn(),
        pexpire: vi.fn(),
        ttl: vi.fn(),
      };
      const store = new RedisSecurityStore(mockRedis);

      expect(await store.checkNonce("msg_1", 60000)).toBe(false);
    });

    it("fails open when Redis throws", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mockRedis = {
        set: vi.fn().mockRejectedValue(new Error("connection refused")),
        incr: vi.fn(),
        pexpire: vi.fn(),
        ttl: vi.fn(),
      };
      const store = new RedisSecurityStore(mockRedis);

      expect(await store.checkNonce("msg_1", 60000)).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("checkRateLimit", () => {
    it("returns true when count is within limit", async () => {
      const mockRedis = {
        set: vi.fn(),
        incr: vi.fn().mockResolvedValue(1),
        pexpire: vi.fn().mockResolvedValue(1),
        ttl: vi.fn().mockResolvedValue(-1), // No TTL set yet
      };
      const store = new RedisSecurityStore(mockRedis);

      expect(await store.checkRateLimit("ip_1", 5, 60000)).toBe(true);
      expect(mockRedis.incr).toHaveBeenCalledWith("ratelimit:ip_1");
      expect(mockRedis.pexpire).toHaveBeenCalledWith("ratelimit:ip_1", 60000);
    });

    it("returns false when count exceeds limit", async () => {
      const mockRedis = {
        set: vi.fn(),
        incr: vi.fn().mockResolvedValue(6),
        pexpire: vi.fn(),
        ttl: vi.fn().mockResolvedValue(50), // TTL already set
      };
      const store = new RedisSecurityStore(mockRedis);

      expect(await store.checkRateLimit("ip_1", 5, 60000)).toBe(false);
    });

    it("does not reset expiry when TTL is already set", async () => {
      const mockRedis = {
        set: vi.fn(),
        incr: vi.fn().mockResolvedValue(2),
        pexpire: vi.fn(),
        ttl: vi.fn().mockResolvedValue(45), // TTL is set (45s remaining)
      };
      const store = new RedisSecurityStore(mockRedis);

      await store.checkRateLimit("ip_1", 5, 60000);
      expect(mockRedis.pexpire).not.toHaveBeenCalled();
    });

    it("fails open when Redis throws", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mockRedis = {
        set: vi.fn(),
        incr: vi.fn().mockRejectedValue(new Error("connection refused")),
        pexpire: vi.fn(),
        ttl: vi.fn(),
      };
      const store = new RedisSecurityStore(mockRedis);

      expect(await store.checkRateLimit("ip_1", 5, 60000)).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});

describe("security.ts async functions", () => {
  it("checkNonce works without store (in-memory fallback)", async () => {
    // Use dynamic import to get a fresh module for each test
    const { checkNonce } = await import("../adapters/security.js");
    const id = `test_nonce_${Date.now()}_${Math.random()}`;
    expect(await checkNonce(id, 60000)).toBe(true);
    expect(await checkNonce(id, 60000)).toBe(false);
  });

  it("checkIngressRateLimit works without store (in-memory fallback)", async () => {
    const { checkIngressRateLimit } = await import("../adapters/security.js");
    const key = `test_rate_${Date.now()}_${Math.random()}`;
    expect(await checkIngressRateLimit(key, { windowMs: 60000, maxRequests: 2 })).toBe(true);
    expect(await checkIngressRateLimit(key, { windowMs: 60000, maxRequests: 2 })).toBe(true);
    expect(await checkIngressRateLimit(key, { windowMs: 60000, maxRequests: 2 })).toBe(false);
  });
});
