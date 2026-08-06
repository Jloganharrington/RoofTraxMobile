/**
 * Templates page — Upload, replace, delete, and tag document templates
 * (PDF, HTML, DOCX).  Accessible to admins and super admins only.
 */

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/Shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { customFetch, useGetCurrentAuthUser } from "@workspace/api-client-react";
import { FileText, Upload, Trash2, RefreshCw, Loader2, FilePlus } from "lucide-react";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

const ACCEPTED_MIME: Record<string, string> = {
  "application/pdf": "PDF",
  "text/html": "HTML",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

const USE_CASE_LABELS: Record<string, string> = {
  forensic_report:   "Forensic Report",
  proof_package:     "Proof Package",
  fipsa_agreement:   "FIPSA Agreement",
  estimate_proposal: "Estimate Proposal",
  homeowner_email:   "Homeowner Email",
  claim_supplement:  "Claim Supplement",
  other:             "Other",
};

const USE_CASE_OPTIONS = Object.entries(USE_CASE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Template {
  id: string;
  name: string;
  mimeType: string;
  useCase: string;
  originalFilename: string;
  objectPath: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Format badge
// ---------------------------------------------------------------------------

function FormatBadge({ mimeType }: { mimeType: string }) {
  const label = ACCEPTED_MIME[mimeType] ?? mimeType.split("/").pop()?.toUpperCase() ?? "FILE";
  const colorMap: Record<string, string> = {
    PDF:  "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    HTML: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    DOCX: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${colorMap[label] ?? "bg-muted text-muted-foreground"}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Upload helper — request presigned URL then PUT the file bytes
// ---------------------------------------------------------------------------

async function uploadToStorage(file: File): Promise<{ objectPath: string }> {
  const { uploadURL, objectPath } = await customFetch<{
    uploadURL: string;
    objectPath: string;
  }>("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error(`Storage PUT failed: ${putRes.status}`);

  return { objectPath };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TemplatesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: authEnvelope } = useGetCurrentAuthUser();
  const companyId = authEnvelope?.user?.companyId ?? "";

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<{ templates: Template[] }>({
    queryKey: ["templates", companyId],
    queryFn: () => customFetch(`/api/companies/${companyId}/templates`),
    enabled: !!companyId,
  });
  const templates = data?.templates ?? [];

  // ── Upload state ─────────────────────────────────────────────────────────
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadDialog, setUploadDialog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingObjectPath, setPendingObjectPath] = useState("");
  const [newName, setNewName] = useState("");
  const [newUseCase, setNewUseCase] = useState("");

  // ── Replace state ─────────────────────────────────────────────────────────
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [replacingInFlight, setReplacingInFlight] = useState(false);

  // ── Delete state ──────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (body: {
      name: string;
      objectPath: string;
      mimeType: string;
      useCase: string;
      originalFilename: string;
    }) =>
      customFetch(`/api/companies/${companyId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", companyId] });
      toast({ title: "Template uploaded" });
      setUploadDialog(false);
      setPendingFile(null);
      setPendingObjectPath("");
      setNewName("");
      setNewUseCase("");
    },
    onError: (err) =>
      toast({ title: "Upload failed", description: String(err), variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Template> }) =>
      customFetch(`/api/companies/${companyId}/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", companyId] });
    },
    onError: (err) =>
      toast({ title: "Update failed", description: String(err), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/companies/${companyId}/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates", companyId] });
      toast({ title: "Template deleted" });
      setDeleteTarget(null);
    },
    onError: (err) =>
      toast({ title: "Delete failed", description: String(err), variant: "destructive" }),
  });

  // ── Upload flow ──────────────────────────────────────────────────────────
  const handleUploadFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!ACCEPTED_MIME[file.type]) {
        toast({ title: "Only PDF, HTML, and DOCX files are allowed", variant: "destructive" });
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast({ title: "File must be under 20 MB", variant: "destructive" });
        return;
      }

      setUploading(true);
      try {
        const { objectPath } = await uploadToStorage(file);
        setPendingFile(file);
        setPendingObjectPath(objectPath);
        setNewName(file.name.replace(/\.[^.]+$/, "")); // strip extension
        setNewUseCase("");
        setUploadDialog(true);
      } catch (err) {
        toast({ title: "File upload failed", description: String(err), variant: "destructive" });
      } finally {
        setUploading(false);
      }
    },
    [toast],
  );

  const handleSaveNew = () => {
    if (!pendingFile || !pendingObjectPath || !newName.trim() || !newUseCase) return;
    createMutation.mutate({
      name: newName.trim(),
      objectPath: pendingObjectPath,
      mimeType: pendingFile.type,
      useCase: newUseCase,
      originalFilename: pendingFile.name,
    });
  };

  // ── Replace flow ─────────────────────────────────────────────────────────
  const startReplace = (templateId: string) => {
    setReplacingId(templateId);
    replaceInputRef.current?.click();
  };

  const handleReplaceFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !replacingId) return;
      if (!ACCEPTED_MIME[file.type]) {
        toast({ title: "Only PDF, HTML, and DOCX files are allowed", variant: "destructive" });
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast({ title: "File must be under 20 MB", variant: "destructive" });
        return;
      }

      setReplacingInFlight(true);
      try {
        const { objectPath } = await uploadToStorage(file);
        await patchMutation.mutateAsync({
          id: replacingId,
          body: { objectPath, mimeType: file.type, originalFilename: file.name },
        });
        toast({ title: "Template replaced" });
      } catch (err) {
        toast({ title: "Replace failed", description: String(err), variant: "destructive" });
      } finally {
        setReplacingInFlight(false);
        setReplacingId(null);
      }
    },
    [replacingId, patchMutation, toast],
  );

  // ── Use case inline edit ─────────────────────────────────────────────────
  const handleUseCaseChange = (id: string, useCase: string) => {
    patchMutation.mutate({ id, body: { useCase } });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Shell>
      {/* Hidden file inputs */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".pdf,.html,.docx,application/pdf,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        onChange={handleUploadFileSelected}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,.html,.docx,application/pdf,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        onChange={handleReplaceFileSelected}
      />

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage reusable document templates for reports, agreements, and communications.
            </p>
          </div>
          <Button
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
            className="shrink-0"
          >
            {uploading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading…</>
            ) : (
              <><Upload className="h-4 w-4 mr-2" />Upload Template</>
            )}
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <FilePlus className="h-10 w-10 text-muted-foreground/40 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No templates yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
                Upload a PDF, HTML, or DOCX file and assign it to an automation workflow.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-5"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload your first template
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {templates.map((tpl) => {
              const isReplacing = replacingInFlight && replacingId === tpl.id;
              return (
                <div
                  key={tpl.id}
                  className="flex items-center gap-4 p-4 rounded-lg border bg-card"
                >
                  {/* Icon */}
                  <FileText className="h-5 w-5 text-muted-foreground/50 flex-shrink-0" />

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{tpl.name}</span>
                      <FormatBadge mimeType={tpl.mimeType} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {tpl.originalFilename}
                      {tpl.createdAt && (
                        <> · {format(new Date(tpl.createdAt), "MMM d, yyyy")}</>
                      )}
                    </p>
                  </div>

                  {/* Use case selector */}
                  <div className="w-44 flex-shrink-0">
                    <Select
                      value={tpl.useCase}
                      onValueChange={(val) => handleUseCaseChange(tpl.id, val)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select use case" />
                      </SelectTrigger>
                      <SelectContent>
                        {USE_CASE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isReplacing || replacingInFlight}
                      onClick={() => startReplace(tpl.id)}
                    >
                      {isReplacing ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Replacing…</>
                      ) : (
                        <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Replace</>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(tpl)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload dialog — name + use case before saving */}
      <Dialog
        open={uploadDialog}
        onOpenChange={(open) => {
          if (!open) {
            setUploadDialog(false);
            setPendingFile(null);
            setPendingObjectPath("");
            setNewName("");
            setNewUseCase("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {pendingFile && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate">{pendingFile.name}</span>
                <FormatBadge mimeType={pendingFile.type} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Forensic Report v3"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-usecase">Automation use case</Label>
              <Select value={newUseCase} onValueChange={setNewUseCase}>
                <SelectTrigger id="tpl-usecase">
                  <SelectValue placeholder="Select use case…" />
                </SelectTrigger>
                <SelectContent>
                  {USE_CASE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUploadDialog(false);
                setPendingFile(null);
                setPendingObjectPath("");
                setNewName("");
                setNewUseCase("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!newName.trim() || !newUseCase || createMutation.isPending}
              onClick={handleSaveNew}
            >
              {createMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</>
              ) : (
                "Save template"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be permanently removed.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Deleting…</>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
