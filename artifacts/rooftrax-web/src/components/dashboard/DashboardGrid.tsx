import { type ComponentType } from 'react';
import type { DashboardWidgetMeta } from '@workspace/api-client-react';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import * as Widgets from './widgets';

// ── Registry ─────────────────────────────────────────────────────────────────
// Maps every WIDGET_CATALOG key to its React component.
// Keys not present here are skipped silently — they never crash the dashboard.

const WIDGET_REGISTRY: Record<string, ComponentType> = {
  quick_add:            Widgets.QuickAddWidget,
  my_day:               Widgets.MyDayWidget,
  my_activity:          Widgets.MyActivityWidget,
  recent_activity:      Widgets.RecentActivityWidget,
  pending_inspections:  Widgets.PendingInspectionsWidget,
  claim_blockers:       Widgets.ClaimBlockersWidget,
  action_required:      Widgets.ActionRequiredWidget,
  sales_funnel:         Widgets.SalesFunnelWidget,
  insurance_claims:     Widgets.InsuranceClaimsWidget,
  canvassing_heatmap:   Widgets.CanvassingHeatmapWidget,
  knock_to_lead:        Widgets.KnockToLeadWidget,
  production_pipeline:  Widgets.ProductionPipelineWidget,
  live_team:            Widgets.LiveTeamWidget,
};

// ── Grid sizing ───────────────────────────────────────────────────────────────
// 4-column grid on desktop. sm occupies 1 col, md 2 cols, lg full width.
// On mobile everything stacks to full width.

type WidgetSize = 'sm' | 'md' | 'lg';

const COL_SPAN: Record<WidgetSize, string> = {
  sm: 'col-span-4 sm:col-span-2 lg:col-span-1',
  md: 'col-span-4 lg:col-span-2',
  lg: 'col-span-4',
};

// Min-height baked into each card so the layout doesn't jump when widget data
// arrives. Sized from the manifest's `size` field — the core of the skeleton
// constraint from the spec.
const CARD_MIN_HEIGHT: Record<WidgetSize, string> = {
  sm: 'min-h-[9rem]',
  md: 'min-h-[11rem]',
  lg: 'min-h-[14rem]',
};

// ── WidgetCard ────────────────────────────────────────────────────────────────

function WidgetCard({
  title,
  size,
  children,
}: {
  title: string;
  size: WidgetSize;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col rounded-lg border bg-card shadow-sm ${CARD_MIN_HEIGHT[size]}`}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-border/50 flex-shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
      </div>
      {/* Body */}
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}

// ── DashboardGrid ─────────────────────────────────────────────────────────────

interface Props {
  widgets: DashboardWidgetMeta[];
}

export function DashboardGrid({ widgets }: Props) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {widgets.map((w) => {
        const Component = WIDGET_REGISTRY[w.key];

        // Unrecognized key → skip silently. Must never crash or blank the page.
        // This lets the server ship a new widget before the client has it.
        if (!Component) return null;

        const size = (w.size as WidgetSize) ?? 'md';

        return (
          <div key={w.key} className={COL_SPAN[size]}>
            <WidgetCard title={w.title} size={size}>
              <WidgetErrorBoundary widgetKey={w.key}>
                <Component />
              </WidgetErrorBoundary>
            </WidgetCard>
          </div>
        );
      })}
    </div>
  );
}
