"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useWhatsAppAccount,
  useWhatsAppPhoneNumbers,
  useWhatsAppTemplates,
} from "@/hooks/use-whatsapp-management";
import type {
  WhatsAppAccountData,
  WhatsAppPhoneNumber,
  WhatsAppTemplate,
} from "@/hooks/use-whatsapp-management";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Phone,
  FileText,
} from "lucide-react";
import Link from "next/link";
import { WhatsAppSendTest } from "./whatsapp-send-test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function QualityDot({ badge }: { badge: WhatsAppPhoneNumber["qualityBadge"] }) {
  const color: Record<string, string> = {
    good: "bg-green-500",
    warning: "bg-yellow-500",
    bad: "bg-red-500",
    unknown: "bg-gray-400",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color[badge] ?? color.unknown}`}
      title={badge}
    />
  );
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    MARKETING: "bg-purple-100 text-purple-800 border-purple-200",
    UTILITY: "bg-blue-100 text-blue-800 border-blue-200",
    AUTHENTICATION: "bg-amber-100 text-amber-800 border-amber-200",
  };
  return (
    <Badge variant="outline" className={colors[category] ?? "bg-gray-100 text-gray-800"}>
      {category.toLowerCase()}
    </Badge>
  );
}

function TemplateBadge({
  status,
  rejectedReason,
}: {
  status: string;
  rejectedReason: string | null;
}) {
  const lower = status.toLowerCase();
  if (lower === "approved" || lower === "active") {
    return <Badge className="bg-green-600 text-white border-green-600">approved</Badge>;
  }
  if (lower === "pending") {
    return <Badge className="bg-yellow-500 text-white border-yellow-500">pending</Badge>;
  }
  if (lower === "rejected") {
    return (
      <Badge variant="destructive" title={rejectedReason ?? undefined} className="cursor-help">
        rejected
      </Badge>
    );
  }
  return <Badge variant="outline">{lower}</Badge>;
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-destructive py-4">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "Unknown";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Readiness Banner
// ---------------------------------------------------------------------------

function ReadinessBanner({ readiness }: { readiness: WhatsAppAccountData["readiness"] }) {
  const [expanded, setExpanded] = useState(false);

  if (readiness.status === "ready") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="font-medium">Ready to send</span>
      </div>
    );
  }

  if (readiness.status === "needs_attention") {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="font-medium">
            Needs attention &mdash; {readiness.reasons[0] ?? "Review required"}
          </span>
          {readiness.reasons.length > 1 && (
            <button
              type="button"
              className="ml-auto flex items-center gap-1 text-xs underline"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <>
                  <ChevronDown className="h-3 w-3" /> Hide issues
                </>
              ) : (
                <>
                  <ChevronRight className="h-3 w-3" /> Show all issues
                </>
              )}
            </button>
          )}
        </div>
        {expanded && readiness.reasons.length > 1 && (
          <ul className="mt-2 ml-6 list-disc space-y-1 text-xs">
            {readiness.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (readiness.status === "incomplete") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="font-medium">
          Setup incomplete &mdash; {readiness.reasons[0] ?? "Configuration missing"}. Reconnect via
          Embedded Signup.
        </span>
      </div>
    );
  }

  // not_connected — full-page empty state
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="rounded-full bg-muted p-4">
        <Phone className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Connect WhatsApp to get started</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set up a WhatsApp Business channel to begin messaging.
        </p>
      </div>
      <Button asChild>
        <Link href="/settings/channels">Go to Channels</Link>
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section A: WhatsApp Setup
// ---------------------------------------------------------------------------

function SetupSection({ data }: { data: WhatsAppAccountData }) {
  const { connection, account } = data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">WhatsApp setup</CardTitle>
        <p className="text-sm text-muted-foreground">
          Connection status and business account details.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Left: Connection info */}
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              <Badge
                className={
                  connection.status === "connected"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-yellow-500 text-white border-yellow-500"
                }
              >
                {connection.status}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Connected:</span>{" "}
              {formatDate(connection.connectedAt)}
            </div>
            <div>
              <span className="text-muted-foreground">Phone Number ID:</span>{" "}
              <span className="font-mono text-xs">{connection.primaryPhoneNumberId ?? "None"}</span>
            </div>
          </div>

          {/* Right: WABA info */}
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">WABA Name:</span> {account.name ?? "Unknown"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Review Status:</span>
              <Badge variant="outline">{account.reviewStatus ?? "unknown"}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Namespace:</span>{" "}
              <span className="font-mono text-xs">{account.templateNamespace ?? "None"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Currency:</span> {account.currency ?? "N/A"}
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Last checked: {formatDate(new Date().toISOString())}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section B: Phone Numbers
// ---------------------------------------------------------------------------

function PhoneNumbersSection({
  data,
  isLoading,
  error,
}: {
  data: { phoneNumbers: WhatsAppPhoneNumber[] } | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Phone numbers</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <SectionSkeleton />}
        {error && <SectionError message="Failed to load phone numbers." />}
        {data && data.phoneNumbers.length === 0 && (
          <p className="text-sm text-muted-foreground">No phone numbers registered.</p>
        )}
        {data && data.phoneNumbers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Phone Number</th>
                  <th className="pb-2 pr-4 font-medium">Verified Name</th>
                  <th className="pb-2 pr-4 font-medium">Quality</th>
                  <th className="pb-2 pr-4 font-medium">Messaging Limit</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Primary</th>
                </tr>
              </thead>
              <tbody>
                {data.phoneNumbers.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{p.displayPhoneNumber ?? "N/A"}</td>
                    <td className="py-2 pr-4">{p.verifiedName ?? "N/A"}</td>
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-1.5">
                        <QualityDot badge={p.qualityBadge} />
                        <span className="capitalize">{p.qualityRating ?? "unknown"}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-4">{p.messagingLimitTier ?? "N/A"}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline">{p.status ?? "unknown"}</Badge>
                    </td>
                    <td className="py-2">
                      {p.isPrimaryForSwitchboard && (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section C: Message Templates
// ---------------------------------------------------------------------------

function TemplatesSection({
  data,
  isLoading,
  error,
  wabaId,
}: {
  data: { templates: WhatsAppTemplate[] } | undefined;
  isLoading: boolean;
  error: Error | null;
  wabaId: string | null;
}) {
  const metaUrl = wabaId
    ? `https://business.facebook.com/wa/manage/message-templates/?waba_id=${wabaId}`
    : "https://business.facebook.com/wa/manage/message-templates/";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Message templates</CardTitle>
        <Button variant="outline" size="sm" asChild>
          <a href={metaUrl} target="_blank" rel="noopener noreferrer" className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" />
            Create Template
          </a>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && <SectionSkeleton />}
        {error && <SectionError message="Failed to load message templates." />}
        {data && data.templates.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No message templates found.</p>
          </div>
        )}
        {data && data.templates.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Category</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Language</th>
                  <th className="pb-2 font-medium">Content</th>
                </tr>
              </thead>
              <tbody>
                {data.templates.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{t.name}</td>
                    <td className="py-2 pr-4">
                      <CategoryBadge category={t.category} />
                    </td>
                    <td className="py-2 pr-4">
                      <TemplateBadge status={t.status} rejectedReason={t.rejectedReason} />
                    </td>
                    <td className="py-2 pr-4">{t.language}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {[t.hasBody && "body", t.hasButtons && "buttons"]
                        .filter(Boolean)
                        .join(", ") || "empty"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function WhatsAppManagement() {
  const account = useWhatsAppAccount();

  const shouldFetchDetails =
    account.data?.readiness.status !== "not_connected" &&
    account.data?.readiness.status !== "incomplete";

  const phones = useWhatsAppPhoneNumbers(!!account.data && shouldFetchDetails);
  const templates = useWhatsAppTemplates(!!account.data && shouldFetchDetails);

  // Initial loading
  if (account.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <SectionSkeleton />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (account.error) {
    return (
      <Card>
        <CardContent className="py-8">
          <SectionError message="Failed to load WhatsApp account status." />
        </CardContent>
      </Card>
    );
  }

  if (!account.data) return null;

  const { readiness } = account.data;

  // Not connected — show full-page empty state only
  if (readiness.status === "not_connected") {
    return <ReadinessBanner readiness={readiness} />;
  }

  return (
    <div className="space-y-6">
      <ReadinessBanner readiness={readiness} />
      <SetupSection data={account.data} />
      <PhoneNumbersSection data={phones.data} isLoading={phones.isLoading} error={phones.error} />
      <WhatsAppSendTest
        phoneNumbers={phones.data?.phoneNumbers ?? []}
        templates={templates.data?.templates ?? []}
        allowedRecipients={account.data.connection.testRecipients}
      />
      <TemplatesSection
        data={templates.data}
        isLoading={templates.isLoading}
        error={templates.error}
        wabaId={account.data.account.id}
      />
    </div>
  );
}
