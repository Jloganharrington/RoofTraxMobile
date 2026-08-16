/**
 * ExhibitManifest — slot-based photo curation for Step 2 of the Proof Package
 * builder. Replaces the free-form curation link with a guided slot card stack.
 *
 * Each slot represents a required or optional exhibit position derived from
 * claim flags. The user confirms a proposed photo, swaps it for another, or
 * marks optional slots as not applicable.
 */
import { useState } from "react";
import {
  useGetExhibitSlots,
  useGetCuration,
  useSetExhibitSelection,
  useConfirmPair,
  useFinalizeCuration,
  getExhibitSlotsQueryKey,
  getCurationQueryKey,
  type ExhibitSlot,
  type SlotPhotoCandidate,
  type ComparisonPairType,
} from "@/lib/curationApi";
import { useRecordClaimEvent } from "@/lib/claimHubApi";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  Image,
  RefreshCw,
  SkipForward,
  Loader2,
  Lock,
  ExternalLink,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Photo thumbnail
// ---------------------------------------------------------------------------

function PhotoThumb({
  photo,
  size = "md",
  onClick,
  selected,
}: {
  photo: SlotPhotoCandidate;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  selected?: boolean;
}) {
  const dim =
    size === "sm"
      ? "h-16 w-16"
      : size === "lg"
        ? "h-36 w-36"
        : "h-24 w-24";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex-shrink-0 rounded-lg overflow-hidden bg-muted border-2 transition-all",
        selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-transparent hover:border-primary/50",
        onClick ? "cursor-pointer" : "cursor-default",
        dim,
      )}
    >
      <img
        src={`/api/storage/proxy?path=${encodeURIComponent(photo.url)}`}
        alt=""
        className="w-full h-full object-cover"
        onError={(e) => {
          const el = e.target as HTMLImageElement;
          el.style.display = "none";
        }}
      />
      {selected && (
        <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
          <CheckCircle2 className="h-5 w-5 text-primary drop-shadow" />
        </div>
      )}
    </button>
  );
}

