import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaEmployeeStore } from "@switchboard/db";

vi.mock("@switchboard/db", () => ({
  PrismaEmployeeStore: vi.fn(),
}));

function createMockStore() {
  return {
    register: vi.fn(),
    getByOrg: vi.fn(),
    getById: vi.fn(),
    updateStatus: vi.fn(),
    updateConfig: vi.fn(),
  };
}

describe("PrismaEmployeeStore usage in employees routes", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
    vi.mocked(PrismaEmployeeStore).mockImplementation(() => store as never);
  });

  it("register creates an employee and returns it", async () => {
    const employee = {
      id: "reg-1",
      employeeId: "creative",
      organizationId: "org-1",
      status: "active",
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    store.register.mockResolvedValue(undefined);
    store.getById.mockResolvedValue(employee);

    await store.register("creative", "org-1", {});
    const result = await store.getById("creative", "org-1");

    expect(store.register).toHaveBeenCalledWith("creative", "org-1", {});
    expect(result).toEqual(employee);
  });

  it("getByOrg lists employees for an org", async () => {
    const employees = [
      {
        id: "reg-1",
        employeeId: "creative",
        organizationId: "org-1",
        status: "active",
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    store.getByOrg.mockResolvedValue(employees);

    const result = await store.getByOrg("org-1");
    expect(result).toEqual(employees);
    expect(store.getByOrg).toHaveBeenCalledWith("org-1");
  });

  it("getById returns null for non-existent employee", async () => {
    store.getById.mockResolvedValue(null);

    const result = await store.getById("nonexistent", "org-1");
    expect(result).toBeNull();
  });

  it("updateStatus updates the employee status", async () => {
    store.updateStatus.mockResolvedValue(undefined);

    await store.updateStatus("creative", "org-1", "paused");
    expect(store.updateStatus).toHaveBeenCalledWith("creative", "org-1", "paused");
  });

  it("updateStatus throws for non-existent employee", async () => {
    store.updateStatus.mockRejectedValue(
      new Error("Employee registration not found: unknown in org org-1"),
    );

    await expect(store.updateStatus("unknown", "org-1", "paused")).rejects.toThrow(
      "Employee registration not found",
    );
  });

  it("updateConfig updates the employee config", async () => {
    store.updateConfig.mockResolvedValue(undefined);

    await store.updateConfig("creative", "org-1", { brandVoice: "professional" });
    expect(store.updateConfig).toHaveBeenCalledWith("creative", "org-1", {
      brandVoice: "professional",
    });
  });
});
