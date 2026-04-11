"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UrlListInputProps {
  value: string[];
  onChange: (urls: string[]) => void;
  label: string;
  placeholder?: string;
}

export function UrlListInput({ value, onChange, label, placeholder }: UrlListInputProps) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setInputValue("");
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-[13px]">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Enter URL..."}
          className="text-[13px]"
        />
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          Add
        </Button>
      </div>
      {value.length > 0 && (
        <div className="space-y-1">
          {value.map((url, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-lg bg-muted/30"
            >
              <span className="text-[12px] text-muted-foreground truncate">{url}</span>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
