/**
 * SectionCard — shared AI report section card.
 * Extracted from ClaimHub so it can be reused in InspectionFlowWizard.
 */
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown, Lock, Loader2, Zap, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useGenerateSection,
  useApproveSection,
  useLockSection,
  type SectionType,
  type ClaimSection,
} from "@/lib/claimHubApi";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SECTION_META: Record<
  SectionType,
  {
    label: string;
    upstream: SectionType[];
    hasRapFallbackGate?: boolean;
    hasCausationGate?: boolean;
    hasComparisonGate?: boolean;
  }
> = {
  findings: {
    label: "Findings",
    upstream: [],
    hasComparisonGate: true,
  },
  causation: {
    label: "Causation",
    upstream: [],
    hasCausationGate: true,
  },
  detriment_application: {
    label: "Detriment Application",
    upstream: [],
    hasCausationGate: true,
  },
  rap_narrative: {
    label: "RAP Narrative",
    upstream: [],
    hasRapFallbackGate: true,
  },
  estimate_justifications: {
    label: "Estimate Justifications",
    upstream: [],
  },
  summary_of_findings: {
    label: "Summary of Findings",
    upstream: [
      "findings",
      "causation",
      "detriment_application",
      "rap_narrative",
      "estimate_justifications",
    ],
  },
  closing_statement: {
    label: "Closing Statement",
    upstream: ["summary_of_findings"],
  },
};

export const SECTION_ORDER: SectionType[] = [
  "findings",
  "causation",
  "detriment_application",
  "rap_narrative",
  "estimate_justifications",
  "summary_of_findings",
  "closing_statement",
];

export const STATE_BADGE: Record<string, { label: string; className: string }> = {
  not_started: {
    label: "Not Started",
    className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
  generating: {
    label: "Generating…",
    className: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300",
  },
  generated: {
    label: "Generated",
    className:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  },
  in_review: {
    label: "In Review",
    className:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  },
  approved: {
    label: "Approved",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  },
  locked: {
    label: "Locked",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SectionCard({
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

  const upstreamReady = meta.upstream.every((upstreamType) => {
    const upstream = allSections.find((s) => s.sectionType === upstreamType);
    return upstream?.state === "approved" || upstream?.state === "locked";
  });

  const canApprove = (() => {
    if (section.state !== "generated" && section.state !== "in_review")
      return false;
    if (meta.hasCausationGate && !causationConfirmed) return false;
    if (
      meta.hasRapFallbackGate &&
      section.rapMode === "fallback_slope" &&
      !rapFallbackConfirmed
    )
      return false;
    return true;
  })();

  const isLocked = section.state === "locked";

  const handleGenerate = () => {
    generateSection.mutate(section.sectionType, {
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Generation not yet available.";
        toast({
          title: "Generate failed",
          description: message,
          variant: "destructive",
        });
      },
    });
  };

  const handleApprove = () => {
    approveSection.mutate(
      {
        sectionType: section.sectionType,
        causationReviewConfirmed: meta.hasCausationGate
          ? causationConfirmed
          : undefined,
        rapFallbackConfirmed: meta.hasRapFallbackGate
          ? rapFallbackConfirmed
          : undefined,
      },
      {
        onSuccess: () =>
          toast({ title: `${meta.label} approved` }),
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Approve failed.";
          toast({
            title: "Approve failed",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleLock = () => {
    lockSection.mutate(section.sectionType, {
      onSuccess: () => toast({ title: `${meta.label} locked` }),
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Lock failed.";
        toast({
          title: "Lock failed",
          description: message,
          variant: "destructive",
        });
      },
    });
  };

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

              <div
                className="flex items-center gap-2 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                {(section.state === "not_started" ||
                  section.state === "generated" ||
                  section.state === "in_review") &&
                  !isLocked && (
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
                      {section.state === "not_started"
                        ? "Generate"
                        : "Regenerate"}
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

            {!upstreamReady &&
              section.state === "not_started" &&
              meta.upstream.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1 ml-6">
                  Requires{" "}
                  {meta.upstream.map((u) => SECTION_META[u].label).join(" + ")}{" "}
                  to be approved first.
                </p>
              )}
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
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

            {!isLocked && (
              <div className="space-y-2">
                {meta.hasComparisonGate && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 opacity-50 cursor-not-allowed">
                          <Checkbox
                            id={`${section.sectionType}-comparison`}
                            disabled
                          />
                          <label
                            htmlFor={`${section.sectionType}-comparison`}
                            className="text-xs text-muted-foreground cursor-not-allowed"
                          >
                            Requires photo curation (upcoming)
                          </label>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-60 text-xs">
                        The comparison photo gate will be enabled once Photo
                        Curation is finalized. Findings can still be approved
                        without it if no comparison set is needed.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {meta.hasCausationGate &&
                  (section.state === "generated" ||
                    section.state === "in_review") && (
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
                        I confirm the causation content was reviewed against the
                        attested field record.
                      </label>
                    </div>
                  )}

                {meta.hasRapFallbackGate &&
                  section.rapMode === "fallback_slope" &&
                  (section.state === "generated" ||
                    section.state === "in_review") && (
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id={`${section.sectionType}-rap-fallback`}
                        checked={rapFallbackConfirmed}
                        onCheckedChange={(v) =>
                          setRapFallbackConfirmed(!!v)
                        }
                      />
                      <label
                        htmlFor={`${section.sectionType}-rap-fallback`}
                        className="text-xs leading-relaxed cursor-pointer"
                      >
                        I confirm the RAP fallback slope narrative is appropriate
                        for this claim.
                      </label>
                    </div>
                  )}

                {(section.state === "generated" ||
                  section.state === "in_review") && (
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
