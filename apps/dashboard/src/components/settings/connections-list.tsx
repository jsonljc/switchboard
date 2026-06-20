"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, StatePanel } from "@/components/query-states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useTestConnection,
} from "@/hooks/use-connections";
import { useOrgDeploymentId } from "@/hooks/use-deployments";
import { Plus, Trash2, Plug, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { SERVICE_FIELD_CONFIGS, SERVICE_CONNECTION_CONFIGS } from "@/lib/service-field-configs";
import { WhatsAppEmbeddedSignup } from "./whatsapp-embedded-signup";
import { SetMetaPageIdDialog } from "./set-meta-page-id-dialog";

const serviceOptions = [
  { id: "meta-ads", name: "Meta Ads" },
  { id: "google_calendar", name: "Google Calendar" },
  { id: "google-ads", name: "Google Ads" },
  { id: "tiktok-ads", name: "TikTok Ads" },
  { id: "stripe", name: "Stripe" },
  { id: "slack", name: "Slack" },
  { id: "telegram", name: "Telegram" },
  { id: "whatsapp", name: "WhatsApp" },
];

const authTypes = ["api_key", "oauth2", "bot_token"];

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "connected":
      return <Badge variant="positive">Connected</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    case "token_expired":
      return <Badge variant="caution">Token Expired</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

interface ConnectionRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  authType: string;
  status: string;
  scopes?: string[];
  lastHealthCheck?: string;
}

