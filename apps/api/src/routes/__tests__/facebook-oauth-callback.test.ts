import { describe, it, expect } from "vitest";

describe("Facebook OAuth callback redirect", () => {
  it("builds the correct dashboard redirect URL", () => {
    const dashboardUrl = "http://localhost:3002";
    const deploymentId = "deploy_abc123";
    const redirectUrl = `${dashboardUrl}/modules/improve-spend/setup?step=select-account&connected=true&deploymentId=${deploymentId}`;

    expect(redirectUrl).toContain("/modules/improve-spend/setup");
    expect(redirectUrl).toContain("step=select-account");
    expect(redirectUrl).toContain("connected=true");
    expect(redirectUrl).toContain(`deploymentId=${deploymentId}`);
    expect(redirectUrl).not.toContain("/marketplace/");
  });
});
