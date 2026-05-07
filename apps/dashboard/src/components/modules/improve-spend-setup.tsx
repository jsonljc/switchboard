"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { isValidPixelId } from "@/lib/validation/pixel";

type Step = "connect-meta" | "select-account" | "set-targets" | "connect-capi" | "activate";

// `set-targets` and `activate` are still stubs — they don't render in the
// wizard flow today, so they're left out of STEPS so the progress bar
// reflects the actual journey (3 segments, not 5). Add them back here when
// they're built.
const STEPS: Step[] = ["connect-meta", "select-account", "connect-capi"];

interface AdAccount {
  accountId: string;
  name: string;
  currency: string;
  status: number;
}

interface ImproveSpendSetupProps {
  initialStep?: string;
  onComplete: () => void;
  deploymentId?: string;
}

function ConnectMetaStep({ error, onConnect }: { error: string | null; onConnect: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Connect Meta Ads</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with Facebook to grant access to your ad accounts.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
        <p>You&apos;ll be redirected to Facebook to authorize Switchboard.</p>
        <p className="mt-1">
          Permissions requested: <strong>ads_read</strong>, <strong>ads_management</strong>,{" "}
          <strong>business_management</strong>
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={onConnect}
        className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
      >
        Connect with Facebook
      </button>
    </div>
  );
}

