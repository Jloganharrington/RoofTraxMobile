/**
 * AHJ Wizard — AI code research, verification queue, and pack assembly.
 * Accessible at /settings/library/ahj-wizard. Super-admin only.
 *
 * Architecture: ingest → extract → verify (human) → activate.
 * Draft and rejected items are never pack-eligible.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  ChevronLeft,
  Plus,
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Package,
  FileText,
  Upload,
  Loader2,
  Filter,
  ArrowRight,
  BookOpen,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeSource {
  id: string;
  jurisdiction: string;
  title: string;
  edition: string;
  effectiveDate: string | null;
  sourceUrl: string | null;
  acquisitionBasis: "licensed_corpus" | "official_public_view" | "print_reference";
  licensingNote: string;
  storedCorpus: boolean;
  createdAt: string;
}

interface WizardRun {
  id: string;
  jurisdiction: string;
  packType: string;
  promptVersion: string;
  model: string;
  status: "running" | "complete" | "failed";
  startedAt: string;
  completedAt: string | null;
  stats: {
    itemsEmitted?: number;
    gapsEmitted?: number;
    byCategory?: Record<string, number>;
    evalReport?: {
      passed: boolean;
      recall: number;
      found: number;
      missed: number;
      canaryFound: boolean;
      failureReasons?: string[];
    };
  };
  itemCounts?: Record<string, number>;
}

interface CandidateItem {
  id: string;
  status: "draft" | "verified" | "edited_verified" | "rejected";
  candidateKey: string;
  citation: string | null;
  edition: string | null;
  provisionSummary: string | null;
  classification: string;
  factualTrigger: Record<string, unknown>;
  scopeConnection: string | null;
  sourceLocator: Record<string, unknown>;
  amendmentNote: string | null;
  confidence: number | null;
  gapsContext: Record<string, unknown> | null;
  lintNote: string | null;
  category: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PACK_TYPE_LABELS: Record<string, string> = {
  ahj_roof: "AHJ Roof",
  ahj_siding: "AHJ Siding",
};

const BASIS_LABELS: Record<string, string> = {
  licensed_corpus: "Licensed Corpus",
  official_public_view: "Official Public View",
  print_reference: "Print Reference",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  verified: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  edited_verified: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  complete: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

function ConfidencePill({ value }: { value: number | null }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color =
    value >= 0.8
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
      : value >= 0.5
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}>
      {pct}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Source registration form
// ---------------------------------------------------------------------------

function SourceRegistrationForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    jurisdiction: "",
    title: "",
    edition: "",
    effectiveDate: "",
    sourceUrl: "",
    acquisitionBasis: "official_public_view" as string,
    licensingNote: "",
  });
  const [corpusText, setCorpusText] = useState<string | null>(null);
  const [corpusFileName, setCorpusFileName] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      customFetch<{ source: CodeSource }>("/api/ahj-wizard/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          effectiveDate: form.effectiveDate || undefined,
          sourceUrl: form.sourceUrl || undefined,
          corpusText: corpusText ?? undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ahj-sources"] });
      toast({ title: "Source registered", description: "Code source saved." });
      onDone();
    },
    onError: (err) => {
      toast({ title: "Failed", description: String(err), variant: "destructive" });
    },
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setCorpusFileName(f.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result === "string") setCorpusText(evt.target.result);
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Jurisdiction</Label>
          <Input placeholder="e.g. Virginia" value={form.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Code Edition</Label>
          <Input placeholder="e.g. 2021 VRC" value={form.edition} onChange={(e) => set("edition", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Title</Label>
        <Input placeholder="e.g. Virginia Residential Code" value={form.title} onChange={(e) => set("title", e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Effective Date (optional)</Label>
          <Input placeholder="YYYY-MM-DD" value={form.effectiveDate} onChange={(e) => set("effectiveDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Source URL (optional)</Label>
          <Input placeholder="https://…" value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Acquisition Basis</Label>
        <Select value={form.acquisitionBasis} onValueChange={(v) => set("acquisitionBasis", v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="licensed_corpus">Licensed Corpus</SelectItem>
            <SelectItem value="official_public_view">Official Public View</SelectItem>
            <SelectItem value="print_reference">Print Reference</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Licensing Note <span className="text-red-500">*</span></Label>
        <Textarea
          placeholder="Describe the legal basis under which this code is being used (required)…"
          value={form.licensingNote}
          onChange={(e) => set("licensingNote", e.target.value)}
          className="min-h-[80px]"
        />
      </div>

      {form.acquisitionBasis === "licensed_corpus" && (
        <div className="space-y-1.5">
          <Label>Corpus Document (optional)</Label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              {corpusFileName ?? "Upload .txt / .md document"}
            </Button>
            {corpusText && (
              <span className="text-xs text-muted-foreground">
                {(corpusText.length / 1024).toFixed(0)} KB loaded
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Plain text or Markdown. Will be chunked by section boundary and stored for extraction passes.
          </p>
          <input ref={fileRef} type="file" accept=".txt,.md,.text" className="hidden" onChange={handleFile} />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button
          disabled={!form.jurisdiction || !form.title || !form.edition || !form.licensingNote || mut.isPending}
          onClick={() => void mut.mutate()}
        >
          {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          Register Source
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run launcher form
// ---------------------------------------------------------------------------

function RunLauncherForm({ sources, onLaunched }: { sources: CodeSource[]; onLaunched: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    jurisdiction: "",
    packType: "ahj_roof",
    selectedSourceIds: [] as string[],
    edition: "",
  });
  const [excerpts, setExcerpts] = useState<Record<string, string>>({});
  const [showExcerpts, setShowExcerpts] = useState(false);

  const AHJ_WIZARD_CATEGORIES = [
    "fire_separation", "structural_attachment", "ventilation", "energy_code",
    "underlayment", "ice_water_shield", "flashing", "deck_attachment",
    "valley_construction", "ridge_hip", "penetrations", "drip_edge_metal",
    "layering_tearoff", "permit_inspection",
  ];

  const mut = useMutation({
    mutationFn: () =>
      customFetch<{ run: WizardRun }>("/api/ahj-wizard/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jurisdiction: form.jurisdiction,
          packType: form.packType,
          codeSourceIds: form.selectedSourceIds,
          edition: form.edition || undefined,
          categoryExcerpts: Object.keys(excerpts).length > 0 ? excerpts : undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ahj-runs"] });
      toast({ title: "Extraction started", description: "The AI is sweeping 14 categories. Poll the run list for progress." });
      onLaunched();
    },
    onError: (err) => {
      toast({ title: "Failed to start run", description: String(err), variant: "destructive" });
    },
  });

  const toggleSource = (id: string) => {
    setForm((p) => ({
      ...p,
      selectedSourceIds: p.selectedSourceIds.includes(id)
        ? p.selectedSourceIds.filter((s) => s !== id)
        : [...p.selectedSourceIds, id],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Jurisdiction</Label>
          <Input placeholder="e.g. Virginia" value={form.jurisdiction} onChange={(e) => setForm((p) => ({ ...p, jurisdiction: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Pack Type</Label>
          <Select value={form.packType} onValueChange={(v) => setForm((p) => ({ ...p, packType: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ahj_roof">AHJ Roof</SelectItem>
              <SelectItem value="ahj_siding">AHJ Siding</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Code Edition (optional override)</Label>
        <Input placeholder="e.g. 2021 VRC" value={form.edition} onChange={(e) => setForm((p) => ({ ...p, edition: e.target.value }))} />
      </div>

      {sources.length > 0 && (
        <div className="space-y-1.5">
          <Label>Code Sources (select to include stored corpus)</Label>
          <div className="space-y-1.5 max-h-40 overflow-y-auto border rounded-md p-2">
            {sources.map((s) => (
              <label key={s.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.selectedSourceIds.includes(s.id)}
                  onChange={() => toggleSource(s.id)}
                />
                <div>
                  <p className="text-sm font-medium">{s.title} ({s.edition})</p>
                  <p className="text-xs text-muted-foreground">{s.jurisdiction} · {BASIS_LABELS[s.acquisitionBasis]} · {s.storedCorpus ? "corpus stored" : "no corpus"}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowExcerpts(!showExcerpts)}
          className="text-xs h-7"
        >
          {showExcerpts ? "Hide" : "Add"} operator excerpts per category
          <ArrowRight className={`h-3 w-3 ml-1 transition-transform ${showExcerpts ? "rotate-90" : ""}`} />
        </Button>
        {showExcerpts && (
          <div className="mt-2 space-y-2 max-h-64 overflow-y-auto border rounded-md p-3">
            <p className="text-[11px] text-muted-foreground mb-2">
              Paste relevant code section text for each category. Used when no stored corpus is available.
            </p>
            {AHJ_WIZARD_CATEGORIES.map((cat) => (
              <div key={cat} className="space-y-0.5">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{cat.replace(/_/g, " ")}</Label>
                <Textarea
                  className="min-h-[60px] text-xs"
                  placeholder={`Paste ${cat} section text…`}
                  value={excerpts[cat] ?? ""}
                  onChange={(e) => setExcerpts((p) => ({ ...p, [cat]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          disabled={!form.jurisdiction || mut.isPending}
          onClick={() => void mut.mutate()}
        >
          {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          Start Extraction
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run list
// ---------------------------------------------------------------------------

function EvalBadge({ eval: ev }: { eval?: WizardRun["stats"]["evalReport"] }) {
  if (!ev) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
        ev.passed ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
      }`}
    >
      VA eval: {Math.round(ev.recall * 100)}% recall {ev.passed ? "✓" : "✗"}
    </span>
  );
}

function RunList({ onSelect }: { onSelect: (run: WizardRun) => void }) {
  const { data, isLoading } = useQuery<{ runs: WizardRun[] }>({
    queryKey: ["ahj-runs"],
    queryFn: () => customFetch<{ runs: WizardRun[] }>("/api/ahj-wizard/runs"),
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((r) => r.status === "running") ? 4000 : false;
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const runs = data?.runs ?? [];

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No extraction runs yet. Launch one from the Run Launcher tab.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const counts = run.itemCounts ?? {};
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const verified = (counts.verified ?? 0) + (counts.edited_verified ?? 0);
        return (
          <div
            key={run.id}
            className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer"
            onClick={() => onSelect(run)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{run.jurisdiction}</span>
                <Badge variant="outline" className="text-[10px] h-4">{PACK_TYPE_LABELS[run.packType] ?? run.packType}</Badge>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[run.status] ?? ""}`}>
                  {run.status === "running" && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />}
                  {run.status}
                </span>
                <EvalBadge eval={run.stats?.evalReport} />
              </div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                <span>{format(new Date(run.startedAt), "MMM d, yyyy HH:mm")}</span>
                <span>prompt v{run.promptVersion}</span>
                {run.stats?.itemsEmitted != null && <span>{run.stats.itemsEmitted} items, {run.stats.gapsEmitted ?? 0} gaps</span>}
                {total > 0 && <span>{verified}/{total} verified</span>}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item verification drawer
// ---------------------------------------------------------------------------

function ItemDrawer({ item, onClose, onPatched }: {
  item: CandidateItem;
  onClose: () => void;
  onPatched: () => void;
}) {
  const { toast } = useToast();
  const isGap = item.gapsContext != null || item.classification === "gap_identified";

  // Gap items start in edit mode — verifier must fill in citation + reclassify
  const [editMode, setEditMode] = useState(isGap);
  const [citation, setCitation] = useState(item.citation ?? "");
  const [edition, setEdition] = useState(item.edition ?? "");
  const [summary, setSummary] = useState(item.provisionSummary ?? "");
  const [scope, setScope] = useState(item.scopeConnection ?? "");
  const [amendment, setAmendment] = useState(item.amendmentNote ?? "");
  const [classification, setClassification] = useState(
    isGap ? "" : item.classification
  );
  const [triggerText, setTriggerText] = useState(
    typeof item.factualTrigger === "object" ? JSON.stringify(item.factualTrigger, null, 2) : "{}"
  );
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const parseTrigger = (): Record<string, unknown> => {
    try { return JSON.parse(triggerText); } catch { return { raw: triggerText }; }
  };

  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/ahj-wizard/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast({ title: "Saved" });
      onPatched();
      onClose();
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const handleVerify = (action: "verify" | "edit_verify") => {
    const payload: Record<string, unknown> = {
      action,
      factualTrigger: parseTrigger(),
    };
    if (editMode || action === "edit_verify") {
      if (citation) payload.citation = citation;
      if (edition) payload.edition = edition;
      if (summary) payload.provisionSummary = summary;
      if (scope) payload.scopeConnection = scope;
      if (amendment) payload.amendmentNote = amendment;
      if (classification) payload.classification = classification;
    }
    void mut.mutate(payload);
  };

  // Gap conversion is valid only when citation + non-gap classification are both provided
  const gapConversionReady = isGap
    ? citation.trim().length > 0 && !!classification && classification !== "gap_identified"
    : true;

  const handleReject = () => {
    void mut.mutate({ action: "reject", rejectionReason: rejectReason });
  };

  const isDone = ["verified", "edited_verified", "rejected"].includes(item.status);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full max-w-3xl sm:max-w-3xl overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            {isGap ? (
              <span className="text-amber-600 dark:text-amber-400">⚠ Gap Marker</span>
            ) : (
              <span>{item.citation ?? "—"}</span>
            )}
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[item.status] ?? ""}`}>
              {item.status}
            </span>
            {item.lintNote && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                lint flag
              </span>
            )}
            <ConfidencePill value={item.confidence} />
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: source text / gap context */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source Text / Context</p>

            {isGap ? (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3 space-y-2">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Gap identified</p>
                <p className="text-sm">{(item.gapsContext as Record<string, string>)?.description ?? "—"}</p>
                {(item.gapsContext as Record<string, string>)?.searched && (
                  <p className="text-xs text-muted-foreground">Searched: {(item.gapsContext as Record<string, string>).searched}</p>
                )}
                {(item.gapsContext as Record<string, string>)?.note && (
                  <p className="text-xs text-muted-foreground">{(item.gapsContext as Record<string, string>).note}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1 font-medium">Source Locator</p>
                  <pre className="text-xs whitespace-pre-wrap break-all">
                    {JSON.stringify(item.sourceLocator, null, 2)}
                  </pre>
                </div>
                {item.lintNote && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 p-2.5">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-0.5">Content lint flag</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">{item.lintNote}</p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Category</p>
              <Badge variant="outline">{item.category.replace(/_/g, " ")}</Badge>
            </div>
          </div>

          {/* Right: editable fields */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Candidate Fields</p>
              {!isDone && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setEditMode(!editMode)}
                >
                  {editMode ? "Lock fields" : "Edit fields"}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Citation</Label>
                <Input
                  value={citation}
                  onChange={(e) => setCitation(e.target.value)}
                  disabled={!editMode || isDone}
                  className="h-8 text-sm"
                  placeholder="e.g. R302.2.2"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Edition</Label>
                <Input
                  value={edition}
                  onChange={(e) => setEdition(e.target.value)}
                  disabled={!editMode || isDone}
                  className="h-8 text-sm"
                  placeholder="e.g. 2021 VRC"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Provision Summary</Label>
                <Textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  disabled={!editMode || isDone}
                  className="min-h-[80px] text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Scope Connection</Label>
                <Textarea
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  disabled={!editMode || isDone}
                  className="min-h-[60px] text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Amendment Note</Label>
                <Input
                  value={amendment}
                  onChange={(e) => setAmendment(e.target.value)}
                  disabled={!editMode || isDone}
                  className="h-8 text-sm"
                />
              </div>
              {isGap && !isDone && (
                <div className="space-y-1">
                  <Label className="text-[11px]">
                    Classification <span className="text-red-500">*</span>{" "}
                    <span className="text-muted-foreground font-normal">(required to convert gap)</span>
                  </Label>
                  <Select value={classification} onValueChange={setClassification}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select classification…" />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "fire_life_safety",
                        "structural",
                        "energy",
                        "weatherproofing",
                        "ventilation",
                        "attachment",
                        "administrative",
                        "materials",
                        "flashing",
                        "other",
                      ].map((cls) => (
                        <SelectItem key={cls} value={cls}>
                          {cls.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-[11px]">
                  Factual Trigger <span className="text-red-500">*</span>{" "}
                  <span className="text-muted-foreground font-normal">(must be confirmed on every verify)</span>
                </Label>
                <Textarea
                  value={triggerText}
                  onChange={(e) => setTriggerText(e.target.value)}
                  disabled={isDone}
                  className="min-h-[80px] text-xs font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        {!isDone && (
          <div className="mt-6 space-y-3">
            <Separator />
            {isGap ? (
              <p className="text-xs text-muted-foreground">
                Gap markers can only be Rejected, or convert to a full citation by editing fields above then using Edit &amp; Verify.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!isGap && (
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  disabled={mut.isPending}
                  onClick={() => handleVerify("verify")}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                  Verify
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="border-blue-400 text-blue-700 dark:text-blue-300"
                disabled={mut.isPending || !gapConversionReady}
                title={
                  isGap && !gapConversionReady
                    ? "Fill in Citation and select a Classification (not gap_identified) to convert this gap"
                    : undefined
                }
                onClick={() => handleVerify("edit_verify")}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                {isGap ? "Convert & Verify" : "Edit & Verify"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-400 text-red-700 dark:text-red-300"
                onClick={() => setShowReject(true)}
                disabled={mut.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Reject
              </Button>
            </div>

            {showReject && (
              <div className="space-y-2 rounded-md border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-900 p-3">
                <Label className="text-xs text-red-700 dark:text-red-300">Rejection reason (required)</Label>
                <Textarea
                  className="min-h-[60px] text-sm"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why is this citation rejected?"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!rejectReason.trim() || mut.isPending}
                    onClick={handleReject}
                  >
                    Confirm Reject
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {isDone && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            {item.status === "rejected"
              ? `Rejected: ${item.rejectionReason ?? "—"}`
              : `Verified at ${item.verifiedAt ? format(new Date(item.verifiedAt), "MMM d, yyyy HH:mm") : "—"}`}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Item queue for a run
// ---------------------------------------------------------------------------

function RunItemQueue({ run, onBack }: { run: WizardRun; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [minConf, setMinConf] = useState("");
  const [selectedItem, setSelectedItem] = useState<CandidateItem | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [showBulkReject, setShowBulkReject] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");

  const queryKey = ["ahj-run-items", run.id, categoryFilter, statusFilter, minConf];
  const { data, isLoading, refetch } = useQuery<{ items: CandidateItem[] }>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (minConf) params.set("minConfidence", minConf);
      return customFetch<{ items: CandidateItem[] }>(`/api/ahj-wizard/runs/${run.id}/items?${params}`);
    },
  });

  const bulkRejectMut = useMutation({
    mutationFn: () =>
      customFetch("/api/ahj-wizard/items/bulk-reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [...bulkSelected], rejectionReason: bulkRejectReason }),
      }),
    onSuccess: () => {
      toast({ title: "Bulk rejected" });
      setBulkSelected(new Set());
      setShowBulkReject(false);
      setBulkRejectReason("");
      void refetch();
      qc.invalidateQueries({ queryKey: ["ahj-runs"] });
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const assembleMut = useMutation({
    mutationFn: () =>
      customFetch<{ pack: unknown; itemsAssembled: number }>("/api/ahj-wizard/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jurisdiction: run.jurisdiction, packType: run.packType, runIds: [run.id] }),
      }),
    onSuccess: (data) => {
      toast({ title: "Pack assembled!", description: `${data.itemsAssembled} items assembled into a new version.` });
      qc.invalidateQueries({ queryKey: ["ahj-packs"] });
    },
    onError: (err) => toast({ title: "Assembly failed", description: String(err), variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const counts = run.itemCounts ?? {};
  const AHJ_CATEGORIES = [
    "fire_separation", "structural_attachment", "ventilation", "energy_code",
    "underlayment", "ice_water_shield", "flashing", "deck_attachment",
    "valley_construction", "ridge_hip", "penetrations", "drip_edge_metal",
    "layering_tearoff", "permit_inspection",
  ];

  const toggleBulk = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-7 text-xs">
          <ChevronLeft className="h-3.5 w-3.5 mr-1" />
          All runs
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{run.jurisdiction}</span>
            <Badge variant="outline">{PACK_TYPE_LABELS[run.packType] ?? run.packType}</Badge>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[run.status] ?? ""}`}>
              {run.status === "running" && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />}
              {run.status}
            </span>
            {run.stats?.evalReport && <EvalBadge eval={run.stats.evalReport} />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {run.stats?.itemsEmitted ?? 0} items · {run.stats?.gapsEmitted ?? 0} gaps ·
            {" "}{(counts.verified ?? 0) + (counts.edited_verified ?? 0)} verified ·
            {" "}{counts.draft ?? 0} draft · {counts.rejected ?? 0} rejected
          </p>
        </div>
        <Button
          size="sm"
          disabled={assembleMut.isPending}
          onClick={() => void assembleMut.mutate()}
        >
          {assembleMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Package className="h-3.5 w-3.5 mr-1.5" />}
          Assemble Pack
        </Button>
      </div>

      {/* Virginia eval details */}
      {run.stats?.evalReport && !run.stats.evalReport.passed && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-3 space-y-1">
          <p className="text-xs font-semibold text-red-800 dark:text-red-300">Virginia eval did not pass</p>
          {(run.stats.evalReport.failureReasons ?? []).map((r, i) => (
            <p key={i} className="text-xs text-red-700 dark:text-red-400">• {r}</p>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44 h-7 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {AHJ_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-7 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="edited_verified">Edited & Verified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="w-28 h-7 text-xs"
          placeholder="Min conf. e.g. 0.7"
          value={minConf}
          onChange={(e) => setMinConf(e.target.value)}
        />
        {bulkSelected.size > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="border-red-400 text-red-700 h-7 text-xs"
            onClick={() => setShowBulkReject(true)}
          >
            Bulk reject ({bulkSelected.size})
          </Button>
        )}
      </div>

      {/* Bulk reject dialog */}
      <Dialog open={showBulkReject} onOpenChange={setShowBulkReject}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk Reject {bulkSelected.size} items</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Rejection reason (required)</Label>
            <Textarea value={bulkRejectReason} onChange={(e) => setBulkRejectReason(e.target.value)} className="min-h-[80px]" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkReject(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!bulkRejectReason.trim() || bulkRejectMut.isPending}
              onClick={() => void bulkRejectMut.mutate()}
            >
              Reject all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item list */}
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No items match the current filters.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const isGap = item.gapsContext != null && !item.citation;
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
              >
                {["draft", "verified", "edited_verified", "rejected"].includes(item.status) && item.status === "draft" && (
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={bulkSelected.has(item.id)}
                    onChange={() => toggleBulk(item.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {isGap ? (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">⚠ Locate this</span>
                    ) : (
                      <span className="text-sm font-medium">{item.citation ?? "—"}</span>
                    )}
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[item.status] ?? ""}`}>
                      {item.status.replace(/_/g, " ")}
                    </span>
                    <Badge variant="outline" className="text-[10px] h-4">{item.category.replace(/_/g, " ")}</Badge>
                    <ConfidencePill value={item.confidence} />
                    {item.lintNote && (
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {isGap
                      ? (item.gapsContext as Record<string, string>)?.description ?? "Gap"
                      : item.provisionSummary ?? "—"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setSelectedItem(item)}
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {selectedItem && (
        <ItemDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onPatched={() => {
            void refetch();
            qc.invalidateQueries({ queryKey: ["ahj-runs"] });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AhjWizardPage() {
  const [tab, setTab] = useState("runs");
  const [addingSource, setAddingSource] = useState(false);
  const [selectedRun, setSelectedRun] = useState<WizardRun | null>(null);
  const qc = useQueryClient();

  const { data: sourcesData } = useQuery<{ sources: CodeSource[] }>({
    queryKey: ["ahj-sources"],
    queryFn: () => customFetch<{ sources: CodeSource[] }>("/api/ahj-wizard/sources"),
  });

  const sources = sourcesData?.sources ?? [];

  return (
    <Shell>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/settings/library" className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4 inline mr-0.5" />
            Library
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              AHJ Wizard
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI code research · 14-category extraction · Human verification queue · Pack assembly
            </p>
          </div>
        </div>

        {/* Guard: if a run is selected, show the item queue */}
        {selectedRun ? (
          <Card>
            <CardContent className="pt-4">
              <RunItemQueue
                run={selectedRun}
                onBack={() => setSelectedRun(null)}
              />
            </CardContent>
          </Card>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="runs">Runs &amp; Queue</TabsTrigger>
              <TabsTrigger value="sources">Code Sources</TabsTrigger>
              <TabsTrigger value="launcher">Run Launcher</TabsTrigger>
            </TabsList>

            {/* Runs tab */}
            <TabsContent value="runs" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Extraction Runs</CardTitle>
                  <CardDescription>
                    Click a run to open its verification queue. Items born as draft require human confirmation before they are pack-eligible.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RunList onSelect={setSelectedRun} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Sources tab */}
            <TabsContent value="sources" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Registered Code Sources</CardTitle>
                      <CardDescription>
                        Register the jurisdiction codes the wizard may extract from. Licensed corpus sources can include the full document text for AI retrieval.
                      </CardDescription>
                    </div>
                    <Button size="sm" onClick={() => setAddingSource(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Register Source
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {addingSource ? (
                    <SourceRegistrationForm
                      onDone={() => {
                        setAddingSource(false);
                        qc.invalidateQueries({ queryKey: ["ahj-sources"] });
                      }}
                    />
                  ) : sources.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                      No code sources registered yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sources.map((s) => (
                        <div key={s.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{s.title}</span>
                              <Badge variant="outline" className="text-[10px] h-4">{s.edition}</Badge>
                              <Badge variant="outline" className="text-[10px] h-4">{BASIS_LABELS[s.acquisitionBasis]}</Badge>
                              {s.storedCorpus && (
                                <Badge className="text-[10px] h-4 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-0">
                                  corpus stored
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {s.jurisdiction} · {s.effectiveDate ? `effective ${s.effectiveDate}` : "no effective date"}
                              {s.sourceUrl && <> · <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">source link</a></>}
                            </p>
                            <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{s.licensingNote}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Launcher tab */}
            <TabsContent value="launcher" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Start Extraction Run</CardTitle>
                  <CardDescription>
                    Launch a 14-category AI sweep for a jurisdiction. The run starts immediately and the queue updates as items arrive.
                    All output is born as draft — no AI-generated item is ever automatically activated.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RunLauncherForm
                    sources={sources}
                    onLaunched={() => setTab("runs")}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Shell>
  );
}
