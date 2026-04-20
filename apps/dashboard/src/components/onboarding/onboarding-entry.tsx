"use client";

import { useState } from "react";
import { AgentMark } from "@/components/character/agent-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CATEGORIES = [
  { label: "Dental", value: "dental" },
  { label: "Salon", value: "salon" },
  { label: "Fitness", value: "fitness" },
  { label: "Med Spa", value: "med_spa" },
  { label: "Coaching", value: "coaching" },
  { label: "Other", value: "other" },
];

const SECONDARY_SOURCES = ["Instagram", "Google Business", "Facebook"];

interface OnboardingEntryProps {
  onScan: (url: string) => void;
  onSkip: (category: string) => void;
}

export function OnboardingEntry({ onScan, onSkip }: OnboardingEntryProps) {
  const [url, setUrl] = useState("");
  const [showCategories, setShowCategories] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = () => {
    if (!url.trim()) return;
    setIsScanning(true);
    onScan(url.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && url.trim()) handleScan();
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      <div className="fixed left-6 top-6 z-10">
        <span
          className="text-[16px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          Switchboard
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center" style={{ paddingBottom: "10vh" }}>
        <div className="mx-auto w-full max-w-[480px] px-6 text-center">
          <div className="mb-8 flex justify-center">
            <AgentMark agent="alex" size="lg" />
          </div>

          <h1
            className="mb-3 text-[32px] font-semibold leading-[40px]"
            style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
          >
            Let Alex learn your business
          </h1>

          <p
            className="mb-12 text-[16px] leading-[24px]"
            style={{ color: "var(--sw-text-secondary)" }}
          >
            Paste your website and Alex will draft your services, hours, rules, and lead flow.
          </p>

          <div className="mb-2">
            <Input
              type="url"
              placeholder="https://yourwebsite.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-[56px] rounded-lg px-5 text-[16px] transition-all duration-200"
              style={{
                borderColor: "var(--sw-border)",
                backgroundColor: "white",
                color: "var(--sw-text-primary)",
              }}
            />
          </div>

          <p className="mb-6 text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
            We&apos;ll draft your setup from this. You can edit everything before going live.
          </p>

          <Button
            onClick={handleScan}
            disabled={!url.trim() || isScanning}
            className="h-[48px] rounded-lg px-8 text-[16px] font-medium transition-all duration-200"
            style={{
              backgroundColor: "var(--sw-text-primary)",
              color: "white",
              opacity: !url.trim() ? 0.4 : 1,
            }}
          >
            {isScanning ? "Scanning..." : "Start scanning"}
          </Button>

          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1" style={{ backgroundColor: "var(--sw-border)" }} />
            <span className="text-[14px]" style={{ color: "var(--sw-text-muted)" }}>
              or use another page
            </span>
            <div className="h-px flex-1" style={{ backgroundColor: "var(--sw-border)" }} />
          </div>

          <div className="mb-6 flex justify-center gap-4">
            {SECONDARY_SOURCES.map((source) => (
              <button
                key={source}
                className="text-[14px] underline-offset-2 transition-colors hover:underline"
                style={{ color: "var(--sw-text-secondary)" }}
              >
                {source}
              </button>
            ))}
          </div>

          <div>
            <button
              onClick={() => setShowCategories(!showCategories)}
              className="text-[14px] transition-colors"
              style={{ color: "var(--sw-text-muted)" }}
            >
              No website? Start from a few questions →
            </button>

            {showCategories && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => onSkip(cat.value)}
                    className="h-[36px] rounded-full border px-4 text-[14px] transition-all duration-200 hover:border-[var(--sw-accent)] hover:text-[var(--sw-accent)]"
                    style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-secondary)" }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
