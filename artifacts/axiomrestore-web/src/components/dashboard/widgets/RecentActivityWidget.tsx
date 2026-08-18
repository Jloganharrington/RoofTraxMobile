import { Loader2, AlertCircle, Activity, Zap, ArrowRight } from 'lucide-react';
import { useGetRecentActivityWidget } from '@workspace/api-client-react';

// Company-wide activity feed merging claim events + stage transitions.
// Payloads are never shown — only the event type label and actor name.
// NULL actor (system-triggered stage transitions) appears as "System".

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ItemIcon({ kind }: { kind: string }) {
  if (kind === 'stage_transition') {
    return <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />;
  }
  return <Zap className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />;
}

export function RecentActivityWidget() {
  const { data, isLoading, isError } = useGetRecentActivityWidget();

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
        Could not load activity feed.
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <Activity className="h-8 w-8" />
        <p className="text-sm">No recent activity.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
      {data.items.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors"
        >
          <div className="mt-0.5">
            <ItemIcon kind={item.kind} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground truncate">{item.text}</p>
            <p className="text-[10px] text-muted-foreground truncate">{item.actorName}</p>
          </div>
          <span
            className="text-[10px] tabular-nums text-muted-foreground/60 flex-shrink-0 mt-0.5"
            title={new Date(item.createdAt).toLocaleString()}
          >
            {relativeTime(item.createdAt)}
          </span>
        </div>
      ))}
      {data.capped && (
        <p className="text-[10px] text-muted-foreground/60 px-2 pt-1">
          Showing {data.items.length} of {data.total} events
        </p>
      )}
    </div>
  );
}
