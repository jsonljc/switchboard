"use client";

import { useState } from "react";
import { PromptCard, type TestPrompt } from "./prompt-card";
import { ChatMessage } from "./chat-message";
import { FixThisSlideOver } from "./fix-this-slide-over";
import { AgentMark } from "@/components/character/agent-mark";
import { Button } from "@/components/ui/button";

interface SimulatedResponse {
  promptId: string;
  userMessage: string;
  alexMessage: string;
  annotations: string[];
  status: "pending" | "good" | "fixed";
}

interface TestCenterProps {
  prompts: TestPrompt[];
  onSendPrompt: (prompt: TestPrompt) => void;
  onAdvance: () => void;
  responses: SimulatedResponse[];
  isSimulating: boolean;
}

export function TestCenter({
  prompts,
  onSendPrompt,
  onAdvance,
  responses,
  isSimulating,
}: TestCenterProps) {
  const [activePromptId, setActivePromptId] = useState<string>();
  const [customInput, setCustomInput] = useState("");
  const [fixingResponseId, setFixingResponseId] = useState<string>();
  const [expandedAnnotation, setExpandedAnnotation] = useState<string>();

  const testedIds = new Set(responses.map((r) => r.promptId));
  const testedCount = testedIds.size;

  const groupedPrompts = prompts.reduce<Record<string, TestPrompt[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  const handlePromptClick = (prompt: TestPrompt) => {
    setActivePromptId(prompt.id);
    onSendPrompt(prompt);
  };

  return (
    <div className="flex h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      <div className="border-b px-6 py-3" style={{ borderColor: "var(--sw-border)" }}>
        <span
          className="text-[16px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Switchboard
        </span>
      </div>

      <div className="px-6 pb-2 pt-8">
        <h1
          className="text-[32px] font-semibold leading-[40px]"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Try Alex with real scenarios
        </h1>
        <p className="mt-2 text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
          These scenarios use your actual services and rules.
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden px-6 pb-6">
        {/* Left: prompts */}
        <div className="w-[40%] overflow-y-auto pr-6">
          {Object.entries(groupedPrompts).map(([category, categoryPrompts]) => (
            <div key={category} className="mb-6">
              <p
                className="mb-2 text-[13px] font-medium uppercase tracking-[0.05em]"
                style={{ color: "var(--sw-text-muted)" }}
              >
                {category}
              </p>
              <div className="space-y-2">
                {categoryPrompts.map((prompt) => (
                  <PromptCard
                    key={prompt.id}
                    prompt={prompt}
                    isActive={activePromptId === prompt.id}
                    isTested={testedIds.has(prompt.id)}
                    onClick={() => handlePromptClick(prompt)}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--sw-border)" }}>
            <p className="mb-2 text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
              Or type your own question
            </p>
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="h-[48px] w-full rounded-lg border bg-transparent px-4 text-[16px] outline-none focus:border-[var(--sw-accent)]"
              style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-primary)" }}
            />
          </div>

          <p className="mt-4 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
            Tested {testedCount} of {prompts.length} scenarios
          </p>
        </div>

        {/* Right: chat */}
        <div
          className="relative w-[60%] overflow-y-auto rounded-xl border p-6"
          style={{ backgroundColor: "var(--sw-surface-raised)", borderColor: "var(--sw-border)" }}
        >
          {responses.length === 0 && !isSimulating ? (
            <div className="flex h-full flex-col items-center justify-center">
              <AgentMark agent="alex" size="md" />
              <p className="mt-4 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
                Send a scenario to see how Alex would respond.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {responses.map((response) => (
                <div key={response.promptId} className="space-y-3">
                  <ChatMessage
                    message={{
                      id: `u-${response.promptId}`,
                      role: "user",
                      text: response.userMessage,
                    }}
                  />
                  <ChatMessage
                    message={{
                      id: `a-${response.promptId}`,
                      role: "alex",
                      text: response.alexMessage,
                      isFirstInCluster: true,
                    }}
                  />

                  <div className="ml-8">
                    <button
                      onClick={() =>
                        setExpandedAnnotation(
                          expandedAnnotation === response.promptId ? undefined : response.promptId,
                        )
                      }
                      className="text-[14px]"
                      style={{ color: "var(--sw-text-muted)" }}
                    >
                      {expandedAnnotation === response.promptId ? "▾" : "▸"} Why this answer?
                    </button>
                    {expandedAnnotation === response.promptId && (
                      <div
                        className="mt-2 rounded-lg border p-3"
                        style={{
                          backgroundColor: "var(--sw-surface)",
                          borderColor: "var(--sw-border)",
                        }}
                      >
                        {response.annotations.map((ann, i) => (
                          <p
                            key={i}
                            className="text-[13px]"
                            style={{ color: "var(--sw-text-muted)" }}
                          >
                            ℹ {ann}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="ml-8 flex gap-6">
                    <button
                      className="text-[14px] transition-colors hover:underline"
                      style={{
                        color:
                          response.status === "good"
                            ? "hsl(145, 45%, 42%)"
                            : "var(--sw-text-secondary)",
                      }}
                    >
                      {response.status === "good" ? "✓ Looks good" : "Looks good"}
                    </button>
                    <button
                      onClick={() => setFixingResponseId(response.promptId)}
                      className="text-[14px] transition-colors hover:underline"
                      style={{ color: "var(--sw-text-secondary)" }}
                    >
                      Fix this
                    </button>
                  </div>
                </div>
              ))}

              {isSimulating && (
                <div className="flex items-center gap-2" data-testid="typing-indicator">
                  <AgentMark agent="alex" size="xs" />
                  <div
                    className="rounded-2xl px-4 py-3"
                    style={{ backgroundColor: "var(--sw-surface-raised)" }}
                  >
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_0ms] rounded-full bg-[var(--sw-text-muted)]" />
                      <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_200ms] rounded-full bg-[var(--sw-text-muted)]" />
                      <span className="h-2 w-2 animate-[typing-dot_1.4s_infinite_400ms] rounded-full bg-[var(--sw-text-muted)]" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <FixThisSlideOver
            isOpen={fixingResponseId !== undefined}
            onClose={() => setFixingResponseId(undefined)}
            onFix={() => setFixingResponseId(undefined)}
          />
        </div>
      </div>

      <div
        className="flex h-[64px] items-center justify-end border-t px-6"
        style={{ backgroundColor: "var(--sw-surface-raised)", borderColor: "var(--sw-border)" }}
      >
        <Button
          onClick={onAdvance}
          className="h-[48px] rounded-lg px-6 text-[16px] font-medium"
          style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
        >
          Alex is ready. Go live →
        </Button>
      </div>
    </div>
  );
}
