/**
 * Retail Pipeline — Kanban accordion view.
 * Stages: Appt. Scheduled → Confirmed → Estimate → Follow-Up → Contract → Deposit → Archived
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Shell } from "@/components/layout/Shell";
import { Skeleton } from "@/components/ui/skeleton";
import { differenceInDays } from "date-fns";
import { ChevronDown, ChevronRight, MapPin, Clock, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetPipeline, type PipelineInspection } from "@/lib/claimHubApi";

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

interface RetailStage {
  key: string;
  label: string;
  statuses: string[];
  accent: string;
  textAccent: string;
}

const RETAIL_STAGES: RetailStage[] = [
  { key: 'pin_dropped',      label: 'Pin Dropped',        statuses: [],             accent: 'border-slate-400',   textAccent: 'text-slate-400' },
  { key: 'appt_scheduled',   label: 'Appt. Scheduled',   statuses: ['scheduled'],  accent: 'border-green-500',   textAccent: 'text-green-400' },
  { key: 'appt_confirmed',   label: 'Appt. Confirmed',   statuses: [],             accent: 'border-blue-500',    textAccent: 'text-blue-400' },
  { key: 'estimate_provided',label: 'Estimate Provided', statuses: [],             accent: 'border-violet-500',  textAccent: 'text-violet-400' },
  { key: 'followup_required',label: 'Follow-Up Required',statuses: [],             accent: 'border-amber-600',   textAccent: 'text-amber-400' },
  { key: 'contract_signed',  label: 'Contract Signed',   statuses: ['submitted'],  accent: 'border-teal-500',    textAccent: 'text-teal-400' },
  { key: 'deposit_received', label: 'Deposit Received',  statuses: [],             accent: 'border-emerald-500', textAccent: 'text-emerald-400' },
  { key: 'archived_lost',    label: 'Archived – Lost',   statuses: [],             accent: 'border-red-700',     textAccent: 'text-red-400' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDamageType(dt: string | null | undefined): string {
  if (!dt) return '';
  return dt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Claim card
// ---------------------------------------------------------------------------

function ClaimCard({ inspection }: { inspection: PipelineInspection }) {
  const daysInStage = inspection.updatedAt
    ? differenceInDays(new Date(), new Date(inspection.updatedAt as string))
    : null;
  const hasPackage = (inspection.compiledReportVersions ?? []).length > 0;

  return (
    <Link href={`/inspections/${inspection.id}`}>
      <div className="group rounded-xl border bg-card hover:bg-card/80 p-3 cursor-pointer transition-all hover:shadow-md space-y-2 h-full">
        <div className="flex items-start gap-2">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-xs font-medium leading-tight line-clamp-2 flex-1">
            {inspection.address ?? 'Unknown address'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasPackage && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
              <Package className="h-2.5 w-2.5" />
              Package
            </span>
          )}
          {inspection.damageType && (
            <span className="text-[10px] text-muted-foreground">
              {formatDamageType(inspection.damageType)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <span className="text-[10px] text-muted-foreground truncate max-w-[110px]">
            {inspection.repName ?? <span className="italic opacity-50">No rep</span>}
          </span>
          {daysInStage !== null && (
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {daysInStage === 0 ? 'today' : `${daysInStage}d`}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Accordion section
// ---------------------------------------------------------------------------

interface AccordionSectionProps {
  stage: RetailStage;
  cards: PipelineInspection[];
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
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl opacity-70" />
              <Skeleton className="h-24 w-full rounded-xl opacity-40" />
            </div>
          ) : cards.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 italic py-5 text-center">No leads in this stage</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-2">
              {cards.map((insp) => (
                <ClaimCard key={insp.id} inspection={insp} />
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
  const { data, isLoading } = useGetPipeline();
  const inspections = data?.inspections ?? [];

  const statusToStageKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of RETAIL_STAGES) {
      for (const s of stage.statuses) map.set(s, stage.key);
    }
    return map;
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, PipelineInspection[]>();
    for (const stage of RETAIL_STAGES) map.set(stage.key, []);
    for (const insp of inspections) {
      const stageKey = statusToStageKey.get(insp.status) ?? null;
      if (stageKey) map.get(stageKey)?.push(insp);
    }
    return map;
  }, [inspections, statusToStageKey]);

  const [openStages, setOpenStages] = useState<Set<string>>(
    () => new Set(RETAIL_STAGES.map((s) => s.key))
  );

  const toggle = (key: string) => {
    setOpenStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const total = inspections.length;

  return (
    <Shell>
      <div className="space-y-4 max-w-6xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Retail Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading ? 'Loading…' : `${total} lead${total !== 1 ? 's' : ''} across all stages`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpenStages(new Set(RETAIL_STAGES.map((s) => s.key)))}
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

        <div className="space-y-2">
          {RETAIL_STAGES.map((stage) => (
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
