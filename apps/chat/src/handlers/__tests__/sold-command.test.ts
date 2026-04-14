import { describe, it, expect } from "vitest";
import {
  parseSoldInput,
  checkPendingSale,
  setPendingSale,
  clearPendingSale,
} from "../sold-command.js";

describe("parseSoldInput", () => {
  it("parses name + amount + description", () => {
    const result = parseSoldInput("Sarah 388 Pico Laser");
    expect(result).toEqual({ name: "Sarah", amount: 388, description: "Pico Laser" });
  });

  it("parses name + dollar amount", () => {
    const result = parseSoldInput("John $150 consultation");
    expect(result).toEqual({ name: "John", amount: 150, description: "consultation" });
  });

  it("parses amount only", () => {
    const result = parseSoldInput("500");
    expect(result).toEqual({ name: null, amount: 500, description: "" });
  });

  it("parses decimal amount", () => {
    const result = parseSoldInput("Sarah 99.50 facial");
    expect(result).toEqual({ name: "Sarah", amount: 99.5, description: "facial" });
  });

  it("returns null for invalid input", () => {
    expect(parseSoldInput("")).toBeNull();
    expect(parseSoldInput("no numbers here")).toBeNull();
  });
});

describe("pendingSale state", () => {
  it("stores and retrieves pending sale", () => {
    setPendingSale("thread-1", {
      contactId: null,
      contactName: "Sarah",
      amount: 388,
      description: "Pico Laser",
      sourceCampaignId: null,
      sourceAdId: null,
      createdAt: Date.now(),
    });

    const sale = checkPendingSale("thread-1");
    expect(sale).toBeTruthy();
    expect(sale!.amount).toBe(388);

    clearPendingSale("thread-1");
    expect(checkPendingSale("thread-1")).toBeNull();
  });

  it("expires after 5 minutes", () => {
    setPendingSale("thread-2", {
      contactId: null,
      contactName: "John",
      amount: 100,
      description: "",
      sourceCampaignId: null,
      sourceAdId: null,
      createdAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
    });

    expect(checkPendingSale("thread-2")).toBeNull();
  });
});
