"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useTestConnection,
} from "@/hooks/use-connections";
import { Plus, Trash2, Plug, RefreshCw, CheckCircle, XCircle } from "lucide-react";

const serviceOptions = [
  { id: "meta-ads", name: "Meta Ads" },
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
      return <Badge className="bg-green-100 text-green-700">Connected</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    case "token_expired":
      return <Badge className="bg-yellow-100 text-yellow-700">Token Expired</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function ConnectionsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { healthy: boolean; detail?: string } | null>>({});

  // Form state
  const [serviceId, setServiceId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [authType, setAuthType] = useState("api_key");
  const [credKey, setCredKey] = useState("");
  const [credValue, setCredValue] = useState("");

  const { data: connections = [], isLoading } = useConnections();
  const createConnection = useCreateConnection();
  const deleteConnection = useDeleteConnection();
  const testConnection = useTestConnection();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const credentials: Record<string, unknown> = {};
    if (credKey && credValue) {
      credentials[credKey] = credValue;
    }
    createConnection.mutate(
      { serviceId, serviceName: serviceName || serviceId, authType, credentials },
      {
        onSuccess: () => {
          setFormOpen(false);
          setServiceId("");
          setServiceName("");
          setCredKey("");
          setCredValue("");
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

  // Normalize connections to always be an array
  const connectionList = Array.isArray(connections)
    ? connections
    : (connections as any)?.connections ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Connections</h1>
          <p className="text-muted-foreground">
            Manage service connections and credentials for your cartridges.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Connection
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-center py-12">Loading connections...</div>
      ) : connectionList.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Plug className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>No connections configured.</p>
          <p className="text-sm">Add a connection to integrate with external services.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connectionList.map((conn: any) => (
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
                    {conn.scopes?.length > 0 && (
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
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
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
      <Dialog open={formOpen} onOpenChange={(v) => !v && setFormOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Connection</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label>Service</Label>
              <Select value={serviceId} onValueChange={(v) => {
                setServiceId(v);
                const svc = serviceOptions.find((s) => s.id === v);
                if (svc) setServiceName(svc.name);
              }}>
                <SelectTrigger><SelectValue placeholder="Select a service" /></SelectTrigger>
                <SelectContent>
                  {serviceOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {authTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cred-key">Credential Key</Label>
                <Input
                  id="cred-key"
                  value={credKey}
                  onChange={(e) => setCredKey(e.target.value)}
                  placeholder="e.g. accessToken"
                />
              </div>
              <div>
                <Label htmlFor="cred-value">Credential Value</Label>
                <Input
                  id="cred-value"
                  type="password"
                  value={credValue}
                  onChange={(e) => setCredValue(e.target.value)}
                  placeholder="****"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createConnection.isPending || !serviceId}>
                {createConnection.isPending ? "Creating..." : "Create Connection"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
