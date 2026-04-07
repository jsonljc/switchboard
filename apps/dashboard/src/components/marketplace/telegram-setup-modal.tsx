"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface TelegramSetupModalProps {
  deploymentId: string;
  onClose: () => void;
  onConnected: () => void;
}

export function TelegramSetupModal({
  deploymentId,
  onClose,
  onConnected,
}: TelegramSetupModalProps) {
  const [step, setStep] = useState(1);
  const [botToken, setBotToken] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (!botToken.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const webhookBaseUrl =
        process.env.NEXT_PUBLIC_CHAT_URL ?? `${window.location.origin.replace(":3002", ":3001")}`;

      const res = await fetch("/api/dashboard/marketplace/connections/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentId, botToken: botToken.trim(), webhookBaseUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to connect Telegram bot");
      }
      const data = await res.json();
      setBotUsername(data.connection.botUsername ?? "your bot");
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg p-6 max-w-lg w-full mx-4 space-y-4">
        <h3 className="font-display text-lg text-foreground">Connect Telegram Bot</h3>

        {step === 1 && (
          <>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>To create a Telegram bot:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Open Telegram and search for <strong>@BotFather</strong>
                </li>
                <li>
                  Send <code className="text-xs bg-muted px-1 rounded">/newbot</code>
                </li>
                <li>Follow the prompts to name your bot</li>
                <li>Copy the bot token you receive</li>
              </ol>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => setStep(2)}>I have my token</Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Bot Token</label>
              <Input
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                disabled={isLoading}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={isLoading}>
                Back
              </Button>
              <Button onClick={handleConnect} disabled={!botToken.trim() || isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Connect
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-sm text-muted-foreground">
              Your agent is live on Telegram! Search for <strong>@{botUsername}</strong> to start
              chatting.
            </p>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  onConnected();
                  onClose();
                }}
              >
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
