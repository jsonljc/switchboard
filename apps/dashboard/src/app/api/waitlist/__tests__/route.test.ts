import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createWaitlistEntry = vi.fn();

vi.mock("@switchboard/db", () => ({
  getDb: () => ({
    waitlistEntry: {
      create: createWaitlistEntry,
    },
  }),
}));

import { POST } from "../route";

describe("POST /api/waitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 when persistence is unavailable", async () => {
    createWaitlistEntry.mockRejectedValue(new Error("database offline"));

    const request = new NextRequest("http://localhost/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      error: "Waitlist signup is temporarily unavailable",
    });
  });

  it("treats duplicates as success", async () => {
    createWaitlistEntry.mockRejectedValue(new Error("P2002 Unique constraint failed"));

    const request = new NextRequest("http://localhost/api/waitlist", {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com" }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, duplicate: true });
  });
});
