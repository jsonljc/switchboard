import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({ createCreativeDraftRequest: createMock }),
}));

import { POST } from "../route";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

function mkReq(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/agents/mira/brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BRIEF = { promoting: "Botox", goal: "more_bookings", vibe: "warm", mode: "polished" };

describe("POST /api/dashboard/agents/mira/brief (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockReset();
  });

  it("forwards a submitted draft as 201", async () => {
    createMock.mockResolvedValueOnce({
      jobId: "j1",
      status: "brief_submitted",
      expectedDraftCount: 1,
      cost: { upfront: null, generationGatedInReview: true },
      requestSource: "mira.open_brief",
    });
    const res = await POST(mkReq(VALID_BRIEF));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ jobId: "j1" });
  });

  it("forwards a PENDING_APPROVAL envelope as 202 (parked, not a phantom 201)", async () => {
    const envelope = {
      outcome: "PENDING_APPROVAL",
      workUnitId: "wu1",
      traceId: "t1",
      approvalRequest: { id: "ar1", bindingHash: "bh1" },
    };
    createMock.mockResolvedValueOnce(envelope);
    const res = await POST(mkReq(VALID_BRIEF));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(envelope);
  });

  it("returns 401 on Unauthorized", async () => {
    vi.mocked(requireDashboardSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await POST(mkReq(VALID_BRIEF));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid brief with 400 before calling the client", async () => {
    const res = await POST(mkReq({ promoting: "" }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
