"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useManagedChannels, useProvision, useDeleteChannel } from "@/hooks/use-managed-channels";
import { useOrgConfig } from "@/hooks/use-org-config";
import { useToast } from "@/components/ui/use-toast";
import { Trash2, Plus, Loader2 } from "lucide-react";

const ALL_CHANNELS = ["telegram", "slack", "whatsapp"] as const;

const channelInstructions: Record<string, string> = {
  telegram:
    "Create a bot via @BotFather on Telegram. Copy the bot token and optionally set a webhook secret.",
  slack:
    "Create a Slack app at api.slack.com/apps, enable Event Subscriptions, and copy the Bot Token + Signing Secret.",
  whatsapp:
    "Create a WhatsApp Business app in the Meta Developer Dashboard. Copy the access token and Phone Number ID from the API Setup page.",
};

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-green-600 text-white border-green-600">active</Badge>;
    case "provisioning":
      return <Badge className="bg-yellow-500 text-white border-yellow-500">provisioning</Badge>;
    default:
      return <Badge variant="destructive">error</Badge>;
  }
}

function relativeTime(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ChannelManagement() {
  const { data: orgData, isLoading: orgLoading } = useOrgConfig();
  const { data: channelsData, isLoading: channelsLoading } = useManagedChannels();
  const provision = useProvision();
  const deleteChannel = useDeleteChannel();
  const { toast } = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [botToken, setBotToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waAppSecret, setWaAppSecret] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");

  const config = orgData?.config;
  const channels = channelsData?.channels ?? [];

  if (orgLoading || channelsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channels</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-16 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  if (config?.runtimeType !== "managed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channels</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Channel management is available for managed runtime organizations.
          </p>
        </CardContent>
      </Card>
    );
  }

  const provisionedNames = channels.map((c) => c.channel);
  const availableChannels = ALL_CHANNELS.filter((c) => !provisionedNames.includes(c));

  const resetForm = () => {
    setShowAddForm(false);
    setSelectedChannel("");
    setBotToken("");
    setWebhookSecret("");
    setSigningSecret("");
    setWaToken("");
    setWaPhoneNumberId("");
    setWaAppSecret("");
    setWaVerifyToken("");
  };

  const handleProvision = () => {
    if (!selectedChannel) return;

    if (selectedChannel === "whatsapp") {
      if (!waToken || !waPhoneNumberId) return;
      const channelPayload: {
        channel: string;
        token: string;
        phoneNumberId: string;
        appSecret?: string;
        verifyToken?: string;
      } = {
        channel: "whatsapp",
        token: waToken,
        phoneNumberId: waPhoneNumberId,
      };
      if (waAppSecret) channelPayload.appSecret = waAppSecret;
      if (waVerifyToken) channelPayload.verifyToken = waVerifyToken;

      provision.mutate(
        { channels: [channelPayload] },
        {
          onSuccess: () => {
            toast({ title: "Channel provisioned", description: "WhatsApp is now active." });
            resetForm();
          },
          onError: (err) => {
            toast({ title: "Provisioning failed", description: err.message, variant: "destructive" });
          },
        },
      );
      return;
    }

    if (!botToken) return;

    const channelPayload: {
      channel: string;
      botToken: string;
      webhookSecret?: string;
      signingSecret?: string;
    } = { channel: selectedChannel, botToken };

    if (selectedChannel === "telegram" && webhookSecret) {
      channelPayload.webhookSecret = webhookSecret;
    }
    if (selectedChannel === "slack" && signingSecret) {
      channelPayload.signingSecret = signingSecret;
    }

    provision.mutate(
      { channels: [channelPayload] },
      {
        onSuccess: () => {
          toast({ title: "Channel provisioned", description: `${selectedChannel} is now active.` });
          resetForm();
        },
        onError: (err) => {
          toast({ title: "Provisioning failed", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  const handleDelete = (channelId: string, channelName: string) => {
    deleteChannel.mutate(channelId, {
      onSuccess: () => {
        toast({ title: "Channel removed", description: `${channelName} has been removed.` });
      },
      onError: (err) => {
        toast({ title: "Failed to remove channel", description: err.message, variant: "destructive" });
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Channels</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {channels.length === 0 && (
          <p className="text-sm text-muted-foreground">No channels provisioned yet.</p>
        )}

        {channels.map((ch) => (
          <div
            key={ch.id}
            className="flex items-center justify-between p-3 rounded-lg border"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium capitalize">{ch.channel}</span>
                {statusBadge(ch.status)}
              </div>
              {ch.botUsername && (
                <p className="text-xs text-muted-foreground">{ch.botUsername}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Last check: {relativeTime(ch.lastHealthCheck)}
              </p>
              {ch.status === "error" && ch.statusDetail && (
                <p className="text-xs text-destructive">{ch.statusDetail}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={deleteChannel.isPending}
              onClick={() => handleDelete(ch.id, ch.channel)}
            >
              {deleteChannel.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        ))}

        {!showAddForm && availableChannels.length > 0 && (
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-4 w-4" />
            Add Channel
          </Button>
        )}

        {showAddForm && (
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <div className="space-y-1.5">
              <Label htmlFor="channel-select">Channel</Label>
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger id="channel-select">
                  <SelectValue placeholder="Select a channel" />
                </SelectTrigger>
                <SelectContent>
                  {availableChannels.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedChannel && (
              <p className="text-xs text-muted-foreground">
                {channelInstructions[selectedChannel]}
              </p>
            )}

            {selectedChannel && selectedChannel !== "whatsapp" && (
              <div className="space-y-1.5">
                <Label htmlFor="bot-token">Bot Token</Label>
                <Input
                  id="bot-token"
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="Paste your bot token"
                />
              </div>
            )}

            {selectedChannel === "telegram" && (
              <div className="space-y-1.5">
                <Label htmlFor="webhook-secret">Webhook Secret (optional)</Label>
                <Input
                  id="webhook-secret"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="Optional secret for webhook verification"
                />
              </div>
            )}

            {selectedChannel === "slack" && (
              <div className="space-y-1.5">
                <Label htmlFor="signing-secret">Signing Secret</Label>
                <Input
                  id="signing-secret"
                  type="password"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder="Your Slack app signing secret"
                />
              </div>
            )}

            {selectedChannel === "whatsapp" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-token">Access Token</Label>
                  <Input
                    id="wa-token"
                    type="password"
                    value={waToken}
                    onChange={(e) => setWaToken(e.target.value)}
                    placeholder="WhatsApp Cloud API access token"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-phone-number-id">Phone Number ID</Label>
                  <Input
                    id="wa-phone-number-id"
                    value={waPhoneNumberId}
                    onChange={(e) => setWaPhoneNumberId(e.target.value)}
                    placeholder="e.g. 123456789012345"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-app-secret">App Secret (optional)</Label>
                  <Input
                    id="wa-app-secret"
                    type="password"
                    value={waAppSecret}
                    onChange={(e) => setWaAppSecret(e.target.value)}
                    placeholder="For webhook signature verification"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-verify-token">Verify Token (optional)</Label>
                  <Input
                    id="wa-verify-token"
                    type="password"
                    value={waVerifyToken}
                    onChange={(e) => setWaVerifyToken(e.target.value)}
                    placeholder="For webhook subscription verification"
                  />
                </div>
              </>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={
                  !selectedChannel ||
                  (selectedChannel === "whatsapp" ? (!waToken || !waPhoneNumberId) : !botToken) ||
                  (selectedChannel === "slack" && !signingSecret) ||
                  provision.isPending
                }
                onClick={handleProvision}
              >
                {provision.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Provisioning...
                  </>
                ) : (
                  "Provision"
                )}
              </Button>
              <Button variant="ghost" onClick={resetForm} disabled={provision.isPending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