export function ConnectionsList() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [pageIdConn, setPageIdConn] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, { healthy: boolean; detail?: string } | null>
  >({});

  // Form state
  const [serviceId, setServiceId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [authType, setAuthType] = useState("api_key");
  const [credFields, setCredFields] = useState<Record<string, string>>({});

  const { data: connections, isError, refetch } = useConnections();
  const createConnection = useCreateConnection();
  const deleteConnection = useDeleteConnection();
  const testConnection = useTestConnection();
  // OAuth connections are stored per-deployment, so the authorize leg requires a real
  // deploymentId (it 400s without one). We bind to the org's first deployment; in a
  // multi-deployment org this anchors the credential to deployments[0] (a connect-time
  // deployment chooser is deferred to a later slice).
  const { deploymentId: oauthDeploymentId, isLoading: deploymentLoading } = useOrgDeploymentId();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const fieldConfig = SERVICE_FIELD_CONFIGS[serviceId];
    const credentials: Record<string, unknown> = fieldConfig
      ? { ...credFields }
      : credFields["_key"] && credFields["_value"]
        ? { [credFields["_key"]]: credFields["_value"] }
        : {};
    createConnection.mutate(
      { serviceId, serviceName: serviceName || serviceId, authType, credentials },
      {
        onSuccess: () => {
          setFormOpen(false);
          setServiceId("");
          setServiceName("");
          setCredFields({});
        },
      },
    );
  };

  const handleTest = (id: string) => {
    setTestResult((prev) => ({ ...prev, [id]: null }));
    testConnection.mutate(id, {
      onSuccess: (data) => {
        setTestResult((prev) => ({ ...prev, [id]: data }));
      },
      onError: () => {
        setTestResult((prev) => ({ ...prev, [id]: { healthy: false, detail: "Test failed" } }));
      },
    });
  };

  const handleDelete = (id: string) => {
    deleteConnection.mutate(id, {
      onSuccess: () => setDeleteConfirm(null),
    });
  };

  const resetForm = () => {
    setServiceId("");
    setServiceName("");
    setAuthType("api_key");
    setCredFields({});
  };
  const closeForm = () => {
    setFormOpen(false);
    resetForm();
  };

  // WhatsApp is onboarded via Meta Embedded Signup, not a pasted token. When it is the
  // selected service (and ESU is configured), the New Connection modal becomes a dedicated,
  // branded Connect-WhatsApp step. The generic Auth Type / Display Name / manual-credential
  // chrome is hidden so the surface never implies WhatsApp access comes from a token paste.
  const isWhatsAppEsu = serviceId === "whatsapp" && !!process.env.NEXT_PUBLIC_META_APP_ID;

  // Normalize connections to always be an array
  const rawData = connections as unknown;
  const connectionList: ConnectionRecord[] = Array.isArray(rawData)
    ? rawData
    : (((rawData as Record<string, unknown>)?.connections as ConnectionRecord[]) ?? []);

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">Service Connections</h3>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Connection
        </Button>
      </div>

      {isError ? (
        <StatePanel
          role="alert"
          eyebrow="Couldn't load"
          title="We couldn't reach your connections."
          body="This is usually momentary. Try again in a moment."
          onRetry={() => refetch()}
        />
      ) : connections === undefined ? (
        // Gate the skeleton on absent data (not isLoading): a keys-pending query
        // (enabled:false until orgId resolves) is pending+idle, so isLoading is
        // false — keying on it would flash the empty state before the first load
        // (the #472 false-empty class). Absent data ⇒ loading.
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : connectionList.length === 0 ? (
        <StatePanel
          icon={<Plug />}
          title="No connections yet."
          body="Add a connection to integrate with external services."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connectionList.map((conn) => (
            <Card key={conn.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{conn.serviceName}</CardTitle>
                  <StatusBadge status={conn.status} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-mono text-xs">{conn.serviceId}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline">{conn.authType}</Badge>
                    {conn.scopes && conn.scopes.length > 0 && (
                      <Badge variant="secondary">{conn.scopes.length} scopes</Badge>
                    )}
                  </div>
                  {conn.lastHealthCheck && (
                    <div className="text-xs text-muted-foreground">
                      Last checked: {new Date(conn.lastHealthCheck).toLocaleString()}
                    </div>
                  )}
                  {testResult[conn.id] && (
                    <div className="flex items-center gap-1 text-xs">
                      {testResult[conn.id]!.healthy ? (
                        <>
                          <CheckCircle className="h-3 w-3 text-green-500" />
                          <span className="text-green-600">Healthy</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3 text-red-500" />
                          <span className="text-red-600">
                            {testResult[conn.id]!.detail || "Unhealthy"}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTest(conn.id)}
                      disabled={testConnection.isPending}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Test
                    </Button>
                    {conn.serviceId === "meta-ads" && (
                      <Button variant="outline" size="sm" onClick={() => setPageIdConn(conn.id)}>
                        Set Facebook Page
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteConfirm(conn.id)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(v) => !v && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Connection</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this connection? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              disabled={deleteConnection.isPending}
            >
              {deleteConnection.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New connection form */}
      <Dialog
        open={formOpen}
        onOpenChange={(v) => {
          if (!v) closeForm();
        }}
      >
        <DialogContent
          className={isWhatsAppEsu ? "gap-0 overflow-hidden p-0 sm:max-w-md" : "sm:max-w-lg"}
        >
          {isWhatsAppEsu ? (
            <>
              {/* Radix needs a title for a11y; the branded crown carries the visible one. */}
              <DialogTitle className="sr-only">Connect WhatsApp</DialogTitle>
              <DialogDescription className="sr-only">
                Connect your WhatsApp Business Account through Meta Embedded Signup.
              </DialogDescription>
              <WhatsAppEmbeddedSignup
                _metaAppId={process.env.NEXT_PUBLIC_META_APP_ID as string}
                metaConfigId={process.env.NEXT_PUBLIC_META_CONFIG_ID ?? ""}
                onConnected={() => refetch()}
                onSuccess={() => closeForm()}
              />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New Connection</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <Label>Service</Label>
                  <Select
                    value={serviceId}
                    onValueChange={(v) => {
                      setServiceId(v);
                      const svc = serviceOptions.find((s) => s.id === v);
                      if (svc) setServiceName(svc.name);
                      setCredFields({});
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a service" />
                    </SelectTrigger>
                    <SelectContent>
                      {serviceOptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="conn-name">Display Name</Label>
                  <Input
                    id="conn-name"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder="e.g. Production Meta Ads"
                  />
                </div>

                <div>
                  <Label>Auth Type</Label>
                  <Select value={authType} onValueChange={setAuthType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {authTypes.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {SERVICE_CONNECTION_CONFIGS[serviceId]?.oauth && (
                  <div className="space-y-3">
                    <Button
                      variant="action"
                      type="button"
                      className="w-full"
                      disabled={!oauthDeploymentId}
                      onClick={() => {
                        const url = SERVICE_CONNECTION_CONFIGS[serviceId].oauth!.getUrl(
                          oauthDeploymentId ?? undefined,
                        );
                        window.location.href = url;
                      }}
                    >
                      {SERVICE_CONNECTION_CONFIGS[serviceId].oauth!.label}
                    </Button>
                    {!oauthDeploymentId && !deploymentLoading && (
                      <p className="text-xs text-center text-muted-foreground">
                        Deploy an agent before connecting this service.
                      </p>
                    )}
                    {SERVICE_FIELD_CONFIGS[serviceId]?.length > 0 && (
                      <p className="text-xs text-center text-muted-foreground">
                        Or enter credentials manually below
                      </p>
                    )}
                  </div>
                )}

                {SERVICE_FIELD_CONFIGS[serviceId]?.length ? (
                  <div className="space-y-3">
                    {SERVICE_FIELD_CONFIGS[serviceId].map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <Label htmlFor={`cred-${field.key}`}>
                          {field.label}
                          {field.required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        <Input
                          id={`cred-${field.key}`}
                          type={field.type}
                          value={credFields[field.key] ?? ""}
                          onChange={(e) =>
                            setCredFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          placeholder={field.placeholder}
                        />
                        {field.helpText && (
                          <p className="text-xs text-muted-foreground">{field.helpText}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="cred-key">Credential Key</Label>
                      <Input
                        id="cred-key"
                        value={credFields["_key"] ?? ""}
                        onChange={(e) =>
                          setCredFields((prev) => ({ ...prev, _key: e.target.value }))
                        }
                        placeholder="e.g. accessToken"
                      />
                    </div>
                    <div>
                      <Label htmlFor="cred-value">Credential Value</Label>
                      <Input
                        id="cred-value"
                        type="password"
                        value={credFields["_value"] ?? ""}
                        onChange={(e) =>
                          setCredFields((prev) => ({ ...prev, _value: e.target.value }))
                        }
                        placeholder="****"
                      />
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={closeForm}>
                    Cancel
                  </Button>
                  <Button
                    variant="action"
                    type="submit"
                    disabled={
                      createConnection.isPending ||
                      !serviceId ||
                      (SERVICE_FIELD_CONFIGS[serviceId]
                        ? SERVICE_FIELD_CONFIGS[serviceId]
                            .filter((f) => f.required)
                            .some((f) => !credFields[f.key]?.trim())
                        : false)
                    }
                  >
                    {createConnection.isPending ? "Creating..." : "Create Connection"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <SetMetaPageIdDialog connectionId={pageIdConn} onClose={() => setPageIdConn(null)} />
    </>
  );
}