function SelectAccountStep({
  accounts,
  loading,
  error,
  selectedAccountId,
  onSelectAccount,
  onConfirm,
}: {
  accounts: AdAccount[];
  loading: boolean;
  error: string | null;
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Select ad account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which ad account Switchboard should optimize.
        </p>
      </div>
      {loading && (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground text-center">
          Loading ad accounts…
        </div>
      )}
      {!loading && accounts.length === 0 && !error && (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground text-center">
          No ad accounts found. Make sure your Facebook account has active ad accounts.
        </div>
      )}
      {!loading && accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map((account) => (
            <button
              key={account.accountId}
              type="button"
              onClick={() => onSelectAccount(account.accountId)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                selectedAccountId === account.accountId
                  ? "border-foreground bg-muted"
                  : "border-border hover:bg-muted"
              }`}
            >
              <span className="font-medium">{account.name}</span>
              <span className="ml-2 text-muted-foreground">
                (act_{account.accountId}) · {account.currency}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={onConfirm}
        disabled={!selectedAccountId || loading}
        className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Saving…" : "Confirm selection"}
      </button>
    </div>
  );
}

function ComingSoonStep({ step }: { step: Step }) {
  const titles: Record<Step, string> = {
    "connect-meta": "",
    "select-account": "",
    "set-targets": "Set optimization targets",
    "connect-capi": "Connect Conversions API",
    activate: "Activate Improve Spend",
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">{titles[step]}</h2>
        <p className="mt-1 text-sm text-muted-foreground">This step is coming soon.</p>
      </div>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Coming soon — this step is not yet available in the beta.
      </div>
    </div>
  );
}

export function ConnectCapiStep({
  pixelId,
  loading,
  error,
  onPixelIdChange,
  onSave,
}: {
  pixelId: string;
  loading: boolean;
  error: string | null;
  onPixelIdChange: (value: string) => void;
  onSave: () => void;
}) {
  const canSave = isValidPixelId(pixelId) && !loading;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Connect Conversions API</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Switchboard checks your Meta pixel daily to confirm conversion events are flowing. Without
          a Pixel ID we can&apos;t run signal-health monitoring or recommend pixel/CAPI fixes.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="pixel-id" className="block text-sm font-medium">
          Pixel ID
        </label>
        <input
          id="pixel-id"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={pixelId}
          onChange={(e) => onPixelIdChange(e.target.value.trim())}
          placeholder="123456789012345"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
        />
        <p className="text-xs text-muted-foreground">
          Find this in Events Manager → Data Sources. Usually 15–16 digits.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Saving…" : "Save and continue"}
      </button>
    </div>
  );
}

export function ImproveSpendSetup({
  initialStep,
  onComplete,
  deploymentId,
}: ImproveSpendSetupProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const connectedParam = searchParams.get("connected");
  const deploymentIdParam = searchParams.get("deploymentId") ?? deploymentId;

  const resolvedInitialStep =
    connectedParam === "true" && initialStep === "select-account"
      ? "select-account"
      : STEPS.includes(initialStep as Step)
        ? (initialStep as Step)
        : "connect-meta";

  const [currentStep, setCurrentStepState] = useState<Step>(resolvedInitialStep);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pixelId, setPixelId] = useState("");

  // Always clear the error when changing steps so a stale message from
  // step N doesn't render under step N+1, and keep the URL in sync so a
  // mid-wizard reload lands on the right step instead of dropping the
  // operator back to select-account.
  const setCurrentStep = useCallback(
    (next: Step) => {
      setCurrentStepState(next);
      setError(null);
      const qs = new URLSearchParams();
      qs.set("step", next);
      if (deploymentIdParam) qs.set("deploymentId", deploymentIdParam);
      router.replace(`?${qs.toString()}`, { scroll: false });
    },
    [router, deploymentIdParam],
  );

  const currentIndex = STEPS.indexOf(currentStep);

  const fetchAccounts = useCallback(async () => {
    if (!deploymentIdParam) {
      setError("No deployment ID available. Please restart the setup.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentIdParam}/ad-account`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch ad accounts");
      }
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch ad accounts");
    } finally {
      setLoading(false);
    }
  }, [deploymentIdParam]);

  useEffect(() => {
    if (currentStep === "select-account") {
      fetchAccounts();
    }
  }, [currentStep, fetchAccounts]);

  const handleSelectAccount = useCallback(async () => {
    if (loading) return; // Race guard: ignore re-clicks while in flight.
    if (!selectedAccountId || !deploymentIdParam) return;
    const account = accounts.find((a) => a.accountId === selectedAccountId);
    if (!account) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentIdParam}/ad-account`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adAccountId: `act_${account.accountId}`,
            adAccountName: account.name,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save account selection");
      }
      // Pixel-id capture is the gating prerequisite for Gap 2 signal-health
      // monitoring; advance straight there. set-targets and activate are
      // still stubs (omitted from STEPS).
      setCurrentStep("connect-capi");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save account selection");
    } finally {
      setLoading(false);
    }
  }, [loading, selectedAccountId, deploymentIdParam, accounts, setCurrentStep]);

  const handleSavePixelId = useCallback(async () => {
    if (loading) return; // Race guard: ignore re-clicks while in flight.
    if (!deploymentIdParam) {
      setError("No deployment ID available. Please restart the setup.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentIdParam}/pixel-id`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pixelId }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save pixel id");
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save pixel id");
    } finally {
      setLoading(false);
    }
  }, [loading, pixelId, deploymentIdParam, onComplete]);

  const handleConnectMeta = useCallback(() => {
    if (!deploymentIdParam) {
      setError("No deployment ID available. Please restart the setup.");
      return;
    }
    window.location.href = `/api/dashboard/connections/facebook/authorize?deploymentId=${deploymentIdParam}`;
  }, [deploymentIdParam]);

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="flex gap-1.5">
        {STEPS.map((step, i) => (
          <div
            key={step}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= currentIndex ? "bg-foreground" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {currentStep === "connect-meta" && (
        <ConnectMetaStep error={error} onConnect={handleConnectMeta} />
      )}

      {currentStep === "select-account" && (
        <SelectAccountStep
          accounts={accounts}
          loading={loading}
          error={error}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
          onConfirm={handleSelectAccount}
        />
      )}

      {currentStep === "connect-capi" && (
        <ConnectCapiStep
          pixelId={pixelId}
          loading={loading}
          error={error}
          onPixelIdChange={setPixelId}
          onSave={handleSavePixelId}
        />
      )}

      {(currentStep === "set-targets" || currentStep === "activate") && (
        <ComingSoonStep step={currentStep} />
      )}
    </div>
  );
}
