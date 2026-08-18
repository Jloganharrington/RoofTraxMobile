/**
 * Retail Pipeline — 10-stage inline exit-task kanban.
 * Every stage exit is performable from the card in ≤2 clicks.
 * archived_lost leads are hidden by default — toggle "Show Lost" to reveal them.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Shell } from '@/components/layout/Shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DollarSign,
  FileText,
  User,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useGetRetailPipeline,
  getRetailPipelineQueryKey,
  type RetailLead,
} from '@/lib/claimHubApi';
import { StageCard } from '@/components/pipeline/StageCard';
import {
  AssignUserWidget,
  DatetimeWidget,
  MoneyConfirmWidget,
  OutcomeButtonsWidget,
} from '@/components/pipeline/widgets';

// ---------------------------------------------------------------------------
// Stage column definitions (spec order)
// ---------------------------------------------------------------------------

interface RetailStageCol {
  key: string;
  label: string;
  /** `border-*` class used for the stage pill nav */
  accent: string;
  /** `text-*` class for stage label coloring */
  textAccent: string;
  /** `bg-*` class for the 3 px accent pip in accordion section headers */
  pipBg: string;
  isLoopStage: boolean;
  isTerminal: boolean;
}

const RETAIL_STAGE_COLS: RetailStageCol[] = [
  { key: 'pin_dropped',       label: 'Pin Dropped',       accent: 'border-slate-400',   textAccent: 'text-slate-400',   pipBg: 'bg-slate-400',   isLoopStage: false, isTerminal: false },
  { key: 'appt_needed',       label: 'Appt. Needed',      accent: 'border-sky-500',     textAccent: 'text-sky-400',     pipBg: 'bg-sky-500',     isLoopStage: false, isTerminal: false },
  { key: 'appt_scheduled',    label: 'Appt. Scheduled',   accent: 'border-blue-500',    textAccent: 'text-blue-400',    pipBg: 'bg-blue-500',    isLoopStage: true,  isTerminal: false },
  { key: 'appt_complete',     label: 'Appt. Complete',    accent: 'border-indigo-500',  textAccent: 'text-indigo-400',  pipBg: 'bg-indigo-500',  isLoopStage: false, isTerminal: false },
  { key: 'proposal_provided', label: 'Proposal Provided', accent: 'border-violet-500',  textAccent: 'text-violet-400',  pipBg: 'bg-violet-500',  isLoopStage: false, isTerminal: false },
  { key: 'follow_up',         label: 'Follow Up',         accent: 'border-amber-500',   textAccent: 'text-amber-400',   pipBg: 'bg-amber-500',   isLoopStage: true,  isTerminal: false },
  { key: 'contract_pending',  label: 'Contract Pending',  accent: 'border-orange-500',  textAccent: 'text-orange-400',  pipBg: 'bg-orange-500',  isLoopStage: true,  isTerminal: false },
  { key: 'contract_signed',   label: 'Contract Signed',   accent: 'border-teal-500',    textAccent: 'text-teal-400',    pipBg: 'bg-teal-500',    isLoopStage: false, isTerminal: false },
  { key: 'deposit_received',  label: 'Deposit Received',  accent: 'border-emerald-500', textAccent: 'text-emerald-400', pipBg: 'bg-emerald-500', isLoopStage: false, isTerminal: false },
  { key: 'archived_lost',     label: 'Archived – Lost',   accent: 'border-red-700',     textAccent: 'text-red-400',     pipBg: 'bg-red-700',     isLoopStage: false, isTerminal: true  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Base Tailwind classes for compact action trigger buttons in card footers */
const COMPACT_BTN =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ' +
  'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 ' +
  'text-white text-[11px] font-semibold transition-colors whitespace-nowrap select-none';

const REP_COLORS = [
  'bg-orange-500', 'bg-sky-500', 'bg-violet-500', 'bg-teal-500',
  'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-indigo-500',
];

/** Picks a stable avatar background color derived from the rep's name. */
function getRepColor(name: string | null): string {
  if (!name) return 'bg-slate-600';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return REP_COLORS[h % REP_COLORS.length];
}

/** Optional status hint shown on the card body for certain stages. */
function getStageStatus(stage: string): string | null {
  if (stage === 'appt_complete')    return 'Awaiting proposal';
  if (stage === 'contract_pending') return 'Awaiting signature';
  return null;
}

/** Outcome options shared by ProposalProvided and FollowUp stages */
const PROPOSAL_OUTCOMES = [
  { key: 'won',       label: 'Won — Contract',  toStage: 'contract_pending' },
  { key: 'follow_up', label: 'Follow-Up',        toStage: 'follow_up'        },
  { key: 'lost',      label: 'Lost',             toStage: 'archived_lost'    },
];

/**
 * Compact local button for appt_scheduled — tracks confirmed state without
 * advancing the stage (appointment completion is logged in-field by the rep).
 */
function ApptScheduledButton() {
  const [confirmed, setConfirmed] = useState(false);
  if (confirmed) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold">
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        Confirmed
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setConfirmed(true)} className={COMPACT_BTN}>
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      Confirm Appt.
    </button>
  );
}

