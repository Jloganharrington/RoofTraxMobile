/**
 * Retail Pipeline — Kanban accordion view backed by real pins/lead data.
 * Stage is derived server-side from doorKnockResult, contactOutcome, and linked inspection status.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { Skeleton } from "@/components/ui/skeleton";
import { differenceInDays } from "date-fns";
import { ChevronDown, ChevronRight, MapPin, Clock, Phone, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetRetailPipeline, type RetailLead } from "@/lib/claimHubApi";

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

interface RetailStage {
  key: string;
  label: string;
  accent: string;
  textAccent: string;
}

const RETAIL_STAGES: RetailStage[] = [
  { key: 'pin_dropped',       label: 'Pin Dropped',        accent: 'border-slate-400',   textAccent: 'text-slate-400' },
  { key: 'appt_scheduled',    label: 'Appt. Scheduled',    accent: 'border-green-500',   textAccent: 'text-green-400' },
  { key: 'appt_confirmed',    label: 'Appt. Confirmed',    accent: 'border-blue-500',    textAccent: 'text-blue-400' },
  { key: 'estimate_provided', label: 'Estimate Provided',  accent: 'border-violet-500',  textAccent: 'text-violet-400' },
  { key: 'followup_required', label: 'Follow-Up Required', accent: 'border-amber-600',   textAccent: 'text-amber-400' },
  { key: 'contract_signed',   label: 'Contract Signed',    accent: 'border-teal-500',    textAccent: 'text-teal-400' },
  { key: 'deposit_received',  label: 'Deposit Received',   accent: 'border-emerald-500', textAccent: 'text-emerald-400' },
  { key: 'archived_lost',     label: 'Archived – Lost',    accent: 'border-red-700',     textAccent: 'text-red-400' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OUTCOME_LABELS: Record<string, string> = {
  appointment:         'Appt.',
  no_appointment:      'No Appt.',
  no_answer:           'No Answer',
  no_soliciting:       'No Soliciting',
  priority_inspection: 'Priority',
  call_to_schedule:    'Call Back',
};

function formatDamage(dt: string | null | undefined): string {
  if (!dt) return '';
  return dt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Lead card
// ---------------------------------------------------------------------------

function LeadCard({ lead }: { lead: RetailLead }) {
  const daysAgo = lead.createdAt
    ? differenceInDays(new Date(), new Date(lead.createdAt))
    : null;

  const inner = (
    <div className="group rounded-xl border bg-card hover:bg-card/80 p-3 cursor-pointer transition-all hover:shadow-md space-y-2 h-full">
      {/* Name */}
      {lead.customerName && (
        <p className="text-xs font-semibold truncate">{lead.customerName}</p>
      )}

      {/* Address */}
      <div className="flex items-start gap-1.5">
        <MapPin className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
        <span className="text-[11px] text-muted-foreground leading-tight line-clamp-2 flex-1">
          {lead.address ?? 'Unknown address'}
        </span>
      </div>

      {/* Phone */}
      {lead.customerPhone && (
        <div className="flex items-center gap-1.5">
          <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground">{lead.customerPhone}</span>
        </div>
      )}

      {/* Outcome + damage badges */}
      <div className="flex flex-wrap gap-1">
        {lead.doorKnockResult && OUTCOME_LABELS[lead.doorKnockResult] && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
            {OUTCOME_LABELS[lead.doorKnockResult]}
          </span>
        )}
        {lead.damageType && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {formatDamage(lead.damageType)}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
          {lead.repName ?? <span className="italic opacity-40">No rep</span>}
        </span>
        <div className="flex items-center gap-1.5">
          {lead.inspectionId && (
            <ExternalLink className="h-3 w-3 text-primary/60" />
          )}
          {daysAgo !== null && (
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {daysAgo === 0 ? 'today' : `${daysAgo}d`}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return <Link href={`/leads/${lead.id}`}>{inner}</Link>;
}

// ---------------------------------------------------------------------------
// Accordion section
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  stage: RetailStage;
  cards: RetailLead[];
  isLoading: boolean;
  open: boolean;
  onToggle: () => void;
}

function AccordionSection({ stage, cards, isLoading, open, onToggle }: AccordionSectionProps) {
  return (
    <div className={cn("rounded-2xl border bg-card overflow-hidden border-l-4", stage.accent)}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 hover:bg-muted/20 transition-colors text-left"
      >
        <span className={cn("text-sm font-semibold flex-1", stage.textAccent)}>{stage.label}</span>
        <span className={cn("text-sm font-bold tabular-nums mr-1", stage.textAccent)}>
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
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl opacity-70" />
              <Skeleton className="h-28 w-full rounded-xl opacity-40" />
            </div>
          ) : cards.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 italic py-5 text-center">No leads in this stage</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-2">
              {cards.map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
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
  const { data, isLoading } = useGetRetailPipeline();
  const leads = data?.leads ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, RetailLead[]>();
    for (const stage of RETAIL_STAGES) map.set(stage.key, []);
    for (const lead of leads) {
      map.get(lead.retailStage)?.push(lead);
    }
    return map;
  }, [leads]);

  const [openStages, setOpenStages] = useState<Set<string>>(
    () => new Set(RETAIL_STAGES.map(s => s.key))
  );

  const toggle = (key: string) => {
    setOpenStages(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <Shell>
      <div className="space-y-4 max-w-6xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Retail Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading ? 'Loading…' : `${leads.length} lead${leads.length !== 1 ? 's' : ''} across all stages`}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpenStages(new Set(RETAIL_STAGES.map(s => s.key)))}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Expand all
            </button>
            <span className="text-muted-foreground/30 text-xs">·</span>
            <button type="button" onClick={() => setOpenStages(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Collapse all
            </button>
          </div>
        </div>

        {/* Stage menu — horizontal scrollable pills showing count per stage */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
          {RETAIL_STAGES.map(stage => {
            const count = grouped.get(stage.key)?.length ?? 0;
            const active = openStages.has(stage.key);
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => toggle(stage.key)}
                className={cn(
                  'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all',
                  count > 0
                    ? cn(stage.accent, stage.textAccent, 'bg-card', active ? 'opacity-100' : 'opacity-50')
                    : 'border-border/40 text-muted-foreground/40 cursor-default',
                )}
                disabled={count === 0}
              >
                {stage.label}
                {count > 0 && (
                  <span className={cn(
                    'min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold',
                    active ? 'bg-foreground/15' : 'bg-foreground/10',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          {RETAIL_STAGES.map(stage => (
            <AccordionSection
              key={stage.key}
              stage={stage}
              cards={grouped.get(stage.key) ?? []}
              isLoading={isLoading}
              open={openStages.has(stage.key)}
              onToggle={() => toggle(stage.key)}
            />
          ))}
        </div>
      </div>
    </Shell>
  );
}
