import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { findApprovalMutations } from "../approval-mutations.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

function project(): Project {
  return new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true });
}

describe("findApprovalMutations", () => {
  it("flags db.approval.create / update / delete calls", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("approval-mutation.ts"));
    const found = findApprovalMutations(sf);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].method).toBe("create");
    expect(found[0].line).toBeGreaterThan(0);
  });

  it("ignores read-only approval queries (findFirst, findMany, get)", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("approval-readonly.ts"));
    const found = findApprovalMutations(sf);
    expect(found).toHaveLength(0);
  });
});
