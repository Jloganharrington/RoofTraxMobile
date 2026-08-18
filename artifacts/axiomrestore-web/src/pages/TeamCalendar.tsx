/**
 * TeamCalendar — unified shared calendar for all four scheduling sources:
 *   - Phase 1 (preliminary) inspections
 *   - Phase 2 (forensic) inspections
 *   - Retail appointments (pins.appointment_at)
 *   - Adjuster meetings (pins.adjusterMeetingDate)
 *
 * Views: Month and Week. Items are points in time, not blocks.
 * Colour + icon encode type (never colour alone).
 * Field reps see only their own items; managers see the whole company.
 */

import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, addWeeks, subWeeks,
  isSameMonth, isSameDay, format, parseISO, isToday,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, Calendar, ClipboardCheck,
  MapPin, Users, AlertCircle, Loader2,
} from 'lucide-react';
import { useGetCalendarFeed } from '@workspace/api-client-react';
import type { CalendarItem } from '@workspace/api-client-react';

// ── Type metadata ─────────────────────────────────────────────────────────────

const TYPE_META: Record<CalendarItem['type'], {
  label: string;
  color: string;
  dot: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  inspection_phase1: {
    label:  'Phase 1 Inspection',
    color:  'bg-violet-100 text-violet-800 border-violet-200',
    dot:    'bg-violet-500',
    icon:   ClipboardCheck,
  },
  inspection_phase2: {
    label:  'Phase 2 Inspection',
    color:  'bg-blue-100 text-blue-800 border-blue-200',
    dot:    'bg-blue-500',
    icon:   ClipboardCheck,
  },
  retail_appointment: {
    label:  'Appointment',
    color:  'bg-emerald-100 text-emerald-800 border-emerald-200',
    dot:    'bg-emerald-500',
    icon:   MapPin,
  },
  adjuster_meeting: {
    label:  'Adjuster Meeting',
    color:  'bg-amber-100 text-amber-800 border-amber-200',
    dot:    'bg-amber-500',
    icon:   Users,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return format(parseISO(iso), 'h:mm a');
}

function itemPath(item: CalendarItem): string {
  if (item.inspectionId) return `/inspections/${item.inspectionId}`;
  if (item.pinId)        return `/leads/${item.pinId}`;
  return '#';
}

// ── EventPill ─────────────────────────────────────────────────────────────────

function EventPill({
  item, onClick, compact = false,
}: {
  item: CalendarItem;
  onClick: (item: CalendarItem) => void;
  compact?: boolean;
}) {
  const meta   = TYPE_META[item.type];
  const Icon   = meta.icon;
  const isUnassigned = !item.assignedUserId;

  return (
    <button
      onClick={() => onClick(item)}
      className={`w-full text-left rounded border px-1.5 py-0.5 text-[11px] leading-tight flex items-center gap-1 truncate ${meta.color} ${isUnassigned ? 'ring-1 ring-orange-400 ring-inset' : ''}`}
      title={`${meta.label}${isUnassigned ? ' — Unassigned' : item.assignedUserName ? ` — ${item.assignedUserName}` : ''}\n${item.title}\n${fmtTime(item.startsAt)}`}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {!compact && (
        <span className="truncate">
          {fmtTime(item.startsAt)} {item.title}
        </span>
      )}
      {compact && <span className="sr-only">{item.title}</span>}
    </button>
  );
}

// ── MonthView ─────────────────────────────────────────────────────────────────

function MonthView({
  anchor, items, onNavigate, onItemClick,
}: {
  anchor:      Date;
  items:       CalendarItem[];
  onNavigate:  (d: Date) => void;
  onItemClick: (item: CalendarItem) => void;
}) {
  const monthStart = startOfMonth(anchor);
  const monthEnd   = endOfMonth(anchor);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd    = endOfWeek(monthEnd,     { weekStartsOn: 0 });

  const days: Date[] = [];
  let cur = gridStart;
  while (cur <= gridEnd) { days.push(cur); cur = addDays(cur, 1); }

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = format(parseISO(item.startsAt), 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return map;
  }, [items]);

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between px-1 mb-3">
        <button onClick={() => onNavigate(subMonths(anchor, 1))} className="p-1 rounded hover:bg-muted">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="font-semibold text-base">{format(anchor, 'MMMM yyyy')}</h2>
        <button onClick={() => onNavigate(addMonths(anchor, 1))} className="p-1 rounded hover:bg-muted">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 text-center">
        {DAYS.map((d) => (
          <div key={d} className="text-[11px] font-medium text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 border-l border-t">
        {days.map((day) => {
          const key       = format(day, 'yyyy-MM-dd');
          const dayItems  = byDay.get(key) ?? [];
          const inMonth   = isSameMonth(day, anchor);
          const today     = isToday(day);
          const MAX_SHOW  = 3;
          const overflow  = dayItems.length - MAX_SHOW;
          return (
            <div
              key={key}
              className={`border-r border-b min-h-[80px] p-1 ${!inMonth ? 'bg-muted/30' : ''}`}
            >
              <div className={`text-xs font-medium mb-1 w-5 h-5 flex items-center justify-center rounded-full ${
                today ? 'bg-primary text-primary-foreground' : inMonth ? '' : 'text-muted-foreground'
              }`}>
                {format(day, 'd')}
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, MAX_SHOW).map((item) => (
                  <EventPill key={item.id} item={item} onClick={onItemClick} />
                ))}
                {overflow > 0 && (
                  <p className="text-[10px] text-muted-foreground pl-1">+{overflow} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── WeekView ──────────────────────────────────────────────────────────────────

function WeekView({
  anchor, items, onNavigate, onItemClick,
}: {
  anchor:      Date;
  items:       CalendarItem[];
  onNavigate:  (d: Date) => void;
  onItemClick: (item: CalendarItem) => void;
}) {
  const weekStart = startOfWeek(anchor, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = format(parseISO(item.startsAt), 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return map;
  }, [items]);

  return (
    <div>
      {/* Week nav */}
      <div className="flex items-center justify-between px-1 mb-3">
        <button onClick={() => onNavigate(subWeeks(anchor, 1))} className="p-1 rounded hover:bg-muted">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="font-semibold text-base">
          {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
        </h2>
        <button onClick={() => onNavigate(addWeeks(anchor, 1))} className="p-1 rounded hover:bg-muted">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-2">
        {days.map((day) => {
          const key      = format(day, 'yyyy-MM-dd');
          const dayItems = (byDay.get(key) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const today    = isToday(day);
          return (
            <div key={key} className={`rounded-lg border ${today ? 'border-primary/40' : ''}`}>
              <div className={`px-3 py-2 rounded-t-lg text-sm font-medium flex items-center gap-2 ${today ? 'bg-primary/8 text-primary' : 'bg-muted/40'}`}>
                <span>{format(day, 'EEE')}</span>
                <span className={`text-xs ${today ? '' : 'text-muted-foreground'}`}>{format(day, 'MMM d')}</span>
                {today && <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">Today</span>}
              </div>
              {dayItems.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">No events</div>
              ) : (
                <div className="px-2 py-2 space-y-1.5">
                  {dayItems.map((item) => {
                    const meta = TYPE_META[item.type];
                    const Icon = meta.icon;
                    const isUnassigned = !item.assignedUserId;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onItemClick(item)}
                        className={`w-full text-left rounded-lg border px-3 py-2 text-sm flex items-start gap-3 ${meta.color} ${isUnassigned ? 'ring-1 ring-orange-400 ring-inset' : ''}`}
                      >
                        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                          <div className={`h-2 w-2 rounded-full ${meta.dot}`} />
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-[11px] uppercase tracking-wide opacity-70">{meta.label}</span>
                            <span className="text-xs font-semibold">{fmtTime(item.startsAt)}</span>
                            {isUnassigned && (
                              <span className="flex items-center gap-0.5 text-[10px] text-orange-700 bg-orange-100 px-1.5 rounded">
                                <AlertCircle className="h-2.5 w-2.5" /> Unassigned
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium mt-0.5 truncate">{item.title}</p>
                          {item.propertyAddress && (
                            <p className="text-xs text-current opacity-70 truncate">{item.propertyAddress}</p>
                          )}
                          {item.assignedUserName && (
                            <p className="text-xs opacity-60">{item.assignedUserName}</p>
                          )}
                          {item.status && (
                            <p className="text-[10px] opacity-60 capitalize mt-0.5">{item.status.replace('_', ' ')}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ItemDetailSheet ───────────────────────────────────────────────────────────

function ItemDetailSheet({
  item, onClose, onNavigate,
}: {
  item:       CalendarItem;
  onClose:    () => void;
  onNavigate: (path: string) => void;
}) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  const path = itemPath(item);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl border shadow-xl w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl ${meta.color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{meta.label}</p>
            <p className="font-semibold text-sm leading-tight">{item.title}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-muted-foreground w-20 shrink-0">When</span>
            <span className="font-medium">{format(parseISO(item.startsAt), 'EEE, MMM d yyyy · h:mm a')}</span>
          </div>
          {item.propertyAddress && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Property</span>
              <span>{item.propertyAddress}</span>
            </div>
          )}
          {item.assignedUserName ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Assigned</span>
              <span>{item.assignedUserName}</span>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="text-muted-foreground w-20 shrink-0">Assigned</span>
              <span className="flex items-center gap-1 text-orange-700 font-medium">
                <AlertCircle className="h-3.5 w-3.5" /> Unassigned
              </span>
            </div>
          )}
          {item.status && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Status</span>
              <span className="capitalize">{item.status.replace('_', ' ')}</span>
            </div>
          )}
        </div>

        {path !== '#' && (
          <button
            onClick={() => { onNavigate(path); onClose(); }}
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            Open Lead / Inspection →
          </button>
        )}
      </div>
    </div>
  );
}

// ── TeamCalendar (main page) ──────────────────────────────────────────────────

type View = 'month' | 'week';
const ITEM_TYPES: CalendarItem['type'][] = [
  'inspection_phase1', 'inspection_phase2', 'retail_appointment', 'adjuster_meeting',
];

export default function TeamCalendar() {
  const [, navigate]    = useLocation();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => new Date());

  // Filters
  const [activeTypes, setActiveTypes] = useState<Set<CalendarItem['type']>>(new Set(ITEM_TYPES));
  const [filterAssignee, setFilterAssignee] = useState<string>('');

  // Detail sheet
  const [selected, setSelected] = useState<CalendarItem | null>(null);

  // Compute range for the calendar feed — we always fetch the full view window
  // plus one buffer month on each side so navigation is instant.
  const { from, to } = useMemo(() => {
    if (view === 'month') {
      return {
        from: startOfWeek(startOfMonth(subMonths(anchor, 0)), { weekStartsOn: 0 }).toISOString(),
        to:   endOfWeek(endOfMonth(anchor),                   { weekStartsOn: 0 }).toISOString(),
      };
    }
    return {
      from: startOfWeek(anchor, { weekStartsOn: 0 }).toISOString(),
      to:   endOfWeek(anchor,   { weekStartsOn: 0 }).toISOString(),
    };
  }, [anchor, view]);

  const { data, isLoading, isError } = useGetCalendarFeed({ from, to });

  // Collect unique assignee names for the manager filter
  const assigneeNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of data?.items ?? []) {
      if (item.assignedUserName) names.add(item.assignedUserName);
    }
    return [...names].sort();
  }, [data]);

  // Apply filters
  const filtered = useMemo(() => {
    return (data?.items ?? []).filter((item) => {
      if (!activeTypes.has(item.type)) return false;
      if (filterAssignee && item.assignedUserName !== filterAssignee) return false;
      return true;
    });
  }, [data, activeTypes, filterAssignee]);

  function toggleType(t: CalendarItem['type']) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-base">Team Calendar</h1>
          <div className="ml-auto flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg border overflow-hidden">
              {(['month', 'week'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            {/* Today button */}
            <button
              onClick={() => setAnchor(new Date())}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-muted/50"
            >
              Today
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type filters */}
          {ITEM_TYPES.map((t) => {
            const meta = TYPE_META[t];
            const Icon = meta.icon;
            const on   = activeTypes.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                  on ? meta.color : 'text-muted-foreground border-transparent bg-muted/40'
                }`}
              >
                <Icon className="h-3 w-3" />
                {meta.label}
              </button>
            );
          })}

          {/* Assignee filter (shown when there are multiple assignees or unassigned items) */}
          {assigneeNames.length > 0 && (
            <select
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              className="ml-auto text-xs rounded-lg border px-2 py-1 bg-card"
            >
              <option value="">All reps</option>
              <option value="">— Unassigned —</option>
              {assigneeNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          )}
        </div>

        {/* Legend — unassigned badge explanation */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-orange-300 text-orange-700 bg-orange-50">
            <AlertCircle className="h-3 w-3" /> Orange border = Unassigned
          </span>
          <span>Click any event to view details and navigate.</span>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="text-center py-16 text-sm text-destructive">
            Failed to load calendar. Check your connection and try again.
          </div>
        )}

        {!isLoading && !isError && data?.items.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <Calendar className="h-10 w-10 mx-auto text-muted-foreground opacity-30" />
            <div>
              <p className="font-medium">Nothing scheduled here</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                Schedule Phase 1 or Phase 2 inspections from the Inspections tab,
                set retail appointments from a lead's profile, or record adjuster
                meeting dates in the Insurance fields.
              </p>
            </div>
          </div>
        )}

        {!isLoading && !isError && data && (
          view === 'month' ? (
            <MonthView
              anchor={anchor}
              items={filtered}
              onNavigate={setAnchor}
              onItemClick={setSelected}
            />
          ) : (
            <WeekView
              anchor={anchor}
              items={filtered}
              onNavigate={setAnchor}
              onItemClick={setSelected}
            />
          )
        )}
      </div>

      {/* Detail sheet */}
      {selected && (
        <ItemDetailSheet
          item={selected}
          onClose={() => setSelected(null)}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}
