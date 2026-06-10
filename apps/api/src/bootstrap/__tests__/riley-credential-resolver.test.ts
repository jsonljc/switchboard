import { describe, it, expect, vi } from "vitest";
import { buildRileyCredentialResolver } from "../riley-credential-resolver.js";

// Riley's Meta-credential resolver (Tier-0 PR 0.1). Primary source is the
// deployment-scoped DeploymentConnection; the pilot-unblock fallback is the
// org-level Connection(serviceId="meta-ads") an operator enters in Settings.
// A needs_reauth/revoked connection must never resolve to a dead token (it
// would otherwise poison the weekly fleet audit, D2-3).
describe("riley credential resolver", () => {
  const meta = (over: Record<string, unknown> = {}) => ({
    type: "meta-ads",
    status: "active",
    credentials: "enc",
    ...over,
  });

  it("returns DeploymentConnection creds when present", async () => {
    const deploymentConn = { listByDeployment: vi.fn().mockResolvedValue([meta()]) };
    const orgConn = { findByServiceId: vi.fn() };
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: deploymentConn,
      orgConnectionStore: orgConn,
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "DC", accountId: "act_1" }),
    });
    expect(await resolver("dep_1")).toEqual({ accessToken: "DC", accountId: "act_1" });
    expect(orgConn.findByServiceId).not.toHaveBeenCalled();
  });

  it("falls back to org Connection(serviceId=meta-ads) when no DeploymentConnection", async () => {
    const deploymentConn = { listByDeployment: vi.fn().mockResolvedValue([]) };
    const orgConn = { findByServiceId: vi.fn().mockResolvedValue({ credentials: "enc-org" }) };
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: deploymentConn,
      orgConnectionStore: orgConn,
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "ORG", accountId: "act_org" }),
    });
    expect(await resolver("dep_1")).toEqual({ accessToken: "ORG", accountId: "act_org" });
    expect(orgConn.findByServiceId).toHaveBeenCalledWith("meta-ads", "org_1");
  });

  // Seam #2 dead-token guard: a needs_reauth DeploymentConnection is skipped,
  // never decrypted into a live token.
  it("skips a DeploymentConnection in needs_reauth and does NOT return a dead token", async () => {
    const deploymentConn = {
      listByDeployment: vi.fn().mockResolvedValue([meta({ status: "needs_reauth" })]),
    };
    const orgConn = { findByServiceId: vi.fn().mockResolvedValue(null) };
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: deploymentConn,
      orgConnectionStore: orgConn,
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "DEAD", accountId: "x" }),
    });
    expect(await resolver("dep_1")).toBeNull();
  });

  // Same dead-token guard for an expired token (a canonical ConnectionStatus value).
  it("skips an expired DeploymentConnection and does NOT return a dead token", async () => {
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: {
        listByDeployment: vi.fn().mockResolvedValue([meta({ status: "expired" })]),
      },
      orgConnectionStore: { findByServiceId: vi.fn().mockResolvedValue(null) },
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "DEAD", accountId: "x" }),
    });
    expect(await resolver("dep_1")).toBeNull();
  });

  it("returns null when neither store has a usable meta-ads connection", async () => {
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      orgConnectionStore: { findByServiceId: vi.fn().mockResolvedValue(null) },
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt: () => ({ accessToken: "x", accountId: "x" }),
    });
    expect(await resolver("dep_1")).toBeNull();
  });

  it("returns null (and does not hit the org store) when the deployment has no org", async () => {
    const orgConn = { findByServiceId: vi.fn() };
    const resolver = buildRileyCredentialResolver({
      deploymentConnectionStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      orgConnectionStore: orgConn,
      resolveOrgId: vi.fn().mockResolvedValue(null),
      decrypt: () => ({ accessToken: "x", accountId: "x" }),
    });
    expect(await resolver("dep_1")).toBeNull();
    expect(orgConn.findByServiceId).not.toHaveBeenCalled();
  });

  // Integration-review seam #2: both credential sources flow through the SAME
  // injected `decrypt`, so the DeploymentConnection path and the org-Connection
  // fallback resolve to an identical { accessToken, accountId } shape.
  it("resolves the org Connection and the DeploymentConnection to the same shape (seam #2)", async () => {
    const decrypt = () => ({ accessToken: "T", accountId: "act" });
    const viaDeployment = buildRileyCredentialResolver({
      deploymentConnectionStore: { listByDeployment: vi.fn().mockResolvedValue([meta()]) },
      orgConnectionStore: { findByServiceId: vi.fn().mockResolvedValue(null) },
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt,
    });
    const viaOrg = buildRileyCredentialResolver({
      deploymentConnectionStore: { listByDeployment: vi.fn().mockResolvedValue([]) },
      orgConnectionStore: {
        findByServiceId: vi.fn().mockResolvedValue({ credentials: "enc-org" }),
      },
      resolveOrgId: vi.fn().mockResolvedValue("org_1"),
      decrypt,
    });

    const fromDeployment = await viaDeployment("dep_1");
    const fromOrg = await viaOrg("dep_1");

    expect(fromDeployment).not.toBeNull();
    expect(fromOrg).not.toBeNull();
    expect(Object.keys(fromDeployment!).sort()).toEqual(["accessToken", "accountId"]);
    expect(Object.keys(fromOrg!).sort()).toEqual(Object.keys(fromDeployment!).sort());
  });
});
