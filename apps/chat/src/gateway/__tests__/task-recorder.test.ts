import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskRecorder } from "../task-recorder.js";

describe("TaskRecorder", () => {
  let recorder: TaskRecorder;
  let mockCreateTask: ReturnType<typeof vi.fn>;
  let mockSubmitOutput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCreateTask = vi.fn().mockResolvedValue({ id: "task-1" });
    mockSubmitOutput = vi.fn().mockResolvedValue({});
    recorder = new TaskRecorder({
      createTask: mockCreateTask,
      submitOutput: mockSubmitOutput,
      sessionTimeoutMs: 1000,
      minAssistantMessages: 2,
    });
  });

  afterEach(() => {
    recorder.dispose();
    vi.useRealTimers();
  });

  it("records a task after session timeout", async () => {
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      organizationId: "org-1",
      channel: "web_widget",
      sessionId: "sess-1",
      role: "user",
      content: "Hello",
    });
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      organizationId: "org-1",
      channel: "web_widget",
      sessionId: "sess-1",
      role: "assistant",
      content: "Hi!",
    });
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      organizationId: "org-1",
      channel: "web_widget",
      sessionId: "sess-1",
      role: "assistant",
      content: "How can I help?",
    });

    await vi.advanceTimersByTimeAsync(1500);

    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-1",
        listingId: "list-1",
        category: "general-inquiry",
      }),
    );
    expect(mockSubmitOutput).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        transcript: expect.arrayContaining([{ role: "user", content: "Hello" }]),
      }),
    );
  });

  it("does not record with fewer than minAssistantMessages", async () => {
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      organizationId: "org-1",
      channel: "web_widget",
      sessionId: "sess-2",
      role: "user",
      content: "Hi",
    });
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      organizationId: "org-1",
      channel: "web_widget",
      sessionId: "sess-2",
      role: "assistant",
      content: "Hello",
    });

    await vi.advanceTimersByTimeAsync(1500);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("resets timeout on new messages", async () => {
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      organizationId: "org-1",
      channel: "web_widget",
      sessionId: "sess-3",
      role: "user",
      content: "First",
    });
    await vi.advanceTimersByTimeAsync(800);
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      organizationId: "org-1",
      channel: "web_widget",
      sessionId: "sess-3",
      role: "assistant",
      content: "Reply 1",
    });
    recorder.recordMessage({
      deploymentId: "dep-1",
      listingId: "list-1",
      organizationId: "org-1",
      channel: "web_widget",
      sessionId: "sess-3",
      role: "assistant",
      content: "Reply 2",
    });

    await vi.advanceTimersByTimeAsync(800);
    expect(mockCreateTask).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
  });
});