// ---------------------------------------------------------------------------
// Retail card
// ---------------------------------------------------------------------------

function RetailCard({
  lead,
  colDef,
  onAdvance,
}: {
  lead: RetailLead;
  colDef: RetailStageCol;
  onAdvance: () => void;
}) {
  const stage       = lead.stageKey ?? lead.retailStage;
  const [widgetOpen, setWidgetOpen] = useState(false);
  const repInitial  = lead.repName ? lead.repName.trim()[0].toUpperCase() : '?';
  const avatarColor = getRepColor(lead.repName);
  const stageStatus = getStageStatus(stage);

  const openWidget    = () => setWidgetOpen(true);
  const closeWidget   = () => setWidgetOpen(false);
  const handleAdvance = () => { setWidgetOpen(false); onAdvance(); };

  /** Compact trigger shown in footer right (hidden while form is open). */
  function renderFooterAction(): ReactNode {
    if (widgetOpen) return null;
    switch (stage) {
      case 'pin_dropped':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <UserPlus className="h-3 w-3 shrink-0" />Assign Rep
          </button>
        );
      case 'appt_needed':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <Calendar className="h-3 w-3 shrink-0" />Schedule
          </button>
        );
      case 'appt_scheduled':
        return <ApptScheduledButton />;
      case 'appt_complete':
        return (
          <Link href={`/leads/${lead.id}`}>
            <span className={COMPACT_BTN}>
              <FileText className="h-3 w-3 shrink-0" />Proposal Builder
            </span>
          </Link>
        );
      case 'proposal_provided':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <ChevronRight className="h-3 w-3 shrink-0" />Next Step
          </button>
        );
      case 'follow_up':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <ChevronRight className="h-3 w-3 shrink-0" />Log Outcome
          </button>
        );
      case 'contract_pending':
        return (
          <Link href={`/leads/${lead.id}`}>
            <span className={COMPACT_BTN}>
              <FileText className="h-3 w-3 shrink-0" />Generate
            </span>
          </Link>
        );
      case 'contract_signed':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <DollarSign className="h-3 w-3 shrink-0" />Collect Deposit
          </button>
        );
      case 'deposit_received':
        return (
          <button type="button" onClick={openWidget} className={COMPACT_BTN}>
            <UserPlus className="h-3 w-3 shrink-0" />Assign PM
          </button>
        );
      default:
        return null;
    }
  }

  /** Inline expanded form — shown only when widgetOpen is true. */
  function renderWidgetForm(): ReactNode {
    if (!widgetOpen) return null;
    switch (stage) {
      case 'pin_dropped':
        return (
          <AssignUserWidget
            leadId={lead.id}
            toStage="appt_needed"
            config={{ label: 'Assign Sales Rep' }}
            onSuccess={handleAdvance}
            onClose={closeWidget}
          />
        );
      case 'appt_needed':
        return (
          <DatetimeWidget
            leadId={lead.id}
            toStage="appt_scheduled"
            config={{ label: 'Schedule Appt.', setsNextAction: true }}
            onSuccess={handleAdvance}
            onClose={closeWidget}
          />
        );
      case 'proposal_provided':
        return (
          <OutcomeButtonsWidget
            leadId={lead.id}
            toStage=""
            config={{ label: 'Next Step', requiresLossReason: true, outcomes: PROPOSAL_OUTCOMES }}
            onSuccess={handleAdvance}
            onClose={closeWidget}
          />
        );
      case 'follow_up':
        return (
          <OutcomeButtonsWidget
            leadId={lead.id}
            toStage=""
            config={{
              label: 'Outcome',
              requiresLossReason: true,
              datetimeFirst: true,
              datetimeLabel: 'Next Follow-Up',
              outcomes: PROPOSAL_OUTCOMES,
            }}
            onSuccess={handleAdvance}
            onClose={closeWidget}
          />
        );
      case 'contract_signed':
        return (
          <MoneyConfirmWidget
            leadId={lead.id}
            toStage="deposit_received"
            config={{ label: 'Collect Deposit', moneyField: 'depositAmount' }}
            onSuccess={handleAdvance}
            onClose={closeWidget}
          />
        );
      case 'deposit_received':
        return (
          <AssignUserWidget
            leadId={lead.id}
            toStage="pm_handoff"
            config={{ label: 'Assign Project Manager', sourcePipeline: 'retail' }}
            onSuccess={handleAdvance}
            onClose={closeWidget}
          />
        );
      default:
        return null;
    }
  }

  const footerAction = renderFooterAction();
  const widgetForm   = renderWidgetForm();

  return (
    <StageCard
      stageEnteredAt={lead.stageEnteredAt}
      loopNextActionAt={lead.loopNextActionAt}
      isLoopStage={colDef.isLoopStage}
      needsStageReview={lead.needsStageReview}
    >
      {/* Name + rep avatar */}
      <div className="flex items-start gap-2">
        <Link href={`/leads/${lead.id}`} className="flex-1 min-w-0 block">
          <p
            className={cn(
              'text-sm font-bold leading-tight truncate pr-1 transition-colors',
              lead.customerName
                ? 'text-white hover:text-blue-300'
                : 'text-white/30 italic font-normal',
            )}
          >
            {lead.customerName ?? 'No name'}
          </p>
        </Link>
        <div
          className={cn(
            'shrink-0 w-[22px] h-[22px] rounded-full flex items-center justify-center',
            'text-[10px] font-bold text-white leading-none select-none',
            avatarColor,
          )}
        >
          {repInitial}
        </div>
      </div>

      {/* Address */}
      <p className="text-[11px] text-white/50 mt-1 leading-snug line-clamp-2">
        {lead.address ?? 'Unknown address'}
      </p>

      {/* Stage status hint (e.g. "Awaiting proposal") */}
      {stageStatus && (
        <p className={cn('text-[11px] font-semibold mt-1.5', colDef.textAccent)}>
          {stageStatus}
        </p>
      )}

      {/* Loss reason for archived leads */}
      {stage === 'archived_lost' && lead.lossReason && (
        <span className="mt-1.5 inline-block text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 capitalize">
          {lead.lossReason.replace(/_/g, ' ')}
        </span>
      )}

      {/* Inline expanded widget form */}
      {widgetForm && (
        <div className="mt-2.5 pt-2 border-t border-white/[0.08]">
          {widgetForm}
        </div>
      )}

      {/* Footer: rep source + action trigger */}
      <div className="flex items-center justify-between mt-3 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <User className="h-3 w-3 text-white/30 shrink-0" />
          <span className="text-[10px] text-white/40 truncate">
            {lead.repName ?? 'Unassigned'}
          </span>
        </div>
        {footerAction}
      </div>
    </StageCard>
  );
}

