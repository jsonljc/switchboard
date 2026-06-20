"use client";

import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import {
  WhatsAppCreateTemplateRequestSchema,
  type WhatsAppCreateTemplateRequest,
} from "@switchboard/schemas";
import { useCreateWhatsAppTemplate } from "@/hooks/use-whatsapp-template-create";

type ButtonDraft =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phoneNumber: string };

type ButtonRow = ButtonDraft & { _id: number };

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

function countVariables(text: string): number {
  const m = text.match(/\{\{\s*\d+\s*\}\}/g);
  if (!m) return 0;
  return new Set(m.map((s) => s.replace(/\D/g, ""))).size;
}

export function CreateTemplateDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateWhatsAppTemplate();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("MARKETING");
  const [language, setLanguage] = useState("en_US");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [footerText, setFooterText] = useState("");
  const [buttons, setButtons] = useState<ButtonRow[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const nextButtonId = useRef(0);

  const varCount = useMemo(() => countVariables(bodyText), [bodyText]);
  const visibleSamples = Array.from({ length: varCount }, (_, i) => samples[i] ?? "");

  function setSample(i: number, value: string) {
    setSamples((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  function handleClose(next: boolean) {
    if (!next) {
      setName("");
      setCategory("MARKETING");
      setLanguage("en_US");
      setHeaderText("");
      setBodyText("");
      setSamples([]);
      setFooterText("");
      setButtons([]);
      setClientError(null);
    }
    setOpen(next);
  }

  function buildRequest(): WhatsAppCreateTemplateRequest {
    return {
      name,
      language,
      category,
      ...(headerText ? { header: { text: headerText } } : {}),
      body: { text: bodyText, ...(varCount > 0 ? { examples: visibleSamples } : {}) },
      ...(footerText ? { footer: { text: footerText } } : {}),
      ...(buttons.length > 0 ? { buttons: buttons.map(({ _id: _omit, ...b }) => b) } : {}),
    };
  }

  function handleSubmit() {
    setClientError(null);
    const candidate = buildRequest();
    const parsed = WhatsAppCreateTemplateRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      setClientError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    create.mutate(parsed.data, { onSuccess: () => handleClose(false) });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Create Template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create message template</DialogTitle>
          <DialogDescription className="sr-only">
            Fill in the fields below to create a new WhatsApp message template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="tpl-name">Template name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="order_update"
            />
            <p className="text-xs text-muted-foreground">Lowercase letters, digits, underscores.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tpl-category">Category</Label>
              <select
                id="tpl-category"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tpl-language">Language</Label>
              <Input
                id="tpl-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tpl-header">Header (optional)</Label>
            <Input
              id="tpl-header"
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Order update"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tpl-body">Body</Label>
            <Textarea
              id="tpl-body"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Hi {{1}}, your order {{2}} has shipped."
              rows={3}
            />
          </div>

          {visibleSamples.map((s, i) => (
            <div key={i} className="grid gap-2">
              <Label htmlFor={`tpl-sample-${i}`}>{`Sample for {{${i + 1}}}`}</Label>
              <Input
                id={`tpl-sample-${i}`}
                value={s}
                onChange={(e) => setSample(i, e.target.value)}
              />
            </div>
          ))}

          <div className="grid gap-2">
            <Label htmlFor="tpl-footer">Footer (optional)</Label>
            <Input
              id="tpl-footer"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Buttons (optional)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setButtons((b) => [
                    ...b,
                    { type: "QUICK_REPLY", text: "", _id: nextButtonId.current++ },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {buttons.map((b, i) => (
              <div key={b._id} className="flex items-center gap-2">
                <select
                  aria-label={`button ${i + 1} type`}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={b.type}
                  onChange={(e) => {
                    const type = e.target.value as ButtonDraft["type"];
                    setButtons((prev) =>
                      prev.map((x, xi) =>
                        xi === i
                          ? type === "URL"
                            ? { type, text: x.text, url: "", _id: x._id }
                            : type === "PHONE_NUMBER"
                              ? { type, text: x.text, phoneNumber: "", _id: x._id }
                              : { type, text: x.text, _id: x._id }
                          : x,
                      ),
                    );
                  }}
                >
                  <option value="QUICK_REPLY">quick reply</option>
                  <option value="URL">url</option>
                  <option value="PHONE_NUMBER">phone</option>
                </select>
                <Input
                  aria-label={`button ${i + 1} text`}
                  placeholder="Label"
                  value={b.text}
                  onChange={(e) =>
                    setButtons((prev) =>
                      prev.map((x, xi) => (xi === i ? { ...x, text: e.target.value } : x)),
                    )
                  }
                />
                {b.type === "URL" && (
                  <Input
                    aria-label={`button ${i + 1} url`}
                    placeholder="https://"
                    value={b.url}
                    onChange={(e) =>
                      setButtons((prev) =>
                        prev.map((x, xi) =>
                          xi === i && x.type === "URL" ? { ...x, url: e.target.value } : x,
                        ),
                      )
                    }
                  />
                )}
                {b.type === "PHONE_NUMBER" && (
                  <Input
                    aria-label={`button ${i + 1} phone`}
                    placeholder="+15551234567"
                    value={b.phoneNumber}
                    onChange={(e) =>
                      setButtons((prev) =>
                        prev.map((x, xi) =>
                          xi === i && x.type === "PHONE_NUMBER"
                            ? { ...x, phoneNumber: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`remove button ${i + 1}`}
                  onClick={() => setButtons((prev) => prev.filter((_, xi) => xi !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {(clientError || create.isError) && (
            <p className="text-sm text-destructive">{clientError ?? create.error?.message}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="action" onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
