import { describe, it, expect } from "vitest";
import { CreativeJobPublishInput } from "../creative-job.js";

describe("CreativeJobPublishInput", () => {
  it("accepts a jobId", () => {
    expect(CreativeJobPublishInput.parse({ jobId: "job_1" }).jobId).toBe("job_1");
  });
  it("rejects an empty jobId", () => {
    expect(() => CreativeJobPublishInput.parse({ jobId: "" })).toThrow();
  });
});
