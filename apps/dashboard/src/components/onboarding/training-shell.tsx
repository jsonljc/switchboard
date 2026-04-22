"use client";

import { useState, useCallback, useEffect } from "react";
import { AlexChat } from "./alex-chat";
import { PlaybookPanel } from "./playbook-panel";
import { InterviewEngine } from "@/lib/interview-engine";
import { useWebsiteScan } from "@/hooks/use-website-scan";
import { hydratePlaybookFromScan } from "@/lib/scan-to-playbook";
import { applyInterviewUpdate } from "@/lib/interview-apply";
import { getReadinessLabel, isPlaybookReady } from "@/lib/playbook-utils";
import { Button } from "@/components/ui/button";
import type { Playbook, PlaybookService } from "@switchboard/schemas";
import type { ChatMessageData } from "./chat-message";

interface TrainingShellProps {
  playbook: Playbook;
  onUpdatePlaybook: (playbook: Playbook) => void;
  onAdvance: () => void;
  scanUrl: string | null;
  category: string | null;
}

export function TrainingShell({
  playbook,
  onUpdatePlaybook,
  onAdvance,
  scanUrl,
  category,
}: TrainingShellProps) {
  const [messages, setMessages] = useState<ChatMessageData[]>(() => {
    if (scanUrl) {
      return [{ id: "scan-start", role: "alex" as const, text: `Looking at ${scanUrl} now...` }];
    }
    return [
      {
        id: "intro",
        role: "alex" as const,
        text: "No problem. Let's build your playbook together. What's your business called, and what do you do?",
      },
    ];
  });
  const [isTyping, setIsTyping] = useState(false);
  const [highlightedSection, setHighlightedSection] = useState<string>();
  const [engine] = useState(() => new InterviewEngine(playbook, category ?? undefined));
  const [mobileTab, setMobileTab] = useState<"chat" | "playbook">("chat");
  const scan = useWebsiteScan();
  const [scanApplied, setScanApplied] = useState(false);

  useEffect(() => {
    if (scanUrl && !scan.data && !scan.isPending && !scanApplied) {
      scan.mutate(scanUrl);
    }
  }, [scanUrl]);

  useEffect(() => {
    if (scan.data?.result && !scanApplied) {
      setScanApplied(true);
      const hydrated = hydratePlaybookFromScan(playbook, scan.data.result);
      onUpdatePlaybook(hydrated);
      setMessages((prev) => [
        ...prev,
        {
          id: "scan-done",
          role: "alex" as const,
          text: scan.data.result.businessName
            ? `I found ${scan.data.result.businessName.value}. I've filled in what I could — take a look at the playbook and let me know what needs fixing.`
            : "I couldn't find much on that page, but let's build your playbook together. What's your business called?",
        },
      ]);
    }
  }, [scan.data, scanApplied]);

  const handleContinueManually = useCallback(() => {
    setMessages((prev) => {
      if (prev.some((message) => message.id === "scan-manual-fallback")) {
        return prev;
      }

      return [
        ...prev,
        {
          id: "scan-manual-fallback",
          role: "alex" as const,
          text: "Let's keep going manually. What's your business called, and what do you do?",
        },
      ];
    });
  }, []);

  const ready = isPlaybookReady(playbook);
  const readinessLabel = getReadinessLabel(playbook);

  const handleSendMessage = useCallback(
    (text: string) => {
      setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: "user" as const, text }]);
      setIsTyping(true);

      const currentQuestion = engine.getNextQuestion();

      setTimeout(() => {
        if (currentQuestion) {
          const update = engine.processResponse(currentQuestion, text);

          if (Object.keys(update.fields).length > 0) {
            const updated = applyInterviewUpdate(playbook, update);
            if (updated !== playbook) {
              onUpdatePlaybook(updated);
              setHighlightedSection(update.section);
              setTimeout(() => setHighlightedSection(undefined), 1500);
            }
          }
        }

        const nextQuestion = engine.getNextQuestion();
        if (nextQuestion) {
          engine.markAsked(nextQuestion.targetSection);
          setMessages((prev) => [
            ...prev,
            { id: `alex-${Date.now()}`, role: "alex" as const, text: nextQuestion.prompt },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: "alex-done",
              role: "alex" as const,
              text: "I think we've covered everything. Review the playbook on the right and make any edits you'd like. When you're happy, hit 'Try Alex' to test.",
            },
          ]);
        }
        setIsTyping(false);
      }, 800);
    },
    [engine, playbook, onUpdatePlaybook],
  );

  const handleUpdateSection = useCallback(
    (section: keyof Playbook, data: unknown) => {
      onUpdatePlaybook({ ...playbook, [section]: data });
    },
    [playbook, onUpdatePlaybook],
  );

  const handleUpdateService = useCallback(
    (service: PlaybookService) => {
      onUpdatePlaybook({
        ...playbook,
        services: playbook.services.map((s) => (s.id === service.id ? service : s)),
      });
    },
    [playbook, onUpdatePlaybook],
  );

  const handleDeleteService = useCallback(
    (id: string) => {
      onUpdatePlaybook({ ...playbook, services: playbook.services.filter((s) => s.id !== id) });
    },
    [playbook, onUpdatePlaybook],
  );

  const handleAddService = useCallback(() => {
    onUpdatePlaybook({
      ...playbook,
      services: [
        ...playbook.services,
        {
          id: crypto.randomUUID(),
          name: "",
          bookingBehavior: "ask_first" as const,
          status: "missing" as const,
          source: "manual" as const,
        },
      ],
    });
  }, [playbook, onUpdatePlaybook]);

  return (
    <div className="flex h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      <div
        className="flex items-center justify-between border-b px-6 py-3"
        style={{ borderColor: "var(--sw-border)" }}
      >
        <span
          className="text-[16px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Switchboard
        </span>
        <span
          className="text-[14px]"
          style={{ color: ready ? "hsl(145, 45%, 42%)" : "var(--sw-text-secondary)" }}
        >
          {readinessLabel}
        </span>
      </div>

      {/* Desktop: split panels */}
      {scan.isError && (
        <div
          className="mx-6 mt-4 rounded-lg border p-4"
          style={{
            borderColor: "rgba(181, 54, 54, 0.28)",
            backgroundColor: "rgba(181, 54, 54, 0.06)",
          }}
        >
          <p className="text-sm" style={{ color: "#8B3A3A" }}>
            We couldn&apos;t scan that page. You can retry or keep building manually.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => scanUrl && scan.mutate(scanUrl)}
              className="h-[40px] rounded-lg px-4 text-[14px] font-medium"
              style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
            >
              Retry scan
            </Button>
            <Button
              variant="outline"
              onClick={handleContinueManually}
              className="h-[40px] rounded-lg px-4 text-[14px] font-medium"
            >
              Continue manually
            </Button>
          </div>
        </div>
      )}

      <div className="hidden flex-1 overflow-hidden md:flex">
        <div className="w-[45%] border-r" style={{ borderColor: "var(--sw-border)" }}>
          <AlexChat messages={messages} onSendMessage={handleSendMessage} isTyping={isTyping} />
        </div>
        <div className="w-[55%]">
          <PlaybookPanel
            playbook={playbook}
            businessName={playbook.businessIdentity.name}
            onUpdateSection={handleUpdateSection}
            onUpdateService={handleUpdateService}
            onDeleteService={handleDeleteService}
            onAddService={handleAddService}
            highlightedSection={highlightedSection}
            lastUpdatedSection={highlightedSection}
          />
        </div>
      </div>

      {/* Mobile: tabbed view */}
      <div className="flex flex-1 flex-col md:hidden">
        {/* Tab bar */}
        <div
          className="flex items-center justify-between border-b px-6 py-3"
          style={{ borderColor: "var(--sw-border)" }}
        >
          <div className="flex gap-4">
            <button
              onClick={() => setMobileTab("chat")}
              className="relative pb-1 text-[14px] font-medium"
              style={{
                color: mobileTab === "chat" ? "var(--sw-text-primary)" : "var(--sw-text-muted)",
              }}
            >
              Chat with Alex
              {mobileTab === "chat" && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: "var(--sw-accent)" }}
                />
              )}
            </button>
            <button
              onClick={() => setMobileTab("playbook")}
              className="relative pb-1 text-[14px] font-medium"
              style={{
                color: mobileTab === "playbook" ? "var(--sw-text-primary)" : "var(--sw-text-muted)",
              }}
            >
              Your Playbook
              {mobileTab === "playbook" && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: "var(--sw-accent)" }}
                />
              )}
            </button>
          </div>
          <button
            onClick={() => setMobileTab("playbook")}
            className="text-[12px]"
            style={{ color: ready ? "var(--sw-ready)" : "var(--sw-text-secondary)" }}
          >
            {readinessLabel}
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === "chat" ? (
            <AlexChat messages={messages} onSendMessage={handleSendMessage} isTyping={isTyping} />
          ) : (
            <PlaybookPanel
              playbook={playbook}
              businessName={playbook.businessIdentity.name}
              onUpdateSection={handleUpdateSection}
              onUpdateService={handleUpdateService}
              onDeleteService={handleDeleteService}
              onAddService={handleAddService}
              highlightedSection={highlightedSection}
              lastUpdatedSection={highlightedSection}
            />
          )}
        </div>
      </div>

      <div
        className="flex h-[64px] items-center justify-end border-t px-6"
        style={{ backgroundColor: "var(--sw-surface-raised)", borderColor: "var(--sw-border)" }}
      >
        {ready ? (
          <div className="flex items-center gap-3">
            <span className="text-[14px]" style={{ color: "var(--sw-text-secondary)" }}>
              Playbook ready.
            </span>
            <Button
              onClick={onAdvance}
              className="h-[48px] rounded-lg px-6 text-[16px] font-medium"
              style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
            >
              Try Alex →
            </Button>
          </div>
        ) : (
          <span className="text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
            Complete the sections marked &quot;Missing&quot; to continue
          </span>
        )}
      </div>
    </div>
  );
}
