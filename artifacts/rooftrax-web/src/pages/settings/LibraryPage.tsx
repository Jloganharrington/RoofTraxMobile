/**
 * BP/Standards/Detriment/AHJ Library management — Task #121.
 * Super-admin only. Accessible at /settings/library.
 */

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Shell } from "@/components/layout/Shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import { CheckCircle, AlertTriangle, Plus, Edit3, ShieldCheck, Upload, FileText, Loader2 } from "lucide-react";
import { parseMdLibrary, type ParsedStandard, type ParsedDetriment } from "@/lib/parseMdLibrary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BpEntry {
  sectionKey: string;
  version: number;
  contentPreview: string | null;
  updatedAt: string | null;
  hasContent: boolean;
}

interface StandardsEntry {
  id: string;
  entry_key: string;
  source_type: string | null;
  citation_text: string | null;
  verification_status: "verified" | "verify_before_ship";
  verified_at: string | null;
  authority_limit: string | null;
  locator_template: string | null;
  version: number;
}

interface DetrimentEntry {
  id: string;
  entry_key: string;
  applicability_conditions: string[];
  statement: string;
  required_support: string | null;
  limitation: string | null;
  version: number;
}

interface AhjPack {
  id: string;
  pack_type: "ahj_roof" | "ahj_siding";
  jurisdiction: string;
  items: Array<{
    key: string;
    citationText: string;
    edition?: string;
    trigger?: string;
    active: boolean;
  }>;
  version: number;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function useLibraryQuery<T>(key: string[], path: string) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => customFetch<T>(path),
  });
}

// ---------------------------------------------------------------------------
// Boilerplate tab
// ---------------------------------------------------------------------------

const BP_SECTION_LABELS: Record<string, string> = {
  opening_statement: "Opening Statement",
  inspection_method: "Inspection Method",
  caption_patterns: "Caption Patterns",
  rap_field_protocol: "RAP Field Protocol",
  attestation_block_a: "Attestation Block A",
  attestation_block_b: "Attestation Block B",
  attestation_block_c: "Attestation Block C",
  uniform_inspection_procedure: "Uniform Inspection Procedure",
  product_id_methodology: "Product ID Methodology",
  scope_block: "Scope Block",
  std_rpr_01_source_record: "STD-RPR-01 Source Record",
};

function BoilerplateTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useLibraryQuery<{ entries: BpEntry[] }>(
    ["bp-library"],
    "/api/report-settings/bp-library"
  );
  const [editing, setEditing] = useState<BpEntry | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [editorTab, setEditorTab] = useState<"write" | "preview">("write");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: (vars: { sectionKey: string; content: string }) =>
      customFetch(`/api/report-settings/bp-library/${vars.sectionKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: vars.content }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bp-library"] });
      toast({ title: "Saved", description: "New version created." });
      setEditing(null);
    },
    onError: (err) => {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    },
  });

  const openEditor = useCallback(async (entry: BpEntry) => {
    setEditing(entry);
    setEditorTab("write");
    setLoadingFull(true);
    try {
      const res = await customFetch<{ entry: { content?: string } | null }>(
        `/api/report-settings/bp-library/${entry.sectionKey}`
      );
      const content = res.entry?.content ?? "";
      setEditorContent(content);
      setFullContent(content);
    } catch {
      setEditorContent(entry.contentPreview ?? "");
    } finally {
      setLoadingFull(false);
    }
  }, []);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === "string") setEditorContent(text);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    e.target.value = "";
  }, []);

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-2">
      {(data?.entries ?? []).map((entry) => (
        <div
          key={entry.sectionKey}
          className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{BP_SECTION_LABELS[entry.sectionKey] ?? entry.sectionKey}</p>
            {entry.hasContent ? (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                v{entry.version} · {entry.updatedAt ? format(new Date(entry.updatedAt), "MMM d, yyyy") : "–"} · {entry.contentPreview}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/60 mt-0.5">No content yet</p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => openEditor(entry)}>
            <Edit3 className="h-3 w-3 mr-1.5" />
            {entry.hasContent ? "Edit" : "Add"}
          </Button>
        </div>
      ))}

      {/* Hidden file input for .md import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={handleFileImport}
      />

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? BP_SECTION_LABELS[editing.sectionKey] ?? editing.sectionKey : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {/* Write / Preview toggle */}
            <div className="flex items-center justify-between">
              <div className="flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEditorTab("write")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    editorTab === "write"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setEditorTab("preview")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    editorTab === "preview"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Preview
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={loadingFull}
              >
                <Upload className="h-3 w-3 mr-1.5" />
                Import .md file
              </Button>
            </div>

            {loadingFull ? (
              <Skeleton className="h-[260px] w-full" />
            ) : editorTab === "write" ? (
              <Textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                className="min-h-[260px] font-mono text-sm"
                placeholder="Enter Markdown, HTML, or plain text…"
              />
            ) : (
              <div className="min-h-[260px] rounded-md border bg-muted/30 p-4 overflow-auto prose prose-sm dark:prose-invert max-w-none text-sm">
                {editorContent.trim() ? (
                  <ReactMarkdown>{editorContent}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">Nothing to preview.</p>
                )}
              </div>
            )}

            {editing && editorContent === fullContent && !loadingFull && (
              <p className="text-xs text-muted-foreground">No changes yet.</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={saveMutation.isPending || loadingFull}
              onClick={() => editing && saveMutation.mutate({ sectionKey: editing.sectionKey, content: editorContent })}
            >
              {saveMutation.isPending ? "Saving…" : "Save new version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standards tab
// ---------------------------------------------------------------------------

function StandardsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useLibraryQuery<{ entries: StandardsEntry[] }>(
    ["standards-entries"],
    "/api/report-settings/standards-entries"
  );
  const [editing, setEditing] = useState<StandardsEntry | null>(null);
  const [form, setForm] = useState<Partial<StandardsEntry>>({});
  const [isNew, setIsNew] = useState(false);
  const [newKey, setNewKey] = useState("");

  const saveMutation = useMutation({
    mutationFn: (vars: { entryKey: string; body: Record<string, unknown> }) =>
      customFetch(`/api/report-settings/standards-entries/${encodeURIComponent(vars.entryKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars.body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["standards-entries"] });
      toast({ title: "Saved" });
      setEditing(null);
      setIsNew(false);
    },
    onError: (err) => toast({ title: "Save failed", description: String(err), variant: "destructive" }),
  });

  const openEdit = (entry: StandardsEntry) => {
    setEditing(entry);
    setForm(entry);
    setIsNew(false);
  };

  const openNew = () => {
    setEditing({ id: "", entry_key: newKey, source_type: null, citation_text: null, verification_status: "verify_before_ship", verified_at: null, authority_limit: null, locator_template: null, version: 0 });
    setForm({});
    setIsNew(true);
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="New entry key, e.g. ASTM-D3161" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={openNew} disabled={!newKey.trim()}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {(data?.entries ?? []).map((entry) => (
          <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium font-mono">{entry.entry_key}</span>
                {entry.source_type && <span className="text-xs text-muted-foreground">{entry.source_type}</span>}
                {entry.verification_status === "verified" ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-[10px] h-4">
                    <CheckCircle className="h-2.5 w-2.5 mr-1" />Verified
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 text-[10px] h-4">
                    <AlertTriangle className="h-2.5 w-2.5 mr-1" />Verify before ship
                  </Badge>
                )}
              </div>
              {entry.citation_text && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.citation_text}</p>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => openEdit(entry)}>Edit</Button>
          </div>
        ))}
        {data?.entries?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No standards entries yet. Add one above.</p>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) { setEditing(null); setIsNew(false); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{isNew ? "Add Standards Entry" : `Edit ${editing?.entry_key}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {isNew && (
              <div>
                <Label>Entry Key</Label>
                <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="ASTM-D3161" />
              </div>
            )}
            <div>
              <Label>Source Type</Label>
              <Input value={form.source_type ?? ""} onChange={(e) => setForm(f => ({ ...f, source_type: e.target.value }))} placeholder="ASTM / IRC / IBC / IICRC" />
            </div>
            <div>
              <Label>Citation Text</Label>
              <Textarea value={form.citation_text ?? ""} onChange={(e) => setForm(f => ({ ...f, citation_text: e.target.value }))} rows={3} />
            </div>
            <div>
              <Label>Authority Limit</Label>
              <Textarea value={form.authority_limit ?? ""} onChange={(e) => setForm(f => ({ ...f, authority_limit: e.target.value }))} rows={2} placeholder="What claims this entry supports" />
            </div>
            <div>
              <Label>Locator Template</Label>
              <Input value={form.locator_template ?? ""} onChange={(e) => setForm(f => ({ ...f, locator_template: e.target.value }))} placeholder="Formatted reference for generated content" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setEditing(null); setIsNew(false); }}>Cancel</Button>
            <Button
              variant="secondary"
              onClick={() => {
                const key = isNew ? newKey : editing!.entry_key;
                saveMutation.mutate({ entryKey: key, body: { ...form, markVerified: true } });
              }}
              disabled={saveMutation.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              Save &amp; Mark Verified
            </Button>
            <Button
              onClick={() => {
                const key = isNew ? newKey : editing!.entry_key;
                saveMutation.mutate({ entryKey: key, body: { ...form } });
              }}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detriment Library tab
// ---------------------------------------------------------------------------

const CONDITION_CODES = [
  "hail_damage", "wind_damage", "hail_and_wind", "deck_exposed",
  "granule_loss", "tab_fracture", "bruising", "metal_dents",
  "siding_damage", "fascia_damage", "gutter_damage", "interior_damage",
  "discontinued_product", "compatibility_issue", "mismatched_repair",
];

function DetrimentTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useLibraryQuery<{ entries: DetrimentEntry[] }>(
    ["detriment-entries"],
    "/api/report-settings/detriment-entries"
  );
  const [editing, setEditing] = useState<DetrimentEntry | null>(null);
  const [form, setForm] = useState<Partial<DetrimentEntry & { entry_key: string }>>({});
  const [isNew, setIsNew] = useState(false);
  const [newKey, setNewKey] = useState("");

  const saveMutation = useMutation({
    mutationFn: (vars: { entryKey: string; body: Record<string, unknown> }) =>
      customFetch(`/api/report-settings/detriment-entries/${encodeURIComponent(vars.entryKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars.body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["detriment-entries"] });
      toast({ title: "Saved" });
      setEditing(null);
      setIsNew(false);
    },
    onError: (err) => toast({ title: "Save failed", description: String(err), variant: "destructive" }),
  });

  const openNew = () => {
    setEditing({ id: "", entry_key: "", applicability_conditions: [], statement: "", required_support: null, limitation: null, version: 0 });
    setForm({ applicability_conditions: [], statement: "" });
    setIsNew(true);
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const toggleCondition = (code: string) => {
    const current = form.applicability_conditions ?? [];
    setForm(f => ({
      ...f,
      applicability_conditions: current.includes(code)
        ? current.filter(c => c !== code)
        : [...current, code],
    }));
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Entry key, e.g. DET-AS-01" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={openNew} disabled={!newKey.trim()}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />Add
        </Button>
      </div>

      <div className="space-y-2">
        {(data?.entries ?? []).map((entry) => (
          <div key={entry.id} className="p-3 rounded-lg border bg-card">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium font-mono">{entry.entry_key}</p>
                {entry.applicability_conditions?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {entry.applicability_conditions.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px] h-4">{c}</Badge>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{entry.statement}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setEditing(entry); setForm(entry); setIsNew(false); }}>Edit</Button>
            </div>
          </div>
        ))}
        {data?.entries?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No detriment entries yet.</p>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) { setEditing(null); setIsNew(false); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{isNew ? `Add Detriment Entry: ${newKey}` : `Edit ${editing?.entry_key}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label>Statement</Label>
              <Textarea value={form.statement ?? ""} onChange={(e) => setForm(f => ({ ...f, statement: e.target.value }))} rows={3} placeholder="The detriment assertion…" />
            </div>
            <div>
              <Label className="mb-1.5 block">Applicability Conditions (all must be present)</Label>
              <div className="flex flex-wrap gap-1.5">
                {CONDITION_CODES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleCondition(code)}
                    className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                      (form.applicability_conditions ?? []).includes(code)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {code}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Required Support</Label>
              <Textarea value={form.required_support ?? ""} onChange={(e) => setForm(f => ({ ...f, required_support: e.target.value }))} rows={2} placeholder="What field evidence must exist" />
            </div>
            <div>
              <Label>Limitation</Label>
              <Textarea value={form.limitation ?? ""} onChange={(e) => setForm(f => ({ ...f, limitation: e.target.value }))} rows={2} placeholder="Scope boundary" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setIsNew(false); }}>Cancel</Button>
            <Button
              onClick={() => {
                const key = isNew ? newKey : editing!.entry_key;
                saveMutation.mutate({
                  entryKey: key,
                  body: {
                    applicabilityConditions: form.applicability_conditions ?? [],
                    statement: form.statement ?? "",
                    requiredSupport: form.required_support ?? undefined,
                    limitation: form.limitation ?? undefined,
                  },
                });
              }}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AHJ Packs tab
// ---------------------------------------------------------------------------

function AhjPacksTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useLibraryQuery<{ packs: AhjPack[] }>(
    ["ahj-packs"],
    "/api/report-settings/ahj-packs"
  );
  const [creating, setCreating] = useState(false);
  const [newJurisdiction, setNewJurisdiction] = useState("");
  const [newPackType, setNewPackType] = useState<"ahj_roof" | "ahj_siding">("ahj_roof");

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch("/api/report-settings/ahj-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ahj-packs"] });
      toast({ title: "Pack created" });
      setCreating(false);
      setNewJurisdiction("");
    },
    onError: (err) => toast({ title: "Create failed", description: String(err), variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const packs = data?.packs ?? [];
  const roofPacks = packs.filter((p) => p.pack_type === "ahj_roof");
  const sidingPacks = packs.filter((p) => p.pack_type === "ahj_siding");

  const renderPacks = (packList: AhjPack[], label: string) => (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">{label}</h3>
      {packList.length === 0 && (
        <p className="text-xs text-muted-foreground pl-1">No {label} packs configured.</p>
      )}
      {packList.map((pack) => (
        <div key={pack.id} className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <p className="text-sm font-medium">{pack.jurisdiction}</p>
              <p className="text-xs text-muted-foreground">v{pack.version} · {pack.items.length} items</p>
            </div>
          </div>
          {pack.items.length > 0 && (
            <div className="space-y-1">
              {pack.items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <Badge variant={item.active ? "secondary" : "outline"} className="text-[10px] h-4 shrink-0">
                    {item.key}
                  </Badge>
                  <span className="text-muted-foreground truncate">{item.citationText}</span>
                  {item.edition && <span className="text-muted-foreground/60 shrink-0">({item.edition})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <div>
          <Label>Jurisdiction</Label>
          <Input
            value={newJurisdiction}
            onChange={(e) => setNewJurisdiction(e.target.value)}
            placeholder="e.g. Denver, CO"
            className="w-48"
          />
        </div>
        <div>
          <Label>Pack Type</Label>
          <select
            value={newPackType}
            onChange={(e) => setNewPackType(e.target.value as "ahj_roof" | "ahj_siding")}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          >
            <option value="ahj_roof">AHJ-Roof</option>
            <option value="ahj_siding">AHJ-Siding</option>
          </select>
        </div>
        <Button
          size="sm"
          disabled={!newJurisdiction.trim() || createMutation.isPending}
          onClick={() =>
            createMutation.mutate({
              packType: newPackType,
              jurisdiction: newJurisdiction.trim(),
              items: [],
            })
          }
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />Create Pack
        </Button>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderPacks(roofPacks, "AHJ-Roof")}
        {renderPacks(sidingPacks, "AHJ-Siding")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk import dialog
// ---------------------------------------------------------------------------

const FORMAT_EXAMPLE = `# Standards

## ASTM-D3161
Source Type: ASTM
Citation Text: Standard Test Method for Wind-Resistance of Steep-Slope Roofing Products
Authority Limit: Supports wind uplift claims for asphalt shingles rated to this standard
Locator Template: ASTM D3161
Verification Status: verified

## IRC-R902.1
Source Type: IRC
Citation Text: ...

# Detriments

## DET-WIND-01
Applicability Conditions: wind_damage, tab_fracture
Statement: Wind uplift caused complete or partial tab separation along the rake edge.
Required Support: Pattern documentation showing directional separation consistent with wind
Limitation: Applies to 3-tab asphalt shingles only`;

type ImportState = 'idle' | 'parsed' | 'importing' | 'done';

function BulkImportDialog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ImportState>('idle');
  const [standards, setStandards] = useState<ParsedStandard[]>([]);
  const [detriments, setDetriments] = useState<ParsedDetriment[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [showFormat, setShowFormat] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = typeof evt.target?.result === 'string' ? evt.target.result : '';
      const parsed = parseMdLibrary(text);
      setStandards(parsed.standards);
      setDetriments(parsed.detriments);
      setWarnings(parsed.warnings);
      setState('parsed');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    const total = standards.length + detriments.length;
    if (total === 0) return;
    setState('importing');
    setProgress({ done: 0, total, errors: 0 });
    let errors = 0;

    for (const std of standards) {
      try {
        await customFetch(
          `/api/report-settings/standards-entries/${encodeURIComponent(std.entryKey)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceType: std.sourceType || undefined,
              citationText: std.citationText || undefined,
              authorityLimit: std.authorityLimit || undefined,
              locatorTemplate: std.locatorTemplate || undefined,
              markVerified: std.verificationStatus === 'verified',
            }),
          }
        );
      } catch { errors++; }
      setProgress((p) => ({ ...p, done: p.done + 1, errors }));
    }

    for (const det of detriments) {
      try {
        await customFetch(
          `/api/report-settings/detriment-entries/${encodeURIComponent(det.entryKey)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              applicabilityConditions: det.applicabilityConditions,
              statement: det.statement,
              requiredSupport: det.requiredSupport || undefined,
              limitation: det.limitation || undefined,
            }),
          }
        );
      } catch { errors++; }
      setProgress((p) => ({ ...p, done: p.done + 1, errors }));
    }

    setState('done');
    void qc.invalidateQueries({ queryKey: ['standards-entries'] });
    void qc.invalidateQueries({ queryKey: ['detriment-entries'] });
    if (errors === 0) {
      toast({ title: 'Import complete', description: `${total} entries saved.` });
    } else {
      toast({
        title: 'Import finished with errors',
        description: `${total - errors} saved, ${errors} failed.`,
        variant: 'destructive',
      });
    }
  };

  const reset = () => {
    setState('idle');
    setStandards([]);
    setDetriments([]);
    setWarnings([]);
    setProgress({ done: 0, total: 0, errors: 0 });
    setShowFormat(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    setOpen(v);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileText className="h-3.5 w-3.5 mr-1.5" />
        Import from .md
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={handleFile}
      />

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Bulk Import Standards &amp; Detriments</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Format reference */}
            <div className="rounded-md border bg-muted/30">
              <button
                type="button"
                onClick={() => setShowFormat((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Expected .md format</span>
                <span>{showFormat ? '▲' : '▼'}</span>
              </button>
              {showFormat && (
                <pre className="px-3 pb-3 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground border-t">
                  {FORMAT_EXAMPLE}
                </pre>
              )}
            </div>

            {/* File picker */}
            {state === 'idle' && (
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-10 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium">Click to choose a .md file</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    One file containing both # Standards and # Detriments sections
                  </p>
                </div>
              </div>
            )}

            {/* Parsed preview */}
            {(state === 'parsed' || state === 'importing' || state === 'done') && (
              <div className="space-y-3">
                {warnings.length > 0 && (
                  <div className="rounded-md bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-3 space-y-1">
                    {warnings.map((w, i) => (
                      <p key={i} className="text-xs text-yellow-800 dark:text-yellow-300 flex gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {/* Standards */}
                  <div className="rounded-md border bg-card p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Standards — {standards.length}
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {standards.length === 0 ? (
                        <p className="text-xs text-muted-foreground">None found</p>
                      ) : (
                        standards.map((s) => (
                          <div key={s.entryKey} className="flex items-center gap-1.5">
                            <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                            <span className="text-xs font-mono truncate">{s.entryKey}</span>
                            {s.verificationStatus === 'verified' && (
                              <Badge variant="secondary" className="text-[9px] h-3.5 px-1 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 shrink-0">✓</Badge>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Detriments */}
                  <div className="rounded-md border bg-card p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Detriments — {detriments.length}
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {detriments.length === 0 ? (
                        <p className="text-xs text-muted-foreground">None found</p>
                      ) : (
                        detriments.map((d) => (
                          <div key={d.entryKey} className="flex items-start gap-1.5">
                            <CheckCircle className="h-3 w-3 text-blue-500 shrink-0 mt-px" />
                            <div className="min-w-0">
                              <p className="text-xs font-mono truncate">{d.entryKey}</p>
                              {d.applicabilityConditions.length > 0 && (
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {d.applicabilityConditions.join(', ')}
                                </p>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                {(state === 'importing' || state === 'done') && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{state === 'done' ? 'Complete' : 'Importing…'}</span>
                      <span>{progress.done} / {progress.total}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-200"
                        style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                      />
                    </div>
                    {progress.errors > 0 && (
                      <p className="text-xs text-destructive">{progress.errors} entries failed to save.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="flex-shrink-0 pt-2">
            {state === 'parsed' && (
              <>
                <Button variant="outline" onClick={() => { reset(); }}>
                  Choose different file
                </Button>
                <Button
                  onClick={() => void handleImport()}
                  disabled={standards.length + detriments.length === 0}
                >
                  Import {standards.length + detriments.length} entries
                </Button>
              </>
            )}
            {state === 'importing' && (
              <Button disabled>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Importing…
              </Button>
            )}
            {(state === 'idle' || state === 'done') && (
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {state === 'done' ? 'Close' : 'Cancel'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LibraryPage() {
  return (
    <Shell>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">BP/AHJ Library</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage the per-tenant boilerplate, standards citations, detriment entries, and AHJ
              jurisdiction packs used by the AI generation pipeline.
            </p>
          </div>
          <BulkImportDialog />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
              Library Management
            </CardTitle>
            <CardDescription className="text-xs">
              Changes create a new immutable version — previous versions are preserved for audit.
              Restrict access to super-admins.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="boilerplate">
              <TabsList className="mb-4">
                <TabsTrigger value="boilerplate">Boilerplate</TabsTrigger>
                <TabsTrigger value="standards">Standards</TabsTrigger>
                <TabsTrigger value="detriment">Detriment Library</TabsTrigger>
                <TabsTrigger value="ahj">AHJ Packs</TabsTrigger>
              </TabsList>
              <TabsContent value="boilerplate">
                <BoilerplateTab />
              </TabsContent>
              <TabsContent value="standards">
                <StandardsTab />
              </TabsContent>
              <TabsContent value="detriment">
                <DetrimentTab />
              </TabsContent>
              <TabsContent value="ahj">
                <AhjPacksTab />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
