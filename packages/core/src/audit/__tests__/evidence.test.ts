import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  InMemoryEvidenceStore,
  FileSystemEvidenceStore,
  setEvidenceStore,
  storeEvidence,
  verifyEvidence,
  type EvidenceStore,
} from "../evidence.js";

describe("InMemoryEvidenceStore", () => {
  let store: InMemoryEvidenceStore;

  beforeEach(() => {
    store = new InMemoryEvidenceStore();
  });

  it("stores and retrieves data by key", async () => {
    const data = Buffer.from("test data");
    const result = await store.store("key1", data);

    expect(result).toBe("key1");

    const retrieved = await store.retrieve("key1");
    expect(retrieved).toEqual(data);
  });

  it("returns the key as the storage reference", async () => {
    const data = Buffer.from("data");
    const ref = await store.store("my-key", data);
    expect(ref).toBe("my-key");
  });

  it("throws error when retrieving non-existent key", async () => {
    await expect(store.retrieve("missing-key")).rejects.toThrow("Evidence not found: missing-key");
  });

  it("overwrites existing data for the same key", async () => {
    const data1 = Buffer.from("first");
    const data2 = Buffer.from("second");

    await store.store("key1", data1);
    await store.store("key1", data2);

    const retrieved = await store.retrieve("key1");
    expect(retrieved).toEqual(data2);
  });

  it("stores multiple keys independently", async () => {
    const data1 = Buffer.from("data-1");
    const data2 = Buffer.from("data-2");

    await store.store("key1", data1);
    await store.store("key2", data2);

    expect(await store.retrieve("key1")).toEqual(data1);
    expect(await store.retrieve("key2")).toEqual(data2);
  });

  it("handles empty buffer", async () => {
    const data = Buffer.alloc(0);
    await store.store("empty", data);

    const retrieved = await store.retrieve("empty");
    expect(retrieved.length).toBe(0);
  });
});

describe("FileSystemEvidenceStore", () => {
  it("rejects path traversal attempts", async () => {
    const store = new FileSystemEvidenceStore("/safe/base/path");
    const data = Buffer.from("malicious");

    await expect(store.store("../../etc/passwd", data)).rejects.toThrow("Path traversal detected");
  });

  it("rejects path traversal on retrieve", async () => {
    const store = new FileSystemEvidenceStore("/safe/base/path");

    await expect(store.retrieve("../../../etc/shadow")).rejects.toThrow("Path traversal detected");
  });
});

