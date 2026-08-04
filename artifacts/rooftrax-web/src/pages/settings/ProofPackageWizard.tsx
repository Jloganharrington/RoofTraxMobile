/**
 * Proof Package Data Wizard
 * AI-powered bulk routing: upload files → AI classifies each chunk →
 * review the routing plan → apply to the correct library destinations.
 */

import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Wand2, Upload, Loader2, CheckCircle, XCircle, ChevronDown,
  ChevronUp, X, FileText, AlertTriangle, Info,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = "upload" | "analyzing" | "review" | "applying" | "done";

interface AhjPackItem {
  key: string;
  citationText: string;
  edition?: string | null;
  trigger?: string | null;
  active: boolean;
}

interface RoutingItem {
  _id: string; // client-side uuid for checkbox tracking
  selected: boolean;
  destination: "boilerplate" | "standards" | "detriment" | "ahj_pack";
  label: string;
  confidence: number;
  reasoning: string;
  // boilerplate
  sectionKey?: string;
  content?: string;
  // standards
  entryKey?: string;
  sourceType?: string | null;
  citationText?: string;
  authorityLimit?: string | null;
  locatorTemplate?: string | null;
  humanEnteredProvisionsOnly?: boolean;
  // detriment
  applicabilityConditions?: string[];
  statement?: string;
  requiredSupport?: string | null;
  limitation?: string | null;
  // ahj_pack
  jurisdiction?: string;
  packType?: "ahj_roof" | "ahj_siding";
  packItems?: AhjPackItem[];
}

