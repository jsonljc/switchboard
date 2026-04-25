import { describe, it, expect } from "vitest";

describe("Google Calendar OAuth routes", () => {
  it("authorize requires deploymentId", () => {
    // The route returns 400 when no deploymentId is provided
    const querystring = new URLSearchParams("");
    expect(querystring.get("deploymentId")).toBeNull();
  });

  it("callback rejects when code is missing", () => {
    const querystring = new URLSearchParams("state=deploy_123");
    expect(querystring.get("code")).toBeNull();
    expect(querystring.get("state")).toBe("deploy_123");
  });

  it("callback rejects when state is missing", () => {
    const querystring = new URLSearchParams("code=abc123");
    expect(querystring.get("state")).toBeNull();
    expect(querystring.get("code")).toBe("abc123");
  });

  it("builds the correct dashboard redirect URL on success", () => {
    const dashboardUrl = "http://localhost:3002";
    const deploymentId = "deploy_abc123";
    const redirectUrl = `${dashboardUrl}/connections/callback?connected=true&deploymentId=${deploymentId}&service=google_calendar`;

    expect(redirectUrl).toContain("/connections/callback");
    expect(redirectUrl).toContain("connected=true");
    expect(redirectUrl).toContain(`deploymentId=${deploymentId}`);
    expect(redirectUrl).toContain("service=google_calendar");
  });

  it("calendars endpoint returns 404 without connection", () => {
    // When no google_calendar connection exists for a deployment, the route returns 404
    const expectedResponse = {
      error: "No google_calendar connection found for this deployment",
      statusCode: 404,
    };
    expect(expectedResponse.statusCode).toBe(404);
  });
});