describe("storeEvidence", () => {
  beforeEach(() => {
    // Reset the global evidence store
    setEvidenceStore(null as unknown as EvidenceStore);
  });

  it("returns inline pointer for small content", () => {
    const content = { action: "test", value: 42 };
    const result = storeEvidence(content);

    expect(result.type).toBe("inline");
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.storageRef).toBeNull();
  });

  it("returns the same hash for identical content", () => {
    const content = { key: "value", number: 123 };
    const result1 = storeEvidence(content);
    const result2 = storeEvidence(content);

    expect(result1.hash).toBe(result2.hash);
  });

  it("returns the same hash regardless of key order", () => {
    const content1 = { a: 1, b: 2 };
    const content2 = { b: 2, a: 1 };
    const result1 = storeEvidence(content1);
    const result2 = storeEvidence(content2);

    expect(result1.hash).toBe(result2.hash);
  });

  it("returns different hashes for different content", () => {
    const result1 = storeEvidence({ action: "create" });
    const result2 = storeEvidence({ action: "delete" });

    expect(result1.hash).not.toBe(result2.hash);
  });

  it("returns pointer type for large content exceeding 10KB threshold", () => {
    // Create content larger than 10KB when serialized
    const largeContent = { data: "x".repeat(11 * 1024) };
    const result = storeEvidence(largeContent);

    expect(result.type).toBe("pointer");
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.storageRef).toBeTruthy();
  });

  it("uses default storage prefix for large content", () => {
    const largeContent = { data: "x".repeat(11 * 1024) };
    const result = storeEvidence(largeContent);

    expect(result.storageRef).toMatch(/^evidence\//);
  });

  it("uses custom storage prefix when provided", () => {
    const largeContent = { data: "x".repeat(11 * 1024) };
    const result = storeEvidence(largeContent, "custom-prefix");

    expect(result.storageRef).toMatch(/^custom-prefix\//);
  });

  it("includes the hash in the storage ref", () => {
    const largeContent = { data: "x".repeat(11 * 1024) };
    const result = storeEvidence(largeContent);

    expect(result.storageRef).toBe(`evidence/${result.hash}`);
  });

  it("stores to global evidence store when one is set", async () => {
    const mockStore: EvidenceStore = {
      store: vi.fn().mockResolvedValue("stored-ref"),
      retrieve: vi.fn(),
    };
    setEvidenceStore(mockStore);

    const largeContent = { data: "x".repeat(11 * 1024) };
    storeEvidence(largeContent);

    // Allow async fire-and-forget to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockStore.store).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(mockStore.store).mock.calls[0]!;
    expect(callArgs[0]).toMatch(/^evidence\//);
    expect(callArgs[1]).toBeInstanceOf(Buffer);
  });

  it("does not store to global store for inline (small) content", async () => {
    const mockStore: EvidenceStore = {
      store: vi.fn().mockResolvedValue("stored-ref"),
      retrieve: vi.fn(),
    };
    setEvidenceStore(mockStore);

    storeEvidence({ small: "data" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockStore.store).not.toHaveBeenCalled();
  });

  it("does not throw when global store fails (fire-and-forget)", async () => {
    const mockStore: EvidenceStore = {
      store: vi.fn().mockRejectedValue(new Error("Storage failure")),
      retrieve: vi.fn(),
    };
    setEvidenceStore(mockStore);

    const largeContent = { data: "x".repeat(11 * 1024) };
    // This should not throw even though the store rejects
    const result = storeEvidence(largeContent);
    expect(result.type).toBe("pointer");

    // Allow async rejection to be caught
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

describe("verifyEvidence", () => {
  it("returns true for content matching the expected hash", () => {
    const content = { action: "test", value: 42 };
    const pointer = storeEvidence(content);

    expect(verifyEvidence(content, pointer.hash)).toBe(true);
  });

  it("returns false when content has been tampered with", () => {
    const originalContent = { action: "test", value: 42 };
    const pointer = storeEvidence(originalContent);

    const tamperedContent = { action: "test", value: 9999 };
    expect(verifyEvidence(tamperedContent, pointer.hash)).toBe(false);
  });

  it("returns false for an incorrect hash", () => {
    const content = { action: "test" };
    expect(
      verifyEvidence(content, "0000000000000000000000000000000000000000000000000000000000000000"),
    ).toBe(false);
  });

  it("is key-order independent", () => {
    const content1 = { z: 1, a: 2 };
    const pointer = storeEvidence(content1);

    const content2 = { a: 2, z: 1 };
    expect(verifyEvidence(content2, pointer.hash)).toBe(true);
  });

  it("handles null content", () => {
    const pointer = storeEvidence(null);
    expect(verifyEvidence(null, pointer.hash)).toBe(true);
  });

  it("handles empty object", () => {
    const pointer = storeEvidence({});
    expect(verifyEvidence({}, pointer.hash)).toBe(true);
  });

  it("handles array content", () => {
    const content = [1, 2, 3];
    const pointer = storeEvidence(content);
    expect(verifyEvidence([1, 2, 3], pointer.hash)).toBe(true);
    expect(verifyEvidence([3, 2, 1], pointer.hash)).toBe(false);
  });

  it("handles string content", () => {
    const pointer = storeEvidence("hello world");
    expect(verifyEvidence("hello world", pointer.hash)).toBe(true);
    expect(verifyEvidence("hello World", pointer.hash)).toBe(false);
  });
});
