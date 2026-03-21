"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  useKnowledgeDocuments,
  useUploadKnowledge,
  useDeleteDocument,
} from "@/hooks/use-knowledge";

interface UploadPanelProps {
  agentId?: string;
}

export function UploadPanel({ agentId }: UploadPanelProps) {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);

  const { data, isLoading } = useKnowledgeDocuments(agentId);
  const uploadMutation = useUploadKnowledge();
  const deleteMutation = useDeleteDocument();

  const handleFile = useCallback(
    async (file: File) => {
      const content = await file.text();
      try {
        const result = await uploadMutation.mutateAsync({
          content,
          fileName: file.name,
          agentId,
        });
        toast({
          title: "Upload successful",
          description: `${result.chunksCreated} chunks created from ${result.fileName}`,
        });
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Upload failed",
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [agentId, uploadMutation, toast],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDelete = useCallback(
    async (documentId: string) => {
      try {
        await deleteMutation.mutateAsync(documentId);
        toast({
          title: "Document deleted",
          description: "Knowledge chunks removed",
        });
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Delete failed",
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [deleteMutation, toast],
  );

  const documents = data?.documents ?? [];

  return (
    <div className="space-y-6">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          "border-2 border-dashed rounded-lg p-12 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-accent/50",
        )}
      >
        <div className="space-y-4">
          <div className="text-[14px] text-muted-foreground">
            Drag and drop a document here, or click to browse
          </div>
          <input
            type="file"
            id="file-upload"
            className="hidden"
            onChange={handleInputChange}
            accept=".txt,.md"
          />
          <Button asChild variant="outline" disabled={uploadMutation.isPending}>
            <label htmlFor="file-upload" className="cursor-pointer">
              {uploadMutation.isPending ? "Uploading..." : "Browse files"}
            </label>
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-[14px] text-muted-foreground">Loading documents...</div>}

      {!isLoading && documents.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[14px] font-medium">Uploaded Documents</h3>
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.documentId}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium truncate">{doc.fileName}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {doc.chunkCount} chunks • {doc.sourceType} •{" "}
                    {new Date(doc.uploadedAt).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(doc.documentId)}
                  disabled={deleteMutation.isPending}
                  className="ml-4"
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLoading && documents.length === 0 && (
        <div className="text-[14px] text-muted-foreground text-center py-8">
          No documents uploaded yet
        </div>
      )}
    </div>
  );
}
