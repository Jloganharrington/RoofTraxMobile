/**
 * LiveActivityWidget — business-events feed (money + legally binding actions).
 *
 * Sources: payment_recorded, contract_signed, contract_voided, fipsa_signed,
 *          fipsa_voided, change_order_signed, change_order_approved,
 *          claim_status_changed.
 *
 * Manager+ only. Polls every 30 s, pauses when the tab is hidden.
 * Deep-links to the lead or inspection on click.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  DollarSign, FileText, FileX, ClipboardList, FileCheck,
  PenLine, CheckSquare, AlertTriangle, RefreshCw, Activity,
} from 'lucide-react';
import { useGetLiveActivityWidget } from '@workspace/api-client-react';
import type { LiveActivityItem } from '@workspace/api-client-react';
import { format, parseISO } from 'date-fns';

// ── Type metadata ─────────────────────────────────────────────────────────────

const TYPE_META: Record<LiveActivityItem['type'], {
  label: string;
  Icon:  React.ComponentType<{ className?: string }>;
  color: string;      // background pill
  text:  string;      // text color
}> = {
  payment_recorded:     { label: 'Payment',          Icon: DollarSign,    color: 'bg-emerald-100', text: 'text-emerald-700' },
  contract_signed:      { label: 'Contract Signed',  Icon: FileCheck,     color: 'bg-blue-100',    text: 'text-blue-700'    },
  contract_voided:      { label: 'Contract Voided',  Icon: FileX,         color: 'bg-red-100',     text: 'text-red-700'     },
  fipsa_signed:         { label: 'FIPSA Signed',     Icon: PenLine,       color: 'bg-violet-100',  text: 'text-violet-700'  },
  fipsa_voided:         { label: 'FIPSA Voided',     Icon: FileX,         color: 'bg-orange-100',  text: 'text-orange-700'  },
  change_order_signed:  { label: 'CO Signed',        Icon: ClipboardList, color: 'bg-cyan-100',    text: 'text-cyan-700'    },
  change_order_approved:{ label: 'CO Approved',      Icon: CheckSquare,   color: 'bg-teal-100',    text: 'text-teal-700'    },
  claim_status_changed: { label: 'Claim Status',     Icon: AlertTriangle, color: 'bg-amber-100',   text: 'text-amber-700'   },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function itemPath(item: LiveActivityItem): string | null {
  if (item.inspectionId) return `/inspections/${item.inspectionId}`;
  if (item.pinId)        return `/leads/${item.pinId}`;
  return null;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'MMM d, h:mm a');
  } catch {
    return '';
  }
}

// ── EventRow ─────────────────────────────────────────────────────────────────

function EventRow({
  item, onClick,
}: {
  item: LiveActivityItem;
  onClick: (path: string) => void;
}) {
  const meta = TYPE_META[item.type] ?? TYPE_META['payment_recorded'];
  const { Icon } = meta;
  const path   = itemPath(item);
  const isLink = !!path;

  const inner = (
    <div className={`flex items-start gap-3 px-3 py-2.5 text-left w-full ${isLink ? 'hover:bg-muted/50 cursor-pointer' : ''} transition-colors`}>
      {/* Icon badge */}
      <div className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${meta.color}`}>
        <Icon className={`h-3.5 w-3.5 ${meta.text}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${meta.text} ${meta.color} px-1.5 py-0.5 rounded`}>
            {meta.label}
          </span>
          {item.actorName && (
            <span className="text-[11px] text-muted-foreground truncate">{item.actorName}</span>
          )}
        </div>
        <p className="text-xs font-medium mt-0.5 leading-snug">{item.title}</p>
        {item.detail && (
          <p className={`text-xs mt-0.5 ${item.amountCents != null ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
            {item.detail}
          </p>
        )}
        {item.occurredAt && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{fmtTime(item.occurredAt)}</p>
        )}
      </div>

      {/* Arrow for linkable items */}
      {isLink && (
        <span className="text-muted-foreground text-xs mt-1 shrink-0">›</span>
      )}
    </div>
  );

  if (!isLink) return <div>{inner}</div>;
  return (
    <button className="w-full text-left" onClick={() => onClick(path!)}>
      {inner}
    </button>
  );
}

// ── LiveActivityWidget ────────────────────────────────────────────────────────

const POLL_INTERVAL        = 30_000; // 30 s
const LIVE_ACTIVITY_CAP   = 50;     // mirrors the server-side cap

export function LiveActivityWidget() {
  const [, navigate]    = useLocation();
  const [isVisible, setIsVisible] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isLoading, isError, refetch } = useGetLiveActivityWidget({});

  // Pause polling when the tab is hidden to avoid wasting bandwidth/CPU.
  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!isVisible) return;
    intervalRef.current = setInterval(() => { refetch(); }, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isVisible, refetch]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const capped = data?.capped ?? false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[120px]">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full min-h-[120px] text-sm text-destructive px-4 text-center">
        Failed to load activity feed. Check your connection.
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[160px] px-5 text-center space-y-2">
        <Activity className="h-7 w-7 text-muted-foreground opacity-40" />
        <div>
          <p className="text-sm font-medium">No activity yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Payments, signed contracts, change orders, and field inspection
            agreements will appear here as they happen.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Claim status changes appear from now on — no prior history was stored.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header strip */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Live Activity</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {capped ? `${total}+ events` : `${total} event${total !== 1 ? 's' : ''}`}
          </span>
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-muted/50"
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto divide-y">
        {items.map((item) => (
          <EventRow
            key={item.id}
            item={item}
            onClick={(path) => navigate(path)}
          />
        ))}
        {capped && (
          <p className="px-3 py-2 text-[11px] text-muted-foreground text-center">
            Showing most recent {LIVE_ACTIVITY_CAP} of {total}+ events
          </p>
        )}
      </div>

      {/* Footer — polling status */}
      <div className="px-3 py-1.5 border-t shrink-0 flex items-center gap-1.5">
        <div className={`h-1.5 w-1.5 rounded-full ${isVisible ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
        <span className="text-[10px] text-muted-foreground">
          {isVisible ? 'Live · refreshes every 30 s' : 'Paused (tab hidden)'}
        </span>
      </div>
    </div>
  );
}
