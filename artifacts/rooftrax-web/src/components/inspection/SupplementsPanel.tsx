/**
 * SupplementsPanel — issue and track supplement documents for a delivered
 * Proof Package.  Each supplement is its own attested blob chain; the
 * original package is never modified.
 */
import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FilePlus, CheckCircle2, Clock, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SupplementReason =
  | "concealed_conditions_exposed"
  | "carrier_response"
  | "scope_correction";

interface CompiledSuppVersion {
  path: string;
  generatedAt?: string;
  isSignedVersion?: boolean;
  reportAttestationId?: string;
  documentType?: string;
}

interface Supplement {
  id: string;
  supplementNumber: string;
  supplementReason: SupplementReason;
  compiledReportVersions: CompiledSuppVersion[];
  originalPackageBlobVersion: string | null;
  originalAttestationId: string | null;
  createdAt: string;
}

const REASON_LABELS: Record<SupplementReason, string> = {
  concealed_conditions_exposed: "Concealed Conditions Exposed",
  carrier_response: "Carrier Response",
  scope_correction: "Scope Correction",
};

const REASONS: SupplementReason[] = [
  "concealed_conditions_exposed",
  "carrier_response",
  "scope_correction",
];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function suppKey(inspectionId: string) {
  return ["inspections", inspectionId, "supplements"] as const;
}

function useSupplements(inspectionId: string) {
  return useQuery({
    queryKey: suppKey(inspectionId),
    queryFn: () =>
      customFetch<{ supplements: Supplement[] }>(
        `/api/inspections/${inspectionId}/supplements`,
      ).then((d) => d.supplements),
  });
}

function useCreateSupplement(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (supplementReason: SupplementReason) =>
      customFetch<{ supplement: Supplement }>(
        `/api/inspections/${inspectionId}/supplements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplementReason }),
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: suppKey(inspectionId) }),
  });
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function suppStatus(supp: Supplement): "draft" | "compiled" | "signed" | "delivered" {
  const versions = supp.compiledReportVersions ?? [];
  const hasSigned = versions.some((v) => v.isSignedVersion && v.reportAttestationId);
  if (hasSigned) return "signed";
  if (versions.length > 0) return "compiled";
  return "draft";
}

function StatusBadge({ status }: { status: ReturnType<typeof suppStatus> }) {
  if (status === "signed")
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Attested
      </Badge>
    );
  if (status === "compiled")
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 gap-1">
        <Lock className="h-3 w-3" /> Compiled
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Clock className="h-3 w-3" /> Draft
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SupplementsPanel({ inspectionId }: { inspectionId: string }) {
  const { toast } = useToast();
  const { data: supplements, isLoading } = useSupplements(inspectionId);
  const createSupplement = useCreateSupplement(inspectionId);

  const [issueOpen, setIssueOpen] = useState(false);
  const [reason, setReason] = useState<SupplementReason | "">("");

  function handleIssue() {
    if (!reason) return;
    createSupplement.mutate(reason, {
      onSuccess: ({ supplement }) => {
        setIssueOpen(false);
        setReason("");
        toast({
          title: `${supplement.supplementNumber} created`,
          description: `${REASON_LABELS[supplement.supplementReason]} — add sections, then compile and attest.`,
        });
      },
      onError: (err) =>
        toast({
          title: "Could not issue supplement",
          description: err instanceof Error ? err.message : "Unknown error.",
          variant: "destructive",
        }),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Supplements</p>
          <p className="text-xs text-muted-foreground">
            Each supplement is its own attested document. The original package
            is never modified.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIssueOpen(true)}
        >
          <FilePlus className="h-4 w-4 mr-1.5" />
          Issue Supplement
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading supplements…
        </div>
      )}

      {!isLoading && (!supplements || supplements.length === 0) && (
        <p className="text-xs text-muted-foreground italic">
          No supplements issued yet.
        </p>
      )}

      {supplements && supplements.length > 0 && (
        <div className="divide-y rounded-md border">
          {supplements.map((supp) => {
            const status = suppStatus(supp);
            return (
              <div
                key={supp.id}
                className="flex items-center justify-between px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono font-medium">
                    {supp.supplementNumber}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {REASON_LABELS[supp.supplementReason]}
                  </span>
                </div>
                <StatusBadge status={status} />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Issue supplement dialog ──────────────────────────────────────── */}
      <Dialog
        open={issueOpen}
        onOpenChange={(open) => {
          if (!createSupplement.isPending) setIssueOpen(open);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Issue Supplement</DialogTitle>
            <DialogDescription className="text-xs">
              Choose the basis for this supplement. It will be compiled and
              attested as a separate document — the original package is
              unchanged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Supplement Reason
            </label>
            <Select
              value={reason}
              onValueChange={(v) => setReason(v as SupplementReason)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select reason…" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIssueOpen(false)}
              disabled={createSupplement.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={!reason || createSupplement.isPending}
              onClick={handleIssue}
            >
              {createSupplement.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FilePlus className="h-4 w-4 mr-2" />
              )}
              {createSupplement.isPending ? "Creating…" : "Create Supplement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
