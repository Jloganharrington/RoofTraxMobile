import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GridLayout, noCompactor, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import { GripVertical } from 'lucide-react';
import type { DashboardWidgetMeta } from '@workspace/api-client-react';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import * as Widgets from './widgets';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// ── Registry ─────────────────────────────────────────────────────────────────

const WIDGET_REGISTRY: Record<string, React.ComponentType> = {
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

// ── Grid constants ────────────────────────────────────────────────────────────

const GRID_COLS    = 12;
const ROW_HEIGHT   = 60;   // px per row unit
const GRID_MARGIN: [number, number] = [12, 12];

type WidgetSize = 'sm' | 'md' | 'lg';

// Default width × height per catalog size (grid cells)
const SIZE_DEFAULTS: Record<WidgetSize, { w: number; h: number }> = {
  sm: { w: 3, h: 4 },
  md: { w: 6, h: 5 },
  lg: { w: 12, h: 6 },
};

// ── Cell type ─────────────────────────────────────────────────────────────────

/** Our persisted grid-cell shape — stored to the server and in React state. */
export interface GridCell {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Layout helpers ────────────────────────────────────────────────────────────

/** Pack widgets into a default grid layout based on their catalog size. */
function buildDefaultLayout(widgets: DashboardWidgetMeta[]): GridCell[] {
  const result: GridCell[] = [];
  let cx = 0;
  let rowTop = 0;

  for (const w of widgets) {
    const { w: ww, h } = SIZE_DEFAULTS[(w.size as WidgetSize) ?? 'md'];

    if (cx + ww > GRID_COLS) {
      rowTop = result.reduce((m, c) => Math.max(m, c.y + c.h), rowTop);
      cx = 0;
    }

    result.push({ key: w.key, x: cx, y: rowTop, w: ww, h });
    cx += ww;
  }

  return result;
}

/** Merge stored positions with the current widget list.
 *  Widgets missing from stored layout get default positions appended below. */
function mergeLayout(stored: GridCell[], widgets: DashboardWidgetMeta[]): GridCell[] {
  const storedMap = new Map(stored.map((c) => [c.key, c]));
  const merged: GridCell[] = [];
  const missing: DashboardWidgetMeta[] = [];

  for (const w of widgets) {
    const cell = storedMap.get(w.key);
    if (cell) merged.push(cell);
    else missing.push(w);
  }

  if (missing.length > 0) {
    const bottomY = merged.reduce((m, c) => Math.max(m, c.y + c.h), 0);
    buildDefaultLayout(missing).forEach((c) =>
      merged.push({ ...c, y: c.y + bottomY }),
    );
  }

  return merged;
}

/** Convert GridCell[] → react-grid-layout LayoutItem[], setting drag/resize flags. */
function toRglLayout(cells: GridCell[], editMode: boolean): LayoutItem[] {
  return cells.map((c) => ({
    i:           c.key,
    x:           c.x,
    y:           c.y,
    w:           c.w,
    h:           c.h,
    minW:        2,
    minH:        3,
    isDraggable: editMode,
    isResizable: editMode,
  }));
}

/** Convert react-grid-layout Layout (readonly) → GridCell[]. */
function fromRglLayout(layout: Layout): GridCell[] {
  return Array.from(layout).map((item) => ({
    key: item.i,
    x:   item.x,
    y:   item.y,
    w:   item.w,
    h:   item.h,
  }));
}

// ── Mobile detection ──────────────────────────────────────────────────────────

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 1024px)').matches
      : true,
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}

// ── WidgetCard ────────────────────────────────────────────────────────────────

