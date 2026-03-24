"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";

export interface ContactListItem {
  id: string;
  displayName: string;
  channel?: string;
  stage?: string;
  lastMessage?: string;
  lastActivityAt: string;
  isEscalated?: boolean;
  isUnread?: boolean;
}

const STAGE_BADGE: Record<string, string> = {
  NEW: "bg-muted text-muted-foreground",
  QUALIFIED: "bg-caution/15 text-foreground",
  BOOKED: "bg-positive/15 text-positive",
  LOST: "bg-muted/50 text-muted-foreground/70",
  ESCALATED: "bg-destructive/15 text-destructive",
};

const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  BOOKED: "Booked",
  LOST: "Lost",
  ESCALATED: "Escalated",
};

function resolveStage(contact: ContactListItem) {
  const stage = contact.isEscalated ? "ESCALATED" : contact.stage;
  const stageClass = stage ? (STAGE_BADGE[stage] ?? STAGE_BADGE.NEW) : null;
  const stageLabel = stage ? (STAGE_LABELS[stage] ?? stage) : null;
  return { stageClass, stageLabel };
}

function CompactRow({ contact }: { contact: ContactListItem }) {
  const { stageClass, stageLabel } = resolveStage(contact);
  return (
    <Link
      href={`/crm/${contact.id}`}
      className="block px-4 py-3.5 rounded-xl border border-border/60 hover:border-border bg-surface transition-colors duration-fast"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-foreground truncate">
              {contact.displayName}
            </span>
            {stageClass && stageLabel && (
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0",
                  stageClass,
                )}
              >
                {stageLabel}
              </span>
            )}
          </div>
          {contact.lastMessage && (
            <p className="text-[12.5px] text-muted-foreground mt-0.5 truncate">
              {contact.lastMessage}
            </p>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {formatRelative(contact.lastActivityAt)}
        </span>
      </div>
    </Link>
  );
}

function FullRow({
  contact,
  isSelected,
  onSelect,
}: {
  contact: ContactListItem;
  isSelected: boolean;
  onSelect?: (id: string) => void;
}) {
  const { stageClass, stageLabel } = resolveStage(contact);
  return (
    <button
      onClick={() => onSelect?.(contact.id)}
      className={cn(
        "w-full text-left rounded-xl border border-border/60 p-4 transition-colors duration-fast",
        isSelected ? "bg-surface border-foreground/20" : "bg-background hover:bg-surface/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13.5px] font-medium text-foreground">{contact.displayName}</span>
            {contact.channel && (
              <span className="text-[11px] text-muted-foreground capitalize">
                {contact.channel}
              </span>
            )}
            {stageClass && stageLabel && (
              <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", stageClass)}>
                {stageLabel}
              </span>
            )}
            {contact.isUnread && <span className="h-2 w-2 rounded-full bg-foreground shrink-0" />}
          </div>
          {contact.lastMessage && (
            <p className="text-[12px] text-muted-foreground line-clamp-1">{contact.lastMessage}</p>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
          {formatRelative(contact.lastActivityAt)}
        </span>
      </div>
    </button>
  );
}

interface ContactListProps {
  contacts: ContactListItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  compact?: boolean;
}

export function ContactList({ contacts, selectedId, onSelect, compact }: ContactListProps) {
  if (contacts.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[14px] text-muted-foreground">No contacts found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {contacts.map((contact) =>
        compact ? (
          <CompactRow key={contact.id} contact={contact} />
        ) : (
          <FullRow
            key={contact.id}
            contact={contact}
            isSelected={selectedId === contact.id}
            onSelect={onSelect}
          />
        ),
      )}
    </div>
  );
}