function EmptyThumb({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim =
    size === "sm"
      ? "h-16 w-16"
      : size === "lg"
        ? "h-36 w-36"
        : "h-24 w-24";
  return (
    <div
      className={cn(
        "flex-shrink-0 rounded-lg bg-muted border-2 border-dashed border-muted-foreground/20 flex items-center justify-center",
        dim,
      )}
    >
      <Image className="h-6 w-6 text-muted-foreground/30" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidate grid modal (for swap)
// ---------------------------------------------------------------------------

function CandidateGridModal({
  open,
  onClose,
  candidates,
  confirmedPhotoId,
  onSelect,
  title,
}: {
  open: boolean;
  onClose: () => void;
  candidates: SlotPhotoCandidate[];
  confirmedPhotoId: string | null;
  onSelect: (photoId: string) => void;
  title: string;
}) {
  const [pending, setPending] = useState<string | null>(null);

  async function handleSelect(id: string) {
    setPending(id);
    try {
      await onSelect(id);
      onClose();
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChevronLeft
              className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={onClose}
            />
            {title}
          </DialogTitle>
        </DialogHeader>
        {candidates.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No candidate photos found for this slot.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pt-2">
            {candidates.map((photo) => (
              <button
                key={photo.id}
                type="button"
                disabled={pending !== null}
                onClick={() => handleSelect(photo.id)}
                className={cn(
                  "relative rounded-lg overflow-hidden aspect-square border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  confirmedPhotoId === photo.id
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-transparent hover:border-primary/50",
                  pending === photo.id && "opacity-60",
                )}
              >
                <img
                  src={`/api/storage/objects/${photo.url}`}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    el.style.display = "none";
                  }}
                />
                {pending === photo.id && (
                  <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}
                {confirmedPhotoId === photo.id && pending === null && (
                  <div className="absolute top-1 right-1">
                    <CheckCircle2 className="h-4 w-4 text-primary drop-shadow" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Single slot card
// ---------------------------------------------------------------------------

function SingleSlotCard({
  slot,
  onConfirm,
  onSwap,
  onSkip,
  isPending,
}: {
  slot: ExhibitSlot;
  onConfirm: (photoId: string) => Promise<void>;
  onSwap: (oldPhotoId: string | null, newPhotoId: string) => Promise<void>;
  onSkip: () => Promise<void>;
  isPending: boolean;
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [skipPending, setSkipPending] = useState(false);

  const proposedPhoto = slot.candidates[0] ?? null;
  const isConfirmed = slot.confirmedPhotoId !== null;
  const confirmedPhoto =
    slot.candidates.find((c) => c.id === slot.confirmedPhotoId) ?? null;
  const displayPhoto = confirmedPhoto ?? proposedPhoto;

  async function handleConfirm() {
    if (!proposedPhoto || isConfirmed) return;
    setConfirmPending(true);
    try {
      await onConfirm(proposedPhoto.id);
    } finally {
      setConfirmPending(false);
    }
  }

  async function handleSkip() {
    setSkipPending(true);
    try {
      await onSkip();
    } finally {
      setSkipPending(false);
    }
  }

  async function handleSwapSelect(newPhotoId: string) {
    await onSwap(slot.confirmedPhotoId, newPhotoId);
  }

  return (
    <>
      <div
        className={cn(
          "rounded-xl border bg-card p-4 flex gap-4 items-start transition-colors",
          isConfirmed
            ? "border-primary/30 bg-primary/5"
            : slot.isSkipped
              ? "border-muted-foreground/20 opacity-60"
              : "border-border",
        )}
      >
        {/* Photo thumbnail */}
        <div className="flex-shrink-0">
          {displayPhoto ? (
            <PhotoThumb
              photo={displayPhoto}
              size="md"
              selected={isConfirmed}
              onClick={isConfirmed ? undefined : () => setSwapOpen(true)}
            />
          ) : (
            <EmptyThumb size="md" />
          )}
        </div>

        {/* Info + actions */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold leading-tight truncate">
              {slot.label}
            </span>
            <Badge
              variant={slot.required ? "default" : "secondary"}
              className="text-[10px] px-1.5 py-0 h-4 shrink-0"
            >
              {slot.required ? "Required" : "Optional"}
            </Badge>
            {isConfirmed && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 border-primary text-primary shrink-0"
              >
                ✓ Confirmed
              </Badge>
            )}
            {slot.isSkipped && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground shrink-0"
              >
                Skipped
              </Badge>
            )}
          </div>

          {/* Candidate count hint */}
          {slot.candidates.length > 0 && !isConfirmed && !slot.isSkipped && (
            <p className="text-xs text-muted-foreground mb-3">
              {slot.candidates.length} candidate
              {slot.candidates.length !== 1 ? "s" : ""} available
            </p>
          )}
          {isConfirmed && (
            <p className="text-xs text-muted-foreground mb-3">
              Photo confirmed
            </p>
          )}
          {slot.isSkipped && (
            <p className="text-xs text-muted-foreground mb-3">
              Marked not applicable
            </p>
          )}

          {/* Actions */}
          {!slot.isSkipped && (
            <div className="flex flex-wrap gap-2">
              {!isConfirmed && proposedPhoto && (
                <Button
                  size="sm"
                  className="h-7 text-xs px-3"
                  disabled={isPending || confirmPending || skipPending}
                  onClick={handleConfirm}
                >
                  {confirmPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                  )}
                  Confirm
                </Button>
              )}
              {slot.candidates.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-3"
                  disabled={isPending || confirmPending || skipPending}
                  onClick={() => setSwapOpen(true)}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {isConfirmed ? "Swap" : "Choose"}
                </Button>
              )}
              {!slot.required && !isConfirmed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-3 text-muted-foreground"
                  disabled={isPending || confirmPending || skipPending}
                  onClick={handleSkip}
                >
                  {skipPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <SkipForward className="h-3 w-3 mr-1" />
                  )}
                  Not applicable
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <CandidateGridModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        candidates={slot.candidates}
        confirmedPhotoId={slot.confirmedPhotoId}
        onSelect={handleSwapSelect}
        title={`Choose photo — ${slot.label}`}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Comparison slot card
// ---------------------------------------------------------------------------

function ComparisonSlotCard({
  slot,
  onConfirmPair,
  onSkip,
  isPending,
}: {
  slot: ExhibitSlot;
  onConfirmPair: (beforeId: string, afterId: string, pairType: ComparisonPairType) => Promise<void>;
  onSkip: () => Promise<void>;
  isPending: boolean;
}) {
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [beforeGridOpen, setBeforeGridOpen] = useState(false);
  const [afterGridOpen, setAfterGridOpen] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [skipPending, setSkipPending] = useState(false);

  const isConfirmed = slot.confirmedPairId !== null;

  const selectedBefore = beforeId
    ? (slot.beforeCandidates.find((c) => c.id === beforeId) ?? null)
    : (slot.beforeCandidates[0] ?? null);
  const selectedAfter = afterId
    ? (slot.afterCandidates.find((c) => c.id === afterId) ?? null)
    : (slot.afterCandidates[0] ?? null);

  const pairTypeLabel: Record<string, string> = {
    recency: "Recency Comparison",
    covered_vs_unrelated: "Covered vs. Pre-existing",
    cause_differentiation: "Cause Differentiation",
  };

  async function handleConfirmPair() {
    if (!selectedBefore || !selectedAfter || !slot.comparisonType) return;
    setConfirmPending(true);
    try {
      await onConfirmPair(selectedBefore.id, selectedAfter.id, slot.comparisonType);
    } finally {
      setConfirmPending(false);
    }
  }

  async function handleSkip() {
    setSkipPending(true);
    try {
      await onSkip();
    } finally {
      setSkipPending(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          "rounded-xl border bg-card p-4 transition-colors",
          isConfirmed
            ? "border-primary/30 bg-primary/5"
            : slot.isSkipped
              ? "border-muted-foreground/20 opacity-60"
              : "border-border",
        )}
      >
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-sm font-semibold">{slot.label}</span>
          <Badge
            variant={slot.required ? "default" : "secondary"}
            className="text-[10px] px-1.5 py-0 h-4 shrink-0"
          >
            {slot.required ? "Required" : "Optional"}
          </Badge>
          {slot.comparisonType && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 shrink-0"
            >
              {pairTypeLabel[slot.comparisonType] ?? slot.comparisonType}
            </Badge>
          )}
          {isConfirmed && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 border-primary text-primary shrink-0"
            >
              ✓ Confirmed
            </Badge>
          )}
          {slot.isSkipped && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground shrink-0"
            >
              Skipped
            </Badge>
          )}
        </div>

        {/* Stacked photo pair */}
        {!slot.isSkipped && !isConfirmed && (
          <div className="flex flex-col gap-2 mb-3">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-20 text-right">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Before</span>
              </div>
              {selectedBefore ? (
                <PhotoThumb
                  photo={selectedBefore}
                  size="md"
                  onClick={() => setBeforeGridOpen(true)}
                  selected={false}
                />
              ) : (
                <EmptyThumb size="md" />
              )}
              {slot.beforeCandidates.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setBeforeGridOpen(true)}
                  disabled={isPending || confirmPending}
                >
                  Change
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-20 text-right">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">After</span>
              </div>
              {selectedAfter ? (
                <PhotoThumb
                  photo={selectedAfter}
                  size="md"
                  onClick={() => setAfterGridOpen(true)}
                  selected={false}
                />
              ) : (
                <EmptyThumb size="md" />
              )}
              {slot.afterCandidates.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setAfterGridOpen(true)}
                  disabled={isPending || confirmPending}
                >
                  Change
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        {!slot.isSkipped && !isConfirmed && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-7 text-xs px-3"
              disabled={
                !selectedBefore ||
                !selectedAfter ||
                isPending ||
                confirmPending ||
                skipPending
              }
              onClick={handleConfirmPair}
            >
              {confirmPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              )}
              Confirm Pair
            </Button>
            {!slot.required && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-3 text-muted-foreground"
                disabled={isPending || confirmPending || skipPending}
                onClick={handleSkip}
              >
                {skipPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <SkipForward className="h-3 w-3 mr-1" />
                )}
                Not applicable
              </Button>
            )}
          </div>
        )}
      </div>

      <CandidateGridModal
        open={beforeGridOpen}
        onClose={() => setBeforeGridOpen(false)}
        candidates={slot.beforeCandidates}
        confirmedPhotoId={beforeId ?? slot.beforeCandidates[0]?.id ?? null}
        onSelect={(id) => { setBeforeId(id); setBeforeGridOpen(false); return Promise.resolve(); }}
        title={`Choose "Before" photo — ${slot.label}`}
      />
      <CandidateGridModal
        open={afterGridOpen}
        onClose={() => setAfterGridOpen(false)}
        candidates={slot.afterCandidates}
        confirmedPhotoId={afterId ?? slot.afterCandidates[0]?.id ?? null}
        onSelect={(id) => { setAfterId(id); setAfterGridOpen(false); return Promise.resolve(); }}
        title={`Choose "After" photo — ${slot.label}`}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// ExhibitManifest (main component)
// ---------------------------------------------------------------------------

export function ExhibitManifest({
  inspectionId,
  isFinalized,
}: {
  inspectionId: string;
  isFinalized: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: slotsData, isLoading } = useGetExhibitSlots(inspectionId);
  const setSelection = useSetExhibitSelection(inspectionId);
  const confirmPairMut = useConfirmPair(inspectionId);
  const finalizeCuration = useFinalizeCuration(inspectionId);
  const recordEvent = useRecordClaimEvent(inspectionId);

  const [finalizing, setFinalizing] = useState(false);

  const slots = slotsData?.slots ?? [];
  const allRequiredConfirmed = slotsData?.allRequiredConfirmed ?? false;

  const requiredTotal = slots.filter((s) => s.required).length;
  const requiredDone = slots.filter(
    (s) =>
      s.required &&
      (s.isSkipped ||
        (s.kind === "comparison"
          ? s.confirmedPairId !== null
          : s.confirmedPhotoId !== null)),
  ).length;

  async function invalidateSlots() {
    await qc.invalidateQueries({ queryKey: getExhibitSlotsQueryKey(inspectionId) });
    await qc.invalidateQueries({ queryKey: getCurationQueryKey(inspectionId) });
  }

  async function handleConfirm(slot: ExhibitSlot, photoId: string) {
    await setSelection.mutateAsync({ photoId, selected: true });
    // Record event BEFORE invalidating — confirmedPhotoId is derived from events,
    // so the refetch must see the committed event or the slot still shows unconfirmed.
    await recordEvent.mutateAsync({
      eventType: "slot_confirmed",
      payload: { slotKey: slot.slotKey, photoId },
    });
    await invalidateSlots();
  }

  async function handleSwap(
    slot: ExhibitSlot,
    oldPhotoId: string | null,
    newPhotoId: string,
  ) {
    if (oldPhotoId && oldPhotoId !== newPhotoId) {
      await setSelection.mutateAsync({ photoId: oldPhotoId, selected: false });
    }
    await setSelection.mutateAsync({ photoId: newPhotoId, selected: true });
    // Record event BEFORE invalidating so the refetch reads the updated slot state.
    await recordEvent.mutateAsync({
      eventType: "slot_swapped",
      // photoId is the canonical field used server-side for per-slot source of truth
      payload: { slotKey: slot.slotKey, photoId: newPhotoId, oldPhotoId },
    });
    await invalidateSlots();
  }

  async function handleSkip(slot: ExhibitSlot) {
    // Event first, then invalidate (skip event IS the state change)
    await recordEvent.mutateAsync({
      eventType: "slot_skipped",
      payload: { slotKey: slot.slotKey },
    });
    await invalidateSlots();
  }

  async function handleConfirmPair(
    slot: ExhibitSlot,
    beforeId: string,
    afterId: string,
    pairType: ComparisonPairType,
  ) {
    await confirmPairMut.mutateAsync({ beforePhotoId: beforeId, afterPhotoId: afterId, pairType });
    // Record event BEFORE invalidating
    await recordEvent.mutateAsync({
      eventType: "slot_confirmed",
      payload: { slotKey: slot.slotKey, beforePhotoId: beforeId, afterPhotoId: afterId },
    });
    await invalidateSlots();
  }

  async function handleFinalize() {
    if (!allRequiredConfirmed) return;
    setFinalizing(true);
    try {
      await finalizeCuration.mutateAsync();
      toast({ title: "Curation finalized", description: "Exhibit badges have been assigned." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Finalization failed.";
      toast({ title: "Finalization failed", description: msg, variant: "destructive" });
    } finally {
      setFinalizing(false);
    }
  }

  const isPending =
    setSelection.isPending || confirmPairMut.isPending || recordEvent.isPending;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  // ── No photos yet ─────────────────────────────────────────────────────────
  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-muted-foreground/20 py-10 text-center text-sm text-muted-foreground">
        <Image className="h-8 w-8 mx-auto mb-2 opacity-20" />
        <p>No exhibit slots derived yet.</p>
        <p className="text-xs mt-1 opacity-70">
          Damage flags and field record data drive slot generation.
        </p>
      </div>
    );
  }

  // ── Finalized state ───────────────────────────────────────────────────────
  if (isFinalized) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-3">
          <Lock className="h-4 w-4 text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium text-primary">Curation finalized</p>
            <p className="text-xs text-muted-foreground">
              Exhibit badges are frozen. Generate and lock captions to complete step 2.
            </p>
          </div>
        </div>
        <a
          href={`/rooftrax-web/inspections/${inspectionId}/curation`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
        >
          <Image className="h-3.5 w-3.5" />
          Manage captions & exhibit details
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  // ── Active manifest ───────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Required slots confirmed
          </span>
          <span className="text-xs font-semibold">
            {requiredDone} / {requiredTotal}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: requiredTotal > 0 ? `${(requiredDone / requiredTotal) * 100}%` : "0%" }}
          />
        </div>
      </div>

      {/* Slot card stack */}
      {slots.map((slot) =>
        slot.kind === "comparison" ? (
          <ComparisonSlotCard
            key={slot.slotKey}
            slot={slot}
            onConfirmPair={(beforeId, afterId, pairType) =>
              handleConfirmPair(slot, beforeId, afterId, pairType)
            }
            onSkip={() => handleSkip(slot)}
            isPending={isPending}
          />
        ) : (
          <SingleSlotCard
            key={slot.slotKey}
            slot={slot}
            onConfirm={(photoId) => handleConfirm(slot, photoId)}
            onSwap={(oldId, newId) => handleSwap(slot, oldId, newId)}
            onSkip={() => handleSkip(slot)}
            isPending={isPending}
          />
        ),
      )}

      {/* Finalize button */}
      <div className="pt-1">
        {allRequiredConfirmed ? (
          <Button
            className="w-full"
            disabled={finalizing || isPending}
            onClick={handleFinalize}
          >
            {finalizing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Lock className="h-4 w-4 mr-2" />
            )}
            Finalize Exhibit Selections
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground text-center">
            Confirm all required slots to finalize curation.
          </p>
        )}
      </div>

      {/* Link to full curation page for advanced editing */}
      <a
        href={`/rooftrax-web/inspections/${inspectionId}/curation`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline"
      >
        <Image className="h-3 w-3" />
        Advanced photo curation
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
