// ---------------------------------------------------------------------------
// Tests — RulesManager
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { RulesManager } from "../rules-manager.js";

const BASE_URL = "https://graph.facebook.com/v21.0";
const TOKEN = "test-token";

describe("RulesManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── create ────────────────────────────────────────────────────────

  it("creates a rule", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "rule_123" }),
      } as unknown as Response),
    );

    const manager = new RulesManager(BASE_URL, TOKEN);
    const result = await manager.create({
      adAccountId: "act_123456",
      name: "Pause Low Performers",
      schedule: { type: "DAILY" },
      evaluation: {
        filters: [
          { field: "entity_type", operator: "EQUAL", value: "CAMPAIGN" },
        ],
        trigger: {
          type: "RESULT",
          field: "cost_per_result",
          operator: "GREATER_THAN",
          value: 50,
        },
      },
      execution: { type: "PAUSE" },
    });

    expect(result.id).toBe("rule_123");
    expect(result.name).toBe("Pause Low Performers");
    expect(result.status).toBe("ENABLED");
    expect(result.executionType).toBe("PAUSE");
    expect(result.createdAt).toBeDefined();

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0]).toContain("act_123456/adrules_library");
    expect(fetchCall[1]!.method).toBe("POST");
  });

  it("throws on create failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: { message: "Invalid rule config" } }),
      } as unknown as Response),
    );

    const manager = new RulesManager(BASE_URL, TOKEN);
    await expect(
      manager.create({
        adAccountId: "act_123",
        name: "Bad Rule",
        schedule: { type: "DAILY" },
        evaluation: {
          filters: [],
          trigger: { type: "RESULT", field: "x", operator: "GT", value: 1 },
        },
        execution: { type: "PAUSE" },
      }),
    ).rejects.toThrow("Failed to create rule: Invalid rule config");
  });

  // ── list ──────────────────────────────────────────────────────────

  it("lists rules with pagination", async () => {
    const page1 = {
      data: [
        {
          id: "rule_1",
          name: "Rule One",
          status: "ENABLED",
          evaluation_spec: {
            type: "RESULT",
            filters: [{ field: "entity_type", operator: "EQUAL", value: "CAMPAIGN" }],
          },
          execution_spec: { type: "PAUSE" },
          schedule_spec: { type: "DAILY" },
          created_time: "2025-01-01T00:00:00Z",
        },
      ],
      paging: { next: "https://graph.facebook.com/v21.0/page2" },
    };
    const page2 = {
      data: [
        {
          id: "rule_2",
          name: "Rule Two",
          status: "DISABLED",
          evaluation_spec: {
            type: "SCHEDULE",
            filters: [],
          },
          execution_spec: { type: "NOTIFICATION" },
          schedule_spec: { type: "WEEKLY" },
          created_time: "2025-01-02T00:00:00Z",
        },
      ],
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page1),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page2),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const manager = new RulesManager(BASE_URL, TOKEN);
    const rules = await manager.list("123456");

    expect(rules).toHaveLength(2);
    expect(rules[0]!.id).toBe("rule_1");
    expect(rules[0]!.name).toBe("Rule One");
    expect(rules[0]!.status).toBe("ENABLED");
    expect(rules[0]!.executionType).toBe("PAUSE");
    expect(rules[1]!.id).toBe("rule_2");
    expect(rules[1]!.status).toBe("DISABLED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── delete ────────────────────────────────────────────────────────

  it("deletes a rule", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as unknown as Response),
    );

    const manager = new RulesManager(BASE_URL, TOKEN);
    const result = await manager.delete("rule_123");

    expect(result.success).toBe(true);
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0]).toContain("rule_123");
    expect(fetchCall[1]!.method).toBe("DELETE");
  });

  it("throws on delete failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: { message: "Rule not found" } }),
      } as unknown as Response),
    );

    const manager = new RulesManager(BASE_URL, TOKEN);
    await expect(manager.delete("rule_999")).rejects.toThrow(
      "Failed to delete rule: Rule not found",
    );
  });

  // ── Error handling ────────────────────────────────────────────────

  it("handles unparseable error body on create", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("parse error")),
      } as unknown as Response),
    );

    const manager = new RulesManager(BASE_URL, TOKEN);
    await expect(
      manager.create({
        adAccountId: "act_123",
        name: "Rule",
        schedule: { type: "DAILY" },
        evaluation: {
          filters: [],
          trigger: { type: "RESULT", field: "x", operator: "GT", value: 1 },
        },
        execution: { type: "PAUSE" },
      }),
    ).rejects.toThrow("Failed to create rule: HTTP 500");
  });
});
