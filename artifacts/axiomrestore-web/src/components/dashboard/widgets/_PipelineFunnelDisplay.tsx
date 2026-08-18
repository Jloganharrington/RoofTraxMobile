/**
 * Shared rendering component for the three pipeline-funnel widgets
 * (sales_funnel, insurance_claims, production_pipeline).
 * NOT exported from the barrel — imported directly by each widget.
 */
import { Loader2, AlertCircle, TrendingDown } from 'lucide-react';
import type { PipelineFunnelEnvelope } from '@workspace/api-client-react';

interface Props {
  data: PipelineFunnelEnvelope;
  /** Stage keys to render with full-opacity primary colour (for insurance claim lifecycle). */
  highlightKeys?: ReadonlySet<string>;
}

function fmtDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
// exported so parent can use it for outstanding duration
export { fmtDuration };

export function PipelineFunnelDisplay({ data, highlightKeys }: Props) {
  const activeStages   = data.stages.filter((s) => !s.isTerminal);
  const terminalStages = data.stages.filter((s) => s.isTerminal);
  const maxCount = Math.max(...activeStages.map((s) => s.count), 1);

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-primary">{data.activeTotal}</span>
        <span className="text-sm text-muted-foreground">active leads</span>
      </div>

      {/* Active stage bars */}
      <div className="space-y-2">
        {activeStages.map((stage) => {
          const isHighlighted = highlightKeys?.has(stage.key) ?? true;
          const pct = (stage.count / maxCount) * 100;
          return (
            <div key={stage.key}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className={isHighlighted ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                  {stage.label}
                </span>
                <span className="tabular-nums font-medium ml-2">{stage.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    background: isHighlighted
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--primary) / 0.4)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Terminal / archived stages */}
      {data.terminalTotal > 0 && (
        <div className="border-t pt-2">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 mb-1">
            <TrendingDown className="h-3 w-3" />
            <span>ARCHIVED · {data.terminalTotal} total</span>
          </div>
          {terminalStages
            .filter((s) => s.count > 0)
            .map((s) => (
              <div key={s.key} className="flex items-center justify-between text-xs text-muted-foreground/50 mt-0.5">
                <span className="truncate">{s.label}</span>
                <span className="tabular-nums">{s.count}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Re-usable loading / error states for pipeline funnel widgets */
export function FunnelLoading() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function FunnelError({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      Could not load {label}.
    </div>
  );
}
