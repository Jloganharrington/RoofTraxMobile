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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown, Lock, Loader2, Zap, RotateCcw, BookOpen, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useGenerateSection,
  useApproveSection,
  useLockSection,
  useFillIicrcCitations,
  type IicrcCitationFill,
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
// IICRC placeholder helpers
// ---------------------------------------------------------------------------

const IICRC_PLACEHOLDER_RE =
  /\{\{IICRC_CITATION_PLACEHOLDER:([A-Z0-9_-]+)\}\}/g;

/** Extract unique IICRC placeholder entry keys from a content string. */
function extractIicrcPlaceholderKeys(content: string): string[] {
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(IICRC_PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(content)) !== null) {
    if (m[1] && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

/**
 * Replace `{{IICRC_CITATION_PLACEHOLDER:KEY}}` tokens in raw HTML with a
 * visible badge so reviewers can immediately see where citations are needed.
 */
function injectPlaceholderBadges(html: string): string {
  return html.replace(
    /\{\{IICRC_CITATION_PLACEHOLDER:([A-Z0-9_-]+)\}\}/g,
    (_, key) =>
      `<span data-iicrc-placeholder="${key}" style="display:inline-block;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:1px 6px;font-size:0.75em;font-weight:600;color:#92400e;">` +
      `⚠ IICRC CITATION REQUIRED [${key}]</span>`,
  );
}

// ---------------------------------------------------------------------------
// IICRC fill-in form per placeholder key
// ---------------------------------------------------------------------------

function IicrcPlaceholderFillIn({
  entryKey,
  value,
  onChange,
}: {
  entryKey: string;
  value: IicrcCitationFill;
  onChange: (v: IicrcCitationFill) => void;
}) {
  return (
    <div className="border border-amber-300 rounded-md p-3 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 space-y-2">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-amber-600 shrink-0" />
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
          IICRC Citation Required — {entryKey}
        </p>
      </div>
      <p className="text-[10px] text-amber-700 dark:text-amber-400">
        Enter the exact citation text from your licensed IICRC document copy and
        its page/section locator. Click "Submit Citations" to record both and
        unlock approval.
      </p>
      <Textarea
        placeholder="Exact citation text from licensed document…"
        value={value.citationText}
        onChange={(e) => onChange({ ...value, citationText: e.target.value })}
        className="text-xs min-h-[60px] resize-y"
        aria-label={`IICRC citation text for ${entryKey}`}
      />
      <Input
        placeholder="Locator — e.g. 'S500 Section 7.3.2, p. 44'"
        value={value.locator}
        onChange={(e) => onChange({ ...value, locator: e.target.value })}
        className="text-xs"
        aria-label={`IICRC citation locator for ${entryKey}`}
      />
    </div>
  );
}

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
  // Local fill state: maps entryKey → { citationText, locator }
  const [iicrcFills, setIicrcFills] = useState<Record<string, IicrcCitationFill>>({});

  const { toast } = useToast();
  const generateSection = useGenerateSection(inspectionId);
  const approveSection = useApproveSection(inspectionId);
  const lockSection = useLockSection(inspectionId);
  const fillIicrcCitations = useFillIicrcCitations(inspectionId);

  const meta = SECTION_META[section.sectionType];
  const stateBadge = STATE_BADGE[section.state] ?? STATE_BADGE.not_started;

  const upstreamReady = meta.upstream.every((upstreamType) => {
    const upstream = allSections.find((s) => s.sectionType === upstreamType);
    return upstream?.state === "approved" || upstream?.state === "locked";
  });

  // ── IICRC citation gate ───────────────────────────────────────────────────
  // Server-side source of truth: lintFindings with ruleId === 'iicrc_citation_unfilled'
  // are cleared by the fill-iicrc-citations route; approve is blocked while any remain.
  const unfilledIicrcFindings = (section.lintFindings ?? []).filter(
    (f) => f.ruleId === "iicrc_citation_unfilled",
  );
  const hasUnfilledFindings = unfilledIicrcFindings.length > 0;

  // Placeholder keys visible in current content (used to show fill-in forms).
  const iicrcPlaceholderKeys = section.content
    ? extractIicrcPlaceholderKeys(section.content)
    : [];

  // Only show fill-in forms when the server still considers them unfilled.
  const showFillInForms =
    hasUnfilledFindings &&
    iicrcPlaceholderKeys.length > 0 &&
    !["approved", "locked"].includes(section.state);

  // Local form validity: all visible fill-in fields have citationText + locator.
  const allLocalFillsFilled = iicrcPlaceholderKeys.every((key) => {
    const fill = iicrcFills[key];
    return fill && fill.citationText.trim().length > 0 && fill.locator.trim().length > 0;
  });

  const canApprove = (() => {
    if (section.state !== "generated" && section.state !== "in_review") return false;
    if (meta.hasCausationGate && !causationConfirmed) return false;
    if (
      meta.hasRapFallbackGate &&
      section.rapMode === "fallback_slope" &&
      !rapFallbackConfirmed
    )
      return false;
    // Server-side gate: unfilled IICRC findings block approval.
    if (hasUnfilledFindings) return false;
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

  const handleSubmitCitations = () => {
    fillIicrcCitations.mutate(
      { sectionType: section.sectionType, citations: iicrcFills },
      {
        onSuccess: (data) => {
          if (data.remainingUnfilled.length === 0) {
            toast({
              title: "Citations submitted",
              description: "All IICRC citations recorded. You may now approve this section.",
            });
            // Clear local form state — server now owns the fills.
            setIicrcFills({});
          } else {
            toast({
              title: "Partial submission",
              description: `${data.remainingUnfilled.length} citation(s) still required.`,
            });
          }
        },
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Submission failed.";
          toast({
            title: "Citation submit failed",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
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
        onSuccess: () => toast({ title: `${meta.label} approved` }),
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

  // Render content with placeholder token badges injected inline.
  const renderedContentHtml = section.content
    ? injectPlaceholderBadges(section.content)
    : null;

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
                {iicrcPlaceholderKeys.length > 0 && (
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                      hasUnfilledFindings
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
                    )}
                  >
                    {hasUnfilledFindings
                      ? `${unfilledIicrcFindings.length} citation${unfilledIicrcFindings.length > 1 ? "s" : ""} required`
                      : "Citations submitted"}
                  </span>
                )}
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
            {renderedContentHtml ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none border rounded-md p-3 bg-muted/20 text-sm"
                dangerouslySetInnerHTML={{ __html: renderedContentHtml }}
              />
            ) : (
              <div className="border rounded-md p-4 bg-muted/10 text-center text-sm text-muted-foreground">
                {section.state === "not_started"
                  ? "No content yet. Click Generate to draft this section."
                  : "Generating…"}
              </div>
            )}

            {/* IICRC citation fill-in forms — shown while server reports unfilled findings */}
            {showFillInForms && (
              <div className="space-y-3">
                {iicrcPlaceholderKeys.map((key) => (
                  <IicrcPlaceholderFillIn
                    key={key}
                    entryKey={key}
                    value={iicrcFills[key] ?? { citationText: "", locator: "" }}
                    onChange={(v) =>
                      setIicrcFills((prev) => ({ ...prev, [key]: v }))
                    }
                  />
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                  disabled={!allLocalFillsFilled || fillIicrcCitations.isPending}
                  onClick={handleSubmitCitations}
                >
                  {fillIicrcCitations.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                  )}
                  Submit Citations
                </Button>
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
                        onCheckedChange={(v) => setRapFallbackConfirmed(!!v)}
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

                {/* Gate message when IICRC citations still pending */}
                {hasUnfilledFindings &&
                  (section.state === "generated" ||
                    section.state === "in_review") && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                      ⚠ Submit all IICRC citation fields above before approving.
                    </p>
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