// ---------------------------------------------------------------------------
// Accordion section
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  col: RetailStageCol;
  cards: RetailLead[];
  isLoading: boolean;
  open: boolean;
  onToggle: () => void;
  onAdvance: () => void;
}

function AccordionSection({
  col,
  cards,
  isLoading,
  open,
  onToggle,
  onAdvance,
}: AccordionSectionProps) {
  // Sort follow_up cards by loopNextActionAt ascending (overdue first)
  const sorted = useMemo(() => {
    if (col.key !== 'follow_up') return cards;
    return [...cards].sort((a, b) => {
      const aT = a.loopNextActionAt ? new Date(a.loopNextActionAt).getTime() : Infinity;
      const bT = b.loopNextActionAt ? new Date(b.loopNextActionAt).getTime() : Infinity;
      return aT - bT;
    });
  }, [cards, col.key]);

  return (
    <div className="rounded-xl overflow-hidden bg-[#13162a] border border-white/[0.06]">
      {/* Section header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
      >
        {/* Colored accent pip */}
        <div className={cn('w-[3px] h-5 rounded-full shrink-0', col.pipBg)} />
        <span className={cn('text-sm font-bold flex-1', col.textAccent)}>{col.label}</span>
        {col.isLoopStage && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-semibold mr-1">
            loop
          </span>
        )}
        {col.isTerminal && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.07] text-white/40 font-semibold mr-1">
            terminal
          </span>
        )}
        <span className={cn('text-sm font-bold tabular-nums mr-1', col.textAccent)}>
          {isLoading ? '—' : cards.length}
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-white/30 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-white/[0.04]">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-2">
              <Skeleton className="h-36 w-full rounded-xl opacity-30" />
              <Skeleton className="h-36 w-full rounded-xl opacity-20" />
              <Skeleton className="h-36 w-full rounded-xl opacity-10" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-xs text-white/20 italic py-5 text-center">
              No leads in this stage
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-2">
              {sorted.map((lead) => (
                <RetailCard
                  key={lead.id}
                  lead={lead}
                  colDef={col}
                  onAdvance={onAdvance}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RetailPipeline() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetRetailPipeline();
  const leads = data?.leads ?? [];

  // Persist last-visited pipeline so the home redirect can resume here.
  useEffect(() => { localStorage.setItem('rt_last_pipeline', '/retail-pipeline'); }, []);

  // Demo leads filter (persistent across page loads)
  const [hideDemos, setHideDemos] = useState(
    () => localStorage.getItem('rt_hide_demos') === 'true',
  );
  const visibleLeads = hideDemos ? leads.filter((l) => !l.isDemo) : leads;

  // archived_lost hidden by default; toggle to reveal
  const [showLost, setShowLost] = useState(false);

  const visibleCols = showLost
    ? RETAIL_STAGE_COLS
    : RETAIL_STAGE_COLS.filter((c) => c.key !== 'archived_lost');

  const grouped = useMemo(() => {
    const map = new Map<string, RetailLead[]>();
    for (const col of RETAIL_STAGE_COLS) map.set(col.key, []);
    for (const lead of visibleLeads) {
      const key = lead.stageKey ?? lead.retailStage;
      if (map.has(key)) {
        map.get(key)!.push(lead);
      }
      // else: stage is a project-pipeline key (pm_handoff, etc.) — the API
      // should already have excluded these, but drop silently as a safety net.
    }
    return map;
  }, [visibleLeads]);

  const lostCount = grouped.get('archived_lost')?.length ?? 0;
  const activeCount = visibleLeads.filter(
    (l) => (l.stageKey ?? l.retailStage) !== 'archived_lost',
  ).length;
  const demoCount = leads.filter((l) => l.isDemo).length;

  // Start with all non-terminal stages open
  const [openStages, setOpenStages] = useState<Set<string>>(
    () => new Set(RETAIL_STAGE_COLS.filter((c) => !c.isTerminal).map((c) => c.key)),
  );

  const toggle = (key: string) => {
    setOpenStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onAdvance = () => qc.invalidateQueries({ queryKey: getRetailPipelineQueryKey() });

  return (
    <Shell>
      <div className="space-y-4 max-w-6xl">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Retail Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading
                ? 'Loading…'
                : `${activeCount} active lead${activeCount !== 1 ? 's' : ''}${lostCount > 0 ? ` · ${lostCount} lost` : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Hide demo toggle */}
            {demoCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideDemos}
                  onChange={(e) => {
                    setHideDemos(e.target.checked);
                    localStorage.setItem('rt_hide_demos', String(e.target.checked));
                  }}
                  className="rounded border-border"
                />
                Hide demo
                <span className="text-[10px] tabular-nums bg-muted px-1.5 py-0.5 rounded-full">
                  {demoCount}
                </span>
              </label>
            )}
            {demoCount > 0 && <span className="text-muted-foreground/30 text-xs">·</span>}
            {/* Show Lost toggle */}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showLost}
                onChange={(e) => {
                  setShowLost(e.target.checked);
                  if (e.target.checked) {
                    setOpenStages((prev) => new Set([...prev, 'archived_lost']));
                  }
                }}
                className="rounded border-border"
              />
              Show Lost
              {lostCount > 0 && (
                <span className="text-[10px] tabular-nums bg-muted px-1.5 py-0.5 rounded-full">
                  {lostCount}
                </span>
              )}
            </label>
            <span className="text-muted-foreground/30 text-xs">·</span>
            <button
              type="button"
              onClick={() => setOpenStages(new Set(visibleCols.map((c) => c.key)))}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Expand all
            </button>
            <span className="text-muted-foreground/30 text-xs">·</span>
            <button
              type="button"
              onClick={() => setOpenStages(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Collapse all
            </button>
          </div>
        </div>

        {/* Stage pill nav */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
          {visibleCols.map((col) => {
            const count = grouped.get(col.key)?.length ?? 0;
            const active = openStages.has(col.key);
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => toggle(col.key)}
                className={cn(
                  'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all',
                  count > 0
                    ? cn(
                        col.accent,
                        col.textAccent,
                        'bg-card',
                        active ? 'opacity-100' : 'opacity-50',
                      )
                    : 'border-border/40 text-muted-foreground/40 cursor-default',
                )}
                disabled={count === 0}
              >
                {col.label}
                {count > 0 && (
                  <span
                    className={cn(
                      'min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold',
                      active ? 'bg-foreground/15' : 'bg-foreground/10',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Kanban columns */}
        <div className="space-y-2">
          {visibleCols.map((col) => (
            <AccordionSection
              key={col.key}
              col={col}
              cards={grouped.get(col.key) ?? []}
              isLoading={isLoading}
              open={openStages.has(col.key)}
              onToggle={() => toggle(col.key)}
              onAdvance={onAdvance}
            />
          ))}
        </div>
      </div>
    </Shell>
  );
}
