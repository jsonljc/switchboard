"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Globe, MessageCircle } from "lucide-react";

interface Connection {
  id: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown>;
}

interface ChannelsSectionProps {
  deploymentId: string;
  connections: Connection[];
  onRefresh: () => void;
}

export function ChannelsSection({ deploymentId, connections, onRefresh }: ChannelsSectionProps) {
  const [showWidgetModal, setShowWidgetModal] = useState(false);
  const [showTelegramModal, setShowTelegramModal] = useState(false);

  const widgetConn = connections.find((c) => c.type === "web_widget" && c.status === "active");
  const telegramConn = connections.find((c) => c.type === "telegram" && c.status === "active");

  async function handleDisconnect(connectionId: string) {
    try {
      await fetch(
        `/api/dashboard/marketplace/connections/${connectionId}?deploymentId=${deploymentId}`,
        { method: "DELETE" },
      );
      onRefresh();
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg text-foreground">Channels</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Web Widget Card */}
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Web Widget</span>
            {widgetConn && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                Connected
              </span>
            )}
          </div>
          {widgetConn ? (
            <Button variant="outline" size="sm" onClick={() => handleDisconnect(widgetConn.id)}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={() => setShowWidgetModal(true)}>
              Add to your website
            </Button>
          )}
        </div>

        {/* Telegram Card */}
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Telegram</span>
            {telegramConn && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                Connected
              </span>
            )}
          </div>
          {telegramConn ? (
            <Button variant="outline" size="sm" onClick={() => handleDisconnect(telegramConn.id)}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={() => setShowTelegramModal(true)}>
              Connect Telegram
            </Button>
          )}
        </div>
      </div>

      {showWidgetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="font-semibold">Web Widget Setup</h3>
            <p className="text-sm text-muted-foreground">
              Widget setup will be available in the module detail view.
            </p>
            <Button variant="outline" onClick={() => setShowWidgetModal(false)}>
              Close
            </Button>
          </div>
        </div>
      )}
      {showTelegramModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="font-semibold">Telegram Setup</h3>
            <p className="text-sm text-muted-foreground">
              Telegram setup will be available in the module detail view.
            </p>
            <Button variant="outline" onClick={() => setShowTelegramModal(false)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
