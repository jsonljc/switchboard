import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { scanStoreFileForTest, runStoreMutationAdvisory } from "../store-mutation-check.js";

function scan(src: string, path = "packages/db/src/stores/x.ts") {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(path, src);
  return scanStoreFileForTest(sf, path);
}

describe("store-mutation advisory", () => {
  it("flags a bare where:{id} update", () => {
    const w = scan(`export class S {
      async f(id: string) { await this.prisma.contact.update({ where: { id }, data: {} }); }
    }`);
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/organizationId/);
  });

  it("passes an org-scoped updateMany", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.contact.updateMany({ where: { id, organizationId }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("passes a relation-filter where", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.deploymentConnection.updateMany({ where: { id, deployment: { organizationId } }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("honors the suppression directive", () => {
    const w = scan(`export class S {
      async f(id: string) {
        // route-governance: store-mutation-global
        await this.prisma.agentListing.update({ where: { id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });
});

describe("runStoreMutationAdvisory entrypoint scope-filter", () => {
  it("skips non-store paths and __tests__ store paths", async () => {
    const result = await runStoreMutationAdvisory({
      touchedFiles: ["apps/api/src/routes/foo.ts", "packages/db/src/stores/__tests__/some.test.ts"],
      repoRoot: process.cwd(),
    });
    expect(result.warnings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});

describe("store-mutation advisory — AST where-object inspection", () => {
  it("FAILS a mutation whose org token is only in the param list, not the where", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.contact.updateMany({ where: { id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(1);
  });

  it("passes a direct-column where org filter", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.contact.updateMany({ where: { id, organizationId }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("passes an orgId-keyed where", () => {
    const w = scan(`export class S {
      async f(orgId: string, agentKey: string) {
        await this.prisma.orgAgentEnablement.updateMany({ where: { orgId, agentKey }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("passes a relation-filter where (Pattern C)", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.deploymentConnection.updateMany({ where: { id, deployment: { organizationId } }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("FAILS a relation-filter where whose nested object lacks org", () => {
    const w = scan(`export class S {
      async f(id: string) {
        await this.prisma.approvalCheckpointRecord.updateMany({ where: { id, workflow: { status: "x" } }, data: {} });
      }
    }`);
    expect(w).toHaveLength(1);
  });

  it("still honors the suppression directive", () => {
    const w = scan(`export class S {
      async f(id: string) {
        // route-governance: store-mutation-global
        await this.prisma.agentListing.update({ where: { id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("passes a where bound to a same-scope const object literal carrying org", () => {
    const w = scan(`export class S {
      async f(organizationId: string, id: string) {
        const where = { id, organizationId };
        await this.prisma.contact.updateMany({ where, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });

  it("FAILS a where built from an unresolvable identifier (conservative)", () => {
    const w = scan(`export class S {
      async f(where: any) {
        await this.prisma.contact.updateMany({ where, data: {} });
      }
    }`);
    expect(w).toHaveLength(1);
  });

  it("honors the distinct store-mutation-deferred directive", () => {
    const w = scan(`export class S {
      async f(id: string) {
        // route-governance: store-mutation-deferred
        await this.prisma.creatorIdentity.update({ where: { id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(0);
  });
});

describe("store-mutation advisory — AST edge cases (pinned behavior)", () => {
  it("inspects deleteMany where the same way as updateMany", () => {
    const ok = scan(`export class S {
      async f(organizationId: string, id: string) {
        await this.prisma.contact.deleteMany({ where: { id, organizationId } });
      }
    }`);
    expect(ok).toHaveLength(0);
    const bad = scan(`export class S {
      async f(id: string) {
        await this.prisma.contact.deleteMany({ where: { id } });
      }
    }`);
    expect(bad).toHaveLength(1);
  });

  it("over-flags a spread-built where it cannot statically prove carries org (conservative)", () => {
    // A spread element is not a named property; objectHasOrgKey does not see
    // through it, so this conservatively warns. Acceptable in warning mode.
    const w = scan(`export class S {
      async f(base: object, id: string) {
        await this.prisma.contact.updateMany({ where: { ...base, id }, data: {} });
      }
    }`);
    expect(w).toHaveLength(1);
  });

  it("flags a where bound to an identifier with no in-file declaration (cross-file/param)", () => {
    const w = scan(`export class S {
      async f(id: string) {
        await this.prisma.contact.updateMany({ where: EXTERNAL_WHERE, data: {} });
      }
    }`);
    expect(w).toHaveLength(1);
  });
});
