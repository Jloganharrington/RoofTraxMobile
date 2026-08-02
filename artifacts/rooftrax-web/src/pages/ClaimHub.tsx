/**
 * Claim Hub — unified tabbed view for a single claim (inspection).
 * Replaces the old split Summary/Estimate pages as the primary claim surface.
 * Tabs: Overview | AI Sections | Estimate | Package
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import { useGetInspection, getGetInspectionQueryKey } from "@workspace/api-client-react";
import { Shell } from "@/components/layout/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Package,
  Loader2,
  FileText,
  Download,
  Lock,
  Zap,
  RotateCcw,
  Camera,
  ExternalLink,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EstimatePanel } from "@/pages/inspections/EstimatePanel";
import {
  useGetReadiness,
  useGetSections,
  useGetEvents,
  useGenerateSection,
  useApproveSection,
  useLockSection,
  useCompileReport,
  useGetReportAttestation,
  useAttestReport,
  type SectionType,
  type ClaimSection,
  type ReadinessItem,
} from "@/lib/claimHubApi";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabId = "overview" | "sections" | "estimate" | "package";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sections", label: "AI Sections" },
  { id: "estimate", label: "Estimate" },
  { id: "package", label: "Package" },
];

const SECTION_META: Record<
  SectionType,
  { label: string; upstream: SectionType[]; hasRapFallbackGate?: boolean; hasCausationGate?: boolean; hasComparisonGate?: boolean }
> = {
  findings:               { label: "Findings",               upstream: [],                                                    hasComparisonGate: true },
  causation:              { label: "Causation",              upstream: ["findings"],                                           hasCausationGate: true },
  detriment_application:  { label: "Detriment Application",  upstream: ["causation"],                                          hasCausationGate: true },
  rap_narrative:          { label: "RAP Narrative",          upstream: [],                                                    hasRapFallbackGate: true },
  estimate_justifications: { label: "Estimate Justifications", upstream: [] },
  summary_of_findings:    { label: "Summary of Findings",   upstream: ["findings", "causation", "detriment_application", "rap_narrative", "estimate_justifications"] },
  closing_statement:      { label: "Closing Statement",     upstream: ["summary_of_findings"] },
};

const SECTION_ORDER: SectionType[] = [
  "findings",
  "causation",
  "detriment_application",
  "rap_narrative",
  "estimate_justifications",
  "summary_of_findings",
  "closing_statement",
];

const STATE_BADGE: Record<string, { label: string; className: string }> = {
  not_started: { label: "Not Started",  className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  generating:  { label: "Generating…", className: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300" },
  generated:   { label: "Generated",   className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300" },
  in_review:   { label: "In Review",   className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" },
  approved:    { label: "Approved",    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  locked:      { label: "Locked",      className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
};

// ---------------------------------------------------------------------------
// Package status derivation
// ---------------------------------------------------------------------------

interface CompiledVersion {
  path: string;
  compiledAt: string;
  schemaVersion?: number;
  lintStatus?: "passed" | "needs_review" | "blocked";
}

type PackageStatus = "none" | "drafting" | "compiled";

function derivePackageStatus(inspection: Record<string, unknown>): PackageStatus {
  const versions = (inspection.compiledReportVersions as CompiledVersion[] | undefined) ?? [];
  if (versions.length > 0) return "compiled";
  if (inspection.status === "validating") return "drafting";
  return "none";
}

const PKG_BADGE: Record<PackageStatus, { label: string; className: string }> = {
  none:     { label: "No Package", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  drafting: { label: "Drafting",   className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  compiled: { label: "Compiled",   className: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
};

// ---------------------------------------------------------------------------
// Readiness item row
// ---------------------------------------------------------------------------

function ReadinessRow({ item }: { item: ReadinessItem }) {
  const icon =
    item.state === "pass" ? (
      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
    ) : item.state === "warning" ? (
      <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
    ) : (
      <XCircle className="h-4 w-4 text-destructive shrink-0" />
    );

  return (
    <div className="flex items-start gap-2.5 py-2 border-b last:border-0">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{item.label}</p>
        {item.detail && (
          <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function SectionCard({
  section,
  allSections,
  inspectionId,
}: {
  section: ClaimSection;
  allSections: ClaimSection[];
  inspectionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [causationConfirmed, setCausationConfirmed] = useState(false);
  const [rapFallbackConfirmed, setRapFallbackConfirmed] = useState(false);

  const { toast } = useToast();
  const generateSection = useGenerateSection(inspectionId);
  const approveSection = useApproveSection(inspectionId);
  const lockSection = useLockSection(inspectionId);

  const meta = SECTION_META[section.sectionType];
  const stateBadge = STATE_BADGE[section.state] ?? STATE_BADGE.not_started;

  // Check upstream sections are all approved or locked
  const upstreamReady = meta.upstream.every((upstreamType) => {
    const upstream = allSections.find((s) => s.sectionType === upstreamType);
    return upstream?.state === "approved" || upstream?.state === "locked";
  });

  // Can the approve button be clicked?
  const canApprove = (() => {
    if (section.state !== "generated" && section.state !== "in_review") return false;
    if (meta.hasCausationGate && !causationConfirmed) return false;
    if (meta.hasRapFallbackGate && section.rapMode === "fallback_slope" && !rapFallbackConfirmed) return false;
    return true;
  })();

  const handleGenerate = () => {
    generateSection.mutate(section.sectionType, {
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Generation not yet available.";
        toast({ title: "Generate failed", description: message, variant: "destructive" });
      },
    });
  };

  const handleApprove = () => {
    approveSection.mutate(
      {
        sectionType: section.sectionType,
        causationReviewConfirmed: meta.hasCausationGate ? causationConfirmed : undefined,
        rapFallbackConfirmed: meta.hasRapFallbackGate ? rapFallbackConfirmed : undefined,
      },
      {
        onSuccess: () => toast({ title: `${meta.label} approved` }),
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : "Approve failed.";
          toast({ title: "Approve failed", description: message, variant: "destructive" });
        },
      },
    );
  };

  const handleLock = () => {
    lockSection.mutate(section.sectionType, {
      onSuccess: () => toast({ title: `${meta.label} locked` }),
      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : "Lock failed.";
        toast({ title: "Lock failed", description: message, variant: "destructive" });
      },
    });
  };

  const isLocked = section.state === "locked";

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className={cn(isLocked && "opacity-80")}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {isLocked ? (
                  <Lock className="h-4 w-4 text-green-600 shrink-0" />
                ) : (
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                      !expanded && "-rotate-90",
                    )}
                  />
                )}
                <CardTitle className="text-sm">{meta.label}</CardTitle>
                <span
                  className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                    stateBadge.className,
                  )}
                >
                  {stateBadge.label}
                </span>
              </div>

              {/* Actions (non-interactive, stop propagation) */}
              <div
                className="flex items-center gap-2 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                {(section.state === "not_started" || section.state === "generated" || section.state === "in_review") && !isLocked && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    disabled={generateSection.isPending || !upstreamReady}
                    onClick={handleGenerate}
                  >
                    {generateSection.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : section.state === "not_started" ? (
                      <Zap className="h-3 w-3 mr-1" />
                    ) : (
                      <RotateCcw className="h-3 w-3 mr-1" />
                    )}
                    {section.state === "not_started" ? "Generate" : "Regenerate"}
                  </Button>
                )}

                {section.state === "approved" && (
                  <Button
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    disabled={lockSection.isPending}
                    onClick={handleLock}
                  >
                    <Lock className="h-3 w-3 mr-1" />
                    Lock
                  </Button>
                )}
              </div>
            </div>

            {/* Upstream dependency note */}
            {!upstreamReady && section.state === "not_started" && meta.upstream.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1 ml-6">
                Requires{" "}
                {meta.upstream
                  .map((u) => SECTION_META[u].label)
                  .join(" + ")}{" "}
                to be approved first.
              </p>
            )}
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Content preview */}
            {section.content ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none border rounded-md p-3 bg-muted/20 text-sm"
                dangerouslySetInnerHTML={{ __html: section.content }}
              />
            ) : (
              <div className="border rounded-md p-4 bg-muted/10 text-center text-sm text-muted-foreground">
                {section.state === "not_started"
                  ? "No content yet. Click Generate to draft this section."
                  : "Generating…"}
              </div>
            )}

            {/* Hard gate checkboxes */}
            {!isLocked && (
              <div className="space-y-2">
                {/* Findings: comparison photo gate (disabled placeholder) */}
                {meta.hasComparisonGate && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 opacity-50 cursor-not-allowed">
                          <Checkbox id={`${section.sectionType}-comparison`} disabled />
                          <label
                            htmlFor={`${section.sectionType}-comparison`}
                            className="text-xs text-muted-foreground cursor-not-allowed"
                          >
                            Requires photo curation (upcoming)
                          </label>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-60 text-xs">
                        The comparison photo gate will be enabled once the Photo Curation
                        feature lands. Findings can still be approved without it if no
                        comparison set is needed.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {/* Causation / Detriment: reviewer confirmation */}
                {meta.hasCausationGate &&
                  (section.state === "generated" || section.state === "in_review") && (
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id={`${section.sectionType}-causation`}
                        checked={causationConfirmed}
                        onCheckedChange={(v) => setCausationConfirmed(!!v)}
                      />
                      <label
                        htmlFor={`${section.sectionType}-causation`}
                        className="text-xs leading-relaxed cursor-pointer"
                      >
                        I confirm the causation content was reviewed against the attested
                        field record.
                      </label>
                    </div>
                  )}

                {/* RAP Narrative: fallback slope confirmation */}
                {meta.hasRapFallbackGate &&
                  section.rapMode === "fallback_slope" &&
                  (section.state === "generated" || section.state === "in_review") && (
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id={`${section.sectionType}-rap-fallback`}
                        checked={rapFallbackConfirmed}
                        onCheckedChange={(v) => setRapFallbackConfirmed(!!v)}
                      />
                      <label
                        htmlFor={`${section.sectionType}-rap-fallback`}
                        className="text-xs leading-relaxed cursor-pointer"
                      >
                        I confirm the RAP fallback slope narrative is appropriate for this
                        claim.
                      </label>
                    </div>
                  )}

                {/* Approve button */}
                {(section.state === "generated" || section.state === "in_review") && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canApprove || approveSection.isPending}
                    onClick={handleApprove}
                    className="mt-1"
                  >
                    {approveSection.isPending && (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    )}
                    Approve
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ClaimHub() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const { toast } = useToast();

  const { data: inspectionEnv, isLoading: isInspectionLoading } = useGetInspection(id, {
    query: { enabled: !!id, queryKey: getGetInspectionQueryKey(id) },
  });

  const { data: readinessData, isLoading: isReadinessLoading } = useGetReadiness(id);
  const { data: sectionsData, isLoading: isSectionsLoading } = useGetSections(id);
  const { data: eventsData } = useGetEvents(id);
  const compileReport = useCompileReport(id);

  // Variant B attestation state
  const [attestDialogOpen, setAttestDialogOpen] = useState(false);
  const [attestAcknowledged, setAttestAcknowledged] = useState(false);
  const { data: attestationData, isLoading: isAttestationLoading } = useGetReportAttestation(id);
  const attestReport = useAttestReport(id);

  const inspection = inspectionEnv?.inspection as (Record<string, unknown> & { address?: string | null; status?: string; compiledReportVersions?: CompiledVersion[] }) | undefined;
  const readiness = readinessData;
  const sections = sectionsData?.sections ?? [];
  const events = eventsData?.events ?? [];

  if (isInspectionLoading) {
    return (
      <Shell>
        <div className="space-y-4 max-w-5xl mx-auto">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Shell>
    );
  }

  if (!inspection) {
    return (
      <Shell>
        <div className="text-sm text-muted-foreground">Inspection not found.</div>
      </Shell>
    );
  }

  const pkgStatus = derivePackageStatus(inspection);
  const pkgBadge = PKG_BADGE[pkgStatus];
  const compiledVersions = (inspection.compiledReportVersions ?? []) as CompiledVersion[];
  const allSectionsLocked = sections.length > 0 && sections.every((s) => s.state === "locked");
  // A section is "real" only once it has progressed past the initial stub state.
  // When the generation pipeline (Task #122) hasn't landed yet all sections are
  // not_started stubs — in that case there is no meaningful gate to enforce and
  // compile should be allowed.
  const hasRealSections = sections.some((s) => s.state !== "not_started");
  const canCompile = !compileReport.isPending && (!hasRealSections || allSectionsLocked);

  return (
    <Shell>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Breadcrumb + header */}
        <div>
          <Link
            href="/pipeline"
            className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 mb-3 w-fit"
          >
            <ArrowLeft className="h-4 w-4" /> Pipeline
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {String(inspection.address ?? "Unknown address")}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className="text-xs capitalize">
                  {String(inspection.status ?? "")}
                </Badge>
                <span
                  className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                    pkgBadge.className,
                  )}
                >
                  <Package className="h-2.5 w-2.5 inline mr-1" />
                  {pkgBadge.label}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b">
          <nav className="flex gap-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                  activeTab === tab.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* OVERVIEW TAB                                                      */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Property details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Property Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    ["Address", inspection.address],
                    ["Status", inspection.status],
                    ["Phase", inspection.phase],
                    ["Damage Type", inspection.damageType],
                    ["Date of Loss", inspection.dateOfLoss ? format(new Date(String(inspection.dateOfLoss)), "MMM d, yyyy") : null],
                    ["Created", inspection.createdAt ? format(new Date(String(inspection.createdAt)), "MMM d, yyyy") : null],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={String(label)} className="flex justify-between text-sm py-1 border-b last:border-0">
                        <span className="text-muted-foreground">{String(label)}</span>
                        <span className="font-medium capitalize text-right max-w-56 truncate">
                          {String(value).replace(/_/g, " ")}
                        </span>
                      </div>
                    ) : null,
                  )}
                </CardContent>
              </Card>

              {/* Stage 0 readiness */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Stage 0 Readiness</CardTitle>
                  <CardDescription className="text-xs">
                    {readiness
                      ? readiness.overallPass
                        ? "All checks passed — ready to generate."
                        : "Some checks need attention before generating."
                      : "Checking readiness…"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isReadinessLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : readiness ? (
                    readiness.items.map((item) => (
                      <ReadinessRow key={item.key} item={item} />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Unable to load readiness.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right column */}
            <div className="space-y-6">
              {/* Asset checklist */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Asset Checklist</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {readiness?.items
                    .filter((i) =>
                      [
                        "field_record_attested",
                        "measurement_report",
                        "storm_data",
                        "rap_record",
                      ].includes(i.key),
                    )
                    .map((item) => (
                      <div key={item.key} className="flex items-center gap-2 text-sm py-1 border-b last:border-0">
                        {item.state === "pass" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={item.state !== "pass" ? "text-muted-foreground" : ""}>
                          {item.label}
                        </span>
                      </div>
                    )) ?? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  )}
                </CardContent>
              </Card>

              {/* Event timeline */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Claim Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  {events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No events recorded yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {events.slice(0, 10).map((ev) => (
                        <div key={ev.id} className="flex gap-2 text-xs">
                          <Clock className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium capitalize">
                              {ev.eventType.replace(/_/g, " ")}
                            </p>
                            <p className="text-muted-foreground">
                              {ev.createdAt
                                ? formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })
                                : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* AI SECTIONS TAB                                                   */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === "sections" && (
          <div className="space-y-4">
            {/* Readiness gate banner */}
            {readiness && !readiness.overallPass && (
              <div className="flex items-start gap-2 p-3 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Stage 0 not ready</p>
                  <p className="text-xs mt-0.5">
                    {readiness.items
                      .filter((i) => i.state === "fail")
                      .map((i) => i.label)
                      .join(", ")}{" "}
                    must be resolved before generating.
                  </p>
                </div>
              </div>
            )}

            {isSectionsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : (
              SECTION_ORDER.map((sType) => {
                const section: ClaimSection = sections.find((s) => s.sectionType === sType) ?? {
                  sectionType: sType,
                  state: "not_started",
                };
                return (
                  <SectionCard
                    key={sType}
                    section={section}
                    allSections={sections}
                    inspectionId={id}
                  />
                );
              })
            )}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* ESTIMATE TAB                                                      */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === "estimate" && (
          <EstimatePanel inspectionId={id} />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* PACKAGE TAB                                                       */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === "package" && (
          <div className="space-y-6">
            {/* Compile card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Compile Package</CardTitle>
                <CardDescription className="text-xs">
                  All sections must be locked before compiling.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Section lock status — only shown once real sections exist */}
                {hasRealSections && !allSectionsLocked && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Sections still unlocked:</p>
                    {sections
                      .filter((s) => s.state !== "locked")
                      .map((s) => (
                        <div key={s.sectionType} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <XCircle className="h-3 w-3 text-destructive" />
                          {SECTION_META[s.sectionType]?.label ?? s.sectionType}
                          <span className="text-[10px]">({s.state})</span>
                        </div>
                      ))}
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            disabled={!canCompile}
                            onClick={() =>
                              compileReport.mutate(undefined, {
                                onSuccess: (result) => {
                                  toast({
                                    title: "Package compiled",
                                    description: `Lint status: ${result.lintStatus}.`,
                                  });
                                },
                                onError: (err) => {
                                  const message = err instanceof Error ? err.message : "Compile failed.";
                                  toast({ title: "Compile failed", description: message, variant: "destructive" });
                                },
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
                      {(!allSectionsLocked || sections.length === 0) && (
                        <TooltipContent className="text-xs">
                          Lock all sections before compiling.
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>

                  {/* Supplement placeholder */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button variant="outline" disabled>
                            Issue Supplement
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        Supplement workflow — coming in a future release.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {/* Attestation (Variant B) */}
                  {(() => {
                    const isAttested = attestationData?.attested === true;
                    const canAttest =
                      pkgStatus === "compiled" && !isAttested && !isAttestationLoading && !attestReport.isPending;
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              {isAttested ? (
                                <Badge className="bg-green-100 text-green-700 border-green-300 dark:bg-green-900 dark:text-green-300 px-3 py-1.5 text-xs font-medium flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Report Attested
                                </Badge>
                              ) : (
                                <Button
                                  variant="outline"
                                  disabled={!canAttest}
                                  onClick={() => {
                                    setAttestAcknowledged(false);
                                    setAttestDialogOpen(true);
                                  }}
                                >
                                  {isAttestationLoading ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  ) : (
                                    <Lock className="h-4 w-4 mr-2" />
                                  )}
                                  Attest &amp; Sign Report
                                </Button>
                              )}
                            </span>
                          </TooltipTrigger>
                          {!canAttest && !isAttested && (
                            <TooltipContent className="text-xs">
                              {pkgStatus !== "compiled"
                                ? "Compile the report before attesting."
                                : "Loading attestation status…"}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>

            {/* Version history */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Compiled Versions</CardTitle>
                <CardDescription className="text-xs">
                  Previous compilations are archived and remain accessible.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {compiledVersions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No versions compiled yet.</p>
                ) : (
                  <div className="space-y-2">
                    {compiledVersions
                      .slice()
                      .reverse()
                      .map((version, idx) => (
                        <div
                          key={version.path}
                          className="flex items-center justify-between py-2 border-b last:border-0"
                        >
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium">
                              Version {compiledVersions.length - idx}
                              {idx === 0 && (
                                <span className="ml-2 text-[10px] text-green-600 font-semibold">
                                  LATEST
                                </span>
                              )}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {version.compiledAt && (
                                <span>
                                  {format(new Date(version.compiledAt), "MMM d, yyyy 'at' h:mm a")}
                                </span>
                              )}
                              {version.schemaVersion && (
                                <Badge variant="secondary" className="text-[10px]">
                                  v{version.schemaVersion}
                                </Badge>
                              )}
                              {version.lintStatus && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px]",
                                    version.lintStatus === "passed" && "border-green-500 text-green-600",
                                    version.lintStatus === "blocked" && "border-red-500 text-red-600",
                                  )}
                                >
                                  {version.lintStatus}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                window.open(
                                  `/api/inspections/${id}/report/preview-url?versionIndex=${compiledVersions.length - 1 - idx}`,
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
                                  `/api/inspections/${id}/report/download?versionIndex=${compiledVersions.length - 1 - idx}`,
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
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Variant B Attestation Dialog */}
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

          {/* Statement block */}
          <div className="rounded-md border bg-muted/40 p-4 text-sm leading-relaxed text-foreground">
            {attestationData?.attested === false && attestationData.statementText ? (
              <p>{attestationData.statementText}</p>
            ) : (
              <p className="text-muted-foreground italic">Loading statement…</p>
            )}
          </div>

          {/* Acknowledgement checkbox */}
          <div className="flex items-start gap-3 pt-1">
            <Checkbox
              id="attest-acknowledged"
              checked={attestAcknowledged}
              onCheckedChange={(v) => setAttestAcknowledged(v === true)}
              disabled={attestReport.isPending}
            />
            <label
              htmlFor="attest-acknowledged"
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
                      description: "The package is now authorized for delivery.",
                    });
                  },
                  onError: (err) => {
                    const message =
                      err instanceof Error ? err.message : "Attestation failed.";
                    toast({
                      title: "Attestation failed",
                      description: message,
                      variant: "destructive",
                    });
                  },
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
    </Shell>
  );
}
