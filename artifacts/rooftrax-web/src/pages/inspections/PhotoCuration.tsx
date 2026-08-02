import { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetInspection, getGetInspectionQueryKey } from "@workspace/api-client-react";
import { Shell } from "@/components/layout/Shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, ArrowLeft, CheckCircle2, Camera, Sparkles,
  Lock, AlertTriangle, Link2, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useGetCuration,
  useProposeCuration,
  useSetExhibitSelection,
  useConfirmPair,
  useRemovePair,
  useFinalizeCuration,
  useGenerateCaptions,
  useUpdateCaption,
  useApproveCaptions,
  useLockCaptions,
  type ExhibitClass,
  type ComparisonPairType,
  type PhotoBrief,
  type ExhibitSelection,
  type ExhibitCaption,
} from "@/lib/curationApi";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLASS_LABELS: Record<ExhibitClass, string> = {
  R: "Roof",
  S: "Storm",
  I: "Interior",
  F: "Field Meas.",
  C: "Collateral",
  T: "Test Square",
};

const CLASS_COLORS: Record<ExhibitClass, string> = {
  R: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  S: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  I: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  F: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  C: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  T: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const PAIR_TYPE_LABELS: Record<ComparisonPairType, string> = {
  pre_post_loss: "Pre/Post Loss",
  condition_differentiation: "Condition Differentiation",
  directional_comparison: "Directional Comparison",
};

const CAPTION_STATE_LABELS: Record<string, string> = {
  pending: "Pending",
  generated: "Generated",
  in_review: "In Review",
  approved: "Approved",
  locked: "Locked",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PhotoThumbnail({
  photo,
  selected,
  exhibitClass,
  badgeLabel,
  isFinalized,
  onClick,
}: {
  photo: PhotoBrief;
  selected: boolean;
  exhibitClass: ExhibitClass | null;
  badgeLabel: string | null;
  isFinalized: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isFinalized}
      className={cn(
        "relative rounded-lg overflow-hidden border-2 transition-all text-left group",
        selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-transparent hover:border-muted-foreground/40",
        isFinalized && "cursor-default opacity-90",
      )}
    >
      <div className="aspect-[4/3] bg-muted">
        <img
          src={`/api/storage/proxy?path=${encodeURIComponent(photo.url)}`}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      {selected && (
        <div className="absolute top-1.5 left-1.5">
          <CheckCircle2 className="h-5 w-5 text-primary drop-shadow" />
        </div>
      )}
      {badgeLabel && (
        <div className="absolute top-1.5 right-1.5">
          <span className={cn(
            "text-xs font-bold px-1.5 py-0.5 rounded",
            exhibitClass ? CLASS_COLORS[exhibitClass] : "bg-gray-100 text-gray-800",
          )}>
            {badgeLabel}
          </span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 truncate">
        {photo.stage ?? photo.subjectType}
        {photo.triadRole ? ` · ${photo.triadRole}` : ""}
        {photo.preliminaryRole ? ` · ${photo.preliminaryRole}` : ""}
      </div>
    </button>
  );
}

function ClassSelector({
  value,
  onChange,
  disabled,
}: {
  value: ExhibitClass | null;
  onChange: (c: ExhibitClass | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {(Object.keys(CLASS_LABELS) as ExhibitClass[]).map((cls) => (
        <button
          key={cls}
          disabled={disabled}
          onClick={() => onChange(value === cls ? null : cls)}
          className={cn(
            "text-xs px-2 py-0.5 rounded-full font-medium transition-all",
            value === cls
              ? CLASS_COLORS[cls]
              : "bg-muted text-muted-foreground hover:bg-muted/80",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {cls} — {CLASS_LABELS[cls]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PhotoCuration() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: inspectionEnv, isLoading: inspectionLoading } =
    useGetInspection(id, { query: { enabled: !!id, queryKey: getGetInspectionQueryKey(id) } });

  const { data: curation, isLoading: curationLoading } = useGetCuration(id);

  const propose = useProposeCuration(id);
  const setSelection = useSetExhibitSelection(id);
  const confirmPair = useConfirmPair(id);
  const removePair = useRemovePair(id);
  const finalize = useFinalizeCuration(id);
  const generateCaptions = useGenerateCaptions(id);
  const updateCaption = useUpdateCaption(id);
  const approveCaptions = useApproveCaptions(id);
  const lockCaptions = useLockCaptions(id);

  // Pair builder state
  // `isPairing` = user clicked "Start pair" and we are in pair-selection mode.
  // First photo click sets pairFirst; second click submits the pair.
  const [isPairing, setIsPairing] = useState(false);
  const [pairFirst, setPairFirst] = useState<PhotoBrief | null>(null);
  const [pairType, setPairType] = useState<ComparisonPairType>("pre_post_loss");
  const [pairNotes, setPairNotes] = useState("");
  const [expandedCaptionId, setExpandedCaptionId] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState<Record<string, string>>({});

  const inspection = inspectionEnv?.inspection;
  const isFinalized = curation?.isFinalized ?? false;

  const selectedIds = new Set(curation?.selections.map((s) => s.photoId) ?? []);
  const selectionMap = new Map<string, ExhibitSelection>(
    (curation?.selections ?? []).map((s) => [s.photoId, s]),
  );

  /** Single handler for all grid photo clicks — routes to selection or pairing. */
  function handlePhotoClick(photo: PhotoBrief) {
    if (isFinalized) return;

    if (isPairing) {
      if (!pairFirst) {
        // First click in pairing mode — record the "before" photo.
        setPairFirst(photo);
        toast({
          title: `"Before" photo selected`,
          description: 'Now click the second photo to set the \u201cafter\u201d side.',
        });
      } else if (pairFirst.id === photo.id) {
        // Clicking the same photo deselects it as the first.
        setPairFirst(null);
      } else {
        // Second distinct click — submit the pair.
        confirmPair.mutate(
          { beforePhotoId: pairFirst.id, afterPhotoId: photo.id, pairType, notes: pairNotes || undefined },
          {
            onSuccess: () => {
              toast({ title: "Comparison pair confirmed" });
              setPairFirst(null);
              setIsPairing(false);
              setPairNotes("");
            },
            onError: () => toast({ title: "Failed to confirm pair", variant: "destructive" }),
          },
        );
      }
      return;
    }

    // Normal selection-toggle mode.
    const alreadySelected = selectedIds.has(photo.id);
    setSelection.mutate(
      { photoId: photo.id, selected: !alreadySelected },
      {
        onError: () => toast({ title: "Failed to update selection", variant: "destructive" }),
      },
    );
  }

  function handleClassChange(photoId: string, cls: ExhibitClass | null) {
    if (isFinalized) return;
    setSelection.mutate(
      { photoId, selected: true, exhibitClass: cls },
      {
        onError: () => toast({ title: "Failed to set class", variant: "destructive" }),
      },
    );
  }

  function cancelPairing() {
    setIsPairing(false);
    setPairFirst(null);
    setPairNotes("");
  }

  const captionEditText = (c: ExhibitCaption) =>
    editingCaption[c.id] ?? c.captionText ?? "";

  const isLoading = inspectionLoading || curationLoading;

  if (isLoading) {
    return (
      <Shell>
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Shell>
    );
  }

  if (!inspection) {
    return (
      <Shell>
        <div className="p-6 text-muted-foreground">Inspection not found.</div>
      </Shell>
    );
  }

  const allCaptionsLocked =
    (curation?.captions ?? []).length > 0 &&
    (curation?.captions ?? []).every((c) => c.state === "locked");

  const allCaptionsApproved =
    (curation?.captions ?? []).length > 0 &&
    (curation?.captions ?? []).every((c) => c.state === "approved" || c.state === "locked");

  return (
    <Shell>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href={`/inspections/${id}/summary`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Photo Curation</h1>
            <p className="text-sm text-muted-foreground">{inspection.address}</p>
          </div>
          {isFinalized && (
            <Badge className="ml-auto" variant="secondary">
              <Lock className="h-3 w-3 mr-1" /> Badges Frozen
            </Badge>
          )}
        </div>

        {/* Step 1 — Exhibit Selection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  Step 1 — Select Exhibit Photos
                </CardTitle>
                <CardDescription>
                  Choose ~10 photos for the proof package.{" "}
                  {curation?.selections.length ?? 0} selected
                  {isFinalized ? " · badges frozen" : " · badges assigned at finalization"}.
                </CardDescription>
              </div>
              {!isFinalized && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    propose.mutate(undefined, {
                      onSuccess: () => toast({ title: "AI proposal applied" }),
                      onError: () =>
                        toast({ title: "Proposal failed", variant: "destructive" }),
                    })
                  }
                  disabled={propose.isPending}
                >
                  {propose.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  AI Propose
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {(curation?.photos ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No photos found for this inspection.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {(curation?.photos ?? []).map((photo) => {
                  const sel = selectionMap.get(photo.id);
                  return (
                    <div key={photo.id} className="space-y-1">
                      <PhotoThumbnail
                        photo={photo}
                        selected={selectedIds.has(photo.id)}
                        exhibitClass={sel?.exhibitClass ?? null}
                        badgeLabel={sel?.badgeLabel ?? null}
                        isFinalized={isFinalized}
                        onClick={() => handlePhotoClick(photo)}
                      />
                      {selectedIds.has(photo.id) && !isFinalized && (
                        <ClassSelector
                          value={sel?.exhibitClass ?? null}
                          onChange={(cls) => handleClassChange(photo.id, cls)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Finalize */}
            {!isFinalized && (curation?.selections.length ?? 0) > 0 && (
              <div className="mt-4 pt-4 border-t flex justify-end">
                <Button
                  onClick={() =>
                    finalize.mutate(undefined, {
                      onSuccess: () =>
                        toast({ title: "Badges frozen", description: "Exhibit badge assignments are now permanent." }),
                      onError: () =>
                        toast({ title: "Finalization failed", variant: "destructive" }),
                    })
                  }
                  disabled={finalize.isPending}
                >
                  {finalize.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Lock className="h-4 w-4 mr-2" />
                  )}
                  Freeze Badge Assignments
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2 — Comparison Pairs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Step 2 — Comparison Pairs
            </CardTitle>
            <CardDescription>
              Confirm pairs for pre/post-loss or condition-differentiation sets. Hard gate — must be
              explicitly confirmed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pair builder */}
            {!isFinalized && (
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <p className="text-sm font-medium">Build a pair</p>
                <div className="flex flex-wrap gap-2">
                  {(["pre_post_loss", "condition_differentiation", "directional_comparison"] as ComparisonPairType[]).map(
                    (pt) => (
                      <button
                        key={pt}
                        onClick={() => setPairType(pt)}
                        className={cn(
                          "text-xs px-2 py-1 rounded-full border transition-all",
                          pairType === pt
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-input hover:bg-muted",
                        )}
                      >
                        {PAIR_TYPE_LABELS[pt]}
                      </button>
                    ),
                  )}
                </div>
                {isPairing ? (
                  /* Pairing mode — show step-by-step progress */
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-sm">
                      {!pairFirst ? (
                        <span className="text-primary font-medium">
                          Step 1 of 2 — Click the "before" photo in the grid above.
                        </span>
                      ) : (
                        <span className="text-primary font-medium">
                          Step 2 of 2 — "Before" set. Click the "after" photo to confirm.
                        </span>
                      )}
                      <Button size="sm" variant="ghost" onClick={cancelPairing} className="ml-auto shrink-0">
                        <X className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                    </div>
                    {pairFirst && (
                      <p className="text-xs text-muted-foreground">
                        Before: {pairFirst.stage ?? pairFirst.subjectType}
                        {pairFirst.triadRole ? ` · ${pairFirst.triadRole}` : ""}
                      </p>
                    )}
                  </div>
                ) : (
                  /* Idle — show pair type selector + start button */
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Choose a pair type, then click "Start pair" and pick two photos from the grid.
                    </p>
                    <div className="flex gap-2 items-start">
                      <Textarea
                        className="text-sm resize-none h-10"
                        placeholder="Optional notes…"
                        value={pairNotes}
                        onChange={(e) => setPairNotes(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsPairing(true)}
                      >
                        Start pair
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Existing pairs */}
            {(curation?.pairs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No comparison pairs confirmed yet.</p>
            ) : (
              <div className="space-y-3">
                {(curation?.pairs ?? []).map((pair) => (
                  <div key={pair.id} className="border rounded-lg p-3 flex items-center gap-4">
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div className="font-medium text-foreground">Before</div>
                        <div>{pair.beforePhoto.stage} · {pair.beforePhoto.triadRole}</div>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div className="font-medium text-foreground">After</div>
                        <div>{pair.afterPhoto.stage} · {pair.afterPhoto.triadRole}</div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {PAIR_TYPE_LABELS[pair.pairType]}
                    </Badge>
                    {!isFinalized && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() =>
                          removePair.mutate(pair.id, {
                            onError: () =>
                              toast({ title: "Failed to remove pair", variant: "destructive" }),
                          })
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    {pair.confirmedAt && (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 3 — Caption Generation */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Step 3 — Generate & Review Captions
                </CardTitle>
                <CardDescription>
                  AI drafts one caption per exhibit slot. Review and lock to activate the Findings
                  hard gate.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {isFinalized && !allCaptionsLocked && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      generateCaptions.mutate(undefined, {
                        onSuccess: () => toast({ title: "Captions generated" }),
                        onError: () =>
                          toast({ title: "Caption generation failed", variant: "destructive" }),
                      })
                    }
                    disabled={generateCaptions.isPending}
                  >
                    {generateCaptions.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Generate
                  </Button>
                )}
                {allCaptionsApproved && !allCaptionsLocked && (
                  <Button
                    size="sm"
                    onClick={() =>
                      lockCaptions.mutate(undefined, {
                        onSuccess: () =>
                          toast({ title: "Captions locked", description: "Findings hard gate is now active." }),
                        onError: () =>
                          toast({ title: "Lock failed", variant: "destructive" }),
                      })
                    }
                    disabled={lockCaptions.isPending}
                  >
                    {lockCaptions.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Lock className="h-4 w-4 mr-2" />
                    )}
                    Lock All
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isFinalized ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Freeze badge assignments first to enable caption generation.
              </p>
            ) : (curation?.captions ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No captions yet — click Generate above to draft captions for all exhibit slots.
              </p>
            ) : (
              <div className="space-y-2">
                {(curation?.captions ?? []).map((caption) => {
                  const isExpanded = expandedCaptionId === caption.id;
                  const isLocked = caption.state === "locked";
                  return (
                    <div key={caption.id} className="border rounded-lg overflow-hidden">
                      <button
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
                        onClick={() =>
                          setExpandedCaptionId(isExpanded ? null : caption.id)
                        }
                      >
                        <span className="font-mono text-xs font-bold shrink-0 w-8">
                          {caption.badgeLabel}
                        </span>
                        <span className="text-sm truncate flex-1">
                          {caption.captionText ?? "…pending…"}
                        </span>
                        <Badge
                          variant={isLocked ? "default" : "secondary"}
                          className="shrink-0 capitalize"
                        >
                          {CAPTION_STATE_LABELS[caption.state] ?? caption.state}
                        </Badge>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 border-t pt-3">
                          <Textarea
                            className="text-sm resize-none"
                            rows={3}
                            value={captionEditText(caption)}
                            disabled={isLocked}
                            onChange={(e) =>
                              setEditingCaption((prev) => ({
                                ...prev,
                                [caption.id]: e.target.value,
                              }))
                            }
                          />
                          {!isLocked && (
                            <div className="flex justify-end gap-2">
                              {editingCaption[caption.id] !== undefined && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    updateCaption.mutate(
                                      { captionId: caption.id, captionText: captionEditText(caption) },
                                      {
                                        onSuccess: () => {
                                          setEditingCaption((prev) => {
                                            const next = { ...prev };
                                            delete next[caption.id];
                                            return next;
                                          });
                                          toast({ title: "Caption saved" });
                                        },
                                        onError: () =>
                                          toast({ title: "Save failed", variant: "destructive" }),
                                      },
                                    )
                                  }
                                  disabled={updateCaption.isPending}
                                >
                                  Save
                                </Button>
                              )}
                              {caption.state === "generated" || caption.state === "in_review" ? (
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    approveCaptions.mutate(undefined, {
                                      onSuccess: () => toast({ title: "Caption approved" }),
                                      onError: () =>
                                        toast({ title: "Approve failed", variant: "destructive" }),
                                    })
                                  }
                                  disabled={approveCaptions.isPending}
                                >
                                  Approve All
                                </Button>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {allCaptionsLocked && (
              <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 rounded-lg text-green-800 dark:text-green-200 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Captions locked — Findings hard gate is now active.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