function WidgetCard({
  title,
  editMode,
  children,
}: {
  title: string;
  editMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full rounded-lg border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 border-b border-border/50 flex-shrink-0 flex items-center gap-2">
        {editMode && (
          <span
            className="drag-handle cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground/70 flex-shrink-0 -ml-0.5 transition-colors"
            aria-hidden
          >
            <GripVertical className="h-4 w-4" />
          </span>
        )}
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">
          {title}
        </span>
      </div>
      {/* Body — fills remaining height so the card expands with the RGL item */}
      <div className="flex-1 p-4 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

// ── DashboardGrid ─────────────────────────────────────────────────────────────

export interface DashboardGridProps {
  widgets: DashboardWidgetMeta[];
  /** Stored grid positions from the server. Null → derive from catalog sizes. */
  gridLayout: GridCell[] | null;
  editMode: boolean;
  /** Called whenever the user moves or resizes a widget. */
  onLayoutChange: (cells: GridCell[]) => void;
}

export function DashboardGrid({
  widgets,
  gridLayout,
  editMode,
  onLayoutChange,
}: DashboardGridProps) {
  const isDesktop = useIsDesktop();

  // Compute the active cells (merge stored with current widget list)
  const activeCells = useMemo(
    () =>
      gridLayout
        ? mergeLayout(gridLayout, widgets)
        : buildDefaultLayout(widgets),
    [gridLayout, widgets],
  );

  const rglLayout = useMemo(
    () => toRglLayout(activeCells, editMode),
    [activeCells, editMode],
  );

  // useContainerWidth: attach containerRef to the wrapper div; `mounted` is
  // true once the width has been measured. Before mounting, render a hidden
  // placeholder so the container establishes its width immediately.
  const { width, containerRef, mounted } = useContainerWidth();

  const handleLayoutChange = useCallback(
    (layout: Layout) => {
      onLayoutChange(fromRglLayout(layout));
    },
    [onLayoutChange],
  );

  // ── Mobile: plain stacked list (no drag/resize) ───────────────────────────
  if (!isDesktop) {
    return (
      <div className="flex flex-col gap-4">
        {widgets.map((w) => {
          const Component = WIDGET_REGISTRY[w.key];
          if (!Component) return null;
          return (
            <div key={w.key} className="min-h-[10rem]">
              <WidgetCard title={w.title} editMode={false}>
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

  // ── Desktop: react-grid-layout ────────────────────────────────────────────
  const visibleKeys = new Set(widgets.map((w) => w.key));

  return (
    <>
      {/* Global resize-handle style override — scoped so it doesn't bleed */}
      <style>{`
        .rt-dashboard-grid .react-grid-item > .react-resizable-handle {
          display: ${editMode ? 'block' : 'none'};
        }
        .rt-dashboard-grid .react-grid-item > .react-resizable-handle::after {
          border-color: hsl(var(--primary) / 0.5);
        }
        .rt-dashboard-grid .react-grid-item.react-grid-placeholder {
          background: hsl(var(--primary) / 0.12);
          border: 1.5px dashed hsl(var(--primary) / 0.35);
          border-radius: 0.5rem;
          opacity: 1 !important;
        }
        .rt-dashboard-grid .react-grid-item {
          transition: ${editMode ? 'transform 120ms ease, width 120ms ease, height 120ms ease' : 'none'};
        }
      `}</style>

      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className="rt-dashboard-grid relative"
        style={
          editMode
            ? {
                backgroundImage:
                  'radial-gradient(circle, hsl(var(--primary) / 0.09) 1.5px, transparent 1.5px)',
                backgroundSize: '28px 28px',
                borderRadius: '0.75rem',
                padding: '4px',
              }
            : undefined
        }
      >
        {mounted && (
          <GridLayout
            width={width}
            layout={rglLayout}
            gridConfig={{
              cols:      GRID_COLS,
              rowHeight: ROW_HEIGHT,
              margin:    GRID_MARGIN,
            }}
            dragConfig={
              editMode ? { handle: '.drag-handle' } : undefined
            }
            onLayoutChange={handleLayoutChange}
            compactor={noCompactor}
            autoSize
          >
            {widgets.map((w) => {
              const Component = WIDGET_REGISTRY[w.key];
              if (!Component) return null;

              return (
                <div key={w.key}>
                  <WidgetCard title={w.title} editMode={editMode}>
                    <WidgetErrorBoundary widgetKey={w.key}>
                      <Component />
                    </WidgetErrorBoundary>
                  </WidgetCard>
                </div>
              );
            })}
          </GridLayout>
        )}

        {/* Pre-mount placeholder: invisible rows that give the container
            stable height so the first paint doesn't jump */}
        {!mounted && (
          <div style={{ minHeight: activeCells.length > 0 ? '400px' : '200px' }} />
        )}
      </div>
    </>
  );
}
