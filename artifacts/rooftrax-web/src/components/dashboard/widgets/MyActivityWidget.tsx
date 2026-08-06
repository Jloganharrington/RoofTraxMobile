import React from 'react';
import { Loader2, AlertCircle, Target, TrendingUp, Clock, Users } from 'lucide-react';
import { useGetActivityStats } from '@workspace/api-client-react';

export function MyActivityWidget() {
  // No params — server clamps field_rep to scope='own'. No new endpoint needed.
  const { data, isLoading, isError } = useGetActivityStats();

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
        Could not load your activity.
      </div>
    );
  }

  const { period, competitive } = data.stats;

  return (
    <div className="space-y-4">
      {/* Today */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Today</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <StatCell icon={<Target className="h-3.5 w-3.5" />} label="Pins dropped" value={period.pinsDropped} />
          <StatCell icon={<TrendingUp className="h-3.5 w-3.5" />} label="Appointments" value={period.appointmentsSet} />
          <StatCell
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Hours tracked"
            value={period.hoursTracked != null ? Number(period.hoursTracked).toFixed(1) : null}
          />
          {/* appointmentsCompleted is always null server-side — intentionally omitted */}
        </div>
      </div>

      {/* 30-day competitive rank */}
      {competitive && competitive.cohortSize > 1 && (
        <div className="border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">30-day rank</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tabular-nums">#{competitive.myRank}</span>
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              of {competitive.cohortSize}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Me: {competitive.me.pinsDropped}p · {competitive.me.appointmentsSet}a &nbsp;·&nbsp;
            Team: {competitive.teamTotal.pinsDropped}p · {competitive.teamTotal.appointmentsSet}a
          </p>
        </div>
      )}
    </div>
  );
}

function StatCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string | null | undefined;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-muted-foreground text-xs mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-xl font-bold tabular-nums">
        {value == null ? '—' : value}
      </span>
    </div>
  );
}
