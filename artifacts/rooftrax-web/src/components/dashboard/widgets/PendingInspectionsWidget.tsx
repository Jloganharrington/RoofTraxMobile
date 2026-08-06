import { Loader2, AlertCircle, ClipboardCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useGetPendingInspectionsWidget } from '@workspace/api-client-react';

// Included statuses:
//   'scheduled' — appointment is booked, field work hasn't started
//   'capturing' — rep is doing field work but hasn't submitted yet
// 'validating' is excluded — the rep has submitted; waiting on office review
// is the claim_blockers widget's job. Keeping concerns separated avoids the
// same inspection appearing in both widgets.

function fmtDuration(ms: number): string {
  const days = ms / (1000 * 60 * 60 * 24);
  if (days >= 2) return `${Math.floor(days)}d outstanding`;
  if (days >= 1) return '1d outstanding';
  const hrs = ms / (1000 * 60 * 60);
  if (hrs >= 1) return `${Math.floor(hrs)}h outstanding`;
  return '< 1h outstanding';
}

export function PendingInspectionsWidget() {
  const { data, isLoading, isError } = useGetPendingInspectionsWidget();

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
        Could not load pending inspections.
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <ClipboardCheck className="h-8 w-8" />
        <p className="text-sm">No outstanding inspections.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.scopedToSelf && (
        <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Your inspections</p>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {data.items.map((item) => (
          <div
            key={item.inspectionId}
            className="rounded-md border px-3 py-2 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium truncate flex-1">{item.label}</span>
              <div className="flex gap-1 flex-shrink-0">
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${
                    item.phase === 'preliminary'
                      ? 'border-blue-500/50 text-blue-600 dark:text-blue-400'
                      : 'border-orange-500/50 text-orange-600 dark:text-orange-400'
                  }`}
                >
                  {item.phase === 'preliminary' ? 'P1' : 'P2'}
                </Badge>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${
                    item.status === 'capturing'
                      ? 'border-green-500/50 text-green-600 dark:text-green-400'
                      : 'border-muted-foreground/30 text-muted-foreground'
                  }`}
                >
                  {item.status}
                </Badge>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
              <span>{item.ownerName ?? 'Unassigned'}</span>
              <span className="tabular-nums">{fmtDuration(item.outstandingMs)}</span>
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
