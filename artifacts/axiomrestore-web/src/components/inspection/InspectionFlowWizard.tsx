/**
 * InspectionFlowWizard — Proof Package Builder.
 *
 * Gate: shows "Awaiting Field Capture" until the field record is attested.
 * Once attested, renders a readiness progress bar + 6-step pipeline:
 *   1. Review Field Data
 *   2. Photo Curation      ─┐ both unlock after step 1
 *   3. Estimate            ─┘
 *   4. AI Report Sections
 *   5. Compile & Attest
 *   6. Deliver
 */
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  useGetInspection,
  getGetInspectionQueryKey,
  useGetInspectionEstimate,
  getGetInspectionEstimateQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Package,
  Loader2,
  Lock,
  Download,
  Camera,
  Image,
  Truck,
  CheckCheck,
  ChevronDown,
  Clock,
  FileText,
  Zap,
  Bot,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useGetReadiness,
  useGetSections,
  useGetReportAttestation,
  useAttestReport,
  useCompileReport,
  useDeliverPackage,
  useGetEvents,
  useRecordClaimEvent,
  useGenerateInspectionSummary,
  getSectionsQueryKey,
  type ReadinessItem,
  type SectionType,
} from "@/lib/claimHubApi";
import { useGetCuration } from "@/lib/curationApi";
import {
  SectionCard,
  SECTION_ORDER,
  SECTION_META,
} from "@/components/inspection/SectionCard";
import { SupplementsPanel } from "@/components/inspection/SupplementsPanel";
import { EstimatePanel } from "@/pages/inspections/EstimatePanel";
import { ExhibitManifest } from "@/components/inspection/ExhibitManifest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompiledVersion {
  path: string;
  compiledAt: string;
  schemaVersion?: number;
  lintStatus?: "passed" | "needs_review" | "blocked";
}

