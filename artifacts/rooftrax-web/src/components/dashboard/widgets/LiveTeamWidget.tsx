import { Loader2, AlertCircle, MapPin, Circle } from 'lucide-react';
import { useListTeamLocations } from '@workspace/api-client-react';

// No new endpoint — reuses GET /location/team which already enforces
// isManagerOrAdmin and scopes by companyId.

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isStale(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > 30 * 60_000; // > 30 min
}

export function LiveTeamWidget() {
  const { data, isLoading, isError } = useListTeamLocations();

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
        Could not load team locations.
      </div>
    );
  }

  const locations = data.locations ?? [];

  if (locations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <MapPin className="h-8 w-8" />
        <p className="text-sm">No location data yet.</p>
      </div>
    );
  }

  // Sort: clocked-in first, then by recency
  const sorted = [...locations].sort((a, b) => {
    if (a.isClockedIn !== b.isClockedIn) return a.isClockedIn ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const activeCount = locations.filter(l => l.isClockedIn).length;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{activeCount}</span> active
        {' · '}
        {locations.length} with location
      </p>

      {/* Rep list */}
      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
        {sorted.map(loc => {
          const stale = isStale(loc.updatedAt);
          const name = [loc.firstName, loc.lastName].filter(Boolean).join(' ') || 'Unknown';
          return (
            <div
              key={loc.userId}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
            >
              {/* Status dot */}
              <Circle
                className={`h-2.5 w-2.5 flex-shrink-0 ${
                  loc.isClockedIn
                    ? 'fill-green-500 text-green-500'
                    : 'fill-muted-foreground/40 text-muted-foreground/40'
                }`}
              />

              {/* Name */}
              <span className="flex-1 text-sm font-medium truncate">{name}</span>

              {/* Staleness */}
              <span
                className={`text-xs tabular-nums ${
                  stale ? 'text-muted-foreground/60' : 'text-muted-foreground'
                }`}
                title={new Date(loc.updatedAt).toLocaleString()}
              >
                {/* last-known position, not live tracking */}
                {relativeTime(loc.updatedAt)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground/60">
        Last-known position · not live tracking
      </p>
    </div>
  );
}
