/**
 * InspectionFlowWizard — full inline inspection workflow for the Lead Profile
 * Inspection tab. Covers Stages 0-6: Readiness → Field Capture → Photo Curation
 * → AI Sections → Estimate → Compile & Attest → Submit.
 */
import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  useGetInspection,
  getGetInspectionQueryKey,
  useGetInspectionEstimate,
  getGetInspectionEstimateQueryKey,
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
  Send,
  CheckCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useGetReadiness,
  useGetSections,
  useGetReportAttestation,
  useAttestReport,
  useCompileReport,
  useSubmitClaim,
  type ReadinessItem,
} from "@/lib/claimHubApi";
import { useGetCuration } from "@/lib/curationApi";
import {
  SectionCard,
  SECTION_ORDER,
  SECTION_META,
} from "@/components/inspection/SectionCard";
import { EstimatePanel } from "@/pages/inspections/EstimatePanel";

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
    scheduledFor?: string | null;
    compiledReportVersions?: CompiledVersion[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// StagePanel
// ---------------------------------------------------------------------------

function StageIndicator({
  index,
  isComplete,
  isActive,
}: {
  index: number;
  isComplete: boolean;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
        isComplete
          ? "border-emerald-500 bg-emerald-500 text-white"
          : isActive
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-muted text-muted-foreground",
      )}
    >
      {isComplete ? <CheckCheck className="h-3.5 w-3.5" /> : index}
    </div>
  );
}

function StagePanel({
  index,
  title,
  summary,
  isComplete,
  isActive,
  isOpen,
  onToggle,
  children,
}: {
  index: number;
  title: string;
  summary?: string;
  isComplete: boolean;
  isActive: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        isActive && !isComplete && "border-primary/40 bg-card",
        isComplete && "border-emerald-200 dark:border-emerald-900/40 bg-card",
        !isActive && !isComplete && "border-border bg-muted/20",
      )}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left"
        type="button"
      >
        <StageIndicator index={index} isComplete={isComplete} isActive={isActive} />
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm font-semibold leading-tight",
              !isActive && !isComplete && "text-muted-foreground",
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
        <svg
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
            !isOpen && "-rotate-90",
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isOpen && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3">{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readiness item row (Stage 0 + Stage 1)
// ---------------------------------------------------------------------------

