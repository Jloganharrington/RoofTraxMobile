/**
 * Retail Pipeline — 10-stage inline exit-task kanban.
 * Every stage exit is performable from the card in ≤2 clicks.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Shell } from '@/components/layout/Shell';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { differenceInDays } from 'date-fns';
import {
  ChevronDown,
  ChevronRight,
  MapPin,
  Clock,
  Phone,
  CheckCircle2,
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
  ButtonLinkWidget,
} from '@/components/pipeline/widgets';

// ---------------------------------------------------------------------------
// Stage column definitions (spec order)
// ---------------------------------------------------------------------------

interface RetailStageCol {
  key: string;
  label: string;
  accent: string;
  textAccent: string;
  isLoopStage: boolean;
  isTerminal: boolean;
}

const RETAIL_STAGE_COLS: RetailStageCol[] = [
  { key: 'pin_dropped',       label: 'Pin Dropped',       accent: 'border-slate-400',   textAccent: 'text-slate-400',   isLoopStage: false, isTerminal: false },
  { key: 'appt_needed',       label: 'Appt. Needed',      accent: 'border-sky-500',     textAccent: 'text-sky-400',     isLoopStage: false, isTerminal: false },
  { key: 'appt_scheduled',    label: 'Appt. Scheduled',   accent: 'border-blue-500',    textAccent: 'text-blue-400',    isLoopStage: true,  isTerminal: false },
  { key: 'appt_complete',     label: 'Appt. Complete',    accent: 'border-indigo-500',  textAccent: 'text-indigo-400',  isLoopStage: false, isTerminal: false },
  { key: 'proposal_provided', label: 'Proposal Provided', accent: 'border-violet-500',  textAccent: 'text-violet-400',  isLoopStage: false, isTerminal: false },
  { key: 'follow_up',         label: 'Follow Up',         accent: 'border-amber-500',   textAccent: 'text-amber-400',   isLoopStage: true,  isTerminal: false },
  { key: 'contract_pending',  label: 'Contract Pending',  accent: 'border-orange-500',  textAccent: 'text-orange-400',  isLoopStage: true,  isTerminal: false },
  { key: 'contract_signed',   label: 'Contract Signed',   accent: 'border-teal-500',    textAccent: 'text-teal-400',    isLoopStage: false, isTerminal: false },
  { key: 'deposit_received',  label: 'Deposit Received',  accent: 'border-emerald-500', textAccent: 'text-emerald-400', isLoopStage: false, isTerminal: false },
  { key: 'archived_lost',     label: 'Archived – Lost',   accent: 'border-red-700',     textAccent: 'text-red-400',     isLoopStage: false, isTerminal: true  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDamage(dt: string | null | undefined): string {
  if (!dt) return '';
  return dt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Exit widgets per stage
// ---------------------------------------------------------------------------

function PinDroppedWidget({ lead, onAdvance }: { lead: RetailLead; onAdvance: () => void }) {
  return (
    <AssignUserWidget
      leadId={lead.id}
      toStage="appt_needed"
      config={{ label: 'Assign Sales Rep' }}
      onSuccess={onAdvance}
    />
  );
}

function ApptNeededWidget({ lead, onAdvance }: { lead: RetailLead; onAdvance: () => void }) {
  return (
    <DatetimeWidget
      leadId={lead.id}
      toStage="appt_scheduled"
      config={{ label: 'Schedule Appt.', setsNextAction: true }}
      onSuccess={onAdvance}
    />
  );
}

function ApptScheduledWidget() {
  const [confirmed, setConfirmed] = useState(false);
  if (confirmed) {
    return (
      <div className="flex items-center gap-1.5 mt-2 text-xs text-green-600 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Confirmed
      </div>
    );
  }
  return (
    <Button size="sm" className="w-full mt-2" onClick={() => setConfirmed(true)}>
      Confirm Appt.
    </Button>
  );
}

function ApptCompleteWidget({ lead }: { lead: RetailLead }) {
  return (
    <div className="mt-2 space-y-1.5">
      <div className="text-[11px] rounded px-2 py-1 bg-amber-50 text-amber-700 font-medium border border-amber-200">
        Awaiting proposal
      </div>
      <ButtonLinkWidget
        leadId={lead.id}
        toStage=""
        config={{ label: 'Open Proposal Builder', href: `/leads/${lead.id}` }}
      />
    </div>
  );
}

const PROPOSAL_OUTCOMES = [
  { key: 'won',       label: 'Won — Contract',  toStage: 'contract_pending' },
  { key: 'follow_up', label: 'Follow-Up',        toStage: 'follow_up'        },
  { key: 'lost',      label: 'Lost',             toStage: 'archived_lost'    },
];

function ProposalProvidedWidget({ lead, onAdvance }: { lead: RetailLead; onAdvance: () => void }) {
  return (
    <OutcomeButtonsWidget
      leadId={lead.id}
      toStage=""
      config={{
        label: 'Next Step',
        requiresLossReason: true,
        outcomes: PROPOSAL_OUTCOMES,
      }}
      onSuccess={onAdvance}
    />
  );
}

function FollowUpWidget({ lead, onAdvance }: { lead: RetailLead; onAdvance: () => void }) {
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
      onSuccess={onAdvance}
    />
  );
}

function ContractPendingWidget({ lead }: { lead: RetailLead }) {
  return (
    <div className="mt-2 space-y-1.5">
      <div className="text-[11px] rounded px-2 py-1 bg-orange-50 text-orange-700 font-medium border border-orange-200">
        Awaiting signature
      </div>
      <ButtonLinkWidget
        leadId={lead.id}
        toStage=""
        config={{ label: 'Generate Contract', href: `/leads/${lead.id}` }}
      />
    </div>
  );
}

function ContractSignedWidget({ lead, onAdvance }: { lead: RetailLead; onAdvance: () => void }) {
  return (
    <MoneyConfirmWidget
      leadId={lead.id}
      toStage="deposit_received"
      config={{ label: 'Collect Deposit', moneyField: 'depositAmount' }}
      onSuccess={onAdvance}
    />
  );
}

function DepositReceivedWidget({ lead, onAdvance }: { lead: RetailLead; onAdvance: () => void }) {
  return (
    <AssignUserWidget
      leadId={lead.id}
      toStage="pm_handoff"
      config={{ label: 'Assign Project Manager', sourcePipeline: 'retail' }}
      onSuccess={onAdvance}
    />
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
  const stage = lead.stageKey ?? lead.retailStage;

  const daysAgo = lead.createdAt
    ? differenceInDays(new Date(), new Date(lead.createdAt))
    : null;

  function renderWidget(): React.ReactNode {
    switch (stage) {
      case 'pin_dropped':      return <PinDroppedWidget lead={lead} onAdvance={onAdvance} />;
      case 'appt_needed':      return <ApptNeededWidget lead={lead} onAdvance={onAdvance} />;
      case 'appt_scheduled':   return <ApptScheduledWidget />;
      case 'appt_complete':    return <ApptCompleteWidget lead={lead} />;
      case 'proposal_provided':return <ProposalProvidedWidget lead={lead} onAdvance={onAdvance} />;
      case 'follow_up':        return <FollowUpWidget lead={lead} onAdvance={onAdvance} />;
      case 'contract_pending': return <ContractPendingWidget lead={lead} />;
      case 'contract_signed':  return <ContractSignedWidget lead={lead} onAdvance={onAdvance} />;
      case 'deposit_received': return <DepositReceivedWidget lead={lead} onAdvance={onAdvance} />;
      case 'archived_lost':    return null;
      default:                 return null;
    }
  }

  return (
    <StageCard
      stageEnteredAt={lead.stageEnteredAt}
      loopNextActionAt={lead.loopNextActionAt}
      isLoopStage={colDef.isLoopStage}
    >
      {/* Name — links to lead profile */}
      {lead.customerName ? (
        <Link href={`/leads/${lead.id}`}>
          <p className="text-xs font-semibold truncate hover:underline cursor-pointer pr-5">
            {lead.customerName}
          </p>
        </Link>
      ) : (
        <Link href={`/leads/${lead.id}`}>
          <p className="text-xs font-semibold truncate text-muted-foreground italic hover:underline cursor-pointer pr-5">
            No name
          </p>
        </Link>
      )}

      {/* Address */}
      <div className="flex items-start gap-1 mt-1">
        <MapPin className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
        <span className="text-[11px] text-muted-foreground leading-tight line-clamp-2 flex-1">
          {lead.address ?? 'Unknown address'}
        </span>
      </div>

      {/* Phone */}
      {lead.customerPhone && (
        <div className="flex items-center gap-1 mt-0.5">
          <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground">{lead.customerPhone}</span>
        </div>
      )}

      {/* Damage type */}
      {lead.damageType && (
        <span className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {formatDamage(lead.damageType)}
        </span>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/40">
        <span className="text-[10px] text-muted-foreground truncate max-w-[90px]">
          {lead.repName ?? <span className="italic opacity-40">No rep</span>}
        </span>
        {daysAgo !== null && daysAgo > 0 && (
          <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            {daysAgo}d
          </div>
        )}
      </div>

      {/* Loss reason for archived leads */}
      {stage === 'archived_lost' && lead.lossReason && (
        <span className="mt-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 capitalize">
          {lead.lossReason.replace(/_/g, ' ')}
        </span>
      )}

      {/* Exit-task widget */}
      {renderWidget()}
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
    <div className={cn('rounded-2xl border bg-card overflow-hidden border-l-4', col.accent)}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 hover:bg-muted/20 transition-colors text-left"
      >
        <span className={cn('text-sm font-semibold flex-1', col.textAccent)}>{col.label}</span>
        {col.isLoopStage && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium mr-1">
            loop
          </span>
        )}
        {col.isTerminal && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium mr-1">
            terminal
          </span>
        )}
        <span className={cn('text-sm font-bold tabular-nums mr-1', col.textAccent)}>
          {isLoading ? '—' : cards.length}
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground/60 shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-2">
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl opacity-70" />
              <Skeleton className="h-36 w-full rounded-xl opacity-40" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 italic py-5 text-center">
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

  const grouped = useMemo(() => {
    const map = new Map<string, RetailLead[]>();
    for (const col of RETAIL_STAGE_COLS) map.set(col.key, []);
    for (const lead of leads) {
      const key = lead.stageKey ?? lead.retailStage;
      if (map.has(key)) {
        map.get(key)!.push(lead);
      }
      // else: stage is a project-pipeline key (pm_handoff, etc.) — the API
      // should already have excluded these, but drop silently as a safety net.
    }
    return map;
  }, [leads]);

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
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Retail Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading
                ? 'Loading…'
                : `${leads.length} lead${leads.length !== 1 ? 's' : ''} across all stages`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpenStages(new Set(RETAIL_STAGE_COLS.map((c) => c.key)))}
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
          {RETAIL_STAGE_COLS.map((col) => {
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
          {RETAIL_STAGE_COLS.map((col) => (
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