type InspEnv = {
  inspection: {
    status?: string;
    phase?: string | null;
    scheduledFor?: string | null;
    updatedAt?: string | null;
    address?: string | null;
    compiledReportVersions?: CompiledVersion[];
    roofDamageFound?: boolean | null;
    sidingDamageFound?: boolean | null;
    collateralDamageFound?: boolean | null;
    interiorDamageFound?: boolean | null;
    attestations?: Array<{ attestationType: string | null; createdAt?: string }>;
    photos?: Array<{ id: string; url?: string | null; subjectType?: string | null }>;
    products?: Array<{ id: string; identificationMethod?: string | null }>;
    // Extended fields present in the full API response
    damageType?: string | null;
    insuredName?: string | null;
    dateOfLoss?: string | null;
    claimNumber?: string | null;
    policyNumber?: string | null;
    slopes?: Array<{ id: string; materialType?: string | null }>;
    testSquares?: Array<{ id: string }>;
    damageInstances?: Array<{ id: string }>;
    repairabilityAssessment?: {
      verdict?: string | null;
      overallRating?: string | null;
      [k: string]: unknown;
    } | null;
    aiSummary?: {
      forensicSummary: string;
      repairabilityText: string;
      confidence?: string;
      missingOrUnverifiedItems?: string[];
      qualityFlags?: string[];
      generatedAt?: string;
    } | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// AwaitingFieldCapture — gate shown before an attested field record exists
// ---------------------------------------------------------------------------

function AwaitingFieldCapture({
  inspectionId: _inspectionId,
  inspection,
  onReviewRecord,
}: {
  inspectionId: string;
  inspection: InspEnv["inspection"] | undefined;
  onReviewRecord: () => void;
}) {
  const status = inspection?.status ?? null;

  // Derive a human-readable capture status badge
  const captureStatus = (() => {
    const hasAttestation = inspection?.attestations?.some(
      (a) => a.attestationType === "stage_signoff",
    );
    if (hasAttestation) return { label: "Synced — Pending Attestation", variant: "amber" as const };
    if (status === "in_progress") return { label: "In Progress", variant: "blue" as const };
    if (status === "scheduled") return { label: "Scheduled", variant: "gray" as const };
    if (status && status !== "draft") return { label: "In Progress", variant: "blue" as const };
    return { label: "Not Started", variant: "gray" as const };
  })();

  const lastSync = inspection?.updatedAt
    ? format(new Date(inspection.updatedAt), "MMM d, yyyy 'at' h:mm a")
    : null;

  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 space-y-5">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
        <Camera className="h-8 w-8 text-amber-600 dark:text-amber-400" />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-foreground">
          Awaiting Field Capture
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          The Proof Package Builder will unlock once the field record is
          attested by the inspector.
        </p>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Capture status:</span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
            captureStatus.variant === "amber" &&
              "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
            captureStatus.variant === "blue" &&
              "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
            captureStatus.variant === "gray" &&
              "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
          )}
        >
          <Clock className="h-3 w-3" />
          {captureStatus.label}
        </span>
      </div>

      {lastSync && (
        <p className="text-xs text-muted-foreground">
          Last sync: {lastSync}
        </p>
      )}

      <p className="text-xs text-muted-foreground max-w-xs">
        Use the AxiomRestore mobile app to complete the field capture, then return
        here to build the Proof Package.
      </p>

      <button
        type="button"
        onClick={onReviewRecord}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-muted transition-colors"
      >
        <FileText className="h-3.5 w-3.5" />
        Review Field Record
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadinessProgressBar — replaces the old Stage 0 checklist panel
// ---------------------------------------------------------------------------

function ReadinessProgressBar({
  readiness,
  loading,
}: {
  readiness: { overallPass: boolean; items: ReadinessItem[] } | undefined;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return <Skeleton className="h-10 w-full rounded-xl" />;
  }
  if (!readiness) return null;

  const passCount = readiness.items.filter((i) => i.state === "pass").length;
  const total = readiness.items.length;
  const pct = total > 0 ? (passCount / total) * 100 : 0;
  const failing = readiness.items.filter((i) => i.state !== "pass");

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div
        className={cn(
          "rounded-xl border px-4 py-3 space-y-2",
          readiness.overallPass
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30"
            : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30",
        )}
      >
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 text-left" type="button">
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Stage Readiness
                </span>
                <span className="text-xs text-muted-foreground font-medium">
                  {passCount} / {total} checks passing
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    readiness.overallPass ? "bg-emerald-500" : "bg-amber-500",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            {failing.length > 0 && (
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                  !expanded && "-rotate-90",
                )}
              />
            )}
            {readiness.overallPass && (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            )}
          </button>
        </CollapsibleTrigger>

        {failing.length > 0 && (
          <CollapsibleContent>
            <div className="pt-1 divide-y divide-border/40">
              {failing.map((item) => (
                <div
                  key={item.key}
                  className="flex items-start gap-2.5 py-2 text-xs"
                >
                  {item.state === "warning" ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{item.label}</p>
                    {item.detail && (
                      <p className="text-muted-foreground mt-0.5">{item.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// FieldReviewModal — multi-tab read-only field record view
// ---------------------------------------------------------------------------

function FieldReviewModal({
  open,
  onOpenChange,
  inspection,
  readiness,
  onReviewed,
  isRecording,
  alreadyReviewed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inspection: InspEnv["inspection"] | undefined;
  readiness: { overallPass: boolean; items: ReadinessItem[] } | undefined;
  onReviewed: () => void;
  isRecording: boolean;
  /** When true the "Mark Reviewed" CTA is hidden (gate view or step already done) */
  alreadyReviewed: boolean;
}) {
  const [activeTab, setActiveTab] = useState("overview");

  const photos = (inspection?.photos ?? []) as Array<{
    id: string;
    url: string;
    subjectType?: string | null;
  }>;

  const hasAttestation = inspection?.attestations?.some(
    (a) => a.attestationType === "stage_signoff",
  );
  const attestedAt = inspection?.attestations?.find(
    (a) => a.attestationType === "stage_signoff",
  )?.createdAt;

  const damageFlagRow = (label: string, value: boolean | null | undefined) => (
    <div className="flex items-center justify-between py-2.5 border-b last:border-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {value === true ? (
        <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-300">
          Found
        </Badge>
      ) : value === false ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
          <CheckCircle2 className="h-3 w-3" /> Clear
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Not assessed</span>
      )}
    </div>
  );

  const propRow = (label: string, value: string | null | undefined, capitalize = false) =>
    value ? (
      <div key={label} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-0">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium text-right max-w-[55%] truncate", capitalize && "capitalize")}>
          {value}
        </span>
      </div>
    ) : null;

  const rap = inspection?.repairabilityAssessment;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed-height flex dialog so footer always stays visible */}
      <DialogContent className="max-w-2xl h-[82vh] flex flex-col gap-0 p-0 overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="px-6 pt-5 pb-4 border-b shrink-0">
          <DialogTitle className="text-base">Field Record</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            {inspection?.address ?? "Read-only summary of the attested field record"}
          </DialogDescription>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="mx-6 mt-3 mb-0 w-auto self-start shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="damage">Damage Scope</TabsTrigger>
            <TabsTrigger value="photos" className="gap-1.5">
              Photos
              {photos.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold leading-tight">
                  {photos.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="readiness">Readiness</TabsTrigger>
          </TabsList>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">

            {/* ── Overview ──────────────────────────────────────────── */}
            <TabsContent value="overview" className="mt-0 space-y-4">
              {/* Attestation banner */}
              <div className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium",
                hasAttestation
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
                  : "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",
              )}>
                {hasAttestation
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <AlertTriangle className="h-4 w-4 shrink-0" />}
                {hasAttestation
                  ? attestedAt
                    ? `Attested ${format(new Date(attestedAt), "MMM d, yyyy 'at' h:mm a")}`
                    : "Field record attested"
                  : "Field record not yet attested"}
              </div>

              {/* Property details */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Property</p>
                <div className="rounded-lg border divide-y divide-border/50">
                  {propRow("Address", inspection?.address)}
                  {propRow("Status", (inspection?.status as string | undefined)?.replace(/_/g, " "), true)}
                  {propRow("Phase", (inspection?.phase as string | undefined)?.replace(/_/g, " "), true)}
                  {propRow("Damage Type", (inspection?.damageType as string | undefined)?.replace(/_/g, " "), true)}
                  {propRow("Insured Name", inspection?.insuredName as string | undefined)}
                  {propRow("Date of Loss", inspection?.dateOfLoss as string | undefined)}
                  {propRow("Claim #", inspection?.claimNumber as string | undefined)}
                  {propRow("Policy #", inspection?.policyNumber as string | undefined)}
                  {inspection?.scheduledFor
                    ? propRow("Scheduled", format(new Date(String(inspection.scheduledFor)), "MMM d, yyyy"))
                    : null}
                  {inspection?.updatedAt
                    ? propRow("Last Sync", format(new Date(String(inspection.updatedAt)), "MMM d, yyyy 'at' h:mm a"))
                    : null}
                </div>
              </div>

              {/* Evidence counts */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Evidence Summary</p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {([
                    ["Photos",          photos.length],
                    ["Products",        inspection?.products?.length ?? 0],
                    ["Test Squares",    inspection?.testSquares?.length ?? 0],
                    ["Damage Events",   inspection?.damageInstances?.length ?? 0],
                    ["Slopes",          inspection?.slopes?.length ?? 0],
                  ] as [string, number][]).map(([label, count]) => (
                    <div key={label} className="rounded-lg border bg-muted/20 p-3 text-center">
                      <p className="text-2xl font-bold tabular-nums">{count}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* ── Damage Scope ──────────────────────────────────────── */}
            <TabsContent value="damage" className="mt-0 space-y-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Damage Flags</p>
                <div className="rounded-lg border px-3">
                  {damageFlagRow("Roof damage", inspection?.roofDamageFound)}
                  {damageFlagRow("Siding damage", inspection?.sidingDamageFound)}
                  {damageFlagRow("Collateral damage", inspection?.collateralDamageFound)}
                  {damageFlagRow("Interior damage", inspection?.interiorDamageFound)}
                </div>
              </div>

              {rap && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Repairability Assessment
                  </p>
                  <div className="rounded-lg border divide-y divide-border/50">
                    {rap.verdict && (
                      <div className="flex items-center justify-between px-3 py-2.5 text-sm">
                        <span className="text-muted-foreground">Verdict</span>
                        <span className="font-medium capitalize">{String(rap.verdict).replace(/_/g, " ")}</span>
                      </div>
                    )}
                    {rap.overallRating && (
                      <div className="flex items-center justify-between px-3 py-2.5 text-sm">
                        <span className="text-muted-foreground">Overall Rating</span>
                        <span className="font-medium capitalize">{String(rap.overallRating).replace(/_/g, " ")}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── Photos ────────────────────────────────────────────── */}
            <TabsContent value="photos" className="mt-0">
              {photos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                  <Camera className="h-10 w-10 opacity-20" />
                  <p className="text-sm">No photos captured yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo) => (
                    <img
                      key={photo.id}
                      src={`/api/storage/objects/${photo.url}`}
                      alt=""
                      className="rounded-lg aspect-square object-cover w-full bg-muted"
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        el.style.display = "none";
                      }}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Readiness ─────────────────────────────────────────── */}
            <TabsContent value="readiness" className="mt-0">
              {!readiness ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                </div>
              ) : (
                <div className="rounded-lg border divide-y divide-border/50">
                  {readiness.items.map((item) => (
                    <div key={item.key} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                      {item.state === "pass"
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                        : item.state === "warning"
                          ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          : <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "font-medium leading-snug",
                          item.state !== "pass" ? "text-foreground" : "text-muted-foreground",
                        )}>
                          {item.label}
                        </p>
                        {item.detail && (
                          <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="border-t px-6 py-4 flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isRecording}>
            Close
          </Button>
          {!alreadyReviewed && (
            <Button disabled={isRecording} onClick={onReviewed}>
              {isRecording
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {isRecording ? "Saving…" : "Mark Reviewed"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// StageIndicator
// ---------------------------------------------------------------------------

function StageIndicator({
  index,
  isComplete,
  isActive,
  isLocked,
}: {
  index: number;
  isComplete: boolean;
  isActive: boolean;
  isLocked: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
        isComplete
          ? "border-emerald-500 bg-emerald-500 text-white"
          : isActive
            ? "border-primary bg-primary text-primary-foreground"
            : isLocked
              ? "border-border/40 bg-muted/30 text-muted-foreground/40"
              : "border-border bg-muted text-muted-foreground",
      )}
    >
      {isComplete ? (
        <CheckCheck className="h-3.5 w-3.5" />
      ) : isLocked ? (
        <Lock className="h-3 w-3" />
      ) : (
        index
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StagePanel
// ---------------------------------------------------------------------------

function StagePanel({
  index,
  title,
  summary,
  isComplete,
  isActive,
  isLocked,
  isOpen,
  onToggle,
  children,
}: {
  index: number;
  title: string;
  summary?: string;
  isComplete: boolean;
  isActive: boolean;
  isLocked: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const handleToggle = () => {
    if (isLocked) return;
    onToggle();
  };

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        isComplete && "border-emerald-200 dark:border-emerald-900/40 bg-card",
        isActive && !isComplete && "border-primary/40 bg-card",
        isLocked && "border-border/40 bg-muted/10",
        !isActive && !isComplete && !isLocked && "border-border bg-muted/20",
      )}
    >
      {/* Header */}
      <button
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center gap-3 p-4 text-left",
          isLocked && "cursor-not-allowed",
        )}
        type="button"
        disabled={isLocked}
      >
        <StageIndicator
          index={index}
          isComplete={isComplete}
          isActive={isActive}
          isLocked={isLocked}
        />
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm font-semibold leading-tight",
              (isLocked || (!isActive && !isComplete)) && "text-muted-foreground",
            )}
          >
            {title}
          </p>
          {summary && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{summary}</p>
          )}
        </div>
        {isComplete && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 shrink-0">
            Complete
          </span>
        )}
        {!isLocked && (
          <svg
            className={cn(
              "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
              !isOpen && "-rotate-90",
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        )}
      </button>

      {/* Content */}
      {isOpen && !isLocked && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3">{children}</div>
      )}
    </div>
  );
}

/** The five sections that generate independently — no upstream section required. */
const INDEPENDENT_SECTION_TYPES: SectionType[] = [
  "findings",
  "causation",
  "detriment_application",
  "rap_narrative",
  "estimate_justifications",
];
export function InspectionFlowWizard({
  inspectionId,
}: {
  inspectionId: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: readiness, isLoading: loadingReadiness } =
    useGetReadiness(inspectionId);
  const { data: sectionsData, isLoading: loadingSections } =
    useGetSections(inspectionId);
  const { data: curationData } = useGetCuration(inspectionId);
  const { data: estimateEnv } = useGetInspectionEstimate(inspectionId, {
    query: {
      enabled: !!inspectionId,
      queryKey: getGetInspectionEstimateQueryKey(inspectionId),
    },
  });
  const { data: attestationData, isLoading: loadingAttestation } =
    useGetReportAttestation(inspectionId);
  const { data: inspectionEnv } = useGetInspection(inspectionId, {
    query: {
      enabled: !!inspectionId,
      queryKey: getGetInspectionQueryKey(inspectionId),
    },
  });
  const { data: eventsData } = useGetEvents(inspectionId);

  const inspection = (inspectionEnv as InspEnv | undefined)?.inspection;
  const compiledVersions = inspection?.compiledReportVersions ?? [];

  // ── Jurisdiction pack check (compile gate pre-flight) ────────────────────
  // Uses the inspection-scoped code-citations endpoint (requireWritableInspection)
  // so this query is accessible to the rep who owns the inspection, not just
  // admins. The server resolves the property state with the same regex as
  // compile and returns matching packs, giving us a direct answer.
  const { data: jurCitationsData } = useQuery<{
    state: string | null;
    packs: Array<{ state: string }>;
  }>({
    queryKey: ["code-citations-preflight", inspectionId],
    queryFn: () =>
      customFetch(
        `/api/inspections/${inspectionId}/report/code-citations`,
      ) as Promise<{ state: string | null; packs: Array<{ state: string }> }>,
    enabled: !!inspectionId,
    staleTime: 60_000,
  });

  // The server already resolved the property state — reuse it for the banner.
  const propertyState = jurCitationsData?.state ?? null;

  // Only show the banner when we have a definitive answer (packs loaded).
  // While loading we stay silent — compile will surface the 422 if needed.
  const jurPackMissing =
    jurCitationsData !== undefined &&
    !!propertyState &&
    (jurCitationsData.packs?.length ?? 0) === 0;

  // ── AI Briefing (compile gate pre-flight) ────────────────────────────────
  // Compile returns HTTP 400 when aiSummary is null. Show a visible card in
  // step 4 so reps know to generate it before reaching compile.
  const hasSummary = inspection?.aiSummary != null;
  const aiSummaryData = inspection?.aiSummary as {
    forensicSummary: string;
    repairabilityText: string;
    confidence?: string;
    missingOrUnverifiedItems?: string[];
    generatedAt?: string;
  } | null | undefined;

  const sections = sectionsData?.sections ?? [];
  const curation = curationData;
  const events = eventsData?.events ?? [];

  const compileReport = useCompileReport(inspectionId);
  const attestReport = useAttestReport(inspectionId);
  const deliverPackage = useDeliverPackage(inspectionId);
  const recordEvent = useRecordClaimEvent(inspectionId);
  const generateSummary = useGenerateInspectionSummary(inspectionId);

  // ── Generate All Ready ───────────────────────────────────────────────────
  const [generatingAll, setGeneratingAll] = useState(false);

  // Attestation dialog ───────────────────────────────────────────────────
  const [attestDialogOpen, setAttestDialogOpen] = useState(false);
  const [attestAcknowledged, setAttestAcknowledged] = useState(false);

  // ── Field review modal ───────────────────────────────────────────────────
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  // ── Gate: field record attested? ─────────────────────────────────────────
  const fieldRecordAttestedItem = readiness?.items.find(
    (i) => i.key === "field_record_attested",
  );
  const isFieldRecordAttested =
    fieldRecordAttestedItem?.state === "pass";
  const showGate =
    !loadingReadiness && readiness != null && !isFieldRecordAttested;

  // ── Step completion ──────────────────────────────────────────────────────
  // s1: field record reviewed (UI event)
  const s1Complete = events.some((e) => e.eventType === "field_record_reviewed");
  // s2: all exhibit slots confirmed + curation finalized
  // (caption locking continues on the curation page but no longer gates step 2)
  const s2Complete = curation?.isFinalized === true;
  // s3: estimate has ≥1 line items
  const s3Complete = (estimateEnv?.estimate?.lines?.length ?? 0) > 0;
  // s4: all AI sections locked
  const s4Complete = SECTION_ORDER.every((t) =>
    sections.some((s) => s.sectionType === t && s.state === "locked"),
  );
  // s5: compiled + attested
  const s5Complete =
    compiledVersions.length > 0 && attestationData?.attested === true;
  // s6: package delivered
  const s6Complete = inspection?.status === "submitted";

  // ── Active stages (parallel 2+3) ─────────────────────────────────────────
  // Returns the set of 0-based step indices that are "active" (highlighted blue)
  const activeStages = (() => {
    if (!s1Complete) return new Set([0]);
    if (!s2Complete || !s3Complete) {
      const a = new Set<number>();
      if (!s2Complete) a.add(1);
      if (!s3Complete) a.add(2);
      return a;
    }
    if (!s4Complete) return new Set([3]);
    if (!s5Complete) return new Set([4]);
    return new Set([5]);
  })();

  // A step is "locked" (can't open accordion) when its prerequisites aren't met
  const isStepLocked = (i: number): boolean => {
    if (i === 0) return false; // Review Field Data always accessible
    if (i === 1) return !s1Complete; // Photo Curation unlocks after step 1
    if (i === 2) return !s1Complete; // Estimate unlocks after step 1
    if (i === 3) return !s2Complete || !s3Complete; // Sections unlock after 2+3
    if (i === 4) return !s4Complete; // Compile unlocks after sections
    if (i === 5) return !s5Complete; // Deliver unlocks after compile+attest
    return false;
  };

  // ── Open state for accordion panels ─────────────────────────────────────
  const [openStages, setOpenStages] = useState<Set<number>>(
    () => new Set(activeStages),
  );

  useEffect(() => {
    setOpenStages((prev) => {
      const next = new Set(prev);
      for (const a of activeStages) {
        next.add(a);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s1Complete, s2Complete, s3Complete, s4Complete, s5Complete, s6Complete]);

  const toggle = (i: number) =>
    setOpenStages((prev) => {
      if (isStepLocked(i)) return prev;
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  // ── Derived helpers ──────────────────────────────────────────────────────
  const lockedCount = SECTION_ORDER.filter((t) =>
    sections.some((s) => s.sectionType === t && s.state === "locked"),
  ).length;
  const hasRealSections = sections.some((s) => s.state !== "not_started");
  const allSectionsLocked =
    sections.length > 0 && sections.every((s) => s.state === "locked");
  const canCompile =
    !compileReport.isPending &&
    hasSummary &&
    (!hasRealSections || allSectionsLocked);

  // Independent sections not yet started — eligible for "Generate All Ready"
  const notStartedIndependent = INDEPENDENT_SECTION_TYPES.filter((t) => {
    const s = sections.find((sec) => sec.sectionType === t);
    return !s || s.state === "not_started";
  });
  const showGenerateAllReady =
    hasSummary &&
    !!readiness?.overallPass &&
    notStartedIndependent.length > 0;

  const handleGenerateAll = async () => {
    setGeneratingAll(true);
    try {
      await Promise.all(
        notStartedIndependent.map((sType) =>
          customFetch(
            `/api/inspections/${inspectionId}/sections/${sType}/generate`,
            { method: "POST" },
          ),
        ),
      );
    } catch {
      toast({
        title: "Generate All failed",
        description: "One or more sections failed to generate. Check each section for details.",
        variant: "destructive",
      });
    } finally {
      setGeneratingAll(false);
      qc.invalidateQueries({ queryKey: getSectionsQueryKey(inspectionId) });
    }
  };

  const pkgCompiled = compiledVersions.length > 0;
  const isAttested = attestationData?.attested === true;
  const canAttest =
    pkgCompiled && !isAttested && !loadingAttestation && !attestReport.isPending;

  const assignedCount =
    curation?.selections.filter((s) => s.exhibitClass).length ?? 0;
  const captionLockedCount =
    curation?.captions.filter((c) => c.state === "locked").length ?? 0;

  // ── Step metadata ────────────────────────────────────────────────────────
  const STEPS = [
    {
      title: "Review Field Data",
      summary: s1Complete
        ? "Field record reviewed"
        : "Review and mark the field record",
    },
    {
      title: "Photo Curation",
      summary: s2Complete
        ? "Curation finalized"
        : assignedCount > 0
          ? `${assignedCount} exhibit(s) assigned`
          : "Confirm exhibit slots",
    },
    {
      title: "Estimate",
      summary: s3Complete
        ? `${estimateEnv?.estimate?.lines?.length ?? 0} line item(s)`
        : "No line items yet",
    },
    {
      title: "AI Report Sections",
      summary:
        lockedCount > 0
          ? `${lockedCount} / ${SECTION_ORDER.length} sections locked`
          : "Not started",
    },
    {
      title: "Compile & Attest",
      summary: isAttested
        ? "Report attested"
        : pkgCompiled
          ? "Compiled — awaiting attestation"
          : "Not compiled yet",
    },
    {
      title: "Deliver",
      summary: s6Complete ? "Package delivered" : "Ready to deliver",
    },
  ];

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (loadingReadiness && !readiness) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  // ── Gate: Awaiting Field Capture ─────────────────────────────────────────
  if (showGate) {
    return (
      <>
        <div className="rounded-xl border bg-card">
          <AwaitingFieldCapture
            inspectionId={inspectionId}
            inspection={inspection}
            onReviewRecord={() => setReviewModalOpen(true)}
          />
        </div>
        <FieldReviewModal
          open={reviewModalOpen}
          onOpenChange={setReviewModalOpen}
          inspection={inspection}
          readiness={readiness}
          alreadyReviewed={true}
          isRecording={false}
          onReviewed={() => setReviewModalOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Readiness progress bar ────────────────────────────────────── */}
      <ReadinessProgressBar readiness={readiness} loading={loadingReadiness} />

      {/* ── Step 1: Review Field Data ─────────────────────────────────── */}
      <StagePanel
        index={1}
        title={STEPS[0].title}
        summary={STEPS[0].summary}
        isComplete={s1Complete}
        isActive={activeStages.has(0)}
        isLocked={isStepLocked(0)}
        isOpen={openStages.has(0)}
        onToggle={() => toggle(0)}
      >
        <p className="text-sm text-muted-foreground">
          Review the attested field record to confirm its accuracy before
          building the package.
        </p>

        {/* Asset summary from readiness */}
        {readiness && (
          <div className="rounded-lg border bg-muted/20 divide-y divide-border/50">
            {readiness.items
              .filter((i) =>
                [
                  "field_record_attested",
                  "forensic_findings",
                  "product_id",
                  "rap_record",
                ].includes(i.key),
              )
              .map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm"
                >
                  {item.state === "pass" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  ) : item.state === "warning" ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  )}
                  <span
                    className={
                      item.state !== "pass" ? "text-muted-foreground" : ""
                    }
                  >
                    {item.label}
                  </span>
                </div>
              ))}
          </div>
        )}

        <Button onClick={() => setReviewModalOpen(true)}>
          <Camera className="h-4 w-4 mr-2" />
          {s1Complete ? "View Field Record" : "Review Field Record"}
        </Button>
      </StagePanel>

      {/* ── Step 2: Photo Curation ────────────────────────────────────── */}
      <StagePanel
        index={2}
        title={STEPS[1].title}
        summary={STEPS[1].summary}
        isComplete={s2Complete}
        isActive={activeStages.has(1)}
        isLocked={isStepLocked(1)}
        isOpen={openStages.has(1)}
        onToggle={() => toggle(1)}
      >
        <ExhibitManifest
          inspectionId={inspectionId}
          isFinalized={curation?.isFinalized ?? false}
        />
      </StagePanel>

      {/* ── Step 3: Estimate ─────────────────────────────────────────── */}
      <StagePanel
        index={3}
        title={STEPS[2].title}
        summary={STEPS[2].summary}
        isComplete={s3Complete}
        isActive={activeStages.has(2)}
        isLocked={isStepLocked(2)}
        isOpen={openStages.has(2)}
        onToggle={() => toggle(2)}
      >
        <EstimatePanel inspectionId={inspectionId} />
      </StagePanel>

      {/* ── Step 4: AI Report Sections ───────────────────────────────── */}
      <StagePanel
        index={4}
        title={STEPS[3].title}
        summary={STEPS[3].summary}
        isComplete={s4Complete}
        isActive={activeStages.has(3)}
        isLocked={isStepLocked(3)}
        isOpen={openStages.has(3)}
        onToggle={() => toggle(3)}
      >
        {/* ── AI Briefing card ─────────────────────────────────────────── */}
        <div
          className={cn(
            "rounded-md border p-3 space-y-2",
            hasSummary
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30"
              : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {hasSummary ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              )}
              <p className="text-xs font-semibold truncate">
                {hasSummary ? "AI Briefing Ready" : "AI Briefing Required"}
              </p>
            </div>
            {hasSummary ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] shrink-0 text-muted-foreground"
                disabled={generateSummary.isPending}
                onClick={() =>
                  generateSummary.mutate(
                    {},
                    {
                      onSuccess: () => toast({ title: "Briefing regenerated" }),
                      onError: (err) =>
                        toast({
                          title: "Regeneration failed",
                          description:
                            err instanceof Error ? err.message : "Please try again.",
                          variant: "destructive",
                        }),
                    },
                  )
                }
              >
                {generateSummary.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                {generateSummary.isPending ? "…" : "Regenerate"}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs shrink-0"
                disabled={generateSummary.isPending || !readiness?.overallPass}
                onClick={() =>
                  generateSummary.mutate(
                    {},
                    {
                      onSuccess: () =>
                        toast({
                          title: "AI briefing generated",
                          description: "You can now generate report sections.",
                        }),
                      onError: (err) =>
                        toast({
                          title: "Briefing generation failed",
                          description:
                            err instanceof Error ? err.message : "Please try again.",
                          variant: "destructive",
                        }),
                    },
                  )
                }
              >
                {generateSummary.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Bot className="h-3 w-3 mr-1.5" />
                    Generate Briefing
                  </>
                )}
              </Button>
            )}
          </div>
          {hasSummary && aiSummaryData?.forensicSummary && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {aiSummaryData.forensicSummary.slice(0, 220)}
              {aiSummaryData.forensicSummary.length > 220 ? "…" : ""}
            </p>
          )}
          {!hasSummary && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              The AI briefing feeds all seven report sections and is required
              before compiling. Generate it first, then use "Generate All
              Ready."
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Sections locked</span>
            <span className="font-medium">
              {lockedCount} / {SECTION_ORDER.length}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{
                width: `${(lockedCount / SECTION_ORDER.length) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Readiness gate warning */}
        {readiness && !readiness.overallPass && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-xs">
              Stage readiness must pass before generating sections.
            </p>
          </div>
        )}

        {/* Generate All Ready button */}
        {showGenerateAllReady && (
          <Button
            size="sm"
            variant="secondary"
            disabled={generatingAll}
            onClick={handleGenerateAll}
            className="w-full"
          >
            {generatingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
            ) : (
              <Zap className="h-3.5 w-3.5 mr-2" />
            )}
            {generatingAll
              ? `Generating ${notStartedIndependent.length} section(s)…`
              : `Generate All Ready (${notStartedIndependent.length})`}
          </Button>
        )}

        {loadingSections ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {SECTION_ORDER.map((sType) => {
              const section = sections.find((s) => s.sectionType === sType) ?? {
                sectionType: sType,
                state: "not_started" as const,
              };
              return (
                <SectionCard
                  key={sType}
                  section={section}
                  allSections={sections}
                  inspectionId={inspectionId}
                  briefingReady={hasSummary}
                />
              );
            })}
          </div>
        )}
      </StagePanel>

      {/* ── Step 5: Compile & Attest ──────────────────────────────────── */}
      <StagePanel
        index={5}
        title={STEPS[4].title}
        summary={STEPS[4].summary}
        isComplete={s5Complete}
        isActive={activeStages.has(4)}
        isLocked={isStepLocked(4)}
        isOpen={openStages.has(4)}
        onToggle={() => toggle(4)}
      >
        {/* Jurisdiction pack warning — compile will 422 without one */}
        {jurPackMissing && (
          <div className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <div className="space-y-1 min-w-0">
              <p className="text-xs font-medium text-destructive">
                No Building Regulation pack for{" "}
                <span className="font-mono">{propertyState}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Compile will fail until a matching jurisdiction pack exists.{" "}
                <a
                  href="/settings"
                  className="underline text-primary hover:text-primary/80"
                >
                  Open Settings to add one →
                </a>
              </p>
            </div>
          </div>
        )}

        {/* Unlocked sections list */}
        {hasRealSections && !allSectionsLocked && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3 space-y-1">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              Sections still unlocked:
            </p>
            {sections
              .filter((s) => s.state !== "locked")
              .map((s) => (
                <div
                  key={s.sectionType}
                  className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"
                >
                  <XCircle className="h-3 w-3" />
                  {SECTION_META[s.sectionType]?.label ?? s.sectionType}
                  <span className="text-[10px] opacity-70">({s.state})</span>
                </div>
              ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    disabled={!canCompile}
                    onClick={() =>
                      compileReport.mutate(undefined, {
                        onSuccess: (result) =>
                          toast({
                            title: "Package compiled",
                            description: `Lint: ${result.lintStatus}.`,
                          }),
                        onError: (err) =>
                          toast({
                            title: "Compile failed",
                            description:
                              err instanceof Error
                                ? err.message
                                : "Compile failed.",
                            variant: "destructive",
                          }),
                      })
                    }
                  >
                    {compileReport.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Package className="h-4 w-4 mr-2" />
                    )}
                    {compileReport.isPending ? "Compiling…" : "Compile"}
                  </Button>
                </span>
              </TooltipTrigger>
              {!canCompile && (
                <TooltipContent className="text-xs">
                  {!hasSummary
                    ? "Generate the AI briefing in step 4 before compiling."
                    : "Lock all sections before compiling."}
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          {/* Attestation button */}
          {isAttested ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900 dark:text-emerald-300 px-3 py-1.5 text-xs font-medium flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Report Attested
            </Badge>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      disabled={!canAttest}
                      onClick={() => {
                        setAttestAcknowledged(false);
                        setAttestDialogOpen(true);
                      }}
                    >
                      {loadingAttestation ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Lock className="h-4 w-4 mr-2" />
                      )}
                      Attest &amp; Sign Report
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canAttest && (
                  <TooltipContent className="text-xs">
                    {!pkgCompiled
                      ? "Compile the report before attesting."
                      : "Loading attestation status…"}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Compiled version list */}
        {compiledVersions.length > 0 && (
          <div className="rounded-lg border divide-y divide-border/50">
            {[...compiledVersions].reverse().map((version, idx) => (
              <div
                key={version.path}
                className="flex items-center justify-between px-3 py-2.5"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    Version {compiledVersions.length - idx}
                    {idx === 0 && (
                      <span className="ml-2 text-[10px] text-emerald-600 font-semibold">
                        LATEST
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {version.compiledAt && (
                      <span>
                        {format(
                          new Date(version.compiledAt),
                          "MMM d, yyyy 'at' h:mm a",
                        )}
                      </span>
                    )}
                    {version.lintStatus && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          version.lintStatus === "passed" &&
                            "border-emerald-500 text-emerald-600",
                          version.lintStatus === "blocked" &&
                            "border-red-500 text-red-600",
                        )}
                      >
                        {version.lintStatus}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      window.open(
                        `/api/inspections/${inspectionId}/report/preview-url?versionIndex=${compiledVersions.length - 1 - idx}`,
                        "_blank",
                      )
                    }
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      window.open(
                        `/api/inspections/${inspectionId}/report/download?versionIndex=${compiledVersions.length - 1 - idx}`,
                        "_blank",
                      )
                    }
                  >
                    <Download className="h-3 w-3 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </StagePanel>

      {/* ── Step 6: Deliver ───────────────────────────────────────────── */}
      <StagePanel
        index={6}
        title={STEPS[5].title}
        summary={STEPS[5].summary}
        isComplete={s6Complete}
        isActive={activeStages.has(5)}
        isLocked={isStepLocked(5)}
        isOpen={openStages.has(5)}
        onToggle={() => toggle(5)}
      >
        {s6Complete ? (
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-sm font-medium">Package delivered</p>
          </div>
        ) : (
          <div className="space-y-3">
            {!s5Complete && (
              <div className="flex items-start gap-2 p-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-xs">
                  Compile and attest the report before delivering.
                </p>
              </div>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      disabled={!s5Complete || deliverPackage.isPending}
                      onClick={() =>
                        deliverPackage.mutate(undefined, {
                          onSuccess: () =>
                            toast({
                              title: "Package delivered",
                              description:
                                "The compiled package has been delivered.",
                            }),
                          onError: (err) =>
                            toast({
                              title: "Delivery failed",
                              description:
                                err instanceof Error
                                  ? err.message
                                  : "Could not deliver.",
                              variant: "destructive",
                            }),
                        })
                      }
                    >
                      {deliverPackage.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Truck className="h-4 w-4 mr-2" />
                      )}
                      {deliverPackage.isPending ? "Delivering…" : "Deliver Package"}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!s5Complete && (
                  <TooltipContent className="text-xs">
                    Compile and attest the report before delivering.
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </StagePanel>

      {/* ── Step 7: Supplements ───────────────────────────────────────── */}
      {s6Complete && (
        <div className="rounded-lg border border-dashed border-border p-4 mt-2">
          <SupplementsPanel inspectionId={inspectionId} />
        </div>
      )}

      {/* ── Field Review Modal ────────────────────────────────────────── */}
      <FieldReviewModal
        open={reviewModalOpen}
        onOpenChange={setReviewModalOpen}
        inspection={inspection}
        readiness={readiness}
        alreadyReviewed={s1Complete}
        isRecording={recordEvent.isPending}
        onReviewed={() => {
          if (s1Complete) {
            setReviewModalOpen(false);
            return;
          }
          recordEvent.mutate(
            { eventType: "field_record_reviewed" },
            {
              onSuccess: () => {
                setReviewModalOpen(false);
                toast({
                  title: "Field record reviewed",
                  description:
                    "Step 1 complete. Photo Curation and Estimate are now unlocked.",
                });
              },
              onError: (err) =>
                toast({
                  title: "Could not save review",
                  description:
                    err instanceof Error ? err.message : "Unknown error.",
                  variant: "destructive",
                }),
            },
          );
        }}
      />

      {/* ── Attestation dialog ────────────────────────────────────────── */}
      <Dialog
        open={attestDialogOpen}
        onOpenChange={(open) => {
          if (!attestReport.isPending) setAttestDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Attest &amp; Sign Report</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Review the statement below. By checking the box and submitting you
              personally authorize this package for delivery.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/40 p-4 text-sm leading-relaxed text-foreground">
            {attestationData?.attested === false && attestationData.statementText ? (
              <p>{attestationData.statementText}</p>
            ) : (
              <p className="text-muted-foreground italic">Loading statement…</p>
            )}
          </div>

          <div className="flex items-start gap-3 pt-1">
            <Checkbox
              id="wizard-attest-ack"
              checked={attestAcknowledged}
              onCheckedChange={(v) => setAttestAcknowledged(v === true)}
              disabled={attestReport.isPending}
            />
            <label
              htmlFor="wizard-attest-ack"
              className="text-sm leading-snug cursor-pointer select-none"
            >
              I confirm the above statement is accurate and I authorize delivery
              of this compiled package.
            </label>
          </div>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              onClick={() => setAttestDialogOpen(false)}
              disabled={attestReport.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={!attestAcknowledged || attestReport.isPending}
              onClick={() =>
                attestReport.mutate(undefined, {
                  onSuccess: () => {
                    setAttestDialogOpen(false);
                    toast({
                      title: "Report attested",
                      description:
                        "The package is now authorized for delivery.",
                    });
                  },
                  onError: (err) =>
                    toast({
                      title: "Attestation failed",
                      description:
                        err instanceof Error
                          ? err.message
                          : "Attestation failed.",
                      variant: "destructive",
                    }),
                })
              }
            >
              {attestReport.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Lock className="h-4 w-4 mr-2" />
              )}
              {attestReport.isPending ? "Signing…" : "Sign Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
