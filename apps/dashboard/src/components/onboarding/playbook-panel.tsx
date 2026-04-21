"use client";

import { PlaybookSection } from "./playbook-section";
import { ServiceCard } from "./service-card";
import { ApprovalScenario } from "./approval-scenario";
import type { Playbook, PlaybookService } from "@switchboard/schemas";

interface PlaybookPanelProps {
  playbook: Playbook;
  businessName: string;
  onUpdateSection: (section: keyof Playbook, data: unknown) => void;
  onUpdateService: (service: PlaybookService) => void;
  onDeleteService: (id: string) => void;
  onAddService: () => void;
  highlightedSection?: string;
}

const BOOKING_SCENARIOS = [
  {
    question: "A customer wants to book Thursday 2pm.",
    prompt: "What should Alex do?",
    field: "bookingApproval" as const,
    options: [
      { label: "Alex books it, then notifies me", value: "book_then_notify" },
      { label: "Alex asks me before booking", value: "ask_before_booking" },
      {
        label: "Alex books if open, asks me if something looks off",
        value: "book_if_open_ask_if_odd",
      },
    ],
  },
  {
    question: "A customer asks about a service you offer but doesn't mention price.",
    prompt: "How should Alex handle it?",
    field: "pricingApproval" as const,
    options: [
      { label: "Alex quotes the price from the playbook", value: "quote_from_playbook" },
      {
        label: 'Alex describes the service but says "I\'ll confirm pricing for you"',
        value: "describe_but_confirm_pricing",
      },
      {
        label: "Alex always asks me before discussing pricing",
        value: "always_ask_before_pricing",
      },
    ],
  },
];

export function PlaybookPanel({
  playbook,
  businessName,
  onUpdateSection,
  onUpdateService,
  onDeleteService,
  onAddService,
  highlightedSection,
}: PlaybookPanelProps) {
  return (
    <div
      className="h-full overflow-y-auto p-8"
      style={{ backgroundColor: "var(--sw-surface-raised)" }}
    >
      <div className="mb-8">
        <p
          className="text-[13px] font-medium uppercase tracking-[0.05em]"
          style={{ color: "var(--sw-text-muted)" }}
        >
          Alex&apos;s Playbook
        </p>
        <h2
          className="mt-1 text-[20px] font-semibold"
          style={{ fontFamily: "var(--font-display)", color: "var(--sw-text-primary)" }}
        >
          for {businessName || "Your Business"}
        </h2>
      </div>

      <div className="space-y-12">
        {/* Business Identity */}
        <PlaybookSection
          title="Business Identity"
          status={playbook.businessIdentity.status}
          required
          defaultCollapsed={playbook.businessIdentity.status === "missing"}
          highlight={highlightedSection === "businessIdentity"}
        >
          <div className="space-y-3 text-[16px]" style={{ color: "var(--sw-text-primary)" }}>
            {playbook.businessIdentity.name && (
              <p>
                <strong>{playbook.businessIdentity.name}</strong>
              </p>
            )}
            {playbook.businessIdentity.category && (
              <p style={{ color: "var(--sw-text-secondary)" }}>
                {playbook.businessIdentity.category}
                {playbook.businessIdentity.location && ` · ${playbook.businessIdentity.location}`}
              </p>
            )}
          </div>
        </PlaybookSection>

        {/* Services */}
        <PlaybookSection
          title="Services"
          status={
            playbook.services.length > 0 && playbook.services.some((s) => s.status === "ready")
              ? "ready"
              : playbook.services.length > 0
                ? "check_this"
                : "missing"
          }
          required
          defaultCollapsed={playbook.services.length === 0}
          highlight={highlightedSection === "services"}
        >
          <div className="space-y-3">
            {playbook.services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                onChange={onUpdateService}
                onDelete={onDeleteService}
              />
            ))}
            <button
              onClick={onAddService}
              className="w-full rounded-lg border border-dashed py-3 text-[14px] transition-colors hover:border-[var(--sw-accent)] hover:text-[var(--sw-accent)]"
              style={{ borderColor: "var(--sw-border)", color: "var(--sw-text-muted)" }}
            >
              + Add service
            </button>
          </div>
        </PlaybookSection>

        {/* Hours */}
        <PlaybookSection
          title="Hours & Availability"
          status={playbook.hours.status}
          required
          defaultCollapsed={playbook.hours.status === "missing"}
          highlight={highlightedSection === "hours"}
        >
          <div className="text-[16px]" style={{ color: "var(--sw-text-secondary)" }}>
            {Object.entries(playbook.hours.schedule).length > 0 ? (
              <div className="space-y-1">
                {Object.entries(playbook.hours.schedule).map(([day, hours]) => (
                  <p key={day}>
                    <span className="inline-block w-12 font-medium capitalize">{day}</span>
                    <span>{hours}</span>
                  </p>
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--sw-text-muted)" }}>No hours set yet</p>
            )}
          </div>
        </PlaybookSection>

        {/* Booking Rules */}
        <PlaybookSection
          title="Booking Rules"
          status={playbook.bookingRules.status}
          required
          defaultCollapsed={playbook.bookingRules.status === "missing"}
          highlight={highlightedSection === "bookingRules"}
        >
          <div className="text-[16px]" style={{ color: "var(--sw-text-secondary)" }}>
            {playbook.bookingRules.leadVsBooking || (
              <span style={{ color: "var(--sw-text-muted)" }}>Not configured yet</span>
            )}
          </div>
        </PlaybookSection>

        {/* Approval Mode */}
        <PlaybookSection
          title="Approval Mode"
          status={playbook.approvalMode.status}
          required
          defaultCollapsed={playbook.approvalMode.status === "missing"}
          highlight={highlightedSection === "approvalMode"}
        >
          <div className="space-y-6">
            {BOOKING_SCENARIOS.map((scenario) => (
              <ApprovalScenario
                key={scenario.field}
                question={scenario.question}
                prompt={scenario.prompt}
                options={scenario.options}
                selected={playbook.approvalMode[scenario.field] as string | undefined}
                onChange={(value) => {
                  onUpdateSection("approvalMode", {
                    ...playbook.approvalMode,
                    [scenario.field]: value,
                    status: "ready" as const,
                    source: "manual" as const,
                  });
                }}
              />
            ))}
          </div>
        </PlaybookSection>

        {/* Escalation (recommended) */}
        <PlaybookSection
          title="Escalation"
          status={playbook.escalation.status}
          required={false}
          defaultCollapsed={playbook.escalation.status === "missing"}
          highlight={highlightedSection === "escalation"}
        >
          <div className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
            {playbook.escalation.triggers.length > 0
              ? playbook.escalation.triggers.join(", ")
              : "No escalation rules set"}
          </div>
        </PlaybookSection>

        {/* Channels (recommended) */}
        <PlaybookSection
          title="Channels"
          status={playbook.channels.status}
          required={false}
          defaultCollapsed={playbook.channels.status === "missing"}
          highlight={highlightedSection === "channels"}
        >
          <div className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
            {playbook.channels.configured.length > 0
              ? playbook.channels.configured.join(", ")
              : "Configured during Go Live"}
          </div>
        </PlaybookSection>
      </div>
    </div>
  );
}
