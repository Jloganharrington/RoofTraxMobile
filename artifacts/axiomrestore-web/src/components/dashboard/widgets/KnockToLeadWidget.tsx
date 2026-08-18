import { Loader2, AlertCircle, Users } from 'lucide-react';
import { useGetKnockToLeadWidget } from '@workspace/api-client-react';

export function KnockToLeadWidget() {
  const { data, isLoading, isError } = useGetKnockToLeadWidget();

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
        Could not load conversion data.
      </div>
    );
  }

  if (data.totalKnocks === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <Users className="h-8 w-8" />
        <p className="text-sm">No canvassing activity in the last {data.windowDays} days.</p>
      </div>
    );
  }

  const pct = (data.conversionRate * 100).toFixed(1);
  const top5 = data.repBreakdown.slice(0, 5);
  const remainder = data.repBreakdown.length - top5.length;

  return (
    <div className="space-y-4">
      {/* Hero number */}
      <div className="flex items-end gap-4">
        <div>
          <p className="text-4xl font-bold tabular-nums text-primary">{pct}%</p>
          <p className="text-xs text-muted-foreground mt-0.5">knock → appointment</p>
        </div>
        <div className="pb-1 space-y-0.5 text-right">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{data.totalLeads}</span>
            <span className="text-muted-foreground"> leads</span>
          </p>
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{data.totalKnocks}</span>
            <span className="text-muted-foreground"> knocks</span>
          </p>
        </div>
      </div>

      {/* Per-rep breakdown */}
      {top5.length > 0 && (
        <div className="border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Last {data.windowDays} days · by rep
          </p>
          <div className="space-y-1">
            {top5.map(rep => (
              <div key={rep.userId} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{rep.name}</span>
                <span className="tabular-nums text-muted-foreground">{rep.knocks}k</span>
                <span className="tabular-nums w-12 text-right font-medium">
                  {rep.knocks > 0 ? (rep.conversionRate * 100).toFixed(0) : '—'}%
                </span>
              </div>
            ))}
            {remainder > 0 && (
              <p className="text-xs text-muted-foreground pt-1">+{remainder} more reps</p>
            )}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60">
        Knock = any door-knock result incl. no-soliciting &nbsp;·&nbsp; Lead = appointment booked
      </p>
    </div>
  );
}