interface PlanResponse {
  plan: { items: Omit<RoutingItem, "_id" | "selected">[] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEST_LABELS: Record<string, string> = {
  boilerplate: "Boilerplate",
  standards: "Standards",
  detriment: "Detriment Library",
  ahj_pack: "AHJ Pack",
};

const DEST_COLORS: Record<string, string> = {
  boilerplate: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  standards: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  detriment: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  ahj_pack: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls =
    value >= 0.9
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : value >= 0.7
      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  const label = value >= 0.9 ? "High" : value >= 0.7 ? "Good" : "Review";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {label} {pct}%
    </span>
  );
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Upload drop zone
// ---------------------------------------------------------------------------

function DropZone({
  files,
  onFiles,
  onRemove,
}: {
  files: File[];
  onFiles: (f: File[]) => void;
  onRemove: (i: number) => void;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = (raw: FileList | null) => {
    if (!raw) return;
    const next = Array.from(raw).filter(
      (f) => f.name.endsWith(".md") || f.name.endsWith(".txt") || f.type === "text/plain" || f.type === "text/markdown",
    );
    if (next.length < raw.length) {
      // silently skip unsupported types — could toast here
    }
    onFiles(next);
  };

  return (
    <div className="space-y-3">
      <div
        className={`relative rounded-lg border-2 border-dashed transition-colors cursor-pointer ${
          drag ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          accept(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-col items-center gap-2 py-8 px-4 text-center pointer-events-none">
          <Upload className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">
            Drop files here or click to browse
          </p>
          <p className="text-xs text-muted-foreground/60">.md and .txt files · up to 8 files</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".md,.txt,text/markdown,text/plain"
          className="sr-only"
          onChange={(e) => accept(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0 text-xs font-medium truncate">{f.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {(f.size / 1024).toFixed(1)} KB
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                className="shrink-0 rounded p-0.5 hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Format tips callout
// ---------------------------------------------------------------------------

function FormatTips() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border bg-muted/30">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-muted-foreground flex-1">Format tips for best results</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t px-3 py-3 space-y-2">
          <FormatRow label="Boilerplate" desc='Use headings matching section names — e.g. "# Opening Statement", "# Inspection Method". Content below each heading is routed verbatim.' />
          <FormatRow label="Standards" desc='One standard per block: citation identifier on the first line, followed by source type, citation text, and optional authority limit.' />
          <FormatRow label="Detriments" desc='Each entry needs a condition/trigger line and a statement. Optional: Required Support and Limitation lines.' />
          <FormatRow label="AHJ Packs" desc='Jurisdiction name at the top or in a heading. Each item: citation key, code text, optional edition and trigger. All items for one jurisdiction are grouped automatically.' />
        </div>
      )}
    </div>
  );
}

function FormatRow({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-[10px] font-semibold text-foreground min-w-[90px] pt-0.5">{label}</span>
      <span className="text-[10px] text-muted-foreground leading-relaxed">{desc}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review item row
// ---------------------------------------------------------------------------

function ReviewRow({
  item,
  onToggle,
}: {
  item: RoutingItem;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const preview =
    item.destination === "boilerplate"
      ? item.content?.slice(0, 120) ?? ""
      : item.destination === "standards"
      ? item.citationText?.slice(0, 120) ?? ""
      : item.destination === "detriment"
      ? item.statement?.slice(0, 120) ?? ""
      : `${item.packItems?.length ?? 0} code citation${(item.packItems?.length ?? 0) !== 1 ? "s" : ""}`;

  const fullContent =
    item.destination === "boilerplate"
      ? item.content ?? ""
      : item.destination === "standards"
      ? [
          item.citationText,
          item.sourceType ? `Source: ${item.sourceType}` : null,
          item.authorityLimit ? `Authority Limit: ${item.authorityLimit}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : item.destination === "detriment"
      ? [
          item.statement,
          item.applicabilityConditions?.length
            ? `Conditions: ${item.applicabilityConditions.join(", ")}`
            : null,
          item.requiredSupport ? `Required Support: ${item.requiredSupport}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : (item.packItems ?? [])
          .map((pi) => `${pi.key}: ${pi.citationText.slice(0, 80)}`)
          .join("\n");

  const isLong = fullContent.length > 120;

  return (
    <div
      className={`rounded-md border transition-colors ${
        item.selected ? "bg-card" : "bg-muted/20 opacity-60"
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={item.selected}
          onChange={onToggle}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary shrink-0"
        />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium truncate">{item.label}</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                DEST_COLORS[item.destination] ?? ""
              }`}
            >
              {DEST_LABELS[item.destination] ?? item.destination}
            </span>
            {item.destination === "standards" && item.entryKey && (
              <span className="text-[10px] font-mono text-muted-foreground">{item.entryKey}</span>
            )}
            {item.destination === "detriment" && item.entryKey && (
              <span className="text-[10px] font-mono text-muted-foreground">{item.entryKey}</span>
            )}
            {item.destination === "boilerplate" && item.sectionKey && (
              <span className="text-[10px] font-mono text-muted-foreground">{item.sectionKey}</span>
            )}
            {item.destination === "ahj_pack" && item.jurisdiction && (
              <span className="text-[10px] text-muted-foreground">{item.jurisdiction}</span>
            )}
            <ConfidenceBadge value={item.confidence} />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {expanded ? fullContent : preview}
            {!expanded && isLong ? "…" : ""}
          </p>
          {item.reasoning && (
            <p className="text-[10px] text-muted-foreground/70 italic">{item.reasoning}</p>
          )}
        </div>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

export function ProofPackageWizard() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [items, setItems] = useState<RoutingItem[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [applyErrors, setApplyErrors] = useState<string[]>([]);

  // ── Reset ─────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStep("upload");
    setFiles([]);
    setPastedText("");
    setItems([]);
    setProgress({ done: 0, total: 0, errors: 0 });
    setApplyErrors([]);
  }, []);

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    setOpen(v);
  };

  // ── File management ───────────────────────────────────────────────────
  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      const deduped = incoming.filter((f) => !names.has(f.name));
      return [...prev, ...deduped].slice(0, 8);
    });
  }, []);

  const removeFile = useCallback((i: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  // ── Analyze ───────────────────────────────────────────────────────────
  const analyze = useCallback(async () => {
    if (files.length === 0 && !pastedText.trim()) return;
    setStep("analyzing");

    try {
      const fileData = await Promise.all(
        files.map(
          (f) =>
            new Promise<{ name: string; content: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (e) =>
                resolve({
                  name: f.name,
                  content: typeof e.target?.result === "string" ? e.target.result : "",
                });
              reader.onerror = reject;
              reader.readAsText(f);
            }),
        ),
      );

      if (pastedText.trim()) {
        fileData.push({ name: "pasted-content.txt", content: pastedText.trim() });
      }

      const result = await customFetch<PlanResponse>("/api/report-settings/pp-wizard/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: fileData }),
      });

      const raw = result?.plan?.items ?? [];
      const routed: RoutingItem[] = raw.map((item) => ({
        ...item,
        _id: uid(),
        selected: (item.confidence ?? 0) >= 0.6,
      }));

      if (routed.length === 0) {
        toast({
          title: "No items found",
          description: "The AI couldn't identify any routable content in your files. Try restructuring them using the format tips.",
        });
        setStep("upload");
        return;
      }

      setItems(routed);
      setStep("review");
    } catch (err) {
      toast({
        title: "Analysis failed",
        description: String(err),
        variant: "destructive",
      });
      setStep("upload");
    }
  }, [files, pastedText, toast]);

  // ── Apply ─────────────────────────────────────────────────────────────
  const apply = useCallback(async () => {
    const selected = items.filter((i) => i.selected);
    if (selected.length === 0) return;

    setStep("applying");
    setProgress({ done: 0, total: selected.length, errors: 0 });
    const errors: string[] = [];

    for (const item of selected) {
      try {
        if (item.destination === "boilerplate" && item.sectionKey) {
          await customFetch(`/api/report-settings/bp-library/${item.sectionKey}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: item.content ?? "" }),
          });
        } else if (item.destination === "standards" && item.entryKey) {
          await customFetch(
            `/api/report-settings/standards-entries/${encodeURIComponent(item.entryKey)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceType: item.sourceType ?? undefined,
                citationText: item.citationText ?? undefined,
                authorityLimit: item.authorityLimit ?? undefined,
                locatorTemplate: item.locatorTemplate ?? undefined,
                humanEnteredProvisionsOnly: item.humanEnteredProvisionsOnly ?? true,
                markVerified: true,
              }),
            },
          );
        } else if (item.destination === "detriment" && item.entryKey) {
          await customFetch(
            `/api/report-settings/detriment-entries/${encodeURIComponent(item.entryKey)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                applicabilityConditions: item.applicabilityConditions ?? [],
                statement: item.statement ?? "",
                requiredSupport: item.requiredSupport ?? undefined,
                limitation: item.limitation ?? undefined,
              }),
            },
          );
        } else if (item.destination === "ahj_pack" && item.jurisdiction && item.packType) {
          await customFetch("/api/report-settings/ahj-packs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              packType: item.packType,
              jurisdiction: item.jurisdiction,
              items: (item.packItems ?? []).map((pi) => ({
                key: pi.key,
                citationText: pi.citationText,
                edition: pi.edition ?? undefined,
                trigger: pi.trigger ?? undefined,
                active: pi.active ?? true,
              })),
            }),
          });
        } else {
          errors.push(`${item.label}: missing required fields`);
        }
      } catch (e) {
        errors.push(`${item.label}: ${String(e)}`);
      }
      setProgress((p) => ({ ...p, done: p.done + 1, errors: p.errors + (errors.length > p.errors ? 1 : 0) }));
    }

    // Invalidate all library caches
    void qc.invalidateQueries({ queryKey: ["bp-library"] });
    void qc.invalidateQueries({ queryKey: ["standards-entries"] });
    void qc.invalidateQueries({ queryKey: ["detriment-entries"] });
    void qc.invalidateQueries({ queryKey: ["ahj-packs"] });

    setApplyErrors(errors);
    setStep("done");

    const saved = selected.length - errors.length;
    if (errors.length === 0) {
      toast({ title: "Applied successfully", description: `${saved} item${saved !== 1 ? "s" : ""} saved to the library.` });
    } else {
      toast({
        title: "Applied with errors",
        description: `${saved} saved, ${errors.length} failed.`,
        variant: "destructive",
      });
    }
  }, [items, qc, toast]);

  // ── Computed ──────────────────────────────────────────────────────────
  const selectedCount = items.filter((i) => i.selected).length;
  const byDest = items.reduce<Record<string, RoutingItem[]>>((acc, item) => {
    (acc[item.destination] ??= []).push(item);
    return acc;
  }, {});

  const doneCounts = {
    boilerplate: items.filter((i) => i.destination === "boilerplate" && i.selected).length,
    standards: items.filter((i) => i.destination === "standards" && i.selected).length,
    detriment: items.filter((i) => i.destination === "detriment" && i.selected).length,
    ahj_pack: items.filter((i) => i.destination === "ahj_pack" && i.selected).length,
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Wand2 className="h-3.5 w-3.5 mr-1.5" />
        Proof Package Data Wizard
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4 text-primary" />
              Proof Package Data Wizard
            </DialogTitle>
            {/* Step indicator */}
            <div className="flex items-center gap-1.5 pt-1">
              {(["upload", "analyzing", "review", "applying", "done"] as WizardStep[]).map(
                (s, i) => {
                  const steps: WizardStep[] = ["upload", "analyzing", "review", "applying", "done"];
                  const current = steps.indexOf(step);
                  const pos = steps.indexOf(s);
                  const done = pos < current;
                  const active = pos === current;
                  return (
                    <div key={s} className="flex items-center gap-1.5">
                      {i > 0 && <div className={`h-px w-6 ${done || active ? "bg-primary" : "bg-muted"}`} />}
                      <div
                        className={`h-2 w-2 rounded-full transition-colors ${
                          done ? "bg-primary" : active ? "bg-primary" : "bg-muted"
                        }`}
                      />
                    </div>
                  );
                },
              )}
              <span className="ml-2 text-xs text-muted-foreground capitalize">
                {step === "upload" && "Upload files"}
                {step === "analyzing" && "Analyzing…"}
                {step === "review" && `Review — ${items.length} item${items.length !== 1 ? "s" : ""} found`}
                {step === "applying" && "Applying…"}
                {step === "done" && "Complete"}
              </span>
            </div>
          </DialogHeader>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 min-h-0">
            {/* ── Step: Upload ─────────────────────────────────────── */}
            {step === "upload" && (
              <>
                <DropZone files={files} onFiles={addFiles} onRemove={removeFile} />

                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden>
                    <div className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-background px-2 text-[11px] text-muted-foreground">or paste text</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <textarea
                    className="w-full min-h-[140px] rounded-md border bg-background px-3 py-2 text-xs font-mono resize-y placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder={"Paste boilerplate, citation text, detriment entries, or AHJ code provisions here…"}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                  />
                  {pastedText.trim().length > 0 && (
                    <p className="text-[10px] text-muted-foreground text-right">
                      {pastedText.trim().length.toLocaleString()} chars · will be analyzed as "pasted-content.txt"
                    </p>
                  )}
                </div>

                <FormatTips />
              </>
            )}

            {/* ── Step: Analyzing ──────────────────────────────────── */}
            {step === "analyzing" && (
              <div className="flex flex-col items-center gap-4 py-12">
                <div className="relative h-16 w-16">
                  <Loader2 className="h-16 w-16 animate-spin text-primary/20" />
                  <Wand2 className="absolute inset-0 m-auto h-6 w-6 text-primary" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">AI is reading your files…</p>
                  <p className="text-xs text-muted-foreground">
                    Identifying boilerplate sections, standards citations, detriment entries, and AHJ provisions.
                  </p>
                </div>
              </div>
            )}

            {/* ── Step: Review ─────────────────────────────────────── */}
            {step === "review" && (
              <div className="space-y-4">
                {/* Destination summary pills */}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(DEST_LABELS).map(([dest, label]) => {
                    const group = byDest[dest] ?? [];
                    if (group.length === 0) return null;
                    const sel = group.filter((i) => i.selected).length;
                    return (
                      <span
                        key={dest}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${DEST_COLORS[dest]}`}
                      >
                        {label}
                        <span className="font-mono">
                          {sel}/{group.length}
                        </span>
                      </span>
                    );
                  })}
                </div>

                {/* Select / deselect all */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Review each item and uncheck any you don't want to save.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setItems((prev) => prev.map((i) => ({ ...i, selected: true })))}
                    >
                      Select all
                    </button>
                    <span className="text-xs text-muted-foreground">·</span>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={() => setItems((prev) => prev.map((i) => ({ ...i, selected: false })))}
                    >
                      Deselect all
                    </button>
                  </div>
                </div>

                {/* Items grouped by destination */}
                {(["boilerplate", "standards", "detriment", "ahj_pack"] as const).map((dest) => {
                  const group = byDest[dest] ?? [];
                  if (group.length === 0) return null;
                  return (
                    <div key={dest}>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                        {DEST_LABELS[dest]}
                      </p>
                      <div className="space-y-1.5">
                        {group.map((item) => (
                          <ReviewRow
                            key={item._id}
                            item={item}
                            onToggle={() =>
                              setItems((prev) =>
                                prev.map((i) =>
                                  i._id === item._id ? { ...i, selected: !i.selected } : i,
                                ),
                              )
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Step: Applying ───────────────────────────────────── */}
            {step === "applying" && (
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Saving items…</span>
                    <span>
                      {progress.done} / {progress.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200"
                      style={{
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <p className="text-xs text-center text-muted-foreground">
                  Writing to boilerplate, standards, detriment, and AHJ libraries…
                </p>
              </div>
            )}

            {/* ── Step: Done ───────────────────────────────────────── */}
            {step === "done" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-4">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      {selectedCount - applyErrors.length} item{selectedCount - applyErrors.length !== 1 ? "s" : ""} saved to the library
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                      Changes create a new immutable version — previous versions are preserved.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {doneCounts.boilerplate > 0 && (
                    <StatCard label="Boilerplate sections" value={doneCounts.boilerplate} dest="boilerplate" />
                  )}
                  {doneCounts.standards > 0 && (
                    <StatCard label="Standards entries" value={doneCounts.standards} dest="standards" />
                  )}
                  {doneCounts.detriment > 0 && (
                    <StatCard label="Detriment entries" value={doneCounts.detriment} dest="detriment" />
                  )}
                  {doneCounts.ahj_pack > 0 && (
                    <StatCard label="AHJ packs" value={doneCounts.ahj_pack} dest="ahj_pack" />
                  )}
                </div>

                {applyErrors.length > 0 && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      <p className="text-xs font-medium text-destructive">{applyErrors.length} error{applyErrors.length !== 1 ? "s" : ""}</p>
                    </div>
                    {applyErrors.map((e, i) => (
                      <p key={i} className="text-[10px] text-muted-foreground pl-5 font-mono">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <DialogFooter className="px-6 py-4 border-t shrink-0">
            {step === "upload" && (
              <>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void analyze()} disabled={files.length === 0 && !pastedText.trim()}>
                  <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                  {files.length > 0 && pastedText.trim()
                    ? `Analyze ${files.length} file${files.length !== 1 ? "s" : ""} + paste`
                    : files.length > 0
                    ? `Analyze ${files.length} file${files.length !== 1 ? "s" : ""}`
                    : pastedText.trim()
                    ? "Analyze Pasted Text"
                    : "Analyze"}
                </Button>
              </>
            )}

            {step === "analyzing" && (
              <Button disabled>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Analyzing…
              </Button>
            )}

            {step === "review" && (
              <>
                <Button variant="outline" onClick={() => setStep("upload")}>
                  Back
                </Button>
                <Button onClick={() => void apply()} disabled={selectedCount === 0}>
                  Apply {selectedCount} item{selectedCount !== 1 ? "s" : ""}
                </Button>
              </>
            )}

            {step === "applying" && (
              <Button disabled>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Applying…
              </Button>
            )}

            {step === "done" && (
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatCard({
  label,
  value,
  dest,
}: {
  label: string;
  value: number;
  dest: string;
}) {
  return (
    <div className={`rounded-lg border p-3 ${DEST_COLORS[dest] ?? ""} bg-opacity-20`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium opacity-80">{label}</p>
    </div>
  );
}
