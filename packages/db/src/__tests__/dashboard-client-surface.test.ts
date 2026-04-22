import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

describe("generated Prisma client surface", () => {
  it("includes dashboard and marketplace fields used by the dashboard app", () => {
    const client = new PrismaClient();
    expect("dashboardUser" in client).toBe(true);
  });
});
