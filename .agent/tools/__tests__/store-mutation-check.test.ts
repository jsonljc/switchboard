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
