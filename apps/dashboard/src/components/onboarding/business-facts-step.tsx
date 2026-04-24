"use client";

import { useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentMark } from "@/components/character/agent-mark";

export interface BusinessFacts {
  serviceArea?: string;
  contactPreference?: "whatsapp" | "email" | "phone" | "in-person";
  escalationContact?: string;
  uniqueSellingPoints?: string[];
  targetCustomer?: string;
}

interface BusinessFactsStepProps {
  initialFacts?: BusinessFacts;
  onSave: (facts: BusinessFacts) => void;
  onBack: () => void;
  onSkip: () => void;
}

const CONTACT_OPTIONS = [
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" },
  { label: "In Person", value: "in-person" },
] as const;

export function BusinessFactsStep({
  initialFacts,
  onSave,
  onBack,
  onSkip,
}: BusinessFactsStepProps) {
  const [serviceArea, setServiceArea] = useState(initialFacts?.serviceArea ?? "");
  const [targetCustomer, setTargetCustomer] = useState(initialFacts?.targetCustomer ?? "");
  const [contactPreference, setContactPreference] = useState<string>(
    initialFacts?.contactPreference ?? "",
  );
  const [escalationContact, setEscalationContact] = useState(initialFacts?.escalationContact ?? "");
  const [usps, setUsps] = useState<string[]>(initialFacts?.uniqueSellingPoints ?? []);
  const [uspInput, setUspInput] = useState("");

  const addUsp = () => {
    const trimmed = uspInput.trim();
    if (trimmed && !usps.includes(trimmed)) {
      setUsps((prev) => [...prev, trimmed]);
      setUspInput("");
    }
  };

  const removeUsp = (index: number) => {
    setUsps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUspKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addUsp();
    }
  };

  const handleSave = () => {
    const facts: BusinessFacts = {};
    if (serviceArea.trim()) facts.serviceArea = serviceArea.trim();
    if (targetCustomer.trim()) facts.targetCustomer = targetCustomer.trim();
    if (contactPreference) {
      facts.contactPreference = contactPreference as BusinessFacts["contactPreference"];
    }
    if (escalationContact.trim()) facts.escalationContact = escalationContact.trim();
    if (usps.length > 0) facts.uniqueSellingPoints = usps;
    onSave(facts);
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--sw-base)" }}>
      <div className="fixed left-6 top-6 z-10">
        <span className="text-[18px] font-semibold" style={{ color: "var(--sw-text-primary)" }}>
          <AgentMark agent="alex" size="sm" /> switchboard
        </span>
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
        <h1
          className="mb-2 text-center text-[28px] font-semibold leading-tight"
          style={{ color: "var(--sw-text-primary)" }}
        >
          Tell Alex about your business
        </h1>
        <p className="mb-8 text-center text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
          These details help Alex give better answers. All fields are optional.
        </p>

        <div className="space-y-5">
          {/* Service Area */}
          <div>
            <label
              className="mb-1.5 block text-[14px] font-medium"
              style={{ color: "var(--sw-text-primary)" }}
            >
              Service Area
            </label>
            <Input
              value={serviceArea}
              onChange={(e) => setServiceArea(e.target.value)}
              placeholder="e.g., Downtown Singapore, 5km radius"
            />
          </div>

          {/* Target Customer */}
          <div>
            <label
              className="mb-1.5 block text-[14px] font-medium"
              style={{ color: "var(--sw-text-primary)" }}
            >
              Target Customer
            </label>
            <Input
              value={targetCustomer}
              onChange={(e) => setTargetCustomer(e.target.value)}
              placeholder="e.g., Busy professionals aged 25-45"
            />
          </div>

          {/* Preferred Contact Method */}
          <div>
            <label
              className="mb-1.5 block text-[14px] font-medium"
              style={{ color: "var(--sw-text-primary)" }}
            >
              Preferred Contact Method for Escalations
            </label>
            <Select value={contactPreference} onValueChange={setContactPreference}>
              <SelectTrigger>
                <SelectValue placeholder="Select a contact method" />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Escalation Contact */}
          <div>
            <label
              className="mb-1.5 block text-[14px] font-medium"
              style={{ color: "var(--sw-text-primary)" }}
            >
              Escalation Contact
            </label>
            <Input
              value={escalationContact}
              onChange={(e) => setEscalationContact(e.target.value)}
              placeholder="e.g., owner@example.com or +65 1234 5678"
            />
            <p className="mt-1 text-[13px]" style={{ color: "var(--sw-text-muted)" }}>
              Who should Alex hand off to when it can&apos;t handle a conversation?
            </p>
          </div>

          {/* Unique Selling Points */}
          <div>
            <label
              className="mb-1.5 block text-[14px] font-medium"
              style={{ color: "var(--sw-text-primary)" }}
            >
              Unique Selling Points
            </label>
            <div className="flex gap-2">
              <Input
                value={uspInput}
                onChange={(e) => setUspInput(e.target.value)}
                onKeyDown={handleUspKeyDown}
                placeholder="Type a selling point and press Enter"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addUsp}
                disabled={!uspInput.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {usps.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {usps.map((usp, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px]"
                    style={{
                      backgroundColor: "var(--sw-surface)",
                      color: "var(--sw-text-primary)",
                      border: "1px solid var(--sw-border)",
                    }}
                  >
                    {usp}
                    <button
                      type="button"
                      onClick={() => removeUsp(i)}
                      className="ml-0.5 rounded-full p-0.5 hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-8 flex items-center justify-between">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="ghost" className="text-muted-foreground" onClick={onSkip}>
              Skip for now
            </Button>
            <Button onClick={handleSave}>
              Save &amp; Continue
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
