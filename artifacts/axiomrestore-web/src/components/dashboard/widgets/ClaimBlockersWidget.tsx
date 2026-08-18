import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useGetClaimBlockersWidget } from '@workspace/api-client-react';

// Reuses the same blocked-claim logic as ActionRequiredWidget (via the shared
// fetchBlockedClaims() helper on the server). The only differences are:
//   - workflow-gated (insurance_retail) rather than manager-gated
//   - scoped to the actor's own pins when they are a field_rep
// The shared helper prevents the two widget implementations drifting apart.

const BLOCKER_LABELS: Record<string, string> = {
  fipsa_unsigned:     'FIPSA unsigned',
  validating:         'Validating',
  capturing_stalled:  'Stalled',
};

const BLOCKER_VARIANT: Record<string, string> = {
  fipsa_unsigned:    'border-red-500/60 text-red-600 dark:text-red-400',
  validating:        'border-yellow-500/60 text-yellow-600 dark:text-yellow-400',
  capturing_stalled: 'border-orange-500/60 text-orange-600 dark:text-orange-400',
};

export function ClaimBlockersWidget() {
  const { data, isLoading, isError } = useGetClaimBlockersWidget();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        Could not load blocked claims.
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <ShieldCheck className="h-8 w-8" />
        <p className="text-sm">No blocked claims.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.scopedToSelf && (
        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Your claims</p>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {data.items.map((item) => (
          <div
            key={item.inspectionId}
            className="rounded-md border px-3 py-2 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium truncate flex-1">{item.label}</span>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${BLOCKER_VARIANT[item.blockerKind] ?? ''}`}
              >
                {BLOCKER_LABELS[item.blockerKind] ?? item.blockerKind}
              </Badge>
            </div>
            <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
              <span>{item.ownerName ?? 'Unassigned'}</span>
              <span className="tabular-nums">{item.stuckForLabel}</span>
            </div>
          </div>
        ))}
      </div>

      {data.capped && (
        <p className="text-[10px] text-muted-foreground/60">
          Showing {data.items.length} of {data.total}
        </p>
      )}
    </div>
  );
}