function ReadinessRow({ item }: { item: ReadinessItem }) {
  const icon =
    item.state === "pass" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
    ) : item.state === "warning" ? (
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
    ) : (
      <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
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
// Main wizard
// ---------------------------------------------------------------------------

export function InspectionFlowWizard({
  inspectionId,
}: {
  inspectionId: string;
}) {
  const { toast } = useToast();

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

  const inspection = (inspectionEnv as InspEnv | undefined)?.inspection;
  const compiledVersions = inspection?.compiledReportVersions ?? [];
  const sections = sectionsData?.sections ?? [];
  const curation = curationData;

  const compileReport = useCompileReport(inspectionId);
  const attestReport = useAttestReport(inspectionId);
  const submitClaim = useSubmitClaim(inspectionId);

  // ── Attestation dialog ───────────────────────────────────────────────────
  const [attestDialogOpen, setAttestDialogOpen] = useState(false);
  const [attestAcknowledged, setAttestAcknowledged] = useState(false);

  // ── Stage completion ─────────────────────────────────────────────────────
  const s0Complete = readiness?.overallPass === true;
  const s1Complete = s0Complete;
  const s2Complete =
    curation?.isFinalized === true &&
    (curation.captions.length === 0 ||
      curation.captions.every((c) => c.state === "locked"));
  const s3Complete = SECTION_ORDER.every((t) =>
    sections.some((s) => s.sectionType === t && s.state === "locked"),
  );
  const s4Complete = (estimateEnv?.estimate?.lines?.length ?? 0) > 0;
  const s5Complete =
    compiledVersions.length > 0 && attestationData?.attested === true;
  const s6Complete = inspection?.status === "submitted";

  const stageComplete = [
    s0Complete,
    s1Complete,
    s2Complete,
    s3Complete,
    s4Complete,
    s5Complete,
    s6Complete,
  ];

  // ── Active stage + open state ────────────────────────────────────────────
  const activeStageIndex = stageComplete.findIndex((c) => !c);
  const effectiveActive = activeStageIndex === -1 ? 6 : activeStageIndex;

  const [openStages, setOpenStages] = useState<Set<number>>(
    () => new Set([effectiveActive]),
  );

  // When active stage changes (data loads), auto-open it but don't close anything
  useEffect(() => {
    if (effectiveActive >= 0) {
      setOpenStages((prev) => {
        if (prev.has(effectiveActive)) return prev;
        const next = new Set(prev);
        next.add(effectiveActive);
        return next;
      });
    }
  }, [effectiveActive]);

  const toggle = (i: number) =>
    setOpenStages((prev) => {
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
    !compileReport.isPending && (!hasRealSections || allSectionsLocked);

  const pkgCompiled = compiledVersions.length > 0;
  const isAttested = attestationData?.attested === true;
  const canAttest =
    pkgCompiled && !isAttested && !loadingAttestation && !attestReport.isPending;

  const assignedCount = curation?.selections.filter((s) => s.exhibitClass).length ?? 0;
  const captionLockedCount = curation?.captions.filter((c) => c.state === "locked").length ?? 0;

  // ── Stage definitions ────────────────────────────────────────────────────
  const STAGES = [
    {
      title: "Readiness",
      summary: s0Complete
        ? "All checks passed"
        : readiness
          ? `${readiness.items.filter((i) => i.state === "fail").length} check(s) need attention`
          : undefined,
    },
    {
      title: "Field Capture",
      summary: s1Complete ? "Field record complete" : "Waiting on field data",
    },
    {
      title: "Photo Curation",
      summary: s2Complete
        ? "Curation finalized"
        : assignedCount > 0
          ? `${assignedCount} exhibit(s) assigned, ${captionLockedCount} caption(s) locked`
          : "Not started",
    },
    {
      title: "AI Report Sections",
      summary:
        lockedCount > 0
          ? `${lockedCount} / ${SECTION_ORDER.length} sections locked`
          : "Not started",
    },
    {
      title: "Estimate",
      summary: s4Complete
        ? `${estimateEnv?.estimate?.lines?.length ?? 0} line item(s)`
        : "No line items yet",
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
      title: "Submit",
      summary: s6Complete ? "Claim submitted" : "Ready to submit",
    },
  ];

  return (
    <div className="space-y-3">
      {/* ── Stage 0: Readiness ─────────────────────────────────────────── */}
      <StagePanel
        index={0}
        title={STAGES[0].title}
        summary={STAGES[0].summary}
        isComplete={s0Complete}
        isActive={effectiveActive === 0}
        isOpen={openStages.has(0)}
        onToggle={() => toggle(0)}
      >
        {loadingReadiness ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : readiness ? (
          <div className="divide-y divide-border/50">
            {readiness.items.map((item) => (
              <ReadinessRow key={item.key} item={item} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">
            Unable to load readiness data.
          </p>
        )}
      </StagePanel>

      {/* ── Stage 1: Field Capture ─────────────────────────────────────── */}
      <StagePanel
        index={1}
        title={STAGES[1].title}
        summary={STAGES[1].summary}
        isComplete={s1Complete}
        isActive={effectiveActive === 1}
        isOpen={openStages.has(1)}
        onToggle={() => toggle(1)}
      >
        {/* Status badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Status:</span>
          <Badge variant="outline" className="capitalize text-xs">
            {String(inspection?.status ?? "—").replace(/_/g, " ")}
          </Badge>
          {inspection?.scheduledFor && (
            <Badge variant="secondary" className="text-xs">
              Scheduled{" "}
              {format(
                new Date(String(inspection.scheduledFor)),
                "MMM d, yyyy",
              )}
            </Badge>
          )}
        </div>

        {/* Asset checklist from readiness */}
        {readiness && (
          <div className="rounded-lg border bg-muted/20 divide-y divide-border/50">
            {readiness.items
              .filter((i) =>
                [
                  "field_record_attested",
                  "measurement_report",
                  "storm_data",
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

        <a
          href={`/rooftrax-web/inspections/${inspectionId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
        >
          <Camera className="h-3.5 w-3.5" />
          Review Field Data
          <ExternalLink className="h-3 w-3" />
        </a>
      </StagePanel>

      {/* ── Stage 2: Photo Curation ───────────────────────────────────── */}
      <StagePanel
        index={2}
        title={STAGES[2].title}
        summary={STAGES[2].summary}
        isComplete={s2Complete}
        isActive={effectiveActive === 2}
        isOpen={openStages.has(2)}
        onToggle={() => toggle(2)}
      >
        {curation ? (
          <div className="rounded-lg border bg-muted/20 divide-y divide-border/50">
            {[
              [
                "Total photos",
                String(curation.photos.length),
              ],
              [
                "Exhibit selections",
                `${assignedCount} assigned`,
              ],
              [
                "Captions",
                `${captionLockedCount} / ${curation.captions.length} locked`,
              ],
              [
                "Curation status",
                curation.isFinalized ? "Finalized ✓" : "Not finalized",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No curation data yet.
          </p>
        )}

        <a
          href={`/rooftrax-web/inspections/${inspectionId}/curation`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
        >
          <Image className="h-3.5 w-3.5" />
          Open Photo Curation
          <ExternalLink className="h-3 w-3" />
        </a>
      </StagePanel>

      {/* ── Stage 3: AI Report Sections ───────────────────────────────── */}
      <StagePanel
        index={3}
        title={STAGES[3].title}
        summary={STAGES[3].summary}
        isComplete={s3Complete}
        isActive={effectiveActive === 3}
        isOpen={openStages.has(3)}
        onToggle={() => toggle(3)}
      >
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
              Stage 0 readiness must pass before generating sections.
            </p>
          </div>
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
                />
              );
            })}
          </div>
        )}
      </StagePanel>

      {/* ── Stage 4: Estimate ─────────────────────────────────────────── */}
      <StagePanel
        index={4}
        title={STAGES[4].title}
        summary={STAGES[4].summary}
        isComplete={s4Complete}
        isActive={effectiveActive === 4}
        isOpen={openStages.has(4)}
        onToggle={() => toggle(4)}
      >
        <EstimatePanel inspectionId={inspectionId} />
      </StagePanel>

      {/* ── Stage 5: Compile & Attest ─────────────────────────────────── */}
      <StagePanel
        index={5}
        title={STAGES[5].title}
        summary={STAGES[5].summary}
        isComplete={s5Complete}
        isActive={effectiveActive === 5}
        isOpen={openStages.has(5)}
        onToggle={() => toggle(5)}
      >
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
                  Lock all sections before compiling.
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

      {/* ── Stage 6: Submit ───────────────────────────────────────────── */}
      <StagePanel
        index={6}
        title={STAGES[6].title}
        summary={STAGES[6].summary}
        isComplete={s6Complete}
        isActive={effectiveActive === 6}
        isOpen={openStages.has(6)}
        onToggle={() => toggle(6)}
      >
        {s6Complete ? (
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-sm font-medium">
              Claim submitted to carrier
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {!s5Complete && (
              <div className="flex items-start gap-2 p-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="text-xs">
                  Compile and attest the report before submitting.
                </p>
              </div>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      disabled={!s5Complete || submitClaim.isPending}
                      onClick={() =>
                        submitClaim.mutate(undefined, {
                          onSuccess: () =>
                            toast({
                              title: "Claim submitted",
                              description:
                                "The claim has been filed with the carrier.",
                            }),
                          onError: (err) =>
                            toast({
                              title: "Submission failed",
                              description:
                                err instanceof Error
                                  ? err.message
                                  : "Could not submit.",
                              variant: "destructive",
                            }),
                        })
                      }
                    >
                      {submitClaim.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      {submitClaim.isPending ? "Submitting…" : "Submit Claim"}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!s5Complete && (
                  <TooltipContent className="text-xs">
                    Compile and attest the report before submitting.
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </StagePanel>

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
                        err instanceof Error ? err.message : "Attestation failed.",
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
